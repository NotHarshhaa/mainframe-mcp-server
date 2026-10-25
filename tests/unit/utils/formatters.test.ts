import {
  formatAbendCatalog,
  formatAbendInfo,
  formatContentHeader,
  formatFailureAnalysis,
  formatJobList,
  formatMemberList,
  formatStructuredResponse,
  formatUssListing,
  renderTable,
  truncateLines,
} from '../../../src/utils/formatters.js';
import type { AbendCodeInfo, Job, JobFailureAnalysis, UssEntry } from '../../../src/types/zos.js';

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

    it('normalizes Windows line endings before truncating', () => {
      const input = 'a\r\nb\r\nc';
      const res = truncateLines(input, 2);
      expect(res.totalLines).toBe(3);
      expect(res.text).not.toContain('\r');
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
      expect(out).toContain('(1 shown)');
    });

    it('notes when results are capped', () => {
      const jobs: Job[] = [
        {
          jobName: 'PAYJOB01',
          jobId: 'JOB01234',
          owner: 'PAYUSR',
          status: 'OUTPUT',
          returnCode: 'CC 0000',
        },
      ];
      const out = formatJobList(jobs, 50);
      expect(out).toContain('of 50 matched');
      expect(out).toContain('Showing first 1 of 50');
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
      expect(out).toContain('Job:       PAYJOB01 (JOB01234)');
      expect(out).toContain('Step:      STEP030 — LOADPGM');
      expect(out).toContain('Fix:       Verify the module is linked.');
    });
  });

  describe('formatStructuredResponse', () => {
    it('renders a titled response with numbered sections', () => {
      const out = formatStructuredResponse('System Health Summary', [
        { heading: 'Overview', body: 'status: HEALTHY' },
        { heading: 'Top abends', body: 'S806: 2' },
      ]);
      expect(out).toContain('System Health Summary');
      expect(out).toContain('1. OVERVIEW');
      expect(out).toContain('2. TOP ABENDS');
    });
  });

  describe('formatAbendInfo', () => {
    it('includes explanation, causes, and fix', () => {
      const info: AbendCodeInfo = {
        code: 'S806',
        title: 'Module Not Found',
        category: 'system',
        explanation: 'Load module missing.',
        commonCauses: ['Missing STEPLIB'],
        suggestedFix: 'Check libraries.',
      };
      const out = formatAbendInfo(info);
      expect(out).toContain('Code:     S806');
      expect(out).toContain('• Missing STEPLIB');
      expect(out).toContain('Fix:      Check libraries.');
    });
  });

  describe('formatAbendCatalog', () => {
    it('renders a table of abend codes', () => {
      const out = formatAbendCatalog([
        {
          code: 'S0C7',
          title: 'Data Exception',
          category: 'system',
          explanation: 'x',
          commonCauses: [],
          suggestedFix: 'y',
        },
      ]);
      expect(out).toContain('S0C7');
      expect(out).toContain('Data Exception');
    });
  });

  describe('formatMemberList', () => {
    it('reports when a pattern matches nothing', () => {
      expect(formatMemberList('SYS1.PROCLIB', [], 'IKJ*')).toMatch(/matched pattern/);
    });
  });

  describe('formatContentHeader', () => {
    it('includes a truncation notice when content was capped', () => {
      const header = formatContentHeader('SYS1.PROCLIB(MEM)', true, 5000, 2000);
      expect(header).toContain('[Showing first 2000 of 5000 lines]');
    });
  });

  describe('formatUssListing', () => {
    const entry = (overrides: Partial<UssEntry>): UssEntry => ({
      name: 'entry',
      type: 'file',
      ...overrides,
    });

    it('pluralizes entry types correctly', () => {
      const out = formatUssListing('/u/app', [
        entry({ name: 'a', type: 'directory' }),
        entry({ name: 'b', type: 'directory' }),
        entry({ name: 'c', type: 'file' }),
        entry({ name: 'd', type: 'file' }),
        entry({ name: 'e', type: 'symlink' }),
      ]);
      expect(out).toContain('2 directories');
      expect(out).toContain('2 files');
      expect(out).toContain('1 symlink');
      expect(out).not.toContain('directoryy');
      expect(out).not.toContain('directoryies');
    });

    it('uses singular forms for single entries', () => {
      const out = formatUssListing('/u/app', [
        entry({ name: 'a', type: 'directory' }),
        entry({ name: 'b', type: 'file' }),
      ]);
      expect(out).toContain('1 file, 1 directory');
      expect(out).not.toContain('directoryy');
      expect(out).not.toContain('directoryies');
    });
  });
});
