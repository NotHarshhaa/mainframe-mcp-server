/**
 * `find_failed_jobs` — find all failed jobs in a time window.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { analyzeJobFailure } from '../jobs/shared.js';
import { findFailedJobs } from './shared.js';

/** Cap how many jobs we'll deep-analyze (each one downloads spool). */
const MAX_DEEP_ANALYZE = 15;

const inputShape = {
  hours: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Look-back window in hours. Defaults to 24.'),
  owner: z.string().optional().describe('Owner filter. Defaults to "*" (all owners).'),
};

export const registerFailedJobsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'find_failed_jobs',
    'Find all failed jobs within a recent time window and summarize their abend/step.',
    inputShape,
    safeHandler(async ({ hours, owner }) => {
      const window = hours ?? 24;
      const failures = await findFailedJobs(ctx, window, owner ?? '*');

      if (failures.length === 0) {
        return textResult(`Failed Jobs — Last ${window} Hours (0 found)`);
      }

      const rows: string[][] = [];
      for (let i = 0; i < failures.length; i += 1) {
        const { job, abendCode } = failures[i];
        let step = '—';
        if (i < MAX_DEEP_ANALYZE) {
          try {
            const analysis = await analyzeJobFailure(ctx, job.jobId);
            step = analysis.failedStep ?? '—';
          } catch {
            step = '—';
          }
        }
        rows.push([job.jobName, job.jobId, abendCode ?? (job.returnCode ?? '—'), step]);
      }

      ctx.logger.debug({ window, count: failures.length }, 'find_failed_jobs');

      const header = `Failed Jobs — Last ${window} Hours (${failures.length} found)\n\n`;
      const table = renderTable(['Job Name', 'Job ID', 'Abend Code', 'Failed Step'], rows);
      const note =
        failures.length > MAX_DEEP_ANALYZE
          ? `\n\n(Step detail shown for the first ${MAX_DEEP_ANALYZE} jobs.)`
          : '';
      return textResult(header + table + note);
    }),
  );
};
