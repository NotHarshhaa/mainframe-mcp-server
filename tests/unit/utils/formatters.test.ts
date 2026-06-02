import {
  formatFailureAnalysis,
  formatJobList,
  renderTable,
  truncateLines,
} from '../../../src/utils/formatters.js';
import type { Job, JobFailureAnalysis } from '../../../src/types/zos.js';

describe('formatters', () => {
  describe('renderTable', () => {
    it('renders headers and rows with box drawing characters', () => {
      const table = renderTable(['A', 'B'], [['1', '2']]);
      expect(table).toContain('A');
      expect(table).toContain('B');
      expect(table).toContain('│ 1');
      expect(table.split('\n').length).toBe(5); // top, header, sep, row, bottom
    });

    it('renders a header-only table when there are no rows', () => {
      const table = renderTable(['Col'], []);
      expect(table).toContain('Col');
      expect(table.split('\n').length).toBe(3);
    });
  });

  describe('truncateLines', () => {
    it('does not truncate when under the limit', () => {
      const res = truncateLines('a\nb\nc', 5);
      expect(res.truncated).toBe(false);
      expect(res.totalLines).toBe(3);
    });

    it('truncates and reports the original line count', () => {
      const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
      const res = truncateLines(input, 4);
      expect(res.truncated).toBe(true);
      expect(res.totalLines).toBe(10);
      expect(res.text).toContain('truncated 6 of 10 lines');
    });
  });

  describe('formatJobList', () => {
    it('reports an empty result clearly', () => {
      expect(formatJobList([])).toMatch(/No jobs matched/);
    });

    it('includes job identifiers in the table', () => {
      const jobs: Job[] = [
        {
          jobName: 'PAYJOB01',
          jobId: 'JOB01234',
          owner: 'PAYUSR',
          status: 'OUTPUT',
          returnCode: 'ABEND S806',
        },
      ];
      const out = formatJobList(jobs);
      expect(out).toContain('PAYJOB01');
      expect(out).toContain('JOB01234');
      expect(out).toContain('(1 found)');
    });
  });

  describe('formatFailureAnalysis', () => {
    it('produces the README-style summary block', () => {
      const analysis: JobFailureAnalysis = {
        job: {
          jobName: 'PAYJOB01',
          jobId: 'JOB01234',
          owner: 'PAYUSR',
          status: 'OUTPUT',
          returnCode: 'ABEND S806',
        },
        abendCode: 'S806',
        failedStep: 'STEP030',
        failedProgram: 'LOADPGM',
        reason: 'Module not found',
        evidence: ['IEF450I PAYJOB01 STEP030 - ABEND S806 U0000'],
        suggestedFix: 'Verify the module is linked.',
      };
      const out = formatFailureAnalysis(analysis);
      expect(out).toContain('Job:     PAYJOB01 (JOB01234)');
      expect(out).toContain('Step:    STEP030 - LOADPGM');
      expect(out).toContain('Fix:     Verify the module is linked.');
    });
  });
});
