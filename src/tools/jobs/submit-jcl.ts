/**
 * `submit_jcl` — submit inline JCL for execution, governed.
 *
 * Pipeline (in order):
 *   1. JCL structural validation + size cap
 *   2. JOB card overrides (CLASS/NOTIFY)
 *   3. JCL pre-flight scan (SECURITY_JCL_SCAN)
 *   4. Change-ticket requirement (SECURITY_CHANGE_TICKET_PATTERN)
 *   5. Change window (SECURITY_WRITE_WINDOW)
 *   6. Dry-run / approval / submit
 *
 * With `dryRun=true` nothing is enforced beyond structure — the tool reports
 * exactly what a real submission would do. With SECURITY_WRITE_APPROVAL=true
 * a validated submission is registered as pending and only `approve_write`
 * executes it.
 */
import { z } from 'zod';
import { SubmitJobs, GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import type { ToolRegistrar, ToolContext } from '../../types/tools.js';
import { ValidationError, ConfigError, ForbiddenError } from '../../utils/errors.js';
import { formatJobStatus, textResult, formatStructuredResponse, renderTable } from '../../utils/formatters.js';
import { assertChangeTicket, assertJclSizeAllowed, resolveIdentity } from '../../utils/security.js';
import { defineTool } from '../../utils/define-tool.js';
import { scanJcl, type JclFinding } from '../../utils/jcl-scan.js';
import { parseWriteWindow, assertWithinWriteWindow, type ParsedWriteWindow } from '../../utils/write-window.js';
import { effectiveSession } from '../../zowe/enduser.js';
import { registerPending } from './pending-approvals.js';
import { normalizeJob } from './shared.js';

const inputShape = {
  jcl: z
    .string()
    .min(1)
    .describe('The complete inline JCL to submit (including the //JOB card).'),
  wait: z
    .boolean()
    .optional()
    .describe('Whether to wait for the job to complete execution before returning.'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum time to wait in seconds (defaults to 30, max 300). Only used when wait=true.'),
  jobClass: z
    .string()
    .length(1)
    .regex(/^[A-Z0-9]$/, 'Job class must be a single alphanumeric character (A-Z, 0-9).')
    .optional()
    .describe('Override the CLASS= parameter on the JOB card (single char, A-Z or 0-9).'),
  notify: z
    .string()
    .max(8)
    .regex(/^[A-Z0-9@#$]{1,8}$/i, 'Notify user id must be 1–8 alphanumeric/national characters.')
    .optional()
    .describe('Override the NOTIFY= parameter on the JOB card (TSO user id, max 8 chars).'),
  dryRun: z
    .boolean()
    .optional()
    .describe('Validate and report without submitting. Runs the same structure checks, JCL scan, and governance report as a real submission.'),
  changeTicket: z
    .string()
    .max(32)
    .optional()
    .describe('Change/ticket ID for governed writes. Required when SECURITY_CHANGE_TICKET_PATTERN is configured.'),
};

/**
 * Attempt to rewrite a JOB card parameter in-place.
 * Only the `//name JOB ...` statement is considered, so identically-named
 * parameters on SET statements or later cards are left untouched.
 * Returns the modified JCL and a note if the parameter was not found.
 */
export function rewriteJobCardParam(jcl: string, param: string, value: string): { jcl: string; note: string | null } {
  const lines = jcl.split('\n');
  const jobCardIndex = lines.findIndex((line) => /^\/\/[A-Z0-9@#$]{1,8}\s+JOB\b/i.test(line));

  if (jobCardIndex >= 0) {
    const regex = new RegExp(`(\\b${param}=)[^\\s,)]+`, 'i');
    const jobCard = lines[jobCardIndex];
    if (regex.test(jobCard)) {
      // Function replacement so "$" and "$'" in the value are taken literally.
      lines[jobCardIndex] = jobCard.replace(regex, (_match, prefix: string) => prefix + value);
      return { jcl: lines.join('\n'), note: null };
    }
  }
  return {
    jcl,
    note: `[Note: ${param}= parameter not found on JOB card; original JCL submitted unchanged for ${param}.]`,
  };
}

/** Structural JCL validation shared by submit, dry-run, and approval. */
function validateJclStructure(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n').trim();

  if (!/^\/\//.test(normalized)) {
    throw new ValidationError('JCL must begin with a "//" JOB statement.');
  }
  if (normalized.includes('\0')) {
    throw new ValidationError('JCL must not contain null characters.');
  }

  // Ensure at least one EXEC step follows the JOB card. Comment lines
  // ("//*") must not satisfy this check.
  const linesAfterJob = normalized.split('\n').slice(1);
  const hasExec = linesAfterJob.some(
    (line) => !line.trim().startsWith('//*') && /^\/\/\S*\s+EXEC\s/i.test(line),
  );
  if (!hasExec) {
    throw new ValidationError(
      'JCL must contain at least one EXEC statement after the JOB card.',
    );
  }
  return normalized;
}

/** Parse the configured change window once; bad config surfaces as ConfigError. */
function parseConfiguredWindow(ctx: ToolContext): ParsedWriteWindow | undefined {
  const { writeWindow, writeDays, writeWindowTz } = ctx.config.security;
  if (!writeWindow) return undefined;
  try {
    return parseWriteWindow(writeWindow, writeDays, writeWindowTz);
  } catch (err) {
    throw new ConfigError(err instanceof Error ? err.message : String(err));
  }
}

function runScan(ctx: ToolContext, jcl: string): JclFinding[] {
  if (!ctx.config.security.jclScan) return [];
  return scanJcl(jcl, {
    blockedPrograms: ctx.config.security.blockedPrograms?.split(',').map((p) => p.trim()).filter(Boolean),
    blockedJobClasses: ctx.config.security.blockedJobClasses?.split(',').map((c) => c.trim()).filter(Boolean),
  });
}

function findingsTable(findings: JclFinding[]): string {
  if (findings.length === 0) {
    return 'No findings — JCL passed the pre-flight scan.';
  }
  return renderTable(
    ['Severity', 'Rule', 'Line', 'Detail'],
    findings.map((f) => [f.severity, f.rule, String(f.line), f.message]),
  );
}

/** Enforce scan/ticket/window gates for a real submission. */
function enforceGovernance(ctx: ToolContext, findings: JclFinding[], changeTicket?: string): void {
  const { jclScanStrict } = ctx.config.security;
  const blocking = findings.filter((f) => f.severity === 'BLOCK' || (jclScanStrict && f.severity === 'WARN'));
  if (blocking.length > 0) {
    throw new ForbiddenError(
      `JCL pre-flight scan blocked the submission (${blocking.length} finding(s)).` +
        (jclScanStrict ? ' Strict mode: WARN findings also block.' : ''),
      { findings: findingsTable(blocking) },
    );
  }

  // The active policy role may declare its own change-ticket pattern, which
  // overrides the server-wide SECURITY_CHANGE_TICKET_PATTERN.
  const { role } = resolveIdentity(ctx);
  assertChangeTicket(ctx.config, changeTicket, role.changeTicketPattern);

  const window = parseConfiguredWindow(ctx);
  if (window) assertWithinWriteWindow(window);
}

/** Submit prepared JCL and render the result (shared with approve_write). */
export async function submitPreparedJcl(
  ctx: ToolContext,
  jcl: string,
  opts: { wait?: boolean; timeout?: number; prefix?: string },
): Promise<string> {
  const session = await effectiveSession(ctx);
  const submitted = await SubmitJobs.submitJcl(session, jcl);
  let job = normalizeJob(submitted);
  ctx.logger.info({ jobId: job.jobId, jobName: job.jobName }, opts.prefix ?? 'submit_jcl');

  if (opts.wait) {
    const timeoutSeconds = Math.min(opts.timeout ?? 30, 300);
    const start = Date.now();
    while (job.status !== 'OUTPUT' && Date.now() - start < timeoutSeconds * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const rawJob = await GetJobs.getJob(session, job.jobId);
        if (rawJob) {
          job = normalizeJob(rawJob);
        }
      } catch {
        // Transient poll failure (e.g. network blip): keep the last known
        // status and retry until the timeout expires rather than failing a
        // submission that already succeeded.
      }
    }
    const note = `[Wait mode: polling every 2s, timeout ${timeoutSeconds}s]`;
    if (job.status === 'OUTPUT') {
      return `Submitted successfully and completed execution.\n${note}\n\n${formatJobStatus(job)}`;
    }
    return `Submitted successfully but execution did not finish within ${timeoutSeconds} seconds.\n${note}\n\n${formatJobStatus(job)}`;
  }

  return `Submitted successfully.\n\n${formatJobStatus(job)}`;
}

export const registerSubmitJclTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'submit_jcl', 'Submit inline JCL to JES for execution. Governed: pre-flight scan, change ticket, change window, optional dry-run and human approval (SECURITY_* settings).', inputShape, async ({ jcl, wait, timeout, jobClass, notify, dryRun, changeTicket }) => {
      const normalized = validateJclStructure(jcl);
      assertJclSizeAllowed(ctx.config, normalized);

      // Apply JOB card overrides
      const overrideNotes: string[] = [];
      let prepared = normalized;
      if (jobClass) {
        const { jcl: patched, note } = rewriteJobCardParam(prepared, 'CLASS', jobClass.toUpperCase());
        prepared = patched;
        if (note) overrideNotes.push(note);
      }
      if (notify) {
        const { jcl: patched, note } = rewriteJobCardParam(prepared, 'NOTIFY', notify.toUpperCase());
        prepared = patched;
        if (note) overrideNotes.push(note);
      }
      const overrideSuffix = overrideNotes.length > 0 ? '\n\n' + overrideNotes.join('\n') : '';

      // JCL pre-flight scan (always run when enabled — dry-run reports it)
      const findings = runScan(ctx, prepared);

      // ---- Dry-run: report, enforce nothing ------------------------------
      if (dryRun) {
        const window = parseConfiguredWindow(ctx);
        const effectiveTicketPattern = resolveIdentity(ctx).role.changeTicketPattern ?? ctx.config.security.changeTicketPattern;
        const sections = [
          { heading: 'Validation', body: 'JCL structure and size checks passed. Submission was NOT performed.' },
          { heading: 'Pre-flight scan', body: findingsTable(findings) },
          {
            heading: 'Governance',
            body: [
              `Change ticket: ${effectiveTicketPattern ? `required (must match /${effectiveTicketPattern}/)${changeTicket ? ` — provided: "${changeTicket}"` : ' — not provided'}` : 'not required'}`,
              `Change window: ${window ? 'configured — a real submission must be inside the window' : 'none configured'}`,
              `Human approval: ${ctx.config.security.writeApproval ? 'ENABLED — a real submission returns a one-time approval token for approve_write' : 'disabled — a real submission executes immediately'}`,
              `Identity: ${ctx.config.zosmf.userId ? `end-user ${ctx.config.zosmf.userId} (PassTicket propagation)` : 'service account'}`,
              overrideNotes.length > 0 ? `Overrides:\n${overrideNotes.map((n) => `  ${n}`).join('\n')}` : 'Overrides: none',
            ].join('\n'),
          },
        ];
        ctx.logger.debug({ dryRun: true, findings: findings.length }, 'submit_jcl');
        return textResult(formatStructuredResponse('JCL Dry Run — no job submitted', sections));
      }

      // ---- Real submission: enforce gates --------------------------------
      enforceGovernance(ctx, findings, changeTicket);

      if (ctx.config.security.writeApproval) {
        const pending = registerPending(prepared, changeTicket, findings);
        ctx.logger.info({ pendingToken: '[redacted]', expiresInMs: pending.expiresAt - Date.now() }, 'submit_jcl pending approval');
        return textResult(
          formatStructuredResponse('Pending approval — JCL was NOT submitted', [
            {
              heading: 'What happens next',
              body:
                'Write approval is enforced (SECURITY_WRITE_APPROVAL=true). A human must review the JCL below, then call approve_write with the token.',
            },
            {
              heading: 'Approval token',
              body: `${pending.token}\n(expires in 10 minutes; one-time use)`,
            },
            {
              heading: 'Pre-flight scan',
              body: findingsTable(findings),
            },
            {
              heading: 'JCL to be submitted',
              body: prepared,
            },
          ]) + overrideSuffix,
        );
      }

      const result = await submitPreparedJcl(ctx, prepared, { wait, timeout });
      return textResult(result + overrideSuffix);
    });
};
