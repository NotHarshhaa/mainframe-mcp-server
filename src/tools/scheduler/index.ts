/**
 * Scheduler tools.
 *
 * `scheduler_job_status` queries external batch schedulers (Control-M, CA 7,
 * IBM Workload Automation) through their REST APIs — endpoints are configured
 * via SCHEDULER_ADAPTERS. `job_dependencies` analyzes a job's JCL to extract
 * dataset flows (inputs / updates / outputs) and PROC calls, the raw material
 * for predecessor/successor analysis.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult, formatStructuredResponse, truncateLines, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { analyzeJclDependencies } from '../../utils/jcl-dependencies.js';
import {
  fetchSchedulerJobStatus,
  parseSchedulerAdapters,
  resolveScheduler,
} from '../../utils/scheduler-adapters.js';
import { getJobJclText } from '../jobs/get-job-jcl.js';

export const registerSchedulerTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'scheduler_job_status',
    'Query an external batch scheduler (Control-M, CA 7, IBM Workload Automation) for job status via its REST API. Schedulers are configured with SCHEDULER_ADAPTERS.',
    {
      scheduler: z.string().optional().describe('Scheduler name from SCHEDULER_ADAPTERS. Required when several are configured.'),
      jobName: z.string().min(1).describe('Scheduler job name, e.g. "PAYROLL_DAILY".'),
    },
    async ({ scheduler, jobName }) => {
      const adapters = parseSchedulerAdapters(ctx.config.enterprise.schedulerAdapters);
      const adapter = resolveScheduler(adapters, scheduler);
      const status = await fetchSchedulerJobStatus(adapter, jobName);
      const sections = [
        { heading: 'Scheduler', body: `${status.scheduler} (${status.type})` },
        ...(status.matchCount != null ? [{ heading: 'Matches', body: String(status.matchCount) }] : []),
        ...(status.status ? [{ heading: 'Reported status', body: status.status }] : []),
        ...(status.normalizedStatus ? [{ heading: 'Normalized status', body: status.normalizedStatus }] : []),
        {
          heading: 'Raw response',
          body: truncateLines(JSON.stringify(status.response, null, 2), 120).text,
        },
        {
          heading: 'Configuration note',
          body:
            'Path templates and response shapes vary by scheduler version — adjust jobStatusPath in SCHEDULER_ADAPTERS if the query returns unexpected data.',
        },
      ];
      return textResult(formatStructuredResponse(`Scheduler status — ${jobName.toUpperCase()}`, sections));
    },
  );

  defineTool(
    server,
    ctx,
    'job_dependencies',
    'Analyze a job\'s JCL for batch dependencies: dataset inputs, outputs, updates per step, and PROCs invoked — the basis for predecessor/successor analysis.',
    {
      jobId: z.string().optional().describe('JES job id — the JCL is pulled from spool (mutually exclusive with "jcl").'),
      jcl: z.string().optional().describe('Inline JCL text to analyze (mutually exclusive with "jobId").'),
    },
    async ({ jobId, jcl }) => {
      if (!jobId && !jcl) {
        return textResult('Provide either "jobId" (analyze JCL from spool) or "jcl" (inline JCL text).');
      }
      const source = jobId ? { label: `job ${jobId}`, text: await getJobJclText(ctx, jobId) } : { label: 'inline JCL', text: jcl as string };
      const analysis = analyzeJclDependencies(source.text);

      const flowRows: string[][] = [];
      for (const step of analysis.steps) {
        const executed = step.proc ? `PROC ${step.proc}` : `PGM ${step.program ?? '?'}`;
        if (step.ddnames.length === 0) {
          flowRows.push([step.stepName, executed, '(no DD statements)', '—']);
          continue;
        }
        for (const dd of step.ddnames) {
          for (const flow of dd.flows) {
            flowRows.push([
              step.stepName,
              executed,
              `${dd.ddName}: ${flow.dsn}`,
              flow.usage + (flow.disp ? ` [DISP=${flow.disp}]` : ''),
            ]);
          }
        }
      }

      const summaryTable = renderTable(
        ['Category', 'Datasets'],
        [
          ['Inputs (read)', analysis.inputDatasets.join(', ') || '—'],
          ['Updates (read/write)', analysis.updateDatasets.join(', ') || '—'],
          ['Outputs (written)', analysis.outputDatasets.join(', ') || '—'],
          ['PROCs invoked', analysis.procedures.join(', ') || '—'],
        ],
      );

      const sections = [
        { heading: 'Source', body: source.label + (analysis.jobName ? ` (job card: ${analysis.jobName})` : '') },
        { heading: 'Summary', body: summaryTable },
        { heading: 'Per-step flows', body: renderTable(['Step', 'Executes', 'DD → Dataset', 'Usage'], flowRows) },
        { heading: 'Dependency analysis notes', body: analysis.notes.map((n) => `• ${n}`).join('\n') },
      ];
      return textResult(formatStructuredResponse('Job Dependency Analysis', sections));
    },
  );

  ctx.logger.debug('Registered scheduler tools');
};
