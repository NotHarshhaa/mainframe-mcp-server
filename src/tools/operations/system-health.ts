/**
 * `system_health_summary` — high-level operational health snapshot.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import { safeHandler } from '../../utils/errors.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { isFailedJob, normalizeJob } from '../jobs/shared.js';
import { aggregateAbends } from './shared.js';
import { extractAbendCode, lookupAbend } from '../../utils/abend-codes.js';

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
      const topAbends = aggregateAbends(failedSummaries).slice(0, 5);

      let status = 'HEALTHY';
      if (failed.length > 0) status = 'DEGRADED';
      if (failed.length >= 5) status = 'CRITICAL';

      const overview = renderTable(
        ['Metric', 'Value'],
        [
          ['Overall status', status],
          ['Total jobs visible', String(jobs.length)],
          ['Active', String(active.length)],
          ['Awaiting execution (INPUT)', String(inputQ.length)],
          ['Failed', String(failed.length)],
        ],
      );

      const abendBody =
        topAbends.length === 0
          ? 'No failed jobs with recognizable abend codes.'
          : renderTable(
              ['Abend Code', 'Count', 'Description'],
              topAbends.map((entry) => {
                const info = lookupAbend(entry.code);
                return [entry.code, String(entry.count), info?.title ?? '(no reference entry)'];
              }),
            );

      ctx.logger.debug({ status, failed: failed.length }, 'system_health_summary');
      return textResult(
        formatStructuredResponse('System Health Summary', [
          { heading: 'Overview', body: overview },
          { heading: 'Top abend codes', body: abendBody },
        ]),
      );
    }),
  );
};
