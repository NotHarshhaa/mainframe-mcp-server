/**
 * `system_health_summary` — high-level operational health snapshot.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import { safeHandler } from '../../utils/errors.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { isFailedJob, normalizeJob } from '../jobs/shared.js';
import { aggregateAbends } from './shared.js';
import { extractAbendCode } from '../../utils/abend-codes.js';

export const registerSystemHealthTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'system_health_summary',
    'Produce a high-level operational health snapshot: active jobs, failures, and top abends.',
    {},
    safeHandler(async () => {
      const raws = await GetJobs.getJobsByOwnerAndPrefix(ctx.session, '*', '*');
      const jobs = raws.map(normalizeJob);

      const active = jobs.filter((job) => job.status === 'ACTIVE');
      const inputQ = jobs.filter((job) => job.status === 'INPUT');
      const failed = jobs.filter(isFailedJob);

      const failedSummaries = failed.map((job) => ({
        job,
        abendCode: extractAbendCode(job.returnCode ?? ''),
      }));
      const topAbends = aggregateAbends(failedSummaries).slice(0, 3);

      const overview = renderTable(
        ['Metric', 'Value'],
        [
          ['Total jobs visible', String(jobs.length)],
          ['Active', String(active.length)],
          ['Awaiting execution (INPUT)', String(inputQ.length)],
          ['Failed', String(failed.length)],
        ],
      );

      let status = 'HEALTHY';
      if (failed.length > 0) status = 'DEGRADED';
      if (failed.length >= 5) status = 'CRITICAL';

      const lines = [`System Health: ${status}`, '', overview];

      if (topAbends.length > 0) {
        lines.push('', 'Top abend codes:');
        for (const entry of topAbends) {
          lines.push(`  ${entry.code}: ${entry.count}`);
        }
      }

      ctx.logger.debug({ status, failed: failed.length }, 'system_health_summary');
      return textResult(lines.join('\n'));
    }),
  );
};
