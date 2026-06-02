/**
 * `analyze_root_cause` — AI-assisted deep root-cause analysis for a failed job.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import {
  formatFailureAnalysis,
  formatStructuredResponse,
  renderTable,
  textResult,
} from '../../utils/formatters.js';
import { buildRootCauseReport } from './shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id of the failed job to analyze.'),
  lookbackHours: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Hours of history for correlation. Defaults to 72.'),
};

export const registerAnalyzeRootCauseTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'analyze_root_cause',
    'AI-assisted root-cause analysis: failure details, similar incidents, correlated abends, and prioritized action items.',
    inputShape,
    safeHandler(async ({ jobId, lookbackHours }) => {
      const window = lookbackHours ?? 72;
      const report = await buildRootCauseReport(ctx, jobId, window);

      const similarBody =
        report.similarIncidents.length > 0
          ? report.similarIncidents.map((line) => `  • ${line}`).join('\n')
          : '  No similar incidents in the look-back window.';

      const abendBody =
        report.correlatedAbends.length > 0
          ? renderTable(
              ['Abend Code', 'Count'],
              report.correlatedAbends.map((entry) => [entry.code, String(entry.count)]),
            )
          : '  No correlated abends in the look-back window.';

      const actionsBody = report.actionItems.map((item, index) => `${index + 1}. ${item}`).join('\n');

      ctx.logger.debug({ jobId, confidence: report.confidence }, 'analyze_root_cause');
      return textResult(
        formatStructuredResponse(`Root Cause Analysis — ${report.analysis.job.jobName}`, [
          {
            heading: `Summary (confidence: ${report.confidence})`,
            body: report.summary,
          },
          { heading: 'Failure analysis', body: formatFailureAnalysis(report.analysis) },
          { heading: `Similar incidents (${window}h)`, body: similarBody },
          { heading: 'Correlated abends', body: abendBody },
          { heading: 'Recommended actions', body: actionsBody },
        ]),
      );
    }),
  );
};
