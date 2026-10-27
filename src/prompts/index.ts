/**
 * MCP prompts (feature: mcp-native).
 *
 * Prompts are reusable playbooks MCP clients surface as slash-command-style
 * actions ("triage failed job", "morning batch health check"). Each returns
 * a guided, tool-referencing instruction so the agent runs the right tools in
 * the right order — the client then drives the actual calls.
 *
 * The prompt texts are built by pure exported builders (unit-testable); no
 * z/OSMF calls are made at prompt time.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types/tools.js';

/** Feature flags that shape which steps a prompt mentions. */
export interface PromptOptions {
  incidentConfigured?: boolean;
  docsConfigured?: boolean;
}

/** Build a one-message user prompt result. */
function userPrompt(
  text: string,
): { messages: [{ role: 'user'; content: { type: 'text'; text: string } }] } {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

/** Playbook for triaging one failed job, or all failures in a window. */
export function triageFailedJobPrompt(
  args: { jobId?: string; hours?: string },
  opts?: PromptOptions,
): string {
  const window = args.hours?.trim() || '4';
  return args.jobId?.trim()
    ? [
        `Triage the failed z/OS job ${args.jobId.trim().toUpperCase()}. Work through these steps:`,
        '1. Run `investigate_incident` for the job id to get the full bundle (analysis, abend reference, runbook, spool excerpts).',
        '2. Run `get_job_status` to confirm the current state and return code.',
        '3. If the bundle names an abend code, run `lookup_abend_code` for the reference entry' +
          (opts?.docsConfigured ? ' and `search_internal_docs` for internal runbook excerpts' : '') +
          '.',
        '4. Check for correlated failures: run `list_jobs` with the same job-name prefix to see whether sibling jobs also failed.',
        ...(opts?.incidentConfigured
          ? ['5. When the root cause is confirmed, offer to run `create_incident_ticket` for the job (ask before filing).']
          : []),
        '6. Finish with a concise triage summary: root cause, blast radius, remediation steps, and whether the job is safe to resubmit.',
      ].join('\n')
    : [
        `Triage recent failed batch jobs (last ${window} hours). Work through these steps:`,
        `1. Run \`find_failed_jobs\` with hours: ${window} to list the failures.`,
        '2. For the highest-impact failures (by job name criticality or abend severity), run `investigate_incident` for each job id.',
        '3. Run `summarize_abends` for the same window to spot recurring abend codes.',
        ...(opts?.docsConfigured
          ? ['4. For recurring codes, run `search_internal_docs` to pull the matching internal runbook excerpts.']
          : []),
        ...(opts?.incidentConfigured
          ? ['5. Offer to run `create_incident_ticket` for any failure with no existing ticket (ask before filing).']
          : []),
        '6. Finish with a triage table: job, abend code, root cause, affected steps, and recommended action for each.',
      ].join('\n');
}

/** Playbook for the morning batch health check. */
export function morningBatchHealthCheckPrompt(
  args: { lookbackHours?: string },
  opts?: PromptOptions,
): string {
  const window = args.lookbackHours?.trim() || '12';
  const extras: string[] = [];
  if (opts?.incidentConfigured) extras.push('create_incident_ticket');
  if (opts?.docsConfigured) extras.push('search_internal_docs');
  return [
    `Run the morning batch health check for the overnight window (last ${window} hours). Work through these steps:`,
    '1. Run `system_health_summary` with lookbackHours: ' + window + ' for the overall HEALTHY/DEGRADED/CRITICAL status.',
    `2. Run \`find_failed_jobs\` with hours: ${window} and \`summarize_abends\` for the same window.`,
    ...(extras.length > 0
      ? [`3. Supporting tools available: ${extras.join(', ')}.`]
      : ['3. Use `get_job_output` for diagnostic spool of any failure.']),
    '4. Run `predict_batch_failures` to flag jobs trending toward failure.',
    '5. Run `get_volume_space` and `get_job_capacity` to confirm storage and capacity headroom.',
    '6. Finish with a standup-ready summary: overall status line, incidents found (with abend codes), risk outlook, and the two most urgent actions.',
  ].join('\n');
}

/** Playbook for a deep dive on one abend code. */
export function investigateAbendPrompt(
  args: { code: string },
  opts?: PromptOptions,
): string {
  const abend = args.code.trim().toUpperCase();
  return [
    `Investigate abend code ${abend}. Work through these steps:`,
    `1. Run \`lookup_abend_code\` with code: "${abend}" for the reference entry` +
      ' (the response also includes the runbook link and internal-doc excerpts when configured).',
    ...(opts?.docsConfigured
      ? [`2. Run \`search_internal_docs\` with query "${abend}" for organization-specific remediation steps.`]
      : []),
    `3. Run \`summarize_abends\` and \`find_failed_jobs\` to find recent jobs that ended ${abend}.`,
    '4. For the most recent occurrence, run `investigate_incident` to capture the failing step and program.',
    '5. Finish with: explanation of the abend, likely causes ranked by fit, affected jobs, and a step-by-step remediation plan.',
  ].join('\n');
}

/**
 * Register every server prompt. Kept as a ToolRegistrar-shaped function so
 * server.ts wires it alongside the tool groups.
 */
export function registerPrompts(server: McpServer, ctx: ToolContext): void {
  const opts: PromptOptions = {
    incidentConfigured: Boolean(ctx.config.incident.provider),
    docsConfigured: Boolean(ctx.docIndex),
  };

  server.registerPrompt(
    'triage_failed_job',
    {
      title: 'Triage Failed Job',
      description:
        'Triage one or more failed batch jobs end-to-end: find failures, assemble incident bundles, ' +
        'check runbooks and internal docs, and (when configured) file an incident ticket.',
      argsSchema: {
        jobId: z
          .string()
          .optional()
          .describe('Specific JES job id to triage, e.g. "JOB01234". Omit to triage all recent failures.'),
        hours: z
          .string()
          .optional()
          .describe('Lookback window in hours when no jobId is given (default 4).'),
      },
    },
    ({ jobId, hours }) => userPrompt(triageFailedJobPrompt({ jobId, hours }, opts)),
  );

  server.registerPrompt(
    'morning_batch_health_check',
    {
      title: 'Morning Batch Health Check',
      description:
        'Run the overnight batch health check: overall system health, failed jobs, abend trends, capacity, ' +
        'and storage — then summarize for the morning standup.',
      argsSchema: {
        lookbackHours: z
          .string()
          .optional()
          .describe('How far back to look for the overnight window (default 12).'),
      },
    },
    ({ lookbackHours }) => userPrompt(morningBatchHealthCheckPrompt({ lookbackHours }, opts)),
  );

  server.registerPrompt(
    'investigate_abend',
    {
      title: 'Investigate Abend',
      description:
        'Deep-dive one abend code: built-in reference, internal documentation, recent occurrences, and affected jobs.',
      argsSchema: {
        code: z.string().min(1).describe('Abend code to investigate, e.g. "S0C7", "S806", "U4038".'),
      },
    },
    ({ code }) => userPrompt(investigateAbendPrompt({ code }, opts)),
  );

  ctx.logger.debug(
    { prompts: ['triage_failed_job', 'morning_batch_health_check', 'investigate_abend'] },
    'Registered MCP prompts',
  );
}
