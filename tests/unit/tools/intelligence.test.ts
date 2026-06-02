import { findFailedJobs } from '../../../src/tools/operations/shared.js';
import { predictBatchFailures } from '../../../src/tools/intelligence/shared.js';
import type { Job } from '../../../src/types/zos.js';
import type { ToolContext } from '../../../src/types/tools.js';

jest.mock('../../../src/tools/operations/shared.js', () => ({
  ...jest.requireActual('../../../src/tools/operations/shared.js'),
  findFailedJobs: jest.fn(),
}));

function job(name: string, id: string, retcode: string): Job {
  return { jobName: name, jobId: id, owner: 'U', status: 'OUTPUT', returnCode: retcode };
}

describe('intelligence/shared', () => {
  const ctx = {
    session: {},
    config: { limits: { maxJesSpoolFiles: 5 } },
    logger: { debug: () => undefined },
  } as unknown as ToolContext;

  beforeEach(() => {
    jest.mocked(findFailedJobs).mockResolvedValue([
      { job: job('PAYJOB01', 'J1', 'ABEND S806'), abendCode: 'S806', endedAt: null },
      { job: job('PAYJOB01', 'J2', 'ABEND S806'), abendCode: 'S806', endedAt: null },
      { job: job('PAYJOB01', 'J3', 'ABEND S806'), abendCode: 'S806', endedAt: null },
      { job: job('PAYJOB01', 'J4', 'ABEND S806'), abendCode: 'S806', endedAt: null },
      { job: job('RPTJOB', 'J5', 'ABEND S0C7'), abendCode: 'S0C7', endedAt: null },
    ]);
  });

  it('scores recurring job failures with risk levels', async () => {
    const risks = await predictBatchFailures(ctx, 168);
    expect(risks[0].jobName).toBe('PAYJOB01');
    expect(risks[0].failureCount).toBe(4);
    expect(['HIGH', 'CRITICAL']).toContain(risks[0].riskLevel);
  });
});
