/**
 * AI-assisted diagnostics and predictive failure analysis.
 *
 * These tools enrich job failure data with correlation, historical patterns,
 * and risk scoring — producing structured output optimized for LLM reasoning.
 * No external AI API is called; the MCP client agent interprets the report.
 */
import type { FailureRisk, RootCauseReport } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { lookupAbend } from '../../utils/abend-codes.js';
import { analyzeJobFailure } from '../jobs/shared.js';
import { aggregateAbends, findFailedJobs } from '../operations/shared.js';

/** Build an extended root-cause report for a failed job. */
export async function buildRootCauseReport(
  ctx: ToolContext,
  jobId: string,
  lookbackHours = 72,
): Promise<RootCauseReport> {
  const analysis = await analyzeJobFailure(ctx, jobId);
  const recentFailures = await findFailedJobs(ctx, lookbackHours, '*');

  const sameJob = recentFailures.filter(
    (f) => f.job.jobName === analysis.job.jobName && f.job.jobId !== analysis.job.jobId,
  );
  const sameAbend = recentFailures.filter(
    (f) => f.abendCode && f.abendCode === analysis.abendCode,
  );

  const similarIncidents = sameJob
    .slice(0, 5)
    .map((f) => `${f.job.jobName} (${f.job.jobId}) — ${f.abendCode ?? f.job.returnCode ?? 'failed'}`);

  const correlatedAbends = aggregateAbends(recentFailures)
    .slice(0, 5)
    .map((entry) => ({ code: entry.code, count: entry.count }));

  const actionItems: string[] = [analysis.suggestedFix];
  const abendInfo = analysis.abendCode ? lookupAbend(analysis.abendCode) : undefined;

  if (abendInfo) {
    for (const cause of abendInfo.commonCauses.slice(0, 2)) {
      actionItems.push(`Check: ${cause}`);
    }
  }

  if (sameJob.length >= 2) {
    actionItems.push(
      `Recurring failure: ${analysis.job.jobName} failed ${sameJob.length + 1} times in ${lookbackHours}h — investigate environment or input data drift.`,
    );
  }

  if (sameAbend.length >= 3) {
    actionItems.push(
      `Systemic abend ${analysis.abendCode} seen ${sameAbend.length} times recently — may indicate a shared dependency or infrastructure issue.`,
    );
  }

  let confidence: RootCauseReport['confidence'] = 'LOW';
  if (analysis.abendCode && analysis.failedStep && analysis.evidence.length > 0) {
    confidence = 'HIGH';
  } else if (analysis.abendCode || analysis.failedStep) {
    confidence = 'MEDIUM';
  }

  const summary = [
    analysis.abendCode ? `Abend ${analysis.abendCode}` : 'Failure detected',
    analysis.failedStep ? `in step ${analysis.failedStep}` : '',
    abendInfo ? `— ${abendInfo.title}` : '',
    sameJob.length > 0 ? `(${sameJob.length} similar incident(s) in ${lookbackHours}h)` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    analysis,
    confidence,
    similarIncidents,
    correlatedAbends,
    actionItems: [...new Set(actionItems)],
    summary,
  };
}

/** Score batch jobs for predicted failure risk based on recent history. */
export async function predictBatchFailures(
  ctx: ToolContext,
  hours = 168,
): Promise<FailureRisk[]> {
  const failures = await findFailedJobs(ctx, hours, '*');
  const byJob = new Map<string, typeof failures>();

  for (const summary of failures) {
    const list = byJob.get(summary.job.jobName) ?? [];
    list.push(summary);
    byJob.set(summary.job.jobName, list);
  }

  const risks: FailureRisk[] = [];

  for (const [jobName, jobFailures] of byJob.entries()) {
    const count = jobFailures.length;
    const abendCounts = aggregateAbends(jobFailures);
    const topAbend = abendCounts[0]?.code ?? null;

    // Simple risk score: failures weighted by recency density.
    const baseScore = Math.min(100, count * 15 + (topAbend ? 10 : 0));
    const riskScore = Math.round(baseScore);

    let riskLevel: FailureRisk['riskLevel'] = 'LOW';
    if (riskScore >= 75) riskLevel = 'CRITICAL';
    else if (riskScore >= 50) riskLevel = 'HIGH';
    else if (riskScore >= 25) riskLevel = 'MEDIUM';

    // Trend: compare first half vs second half of failure list (proxy for increasing rate).
    const half = Math.ceil(count / 2);
    const trend: FailureRisk['trend'] =
      count >= 4 && jobFailures.slice(half).length > jobFailures.slice(0, half).length
        ? 'INCREASING'
        : count >= 4 && jobFailures.slice(half).length < jobFailures.slice(0, half).length
          ? 'DECREASING'
          : 'STABLE';

    let recommendation = 'Monitor during next scheduled run.';
    if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
      recommendation = `Investigate ${jobName} before next run; top abend ${topAbend ?? 'unknown'} occurred ${count} times in ${hours}h.`;
    } else if (trend === 'INCREASING') {
      recommendation = `Failure rate for ${jobName} is increasing — review recent changes and input volumes.`;
    }

    risks.push({
      jobName,
      riskScore,
      riskLevel,
      failureCount: count,
      topAbend,
      trend,
      recommendation,
    });
  }

  return risks.sort((a, b) => b.riskScore - a.riskScore).slice(0, 25);
}
