/**
 * `get_job_jcl` — retrieve the submitted JCL for a job from its spool.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { NotFoundError } from '../../utils/errors.js';
import { formatContentHeader, textResult, truncateLines } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { fetchJob, fetchSpoolContent, fetchSpoolFiles } from './shared.js';

/** DD names that typically contain the submitted JCL, in priority order. */
const JCL_DDS = ['JESJCLIN', 'JCL', 'SYSIN'];

export const registerGetJobJclTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_job_jcl',
    'Retrieve the JCL that was submitted for a job (from JESJCLIN / JCL spool DDs).',
    {
      jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
    },
    securedHandler(ctx, 'get_job_jcl', async ({ jobId }) => {
      const job = await fetchJob(ctx, jobId);
      const files = await fetchSpoolFiles(ctx, job.jobName, job.jobId);
      const jclFile = files
        .filter((file) => JCL_DDS.includes(file.ddName.toUpperCase()))
        .sort(
          (a, b) =>
            JCL_DDS.indexOf(a.ddName.toUpperCase()) - JCL_DDS.indexOf(b.ddName.toUpperCase()),
        )[0];

      if (!jclFile) {
        throw new NotFoundError(`No JCL spool DD found for ${job.jobName} (${job.jobId}).`, {
          available: files.map((f) => f.ddName).join(', '),
        });
      }

      const raw = await fetchSpoolContent(ctx, job.jobName, job.jobId, jclFile.id);
      const { text, truncated, totalLines } = truncateLines(raw, ctx.config.limits.maxJobOutputLines);
      ctx.logger.debug({ jobId, ddName: jclFile.ddName }, 'get_job_jcl');

      const header = formatContentHeader(
        `JCL — ${job.jobName} (${job.jobId}) DD=${jclFile.ddName}`,
        truncated,
        totalLines,
        ctx.config.limits.maxJobOutputLines,
      );
      return textResult(header + text);
    }),
  );
};
