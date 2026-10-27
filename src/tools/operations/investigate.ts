/**
 * `investigate_incident` — full investigation bundle for a job incident.
 *
 * Combines status, failure analysis, the spool inventory, and (when relevant)
 * the diagnostic spool excerpts into a single response an AI agent can reason
 * over in one shot.
 *
 * Bundle assembly lives in `./shared.ts` (buildIncidentBundle) so the
 * incident-management integration creates tickets from the exact same
 * evidence. This tool additionally surfaces, when configured:
 *   - the organization runbook link matching the abend code (INCIDENT_RUNBOOKS)
 *   - internal-documentation excerpts retrieved over DOCS_SOURCES (RAG)
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { buildIncidentBundle } from './shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id to investigate, e.g. "JOB01234".'),
  maxExcerptLines: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe(
      'Maximum lines to include from each diagnostic spool excerpt. Defaults to 80. Increase for a deeper view.',
    ),
};

export const registerInvestigateTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'investigate_incident', 'Assemble a full incident bundle for a job: status, root-cause analysis (with abend reference and runbook link), internal-doc excerpts (RAG), complete spool inventory, and diagnostic excerpts from all relevant DDs.', inputShape, async ({ jobId, maxExcerptLines }) => {
      const bundle = await buildIncidentBundle(ctx, jobId, { maxExcerptLines });
      return textResult(bundle.formatted);
    });
};
