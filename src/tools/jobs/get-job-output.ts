/**
 * `get_job_output` — retrieve spool output for a job.
 *
 * With no `ddName`, returns the spool-file inventory. With a `ddName`, returns
 * that DD's content (line-capped by MAX_JOB_OUTPUT_LINES).
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { NotFoundError, safeHandler } from '../../utils/errors.js';
import { formatSpoolFiles, textResult, truncateLines } from '../../utils/formatters.js';
import { fetchJob, fetchSpoolContent, fetchSpoolFiles } from './shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
  ddName: z
    .string()
    .optional()
    .describe('Optional DD name (e.g. "JESMSGLG"). Omit to list available spool files.'),
};

export const registerGetJobOutputTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_job_output',
    'Retrieve spool output for a job. Lists spool files, or returns one DD when ddName is given.',
    inputShape,
    safeHandler(async ({ jobId, ddName }) => {
      const job = await fetchJob(ctx, jobId);
      const files = await fetchSpoolFiles(ctx, job.jobName, job.jobId);

      if (!ddName) {
        return textResult(formatSpoolFiles(job.jobName, job.jobId, files));
      }

      const match = files.find((file) => file.ddName.toUpperCase() === ddName.toUpperCase());
      if (!match) {
        const available = files.map((f) => f.ddName).join(', ') || '(none)';
        throw new NotFoundError(`DD "${ddName}" not found for ${job.jobName} (${job.jobId}).`, {
          available,
        });
      }

      const raw = await fetchSpoolContent(ctx, job.jobName, job.jobId, match.id);
      const { text, truncated, totalLines } = truncateLines(raw, ctx.config.limits.maxJobOutputLines);
      ctx.logger.debug({ jobId, ddName, totalLines, truncated }, 'get_job_output');

      const header = `Output of ${job.jobName} (${job.jobId}) DD=${match.ddName}\n${'─'.repeat(48)}\n`;
      return textResult(header + text);
    }),
  );
};
