/**
 * Capacity and cost tools.
 *
 * `get_job_capacity` extracts per-step and total CPU from the job's JESMSGLG
 * (IEF374I/IEF376I) and estimates MSU consumption when CAPACITY_MSU_RATING is
 * configured. `estimate_mlc_cost` turns CPU/MSU into an MLC cost attribution
 * using the configured monthly $/MSU price.
 */
import { z } from 'zod';
import { GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import type { ToolRegistrar, ToolContext } from '../../types/tools.js';
import { textResult, formatStructuredResponse, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { fetchJob } from '../jobs/shared.js';
import { effectiveSession } from '../../zowe/enduser.js';
import { cpuSecondsToMsu, estimateMlcCost, parseJobCpu, round2 } from '../../utils/capacity.js';

/** Find and read the JESMSGLG spool content for a job. */
async function fetchJesMsgLg(ctx: ToolContext, jobName: string, jobId: string): Promise<string | null> {
  const session = await effectiveSession(ctx);
  const files = await GetJobs.getSpoolFiles(session, jobName, jobId);
  const msgLg = files
    .filter((f) => String(f.ddname).toUpperCase() === 'JESMSGLG')
    .sort((a, b) => b.id - a.id)[0];
  if (!msgLg) return null;
  return GetJobs.getSpoolContentById(session, jobName, jobId, msgLg.id);
}

export const registerCapacityTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'get_job_capacity',
    'CPU consumption of a job — per step and total from JESMSGLG (IEF374I/IEF376I), with an MSU estimate when CAPACITY_MSU_RATING is configured.',
    {
      jobId: z.string().min(1).describe('JES job id, e.g. "JOB01234".'),
    },
    async ({ jobId }) => {
      const job = await fetchJob(ctx, jobId);
      const msgLg = await fetchJesMsgLg(ctx, job.jobName, job.jobId);
      if (!msgLg) {
        return textResult(`No JESMSGLG spool file found for ${job.jobName} (${job.jobId}). Has the job started?`);
      }
      const cpu = parseJobCpu(msgLg);
      const capacityMsu = ctx.config.enterprise.capacityMsuRating;

      const rows = cpu.steps.map((s) => [
        s.stepName,
        `${round2(s.cpuSeconds)}s`,
        capacityMsu ? `${round2(cpuSecondsToMsu(s.cpuSeconds, capacityMsu))} MSU` : '—',
      ]);
      const totalMsu = capacityMsu && cpu.totalCpuSeconds != null
        ? round2(cpuSecondsToMsu(cpu.totalCpuSeconds, capacityMsu))
        : undefined;

      const sections = [
        {
          heading: 'CPU per step',
          body: cpu.steps.length > 0
            ? renderTable(['Step', 'CPU', capacityMsu ? 'MSU (est.)' : 'MSU (needs CAPACITY_MSU_RATING)'], rows)
            : 'No IEF374I step records found — the job may still be running or its JESMSGLG was purged.',
        },
        {
          heading: 'Job total',
          body:
            cpu.totalCpuSeconds != null
              ? `${round2(cpu.totalCpuSeconds)}s CPU${cpu.totalFromSteps ? ' (summed from steps; IEF376I not present)' : ''}` +
                (totalMsu != null ? ` ≈ ${totalMsu} MSU consumed (capacity ${capacityMsu} MSU/hour)` : '')
              : 'Total CPU not available (IEF376I absent and no steps parsed).',
        },
        {
          heading: 'MLC attribution',
          body: ctx.config.enterprise.mlcMsuMonthlyPrice
            ? `Use estimate_mlc_cost with these figures for a cost estimate (price ${ctx.config.enterprise.mlcMsuMonthlyPrice} ${ctx.config.enterprise.mlcCurrency}/MSU-month configured).`
            : 'Set MLC_MSU_MONTHLY_PRICE to enable cost attribution.',
        },
      ];
      return textResult(formatStructuredResponse(`Capacity — ${job.jobName} (${job.jobId})`, sections));
    },
  );

  defineTool(
    server,
    ctx,
    'estimate_mlc_cost',
    'Estimate MLC cost attribution from CPU seconds or MSU consumption. Pricing assumptions come from CAPACITY_MSU_RATING and MLC_MSU_MONTHLY_PRICE.',
    {
      jobId: z.string().optional().describe('JES job id — CPU is read from its JESMSGLG (mutually exclusive with the numeric inputs).'),
      cpuSeconds: z.number().positive().optional().describe('Explicit CPU seconds to attribute.'),
      msuConsumed: z.number().positive().optional().describe('Explicit MSU consumption (skips the capacity conversion).'),
    },
    async ({ jobId, cpuSeconds, msuConsumed }) => {
      let effectiveCpu = cpuSeconds;
      let sourceLabel: string;
      if (jobId) {
        if (cpuSeconds != null || msuConsumed != null) {
          return textResult('Pass either "jobId" or explicit numeric inputs, not both.');
        }
        const job = await fetchJob(ctx, jobId);
        const msgLg = await fetchJesMsgLg(ctx, job.jobName, job.jobId);
        if (!msgLg) return textResult(`No JESMSGLG spool file found for ${job.jobName} (${job.jobId}).`);
        effectiveCpu = parseJobCpu(msgLg).totalCpuSeconds ?? undefined;
        if (effectiveCpu == null) {
          return textResult(`Could not derive CPU from the JESMSGLG of ${job.jobName} (${job.jobId}).`);
        }
        sourceLabel = `job ${job.jobName} (${job.jobId})`;
      } else {
        sourceLabel = 'explicit inputs';
      }

      const estimate = estimateMlcCost({
        cpuSeconds: effectiveCpu,
        msuConsumed,
        capacityMsu: ctx.config.enterprise.capacityMsuRating,
        monthlyPricePerMsu: ctx.config.enterprise.mlcMsuMonthlyPrice,
        currency: ctx.config.enterprise.mlcCurrency,
      });

      const sections = [
        { heading: 'Basis', body: `${sourceLabel} — ${estimate.basis}` },
        {
          heading: 'Estimate',
          body:
            `${estimate.msuConsumed} MSU consumed` +
            (Number.isFinite(estimate.estimatedCost)
              ? ` ≈ ${estimate.estimatedCost} ${estimate.currency} attributed`
              : ' — cost requires MLC_MSU_MONTHLY_PRICE'),
        },
        { heading: 'Assumptions', body: estimate.assumptions.map((a) => `• ${a}`).join('\n') },
        ...(jobId ? [{ heading: 'Source', body: `CPU parsed from IEF374I/IEF376I messages in the job's JESMSGLG.` }] : []),
      ];
      return textResult(formatStructuredResponse('MLC Cost Attribution', sections));
    },
  );

  ctx.logger.debug('Registered capacity tools');
};
