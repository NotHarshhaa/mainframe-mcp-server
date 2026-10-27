/**
 * Incident-management tools (feature: incident).
 *
 * `create_incident_ticket` rebuilds the investigate_incident bundle for a job
 * and files it as a ServiceNow incident, Jira issue, or PagerDuty trigger —
 * whichever provider the INCIDENT_* settings configure. The ticket carries
 * the abend reference, the matched organization runbook link, and RAG
 * excerpts from internal documentation, so responders get the same evidence
 * the agent investigated.
 *
 * Governed as a write: blocked by SECURITY_READ_ONLY, subject to policy
 * role gates, and audited like every other tool call.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatStructuredResponse, textResult } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { createIncidentProvider, parseLabels } from '../../itsm/index.js';
import { buildIncidentBundle } from '../operations/shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id to file the incident for, e.g. "JOB01234".'),
  summary: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Ticket title. Defaults to "<jobname> (<jobid>) failed with <abend/return code>".',
    ),
  severity: z
    .enum(['info', 'warning', 'error', 'critical'])
    .optional()
    .describe('Ticket severity. Defaults to the INCIDENT_SEVERITY setting (error).'),
  requester: z
    .string()
    .max(64)
    .optional()
    .describe('Reporting identity recorded in the ticket (defaults to the server name).'),
  maxExcerptLines: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe('Maximum lines per diagnostic spool excerpt embedded in the ticket (default 80).'),
};

export const registerIncidentTools: ToolRegistrar = (server, ctx) => {
  const provider = createIncidentProvider(ctx.config.incident);
  if (!provider) {
    ctx.logger.debug('Incident integration not configured (INCIDENT_PROVIDER); create_incident_ticket skipped');
    return;
  }
  ctx.logger.info({ provider: provider.name }, 'Incident integration enabled');

  defineTool(
    server,
    ctx,
    'create_incident_ticket',
    `Create a ${provider.name} ticket from a full incident bundle: rebuilds the investigate_incident evidence (failure analysis, abend reference, runbook link, internal-doc excerpts, spool inventory, diagnostic excerpts) and files it. Requires the incident integration to be configured (INCIDENT_* settings) and write access.`,
    inputShape,
    async ({ jobId, summary, severity, requester, maxExcerptLines }) => {
      const bundle = await buildIncidentBundle(ctx, jobId, { maxExcerptLines });
      const code = bundle.analysis.abendCode;
      const title =
        summary?.trim() ||
        `${bundle.job.jobName} (${bundle.job.jobId}) failed${code ? ` with ${code}` : ` — ${bundle.job.returnCode ?? bundle.job.status}`}`;

      const ticket = await provider.createTicket({
        title,
        description: bundle.formatted,
        severity: severity ?? ctx.config.incident.severity,
        labels: parseLabels(ctx.config.incident.labels),
        source: requester?.trim() || ctx.config.mcp.name,
        jobId: bundle.job.jobId,
        jobName: bundle.job.jobName,
        abendCode: code,
        ...(bundle.runbookUrl ? { runbookUrl: bundle.runbookUrl } : {}),
      });

      ctx.logger.info(
        { provider: ticket.provider, ticketKey: ticket.key, jobId, abendCode: code },
        'incident ticket created',
      );

      return textResult(
        formatStructuredResponse(`Incident ticket created — ${ticket.key}`, [
          { heading: 'Ticket', body: [ticket.url ?? `(no URL returned by ${ticket.provider})`].join('\n') },
          { heading: 'Job', body: `${bundle.job.jobName} (${bundle.job.jobId}) — ${bundle.job.returnCode ?? bundle.job.status}` },
          ...(code ? [{ heading: 'Abend code', body: code }] : []),
          ...(bundle.runbookUrl ? [{ heading: 'Runbook attached', body: bundle.runbookUrl }] : []),
          ...(ticket.externalId ? [{ heading: 'Provider id', body: ticket.externalId }] : []),
          {
            heading: 'What was filed',
            body:
              `The full incident bundle was embedded in the ticket: failure analysis, abend reference, ` +
              `${bundle.docMatches.length} internal-doc excerpt(s), spool inventory, and diagnostic excerpts.`,
          },
        ]),
      );
    },
    undefined,
    // The default annotation derivation already knows this is a non-destructive
    // write; this explicit shape documents the override for reviewers.
    { annotations: { destructiveHint: false, idempotentHint: false } },
  );
};
