/**
 * `submit_jcl` — submit inline JCL for execution.
 */
import { z } from 'zod';
import { SubmitJobs, GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
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
  wait: z
    .boolean()
    .optional()
    .describe('Whether to wait for the job to complete execution before returning.'),
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum time to wait in seconds (defaults to 30, max 300).'),
};

export const registerSubmitJclTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'submit_jcl',
    'Submit inline JCL to JES for execution and return the new job identifier.',
    inputShape,
    securedHandler(ctx, 'submit_jcl', async ({ jcl, wait, timeout }) => {
      const normalized = jcl.replace(/\r\n/g, '\n').trim();
      if (!/^\/\//.test(normalized)) {
        throw new ValidationError('JCL must begin with a "//" JOB statement.');
      }
      if (normalized.includes('\0')) {
        throw new ValidationError('JCL must not contain null characters.');
      }

      assertJclSizeAllowed(ctx.config, normalized);

      const submitted = await SubmitJobs.submitJcl(ctx.session, normalized);
      let job = normalizeJob(submitted);
      ctx.logger.info({ jobId: job.jobId, jobName: job.jobName }, 'submit_jcl');

      if (wait) {
        const timeoutSeconds = Math.min(timeout ?? 30, 300);
        const start = Date.now();
        
        while (job.status !== 'OUTPUT' && (Date.now() - start) < timeoutSeconds * 1000) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const rawJob = await GetJobs.getJob(ctx.session, job.jobId);
          if (rawJob) {
            job = normalizeJob(rawJob);
          }
        }
        
        if (job.status === 'OUTPUT') {
          return textResult(`Submitted successfully and completed execution.\n\n${formatJobStatus(job)}`);
        } else {
          return textResult(`Submitted successfully but execution did not finish within ${timeoutSeconds} seconds.\n\n${formatJobStatus(job)}`);
        }
      }

      return textResult(`Submitted successfully.\n\n${formatJobStatus(job)}`);
    }),
  );
};
