/**
 * `get_smf_metrics` — expose SMF/RMF performance metrics.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { ConfigError, safeHandler } from '../../utils/errors.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { fetchSmfMetrics } from './shared.js';

export const registerSmfMetricsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_smf_metrics',
    'Retrieve SMF/RMF performance metrics from z/OSMF RMF and/or a configured SMF summary dataset.',
    {},
    safeHandler(async () => {
      const { rmfMetricsEnabled, smfSummaryDataset } = ctx.config.enterprise;
      if (!rmfMetricsEnabled && !smfSummaryDataset) {
        throw new ConfigError(
          'SMF metrics require RMF_METRICS_ENABLED=true and/or SMF_SUMMARY_DATASET to be configured.',
        );
      }

      const metrics = await fetchSmfMetrics(ctx);
      if (metrics.length === 0) {
        return textResult(
          'No SMF/RMF metrics were returned. Verify RMF is enabled on z/OSMF or configure SMF_SUMMARY_DATASET.',
        );
      }

      const table = renderTable(
        ['Metric', 'Value'],
        metrics.map((metric) => [metric.name, metric.unit ? `${metric.value} ${metric.unit}` : metric.value]),
      );

      ctx.logger.debug({ count: metrics.length }, 'get_smf_metrics');
      return textResult(
        formatStructuredResponse('SMF / RMF Metrics', [
          { heading: 'Performance snapshot', body: table },
        ]),
      );
    }),
  );
};
