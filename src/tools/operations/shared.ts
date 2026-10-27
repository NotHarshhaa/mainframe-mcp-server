/**
 * Shared operations helpers.
 *
 * Higher-level workflows composed from the job tools: finding failed jobs in a
 * window, aggregating abends, and assembling incident bundles.
 */
import { GetJobs, type IJob } from '@zowe/zos-jobs-for-zowe-sdk';
import type { Job, AbendCodeInfo, JobFailureAnalysis } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { extractAbendCode, lookupAbend } from '../../utils/abend-codes.js';
import { findRunbookUrl, parseRunbooks } from '../../utils/runbooks.js';
import { formatDocExcerpts, type DocMatch } from '../../utils/doc-rag.js';
import {
  formatAnalysisFull,
  formatSpoolFiles,
  formatStructuredResponse,
  truncateLines,
  type StructuredSection,
} from '../../utils/formatters.js';
import { isFailedJob, normalizeJob, analyzeJobFailure, fetchDiagnosticSpool, fetchSpoolFiles } from '../jobs/shared.js';
import { effectiveSession } from '../../zowe/enduser.js';

/** A failed job enriched with the abend code parsed from its return code. */
export interface FailedJobSummary {
  job: Job;
  abendCode: string | null;
  endedAt: number | null;
}

/** Parse the `exec-ended` timestamp from a raw job, if present. */
function execEndedMillis(raw: IJob): number | null {
  const value = raw['exec-ended'];
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Find failed jobs in the output queue within the last `hours`.
 *
 * Only jobs with an `exec-ended` timestamp inside the window are returned so
 * stale OUTPUT entries without timing metadata are not misreported as recent.
 */
export async function findFailedJobs(
  ctx: ToolContext,
  hours: number,
  owner = '*',
): Promise<FailedJobSummary[]> {
  const raws = await GetJobs.getJobsByOwnerAndPrefix(await effectiveSession(ctx), owner, '*');
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const maxResults = ctx.config.limits.maxFailedJobResults;

  const summaries: FailedJobSummary[] = [];
  for (const raw of raws) {
    const job = normalizeJob(raw);
    if (job.status !== 'OUTPUT' || !isFailedJob(job)) continue;

    const ended = execEndedMillis(raw);
    if (ended == null || ended < cutoff) continue;

    summaries.push({
      job,
      abendCode: extractAbendCode(job.returnCode ?? ''),
      endedAt: ended,
    });
  }

  return summaries.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, maxResults);
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

// ---------------------------------------------------------------------------
// Incident bundle (feature: incident)
// ---------------------------------------------------------------------------

/** Everything assembled for one job incident. */
export interface IncidentBundle {
  job: Job;
  analysis: JobFailureAnalysis;
  /** Built-in reference entry for the abend code, when known. */
  abendInfo?: AbendCodeInfo;
  /** Organization runbook URL matched from INCIDENT_RUNBOOKS, when any. */
  runbookUrl?: string;
  /** Internal-documentation excerpts retrieved for the failure (RAG). */
  docMatches: DocMatch[];
  /** Ordered response sections (analysis, references, spool, excerpts). */
  sections: StructuredSection[];
  /** The full formatted bundle text (same content as `sections`). */
  formatted: string;
}

/**
 * Assemble the full investigation bundle for a job: failure analysis, abend
 * reference, runbook link, internal-documentation (RAG) excerpts, spool
 * inventory, and diagnostic excerpts from all relevant DDs.
 *
 * Consumed by `investigate_incident` and by `create_incident_ticket` so a
 * ticket always carries the same evidence the agent investigated.
 */
export async function buildIncidentBundle(
  ctx: ToolContext,
  jobId: string,
  opts?: { maxExcerptLines?: number; includeDocs?: boolean },
): Promise<IncidentBundle> {
  const excerptLines = opts?.maxExcerptLines ?? 80;

  const analysis = await analyzeJobFailure(ctx, jobId);
  const job = analysis.job;
  const spoolFiles = await fetchSpoolFiles(ctx, job.jobName, job.jobId);

  // Rich failure analysis (summary + evidence + remediation)
  const analysisFull = formatAnalysisFull(analysis, { includeEvidence: true });

  // Inline abend code reference when we have a known code
  const abendInfo = analysis.abendCode ? lookupAbend(analysis.abendCode) : undefined;
  const abendReference = abendInfo
    ? `${abendInfo.code} — ${abendInfo.title}\n${abendInfo.suggestedFix}`
    : analysis.abendCode
      ? `Abend code ${analysis.abendCode} has no reference entry in the local catalog.`
      : 'No abend code detected.';

  // Organization runbook link, when INCIDENT_RUNBOOKS matches the code.
  const runbooks = parseRunbooks(ctx.config.incident.runbooks);
  const runbookUrl = findRunbookUrl(analysis.abendCode, runbooks);

  // Internal documentation excerpts (RAG over DOCS_SOURCES).
  let docMatches: DocMatch[] = [];
  if (opts?.includeDocs !== false && ctx.docIndex && analysis.abendCode) {
    try {
      docMatches = ctx.docIndex.search(analysis.abendCode, ctx.config.docs.maxResults);
    } catch (err) {
      ctx.logger.warn({ err }, 'doc-rag: retrieval failed; continuing without excerpts');
    }
  }

  const sections: StructuredSection[] = [
    { heading: 'Failure analysis', body: analysisFull },
    {
      heading: `Abend reference (${analysis.abendCode ?? 'N/A'})`,
      body: abendReference,
    },
  ];
  if (runbookUrl) {
    sections.push({
      heading: `Runbook (${analysis.abendCode ?? 'general'})`,
      body: `${runbookUrl}\nFollow the organization runbook above for environment-specific remediation.`,
    });
  }
  if (docMatches.length > 0) {
    sections.push({
      heading: 'Internal documentation (RAG)',
      body: formatDocExcerpts(docMatches, ctx.config.docs.maxExcerptChars),
    });
  }
  sections.push({
    heading: 'Spool inventory',
    body: formatSpoolFiles(job.jobName, job.jobId, spoolFiles),
  });

  // Collect diagnostic excerpts from ALL relevant DDs (not just the first)
  if (analysis.abendCode || analysis.failedStep || analysis.cancelledStep) {
    const diags = await fetchDiagnosticSpool(ctx, job.jobName, job.jobId);
    for (const diag of diags) {
      const { text, truncated, totalLines } = truncateLines(diag.text, excerptLines);
      const suffix = truncated
        ? `\n... [showing first ${excerptLines} of ${totalLines} lines — increase maxExcerptLines for more]`
        : '';
      sections.push({
        heading: `Diagnostic excerpt — ${diag.ddName}`,
        body: text + suffix,
      });
    }
  }

  ctx.logger.debug(
    { jobId, abendCode: analysis.abendCode, excerptSections: sections.length },
    'incident bundle assembled',
  );

  return {
    job,
    analysis,
    ...(abendInfo ? { abendInfo } : {}),
    ...(runbookUrl ? { runbookUrl } : {}),
    docMatches,
    sections,
    formatted: formatStructuredResponse(
      `Incident Investigation — ${job.jobName} (${job.jobId})`,
      sections,
    ),
  };
}
