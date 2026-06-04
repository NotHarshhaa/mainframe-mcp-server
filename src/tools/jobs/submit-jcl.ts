/**
 * `submit_jcl` — submit inline JCL for execution.
 */
import { z } from 'zod';
import { SubmitJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import type { ToolRegistrar } from '../../types/tools.js';
import { ValidationError } from '../../utils/errors.js';
import { formatJobStatus, textResult } from '../../utils/formatters.js';
import { assertJclSizeAllowed } from '../../utils/security.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { normalizeJob } from './shared.js';

const inputShape = {
  jcl: z
    .string()
    .min(1)
    .describe('The complete inline JCL to submit (including the //JOB card).'),
};

export const registerSubmitJclTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'submit_jcl',
    'Submit inline JCL to JES for execution and return the new job identifier.',
    inputShape,
    securedHandler(ctx, 'submit_jcl', async ({ jcl }) => {
      const normalized = jcl.replace(/\r\n/g, '\n').trim();
      if (!/^\/\//.test(normalized)) {
        throw new ValidationError('JCL must begin with a "//" JOB statement.');
      }
      if (normalized.includes('\0')) {
        throw new ValidationError('JCL must not contain null characters.');
      }

      assertJclSizeAllowed(ctx.config, normalized);

      const submitted = await SubmitJobs.submitJcl(ctx.session, normalized);
      const job = normalizeJob(submitted);
      ctx.logger.info({ jobId: job.jobId, jobName: job.jobName }, 'submit_jcl');

      return textResult(`Submitted successfully.\n\n${formatJobStatus(job)}`);
    }),
  );
};
