/**
 * Console and JES tools.
 *
 * Operator commands are executed through the z/OSMF Console API using a
 * (dynamically activated) extended MCS console — every command tool is a
 * governed write (blocked by SECURITY_READ_ONLY, subject to policy role
 * gates, change tickets, and change windows). Reads: operations-log tail,
 * HSM activity, WLM displays. Writes: MVS commands, JES2 hold/release,
 * job cancel, IMS commands, and the LOGREC (EREP) report job.
 */
import { z } from 'zod';
import { CancelJobs, GetJobs, SubmitJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import type { ToolRegistrar, ToolContext } from '../../types/tools.js';
import { textResult, formatStructuredResponse, truncateLines, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { ValidationError, NotFoundError } from '../../utils/errors.js';
import { buildErepJcl, parseErepSummary } from '../../utils/erep.js';
import {
  buildHoldCommand,
  buildReleaseCommand,
  filterHsmMessages,
  normalizeImsCommand,
} from '../../utils/console-ops.js';
import { fetchJob, normalizeJob, fetchSpoolFiles, fetchSpoolContent } from '../jobs/shared.js';
import { effectiveSession } from '../../zowe/enduser.js';
import {
  collectConsoleMessages,
  getUnsolicitedMessages,
  issueMvsCommand,
} from './shared.js';

/** Cap on console text returned to the agent. */
const CONSOLE_LINE_CAP = 200;

function consoleBody(title: string, command: string, response: string, consoleName: string, extra?: string): string {
  const sections = [
    { heading: 'Command', body: `${command}  (console ${consoleName})` },
    { heading: 'Response', body: truncateLines(response, CONSOLE_LINE_CAP).text },
  ];
  if (extra) sections.push({ heading: 'Note', body: extra });
  return formatStructuredResponse(title, sections);
}

/** Poll an EREP job to OUTPUT (bounded), then return its SYSOUT text. */
async function waitAndFetchErepOutput(
  ctx: ToolContext,
  jobName: string,
  jobId: string,
  timeoutSeconds: number,
): Promise<string> {
  const session = await effectiveSession(ctx);
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const raw = await GetJobs.getJob(session, jobId).catch(() => undefined);
    if (raw?.status?.toUpperCase() === 'OUTPUT') {
      const files = await fetchSpoolFiles(ctx, jobName, jobId);
      const sysout = files.find((f) => f.ddName.toUpperCase() === 'SYSOUT') ?? files[0];
      if (!sysout) throw new NotFoundError(`EREP job ${jobId} produced no spool output.`);
      return fetchSpoolContent(ctx, jobName, jobId, sysout.id);
    }
  }
  throw new NotFoundError(
    `EREP job ${jobId} did not reach OUTPUT within ${timeoutSeconds}s. Check get_job_status later; the report is in the SYSOUT DD.`,
  );
}

export const registerConsoleTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'issue_console_command',
    'Issue an MVS system/operator command through an extended MCS console (gated write). Examples: "D A,L", "D GRS,RES=(*,SYS1.PROCLIB)", "D WLM".',
    {
      command: z
        .string()
        .min(1)
        .max(126)
        .describe('MVS command text, e.g. "D A,L" or "D GRS,RES=(*,SYS1.PROCLIB)".'),
      consoleName: z
        .string()
        .max(8)
        .optional()
        .describe('Extended MCS console name (1–8 chars). Defaults to ZOSMF_CONSOLE_NAME.'),
      collectKey: z
        .string()
        .optional()
        .describe('Response key from a previous call — collects follow-up messages for that command.'),
    },
    async ({ command, consoleName, collectKey }) => {
      if (collectKey) {
        const messages = await collectConsoleMessages(ctx, consoleName ?? ctx.config.enterprise.consoleName, collectKey);
        return textResult(formatStructuredResponse('Console follow-up messages', [
          { heading: 'Collected messages', body: truncateLines(messages, CONSOLE_LINE_CAP).text },
        ]));
      }
      const result = await issueMvsCommand(ctx, command, consoleName);
      const extra = result.lastResponseKey
        ? `More messages may be pending — call again with collectKey="${result.lastResponseKey}" to collect them.`
        : undefined;
      return textResult(consoleBody('MVS Command Response', command, result.response, result.consoleName, extra));
    },
  );

  defineTool(
    server,
    ctx,
    'get_console_messages',
    'Read the operations-log tail: recent unsolicited console messages (SYSLOG-style feed) from an extended MCS console.',
    {
      consoleName: z.string().max(8).optional().describe('Console name; defaults to ZOSMF_CONSOLE_NAME.'),
      maxLines: z.number().int().positive().max(1000).optional().describe('Maximum lines to return (default 200).'),
    },
    async ({ consoleName, maxLines }) => {
      const messages = await getUnsolicitedMessages(ctx, consoleName);
      const cap = maxLines ?? CONSOLE_LINE_CAP;
      const joined = messages.length > 0 ? messages.join('\n') : '(no unsolicited messages available)';
      const { text } = truncateLines(joined, cap);
      return textResult(
        formatStructuredResponse(`Operations log tail — ${messages.length} message(s)`, [
          { heading: 'Messages', body: text },
        ]),
      );
    },
  );

  defineTool(
    server,
    ctx,
    'hold_job',
    'Hold a batch job via the JES2 "$HJ" command (gated write). The job stops at the next step boundary.',
    {
      jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
      consoleName: z.string().max(8).optional().describe('Console used to issue the JES2 command.'),
    },
    async ({ jobId, consoleName }) => {
      const command = buildHoldCommand(jobId);
      const result = await issueMvsCommand(ctx, command, consoleName);
      return textResult(consoleBody(`Hold job ${jobId.toUpperCase()}`, command, result.response, result.consoleName));
    },
  );

  defineTool(
    server,
    ctx,
    'release_job',
    'Release a held batch job via the JES2 "$OJ" command (gated write).',
    {
      jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
      consoleName: z.string().max(8).optional().describe('Console used to issue the JES2 command.'),
    },
    async ({ jobId, consoleName }) => {
      const command = buildReleaseCommand(jobId);
      const result = await issueMvsCommand(ctx, command, consoleName);
      return textResult(consoleBody(`Release job ${jobId.toUpperCase()}`, command, result.response, result.consoleName));
    },
  );

  defineTool(
    server,
    ctx,
    'cancel_job',
    'Cancel a running or queued job via the z/OSMF jobs API (gated write).',
    {
      jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
    },
    async ({ jobId }) => {
      const job = await fetchJob(ctx, jobId);
      const session = await effectiveSession(ctx);
      const feedback = await CancelJobs.cancelJobForJob(
        session,
        { jobname: job.jobName, jobid: job.jobId } as never,
        '2.0',
      );
      const detail = (feedback as { message?: string } | undefined)?.message;
      return textResult(
        formatStructuredResponse(`Cancel job ${job.jobName} (${job.jobId})`, [
          { heading: 'Result', body: detail || 'Cancel request accepted by JES. Verify with get_job_status.' },
        ]),
      );
    },
  );

  defineTool(
    server,
    ctx,
    'get_wlm_status',
    'Display Workload Manager state via an MVS "D WLM" console command (gated write: a console command is issued).',
    {
      command: z
        .string()
        .optional()
        .describe('WLM display command (default "D WLM"). Examples: "D WLM", "D WLM,SYSTEMS", "D WLM,RESOURCE=CPU".'),
      consoleName: z.string().max(8).optional().describe('Console name; defaults to ZOSMF_CONSOLE_NAME.'),
    },
    async ({ command, consoleName }) => {
      const cmd = (command ?? 'D WLM').trim();
      if (!/^D\s+WLM/i.test(cmd)) {
        throw new ValidationError(`"${cmd}" is not a WLM display command. Use "D WLM..." or use issue_console_command instead.`);
      }
      const result = await issueMvsCommand(ctx, cmd, consoleName);
      return textResult(consoleBody('WLM Status', cmd, result.response, result.consoleName));
    },
  );

  defineTool(
    server,
    ctx,
    'ims_command',
    'Issue an IMS command through the z/OS system console (gated write). Commands are prefixed with "/", e.g. "/DIS ACTIVE", "/DIS TRAN TRAN1", "/DIS PROG PGM1".',
    {
      command: z.string().min(1).max(120).describe('IMS command, e.g. "/DIS TRAN TRAN1" or "DIS A" (slash added if missing).'),
      consoleName: z.string().max(8).optional().describe('Console name; defaults to ZOSMF_CONSOLE_NAME.'),
      collectKey: z.string().optional().describe('Response key from a previous call — collects follow-up messages.'),
    },
    async ({ command, consoleName, collectKey }) => {
      if (collectKey) {
        const messages = await collectConsoleMessages(ctx, consoleName ?? ctx.config.enterprise.consoleName, collectKey);
        return textResult(formatStructuredResponse('IMS follow-up messages', [
          { heading: 'Collected messages', body: truncateLines(messages, CONSOLE_LINE_CAP).text },
        ]));
      }
      const normalized = normalizeImsCommand(command);
      const result = await issueMvsCommand(ctx, normalized, consoleName);
      const extra = result.lastResponseKey
        ? `IMS responses may trail — collect with collectKey="${result.lastResponseKey}".`
        : undefined;
      return textResult(consoleBody('IMS Command Response', normalized, result.response, result.consoleName, extra));
    },
  );

  defineTool(
    server,
    ctx,
    'get_hsm_activity',
    'Recent DFSMShsm activity (recalls, migrations, backups) filtered from the operations-log tail.',
    {
      consoleName: z.string().max(8).optional().describe('Console name; defaults to ZOSMF_CONSOLE_NAME.'),
      maxLines: z.number().int().positive().max(500).optional().describe('Maximum HSM lines to return (default 50).'),
    },
    async ({ consoleName, maxLines }) => {
      const messages = await getUnsolicitedMessages(ctx, consoleName);
      const hsm = filterHsmMessages(messages, maxLines ?? 50);
      const body = hsm.length > 0 ? hsm.join('\n') : 'No DFSMShsm activity in the recent console messages window.';
      return textResult(
        formatStructuredResponse(`DFSMShsm activity — ${hsm.length} message(s)`, [
          { heading: 'HSM messages', body: truncateLines(body, CONSOLE_LINE_CAP).text },
          {
            heading: 'Coverage note',
            body: 'This reflects recent console traffic only. For full recall/queue state use HSEND from TSO or the HSM CDS reports.',
          },
        ]),
      );
    },
  );

  defineTool(
    server,
    ctx,
    'analyze_logrec',
    'Submit an EREP (IFCEREP) report job against the LOGREC dataset, wait for completion, and summarize hardware/software error records (gated write: submits a batch job).',
    {
      logrecDataset: z
        .string()
        .optional()
        .describe('LOGREC dataset (default LOGREC_DATASET, typically SYS1.LOGREC).'),
      report: z.enum(['SUMMARY', 'HISTORY']).optional().describe('EREP report type (default SUMMARY).'),
      waitSeconds: z.number().int().positive().max(300).optional().describe('How long to wait for the EREP job (default 60s).'),
    },
    async ({ logrecDataset, report, waitSeconds }) => {
      const dataset = (logrecDataset ?? ctx.config.enterprise.logrecDataset).trim().toUpperCase();
      const jcl = buildErepJcl(dataset, report ?? 'SUMMARY');
      const session = await effectiveSession(ctx);
      const submitted = await SubmitJobs.submitJcl(session, jcl);
      const job = normalizeJob(submitted);
      if (!job.jobId) throw new NotFoundError('EREP submission did not return a job id.');

      const output = await waitAndFetchErepOutput(ctx, job.jobName, job.jobId, waitSeconds ?? 60);
      const summary = parseErepSummary(output);
      const sections = [
        {
          heading: 'Record counts',
          body:
            summary.recordCounts.length > 0
              ? renderCountsTable(summary.recordCounts)
              : 'No record-count table recognized in the EREP output.',
        },
        {
          heading: 'Abend / error codes',
          body: summary.abendCodes.length > 0 ? summary.abendCodes.join(', ') : 'none in summary',
        },
        ...(summary.entries.length > 0 ? [{ heading: 'Modules / CPUs seen', body: summary.entries.join(', ') }] : []),
        ...(summary.keyLines.length > 0 ? [{ heading: 'Key lines', body: summary.keyLines.join('\n') }] : []),
        ...(summary.totalRecords != null ? [{ heading: 'Total records counted', body: String(summary.totalRecords) }] : []),
        { heading: 'Raw output', body: `Job ${job.jobId} DD SYSOUT — use get_job_output({ jobId: "${job.jobId}", ddName: "SYSOUT" }) for the full report.` },
      ];
      return textResult(formatStructuredResponse(`LOGREC (EREP) analysis — ${job.jobId}`, sections));
    },
  );

  ctx.logger.debug('Registered console tools');
};

function renderCountsTable(counts: { label: string; count: number }[]): string {
  return renderTable(['Record type', 'Count'], counts.map((c) => [c.label, String(c.count)]));
}
