import { aggregateAbends, type FailedJobSummary } from '../../../src/tools/operations/shared.js';
import type { Job } from '../../../src/types/zos.js';

function job(name: string, id: string, retcode: string): Job {
  return { jobName: name, jobId: id, owner: 'U', status: 'OUTPUT', returnCode: retcode };
}

describe('operations/shared', () => {
  describe('aggregateAbends', () => {
    it('groups by abend code and sorts by count descending', () => {
      const summaries: FailedJobSummary[] = [
        { job: job('A', 'J1', 'ABEND S806'), abendCode: 'S806' },
        { job: job('B', 'J2', 'ABEND S0C7'), abendCode: 'S0C7' },
        { job: job('C', 'J3', 'ABEND S806'), abendCode: 'S806' },
      ];
      const result = aggregateAbends(summaries);
      expect(result[0].code).toBe('S806');
      expect(result[0].count).toBe(2);
      expect(result[0].jobs).toContain('A (J1)');
      expect(result[1].code).toBe('S0C7');
      expect(result[1].count).toBe(1);
    });

    it('falls back to return code when no abend code parsed', () => {
      const summaries: FailedJobSummary[] = [
        { job: job('D', 'J4', 'JCL ERROR'), abendCode: null },
      ];
      const result = aggregateAbends(summaries);
      expect(result[0].code).toBe('JCL ERROR');
      expect(result[0].count).toBe(1);
    });

    it('returns an empty array for no failures', () => {
      expect(aggregateAbends([])).toEqual([]);
    });
  });
});
