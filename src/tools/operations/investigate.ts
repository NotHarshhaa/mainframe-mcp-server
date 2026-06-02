/**
 * `investigate_incident` — full investigation bundle for a job incident.
 *
 * Combines status, failure analysis, the spool inventory, and (when relevant)
 * the diagnostic spool excerpt into a single response an AI agent can reason
 * over in one shot.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import {
  formatFailureAnalysis,
  formatJobStatus,
  formatSpoolFiles,
  textResult,
  truncateLines,
} from '../../utils/formatters.js';
import { analyzeJobFailure, fetchDiagnosticSpool, fetchJob, fetchSpoolFiles } from '../jobs/shared.js';

const inputShape = {
  jobId: z.string().min(1).describe('JES job id to investigate, e.g. "JOB01234".'),
};

export const registerInvestigateTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'investigate_incident',
    'Assemble a full incident bundle for a job: status, root-cause analysis, spool inventory, and diagnostic excerpt.',
    inputShape,
    safeHandler(async ({ jobId }) => {
      const job = await fetchJob(ctx, jobId);
      const [spoolFiles, analysis] = await Promise.all([
        fetchSpoolFiles(ctx, job.jobName, job.jobId),
        analyzeJobFailure(ctx, jobId),
      ]);

      const sections: string[] = [
        `INCIDENT INVESTIGATION — ${job.jobName} (${job.jobId})`,
        '═'.repeat(60),
        '',
        '1. STATUS',
        formatJobStatus(job),
        '',
        '2. ROOT-CAUSE ANALYSIS',
        formatFailureAnalysis(analysis),
        '',
        '3. SPOOL INVENTORY',
        formatSpoolFiles(job.jobName, job.jobId, spoolFiles),
      ];

      // Include a short diagnostic excerpt for failed jobs to ground the analysis.
      if (analysis.abendCode || analysis.failedStep) {
        const diag = await fetchDiagnosticSpool(ctx, job.jobName, job.jobId);
        if (diag.length > 0) {
          const excerpt = truncateLines(diag[0].text, 60).text;
          sections.push('', `4. DIAGNOSTIC EXCERPT (${diag[0].ddName})`, excerpt);
        }
      }

      ctx.logger.debug({ jobId, abendCode: analysis.abendCode }, 'investigate_incident');
      return textResult(sections.join('\n'));
    }),
  );
};
