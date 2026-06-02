/**
 * Shared operations helpers.
 *
 * Higher-level workflows composed from the job tools: finding failed jobs in a
 * window, aggregating abends, and assembling incident bundles.
 */
import { GetJobs, type IJob } from '@zowe/zos-jobs-for-zowe-sdk';
import type { Job } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { extractAbendCode } from '../../utils/abend-codes.js';
import { isFailedJob, normalizeJob } from '../jobs/shared.js';

/** A failed job enriched with the abend code parsed from its return code. */
export interface FailedJobSummary {
  job: Job;
  abendCode: string | null;
}

/** Parse the `exec-ended` timestamp from a raw job, if present. */
function execEndedMillis(raw: IJob): number | null {
  const value = raw['exec-ended'];
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Find failed jobs across the output queue within the last `hours`.
 *
 * Time filtering is best-effort: jobs without an `exec-ended` timestamp are
 * always included (JES does not always surface completion times).
 */
export async function findFailedJobs(
  ctx: ToolContext,
  hours: number,
  owner = '*',
): Promise<FailedJobSummary[]> {
  const raws = await GetJobs.getJobsByOwnerAndPrefix(ctx.session, owner, '*');
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  const summaries: FailedJobSummary[] = [];
  for (const raw of raws) {
    const job = normalizeJob(raw);
    if (!isFailedJob(job)) continue;

    const ended = execEndedMillis(raw);
    if (ended != null && ended < cutoff) continue;

    summaries.push({ job, abendCode: extractAbendCode(job.returnCode ?? '') });
  }
  return summaries;
}

/** Aggregate failed jobs by abend code. */
export function aggregateAbends(
  summaries: FailedJobSummary[],
): { code: string; count: number; jobs: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const summary of summaries) {
    const code = summary.abendCode ?? (summary.job.returnCode ?? 'UNKNOWN');
    const list = buckets.get(code) ?? [];
    list.push(`${summary.job.jobName} (${summary.job.jobId})`);
    buckets.set(code, list);
  }
  return [...buckets.entries()]
    .map(([code, jobs]) => ({ code, count: jobs.length, jobs }))
    .sort((a, b) => b.count - a.count);
}
