/**
 * `get_job_status` — current status and return code of a single job.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { ValidationError } from '../../utils/errors.js';
import { formatJobStatus, textResult } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { fetchJob } from './shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
  jobName: z
    .string()
    .optional()
    .describe('Optional job name for confirmation/disambiguation.'),
};

export const registerGetJobStatusTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_job_status',
    'Get the current status and return code of a specific job by its JES job id.',
    inputShape,
    securedHandler(ctx, 'get_job_status', async ({ jobId, jobName }) => {
      const job = await fetchJob(ctx, jobId);

      if (jobName && job.jobName.toUpperCase() !== jobName.toUpperCase()) {
        throw new ValidationError(
          `Job id ${jobId} belongs to ${job.jobName}, not ${jobName.toUpperCase()}.`,
          { expectedJobName: job.jobName, providedJobName: jobName },
        );
      }

      ctx.logger.debug({ jobId, status: job.status }, 'get_job_status');
      return textResult(formatJobStatus(job));
    }),
  );
};
