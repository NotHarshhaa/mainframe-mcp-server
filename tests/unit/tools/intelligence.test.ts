import { findFailedJobs } from '../../../src/tools/operations/shared.js';
import { predictBatchFailures, buildRootCauseReport } from '../../../src/tools/intelligence/shared.js';
import { analyzeJobFailure } from '../../../src/tools/jobs/shared.js';
import type { Job } from '../../../src/types/zos.js';
import type { ToolContext } from '../../../src/types/tools.js';

jest.mock('../../../src/tools/operations/shared.js', () => ({
  ...jest.requireActual('../../../src/tools/operations/shared.js'),
  findFailedJobs: jest.fn(),
}));

jest.mock('../../../src/tools/jobs/shared.js', () => ({
  ...jest.requireActual('../../../src/tools/jobs/shared.js'),
  analyzeJobFailure: jest.fn(),
}));

function job(name: string, id: string, retcode: string): Job {
  return { jobName: name, jobId: id, owner: 'U', status: 'OUTPUT', returnCode: retcode };
}

const ctx = {
  session: {},
  config: { limits: { maxJesSpoolFiles: 5, maxFailedJobResults: 100 } },
  logger: { debug: () => undefined },
} as unknown as ToolContext;

// ---------------------------------------------------------------------------
// predictBatchFailures
// ---------------------------------------------------------------------------
describe('intelligence/shared – predictBatchFailures', () => {
  beforeEach(() => {
    jest.mocked(findFailedJobs).mockResolvedValue([
      { job: job('PAYJOB01', 'J1', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 1_000 },
      { job: job('PAYJOB01', 'J2', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 2_000 },
      { job: job('PAYJOB01', 'J3', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 3_000 },
      { job: job('PAYJOB01', 'J4', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 4_000 },
      { job: job('RPTJOB', 'J5', 'ABEND S0C7'), abendCode: 'S0C7', endedAt: Date.now() - 5_000 },
    ]);
  });

  it('scores recurring job failures with risk levels', async () => {
    const risks = await predictBatchFailures(ctx, 168);
    expect(risks[0].jobName).toBe('PAYJOB01');
    expect(risks[0].failureCount).toBe(4);
    expect(['HIGH', 'CRITICAL']).toContain(risks[0].riskLevel);
  });

  it('surfaces topAbendDescription for known abend codes', async () => {
    const risks = await predictBatchFailures(ctx, 168);
    const payjob = risks.find((r) => r.jobName === 'PAYJOB01');
    expect(payjob?.topAbend).toBe('S806');
    expect(payjob?.topAbendDescription).toMatch(/Module Not Found/i);
  });

  it('returns lastOccurrence timestamp', async () => {
    const risks = await predictBatchFailures(ctx, 168);
    const payjob = risks.find((r) => r.jobName === 'PAYJOB01');
    expect(payjob?.lastOccurrence).not.toBeNull();
    expect(typeof payjob?.lastOccurrence).toBe('number');
  });

  it('filters jobs below minFailures threshold', async () => {
    // RPTJOB has 1 failure — should be excluded when minFailures=2
    const risks = await predictBatchFailures(ctx, 168, 2);
    const rptJob = risks.find((r) => r.jobName === 'RPTJOB');
    expect(rptJob).toBeUndefined();
    const payJob = risks.find((r) => r.jobName === 'PAYJOB01');
    expect(payJob).toBeDefined();
  });

  it('returns empty array when no jobs meet the window criteria', async () => {
    jest.mocked(findFailedJobs).mockResolvedValue([]);
    const risks = await predictBatchFailures(ctx, 168);
    expect(risks).toHaveLength(0);
  });

  it('trend is STABLE for a single-failure job', async () => {
    jest.mocked(findFailedJobs).mockResolvedValue([
      { job: job('STABLEJOB', 'J1', 'ABEND S222'), abendCode: 'S222', endedAt: Date.now() },
    ]);
    const risks = await predictBatchFailures(ctx, 168);
    expect(risks[0].trend).toBe('STABLE');
  });
});

// ---------------------------------------------------------------------------
// buildRootCauseReport
// ---------------------------------------------------------------------------
describe('intelligence/shared – buildRootCauseReport', () => {
  const baseAnalysis = {
    job: job('PAYJOB01', 'J99', 'ABEND S806'),
    abendCode: 'S806',
    failedStep: 'STEP010',
    cancelledStep: null,
    failedProgram: 'PAYPGM01',
    reason: 'Module Not Found / Load Failure',
    evidence: ['IEF285I PAYPGM01 NOT FOUND'],
    suggestedFix: 'Verify STEPLIB concatenation.',
  };

  beforeEach(() => {
    jest.mocked(analyzeJobFailure).mockResolvedValue(baseAnalysis);
    jest.mocked(findFailedJobs).mockResolvedValue([
      { job: job('PAYJOB01', 'J1', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 1_000 },
      { job: job('PAYJOB01', 'J2', 'ABEND S806'), abendCode: 'S806', endedAt: Date.now() - 2_000 },
    ]);
  });

  it('includes healthScore in the report', async () => {
    const report = await buildRootCauseReport(ctx, 'J99', 72);
    expect(typeof report.healthScore).toBe('number');
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
  });

  it('sets confidence HIGH when abendCode + failedStep + evidence are all present', async () => {
    const report = await buildRootCauseReport(ctx, 'J99', 72);
    expect(report.confidence).toBe('HIGH');
  });

  it('lists similar incidents from the look-back window', async () => {
    const report = await buildRootCauseReport(ctx, 'J99', 72);
    expect(report.similarIncidents.length).toBeGreaterThan(0);
    expect(report.similarIncidents[0]).toContain('PAYJOB01');
  });

  it('includes action items with no duplicates', async () => {
    const report = await buildRootCauseReport(ctx, 'J99', 72);
    const unique = new Set(report.actionItems);
    expect(unique.size).toBe(report.actionItems.length);
  });
});
