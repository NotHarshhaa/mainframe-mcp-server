import type { IJob, IJobFile } from '@zowe/zos-jobs-for-zowe-sdk';
import { findFailedStep, isFailedJob, latestSpoolFilesByDd, normalizeJob, normalizeSpoolFile } from '../../../src/tools/jobs/shared.js';

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
      expect(isFailedJob(normalizeJob(makeJob({ retcode: 'ABEND S806' })))).toBe(true);
    });

    it('flags JCL errors', () => {
      expect(isFailedJob(normalizeJob(makeJob({ retcode: 'JCL ERROR' })))).toBe(true);
    });

    it('flags condition codes >= 8', () => {
      expect(isFailedJob(normalizeJob(makeJob({ retcode: 'CC 0012' })))).toBe(true);
    });

    it('does not flag CC 0000 or CC 0004', () => {
      expect(isFailedJob(normalizeJob(makeJob({ retcode: 'CC 0000' })))).toBe(false);
      expect(isFailedJob(normalizeJob(makeJob({ retcode: 'CC 0004' })))).toBe(false);
    });

    it('does not flag a running job (null retcode)', () => {
      expect(isFailedJob(normalizeJob(makeJob({ retcode: undefined, status: 'ACTIVE' })))).toBe(
        false,
      );
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
  });
});
