import type { IJob, IJobFile } from '@zowe/zos-jobs-for-zowe-sdk';
import {
  analyzeJobFailureFromText,
  assertValidJobId,
  collectEvidence,
  findCancelledStep,
  findFailedProgram,
  findFailedStep,
  isFailedJob,
  latestSpoolFilesByDd,
  normalizeJob,
  normalizeJobId,
  normalizeSpoolFile,
} from '../../../src/tools/jobs/shared.js';
import { ValidationError } from '../../../src/utils/errors.js';
import type { Job } from '../../../src/types/zos.js';

function makeJob(overrides: Partial<IJob>): IJob {
  return {
    jobname: 'PAYJOB01',
    jobid: 'JOB01234',
    owner: 'PAYUSR',
    status: 'OUTPUT',
    retcode: 'CC 0000',
    ...overrides,
  } as IJob;
}

function makeDomainJob(overrides: Partial<Job>): Job {
  return {
    jobName: 'PAYJOB01',
    jobId: 'JOB01234',
    owner: 'PAYUSR',
    status: 'OUTPUT',
    returnCode: 'CC 0000',
    ...overrides,
  };
}

describe('jobs/shared', () => {
  describe('normalizeJob', () => {
    it('maps SDK fields onto the domain Job', () => {
      const job = normalizeJob(makeJob({ class: 'A', subsystem: 'JES2' }));
      expect(job.jobName).toBe('PAYJOB01');
      expect(job.jobId).toBe('JOB01234');
      expect(job.status).toBe('OUTPUT');
      expect(job.class).toBe('A');
    });

    it('normalizes unknown status', () => {
      const job = normalizeJob(makeJob({ status: 'WEIRD' as IJob['status'] }));
      expect(job.status).toBe('UNKNOWN');
    });

    it('maps a missing retcode to null', () => {
      const job = normalizeJob(makeJob({ retcode: undefined }));
      expect(job.returnCode).toBeNull();
    });
  });

  describe('normalizeJobId', () => {
    it('converts to uppercase', () => {
      expect(normalizeJobId('job01234')).toBe('JOB01234');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeJobId('  JOB01234  ')).toBe('JOB01234');
    });

    it('handles mixed case', () => {
      expect(normalizeJobId('Stc00001')).toBe('STC00001');
    });
  });

  describe('assertValidJobId', () => {
    it('accepts standard JOB id', () => {
      expect(() => assertValidJobId('JOB01234')).not.toThrow();
    });

    it('accepts STC id', () => {
      expect(() => assertValidJobId('STC00001')).not.toThrow();
    });

    it('accepts TSU id', () => {
      expect(() => assertValidJobId('TSU12345')).not.toThrow();
    });

    it('accepts lowercase (normalised internally)', () => {
      expect(() => assertValidJobId('job01234')).not.toThrow();
    });

    it('rejects plain text without digit suffix', () => {
      expect(() => assertValidJobId('INVALID')).toThrow(ValidationError);
    });

    it('rejects all-digit id', () => {
      expect(() => assertValidJobId('123456')).toThrow(ValidationError);
    });

    it('rejects unknown prefix (not JOB/STC/TSU)', () => {
      expect(() => assertValidJobId('ORD01234')).toThrow(ValidationError);
    });

    it('rejects too many digits', () => {
      expect(() => assertValidJobId('JOB123456')).toThrow(ValidationError);
    });

    it('rejects empty string', () => {
      expect(() => assertValidJobId('')).toThrow(ValidationError);
    });
  });

  describe('normalizeSpoolFile', () => {
    it('maps SDK spool fields', () => {
      const file = normalizeSpoolFile({
        id: 2,
        ddname: 'JESMSGLG',
        stepname: 'STEP030',
        'record-count': 42,
      } as IJobFile);
      expect(file.id).toBe(2);
      expect(file.ddName).toBe('JESMSGLG');
      expect(file.stepName).toBe('STEP030');
      expect(file.recordCount).toBe(42);
    });
  });

  describe('latestSpoolFilesByDd', () => {
    it('keeps the highest spool id when DD names duplicate', () => {
      const deduped = latestSpoolFilesByDd([
        { id: 1, ddName: 'SYSOUT' },
        { id: 3, ddName: 'SYSOUT' },
        { id: 2, ddName: 'JESYSMSG' },
      ]);
      expect(deduped).toHaveLength(2);
      expect(deduped.find((file) => file.ddName === 'SYSOUT')?.id).toBe(3);
    });
  });

  describe('isFailedJob', () => {
    it('flags abends', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'ABEND S806' }))).toBe(true);
    });

    it('flags JCL errors', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'JCL ERROR' }))).toBe(true);
    });

    it('flags condition codes >= 8', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'CC 0012' }))).toBe(true);
    });

    it('does not flag CC 0000 or CC 0004', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'CC 0000' }))).toBe(false);
      expect(isFailedJob(makeDomainJob({ returnCode: 'CC 0004' }))).toBe(false);
    });

    it('does not flag a running job (null retcode)', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: null, status: 'ACTIVE' }))).toBe(false);
    });

    it('flags SEC ERROR', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'SEC ERROR' }))).toBe(true);
    });

    it('flags CANCELLED', () => {
      expect(isFailedJob(makeDomainJob({ returnCode: 'CANCELLED' }))).toBe(true);
    });
  });

  describe('findFailedStep', () => {
    it('extracts a step from an IEF450I abend line', () => {
      const text = 'IEF450I PAYJOB01 STEP030 PROC1 - ABEND S806 U0000';
      expect(findFailedStep(text)).toBe('STEP030');
    });

    it('extracts a step from an IEF142I condition code line', () => {
      const text = 'IEF142I PAYJOB01 STEP010 - STEP010 WAS EXECUTED - COND CODE 0012';
      expect(findFailedStep(text)).toBe('STEP010');
    });

    it('returns null when no failure patterns found', () => {
      expect(findFailedStep('Normal completion message.')).toBeNull();
    });
  });

  describe('findFailedProgram', () => {
    it('detects MODULE NOT FOUND pattern', () => {
      const text = 'IEFBR14 MODULE IEFBR14 NOT FOUND IN LOAD LIBRARY';
      expect(findFailedProgram(text)).toBe('IEFBR14');
    });

    it('detects CSV series messages', () => {
      const text = 'CSV003I UNABLE TO LOAD PAYPROC';
      expect(findFailedProgram(text)).toBe('PAYPROC');
    });

    it('detects IEF285I program not found', () => {
      const text = 'IEF285I PAYRPT01 NOT FOUND ON LNKLST';
      expect(findFailedProgram(text)).toBe('PAYRPT01');
    });

    it('returns null when no program found', () => {
      expect(findFailedProgram('Normal spool output line.')).toBeNull();
    });
  });

  describe('findCancelledStep', () => {
    it('detects IEF473I cancellation', () => {
      const text = 'IEF473I PAYJOB01 STEP020 CANCELLED';
      expect(findCancelledStep(text)).toBe('STEP020');
    });

    it('detects IEF473I with proc step', () => {
      const text = 'IEF473I PAYJOB01 STEPB PROC1 CANCEL';
      expect(findCancelledStep(text)).toBe('STEPB');
    });

    it('detects STEP CANCELLED message', () => {
      const text = 'STEP PAYSTEP WAS CANCELLED BY OPERATOR';
      expect(findCancelledStep(text)).toBe('PAYSTEP');
    });

    it('returns null when no cancellation found', () => {
      expect(findCancelledStep('Job completed normally.')).toBeNull();
    });
  });

  describe('collectEvidence', () => {
    it('collects abend and IEF lines', () => {
      const text = [
        'Normal line',
        'IEF450I PAYJOB01 STEP030 PROC1 - ABEND S806',
        'Another normal line',
        'IEF142I STEP030 COND CODE 0012',
      ].join('\n');
      const evidence = collectEvidence(text, null);
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence.some((l) => l.includes('IEF450I'))).toBe(true);
    });

    it('prioritises lines containing the abend code', () => {
      const text = [
        'IEF450I PAYJOB01 STEP030 - ABEND S806',
        'Other message',
        'S806 detected in program output',
      ].join('\n');
      const evidence = collectEvidence(text, 'S806');
      // Lines with S806 should appear at front
      expect(evidence[0]).toContain('S806');
    });

    it('de-duplicates identical lines', () => {
      const repeated = 'ABEND S806 U0000\nABEND S806 U0000\nABEND S806 U0000';
      const evidence = collectEvidence(repeated, null);
      expect(evidence).toHaveLength(1);
    });

    it('caps at 5 items', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `IEF450I JOB STEP${i} - ABEND S${i}`).join('\n');
      const evidence = collectEvidence(lines, null);
      expect(evidence.length).toBeLessThanOrEqual(5);
    });
  });

  describe('analyzeJobFailureFromText', () => {
    it('identifies abend code and step from spool', () => {
      const job = makeDomainJob({ returnCode: 'ABEND S806' });
      const spool = [
        {
          ddName: 'JESYSMSG',
          text: 'IEF450I PAYJOB01 STEP030 PROC1 - ABEND S806 U0000',
        },
      ];
      const result = analyzeJobFailureFromText(job, spool);
      expect(result.abendCode).toBe('S806');
      expect(result.failedStep).toBe('STEP030');
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('detects cancellation when no abend code', () => {
      const job = makeDomainJob({ returnCode: 'CANCELLED' });
      const spool = [
        {
          ddName: 'JESYSMSG',
          text: 'IEF473I PAYJOB01 STEPB CANCELLED BY OPERATOR',
        },
      ];
      const result = analyzeJobFailureFromText(job, spool);
      expect(result.cancelledStep).toBe('STEPB');
      expect(result.reason).toContain('STEPB');
    });

    it('returns normal-completion message for a passing job', () => {
      const job = makeDomainJob({ returnCode: 'CC 0000' });
      const spool = [{ ddName: 'JESYSMSG', text: 'Normal completion output' }];
      const result = analyzeJobFailureFromText(job, spool);
      expect(result.reason).toContain('completed normally');
    });

    it('works with empty spool texts', () => {
      const job = makeDomainJob({ returnCode: 'CC 0016' });
      const result = analyzeJobFailureFromText(job, []);
      expect(result.abendCode).toBeNull();
      expect(result.evidence).toHaveLength(0);
      expect(result.reason).toContain('CC 0016');
    });
  });
});
