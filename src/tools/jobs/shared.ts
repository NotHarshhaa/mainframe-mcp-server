/**
 * Shared job helpers.
 *
 * Normalizers (SDK -> domain types) and reusable fetch/analysis routines that
 * are consumed by the individual job tools AND by the operations tools (which
 * build higher-level workflows on top of job data).
 */
import { GetJobs, type IJob, type IJobFile } from '@zowe/zos-jobs-for-zowe-sdk';
import type { Job, JobFailureAnalysis, JobStatus, SpoolFile } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { NotFoundError, normalizeError } from '../../utils/errors.js';
import { extractAbendCode, lookupAbend } from '../../utils/abend-codes.js';

/** DD names most likely to contain the failure narrative, in priority order. */
const DIAGNOSTIC_DDS = ['JESYSMSG', 'JESMSGLG', 'SYSOUT', 'SYSPRINT'];

/** Convert a raw SDK status into our normalized {@link JobStatus}. */
function normalizeStatus(status: string | undefined): JobStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'INPUT':
      return 'INPUT';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'OUTPUT':
      return 'OUTPUT';
    default:
      return 'UNKNOWN';
  }
}

/** Normalize a Zowe `IJob` into our {@link Job} domain type. */
export function normalizeJob(job: IJob): Job {
  return {
    jobName: job.jobname,
    jobId: job.jobid,
    owner: job.owner,
    status: normalizeStatus(job.status),
    returnCode: job.retcode ?? null,
    class: job.class,
    subsystem: job.subsystem,
    phase: job['phase-name'],
  };
}

/** Normalize a Zowe `IJobFile` into our {@link SpoolFile} domain type. */
export function normalizeSpoolFile(file: IJobFile): SpoolFile {
  return {
    id: file.id,
    ddName: file.ddname,
    stepName: file.stepname ?? undefined,
    procStep: file.procstep ?? undefined,
    recordCount: file['record-count'] ?? undefined,
  };
}

/** Determine whether a job's return code/status indicates a failure. */
export function isFailedJob(job: Job): boolean {
  const rc = (job.returnCode ?? '').toUpperCase();
  if (!rc) return false;
  if (rc.includes('ABEND')) return true;
  if (rc.includes('JCL ERROR')) return true;
  if (rc.includes('SEC ERROR')) return true;
  if (rc.includes('CANCELED') || rc.includes('CANCELLED')) return true;
  const ccMatch = rc.match(/CC\s+(\d+)/);
  if (ccMatch && Number(ccMatch[1]) >= 8) return true;
  return false;
}

/** Fetch a single raw job by JES id, mapping a miss to a {@link NotFoundError}. */
export async function fetchRawJob(ctx: ToolContext, jobId: string): Promise<IJob> {
  try {
    const job = await GetJobs.getJob(ctx.session, jobId);
    if (!job) throw new NotFoundError(`No job found with id ${jobId}.`, { jobId });
    return job;
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    const normalized = normalizeError(err);
    // Zowe returns a 4xx for unknown job ids; treat as not-found.
    if (/not\s*found|no jobs|404/i.test(normalized.message)) {
      throw new NotFoundError(`No job found with id ${jobId}.`, { jobId });
    }
    throw normalized;
  }
}

/** Fetch and normalize a single job by id. */
export async function fetchJob(ctx: ToolContext, jobId: string): Promise<Job> {
  return normalizeJob(await fetchRawJob(ctx, jobId));
}

/** List jobs by owner/prefix and normalize them. */
export async function listJobs(
  ctx: ToolContext,
  owner: string,
  prefix: string,
): Promise<Job[]> {
  const jobs = await GetJobs.getJobsByOwnerAndPrefix(ctx.session, owner, prefix);
  return jobs.map(normalizeJob);
}

/** Retrieve the normalized spool inventory of a job. */
export async function fetchSpoolFiles(
  ctx: ToolContext,
  jobName: string,
  jobId: string,
): Promise<SpoolFile[]> {
  const files = await GetJobs.getSpoolFiles(ctx.session, jobName, jobId);
  return files.map(normalizeSpoolFile);
}

/** Download the text content of a single spool file. */
export async function fetchSpoolContent(
  ctx: ToolContext,
  jobName: string,
  jobId: string,
  spoolId: number,
): Promise<string> {
  return GetJobs.getSpoolContentById(ctx.session, jobName, jobId, spoolId);
}

/** Try to pull the most diagnostic spool text for a job (capped by config). */
export async function fetchDiagnosticSpool(
  ctx: ToolContext,
  jobName: string,
  jobId: string,
): Promise<{ ddName: string; text: string }[]> {
  const files = await fetchSpoolFiles(ctx, jobName, jobId);
  const ordered = files
    .filter((file) => DIAGNOSTIC_DDS.includes(file.ddName.toUpperCase()))
    .sort(
      (a, b) =>
        DIAGNOSTIC_DDS.indexOf(a.ddName.toUpperCase()) -
        DIAGNOSTIC_DDS.indexOf(b.ddName.toUpperCase()),
    )
    .slice(0, ctx.config.limits.maxJesSpoolFiles);

  const out: { ddName: string; text: string }[] = [];
  for (const file of ordered) {
    const text = await fetchSpoolContent(ctx, jobName, jobId, file.id);
    out.push({ ddName: file.ddName, text });
  }
  return out;
}

/**
 * Analyze a (presumed failed) job: locate the abend code, failing step/program,
 * and a remediation hint from the diagnostic spool output.
 */
export async function analyzeJobFailure(
  ctx: ToolContext,
  jobId: string,
): Promise<JobFailureAnalysis> {
  const job = await fetchJob(ctx, jobId);
  const spool = await fetchDiagnosticSpool(ctx, job.jobName, job.jobId);
  const combined = spool.map((s) => s.text).join('\n');

  const abendCode = extractAbendCode(job.returnCode ?? '') ?? extractAbendCode(combined);
  const failedStep = findFailedStep(combined);
  const failedProgram = findFailedProgram(combined);
  const evidence = collectEvidence(combined, abendCode);

  const abendInfo = abendCode ? lookupAbend(abendCode) : undefined;

  let reason: string;
  let suggestedFix: string;
  if (abendInfo) {
    reason = `${abendInfo.title} — ${abendInfo.explanation}`;
    suggestedFix = abendInfo.suggestedFix;
  } else if (abendCode) {
    reason = `Job ended with code ${abendCode}. No reference entry is available for this code.`;
    suggestedFix = 'Review the spool output around the failing step for the specific message text.';
  } else if (isFailedJob(job)) {
    reason = `Job ended unsuccessfully with status "${job.returnCode ?? job.status}".`;
    suggestedFix = 'Inspect JESYSMSG/JESMSGLG for the first error or condition-code message.';
  } else {
    reason = 'No failure indicators were found; the job may have completed normally.';
    suggestedFix = 'Confirm the job actually failed before investigating further.';
  }

  return {
    job,
    abendCode,
    failedStep,
    failedProgram,
    reason,
    evidence,
    suggestedFix,
  };
}

/** Heuristically find the failing step name from spool messages. */
function findFailedStep(text: string): string | null {
  // IEF450I jobname stepname procstep - ABEND ...
  const ief450 = text.match(/IEF450I\s+\S+\s+(\S+)(?:\s+(\S+))?\s+-\s+ABEND/i);
  if (ief450) return ief450[1];
  // Generic "STEP WAS EXECUTED" / completion lines
  const stepCc = text.match(/IEF142I\s+\S+\s+(\S+)\s+.*COND CODE\s+(\d+)/i);
  if (stepCc && Number(stepCc[2]) >= 8) return stepCc[1];
  return null;
}

/** Heuristically find a referenced program/module name. */
function findFailedProgram(text: string): string | null {
  // CSV003I ... MODULE modname  /  module 'X' not found
  const notFound = text.match(/MODULE\s+([A-Z0-9#@$]{1,8})\s+NOT FOUND/i);
  if (notFound) return notFound[1];
  const csv = text.match(/CSV0\d\dI[^\n]*?\b([A-Z0-9#@$]{1,8})\b/i);
  if (csv) return csv[1];
  return null;
}

/** Pull the spool lines most relevant to the failure as supporting evidence. */
function collectEvidence(text: string, abendCode: string | null): string[] {
  const lines = text.split(/\r?\n/);
  const matches = lines.filter((line) =>
    /ABEND|IEF450I|IEF142I|IEC|IGZ|CSV0|S0C[0-9A-F]|COND CODE/.test(line),
  );
  if (abendCode) {
    const direct = lines.filter((line) => line.toUpperCase().includes(abendCode));
    matches.unshift(...direct);
  }
  // De-dupe while preserving order, keep it short.
  return [...new Set(matches.map((l) => l.trim()).filter(Boolean))].slice(0, 5);
}
