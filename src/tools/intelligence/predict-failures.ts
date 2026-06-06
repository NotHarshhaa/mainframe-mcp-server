/**
 * `predict_batch_failures` — predictive batch failure risk scoring.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { predictBatchFailures } from './shared.js';

const inputShape = {
  hours: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Historical look-back window in hours. Defaults to 168 (7 days).'),
};

export const registerPredictFailuresTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'predict_batch_failures',
    'Predict batch failure risk by scoring job names with recurring failures, abend patterns, and trends.',
    inputShape,
    securedHandler(ctx, 'mainframe_predict_batch_failures', async ({ hours }) => {
      const window = hours ?? 168;
      const risks = await predictBatchFailures(ctx, window);

      if (risks.length === 0) {
        return textResult(`Predictive Analysis — Last ${window} Hours\n\nNo recurring batch failures detected.`);
      }

      const critical = risks.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH');
      const overview = renderTable(
        ['Metric', 'Value'],
        [
          ['Jobs analyzed', String(risks.length)],
          ['High/Critical risk', String(critical.length)],
          ['Look-back window', `${window} hours`],
        ],
      );

      const riskTable = renderTable(
        ['Job Name', 'Risk', 'Score', 'Failures', 'Top Abend', 'Trend'],
        risks.map((risk) => [
          risk.jobName,
          risk.riskLevel,
          String(risk.riskScore),
          String(risk.failureCount),
          risk.topAbend ?? '—',
          risk.trend,
        ]),
      );

      const recommendations = risks
        .filter((r) => r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL')
        .slice(0, 5)
        .map((r) => `• ${r.jobName}: ${r.recommendation}`)
        .join('\n');

      ctx.logger.debug({ window, jobs: risks.length }, 'predict_batch_failures');
      return textResult(
        formatStructuredResponse('Predictive Batch Failure Analysis', [
          { heading: 'Overview', body: overview },
          { heading: 'Risk ranking', body: riskTable },
          {
            heading: 'Priority recommendations',
            body: recommendations || 'No high-risk jobs require immediate action.',
          },
        ]),
      );
    }),
  );
};
