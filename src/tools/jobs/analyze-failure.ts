/**
 * `analyze_job_failure` — analyze a failed job and summarize the root cause.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { formatFailureAnalysis, formatStructuredResponse, textResult } from '../../utils/formatters.js';
import { analyzeJobFailure } from './shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id of the failed job, e.g. "JOB01234".'),
};

export const registerAnalyzeFailureTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'analyze_job_failure',
    'Analyze a failed job: identify the abend code, failing step/program, and a suggested fix.',
    inputShape,
    securedHandler(ctx, 'analyze_job_failure', async ({ jobId }) => {
      const analysis = await analyzeJobFailure(ctx, jobId);
      ctx.logger.debug({ jobId, abendCode: analysis.abendCode }, 'analyze_job_failure');
      return textResult(
        formatStructuredResponse(`Failure Analysis — ${analysis.job.jobName}`, [
          { heading: 'Analysis', body: formatFailureAnalysis(analysis) },
        ]),
      );
    }),
  );
};
