/**
 * `compare_jobs` — side-by-side comparison of two jobs.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatJobStatus, formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { fetchJob, isFailedJob } from '../jobs/shared.js';
import { extractAbendCode } from '../../utils/abend-codes.js';

const inputShape = {
  jobId1: z.string().min(1).describe('First JES job id.'),
  jobId2: z.string().min(1).describe('Second JES job id.'),
};

export const registerCompareJobsTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'compare_jobs', 'Compare status, return code, and failure indicators for two jobs side by side.', inputShape, async ({ jobId1, jobId2 }) => {
      const [job1, job2] = await Promise.all([fetchJob(ctx, jobId1), fetchJob(ctx, jobId2)]);

      const rows = [
        ['Job name', job1.jobName, job2.jobName],
        ['Job id', job1.jobId, job2.jobId],
        ['Owner', job1.owner, job2.owner],
        ['Status', job1.status, job2.status],
        ['Return code', job1.returnCode ?? '(running)', job2.returnCode ?? '(running)'],
        ['Failed?', isFailedJob(job1) ? 'YES' : 'no', isFailedJob(job2) ? 'YES' : 'no'],
        [
          'Abend code',
          extractAbendCode(job1.returnCode ?? '') ?? '—',
          extractAbendCode(job2.returnCode ?? '') ?? '—',
        ],
      ];

      ctx.logger.debug({ jobId1, jobId2 }, 'compare_jobs');
      return textResult(
        formatStructuredResponse('Job Comparison', [
          {
            heading: 'Summary table',
            body: renderTable(['Field', job1.jobId, job2.jobId], rows),
          },
          {
            heading: 'Job 1 details',
            body: formatJobStatus(job1),
          },
          {
            heading: 'Job 2 details',
            body: formatJobStatus(job2),
          },
        ]),
      );
    });
};
