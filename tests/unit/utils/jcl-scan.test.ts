import { scanJcl, DEFAULT_BLOCKED_PROGRAMS } from '../../../src/utils/jcl-scan.js';

const cleanJcl = [
  '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
  '//STEP1  EXEC PGM=IEFBR14',
  '//DD1    DD DSN=USER.TEMP,DISP=(NEW,CATLG,KEEP)',
  '//STEP2  EXEC PGM=SORT',
  '//SYSIN  DD *',
  '  SORT FIELDS=(1,10,CH,A)',
  '/*',
].join('\n');

describe('jcl-scan', () => {
  it('passes clean JCL with no findings', () => {
    expect(scanJcl(cleanJcl)).toEqual([]);
  });

  it('blocks IDCAMS DELETE in SYSIN instream data', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//DELSTEP EXEC PGM=IDCAMS',
      '//SYSIN   DD *',
      '  DELETE (USER.PROD.MASTER) -',
      '    NOSCRATCH',
      '/*',
    ].join('\n');
    const findings = scanJcl(jcl);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'BLOCK', rule: 'idcams-delete', line: 4 });
  });

  it('warns on IDCAMS ALTER (blocks only in strict mode at the gate)', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//ALTSTEP EXEC PGM=IDCAMS',
      '//SYSIN   DD *',
      '  ALTER USER.PROD.MASTER RENAME(USER.PROD.NEW)',
      '/*',
    ].join('\n');
    const findings = scanJcl(jcl);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'WARN', rule: 'idcams-alter' });
  });

  it('does not flag DELETE outside IDCAMS SYSIN', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//STEP1   EXEC PGM=SORT',
      '//SYSIN   DD *',
      '  COMMENT ABOUT DELETE OPERATIONS IS JUST TEXT',
      '/*',
    ].join('\n');
    expect(scanJcl(jcl)).toEqual([]);
  });

  it('blocks IEFBR14 with DISP=(MOD,DELETE)', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//STEP1 EXEC PGM=IEFBR14',
      '//DD1   DD DSN=USER.PROD.OLD,DISP=(MOD,DELETE)',
    ].join('\n');
    const findings = scanJcl(jcl);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'BLOCK', rule: 'iefbr14-delete', line: 3 });
  });

  it('blocks IEFBR14 with DISP=(,DELETE)', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//STEP1 EXEC PGM=IEFBR14',
      '//DD1   DD DSN=USER.PROD.OLD,DISP=(,DELETE)',
    ].join('\n');
    expect(scanJcl(jcl)[0]?.rule).toBe('iefbr14-delete');
  });

  it('does not flag DISP DELETE for programs other than IEFBR14', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//STEP1 EXEC PGM=IEBGENER',
      '//DD1   DD DSN=USER.TEMP.WORK,DISP=(NEW,PASS,DELETE)',
    ].join('\n');
    expect(scanJcl(jcl)).toEqual([]);
  });

  it('blocks destructive storage utilities from the default list', () => {
    for (const pgm of DEFAULT_BLOCKED_PROGRAMS) {
      const jcl = `//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A\n//STEP1 EXEC PGM=${pgm}\n`;
      const findings = scanJcl(jcl);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'BLOCK', rule: 'blocked-program' });
    }
  });

  it('blocks user-configured programs', () => {
    const jcl = '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A\n//STEP1 EXEC PGM=IKJEFT01\n';
    const findings = scanJcl(jcl, { blockedPrograms: ['IKJEFT01'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('blocked-program');
  });

  it('blocks restricted job classes on the JOB card', () => {
    const jcl = '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=Z\n//STEP1 EXEC PGM=IEFBR14\n';
    const findings = scanJcl(jcl, { blockedJobClasses: ['Z'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'BLOCK', rule: 'blocked-job-class', line: 1 });
  });

  it('ignores commented-out EXEC statements', () => {
    const jcl = [
      '//PAYJOB01 JOB (ACCT),\'demo\',CLASS=A',
      '//*STEP1 EXEC PGM=ADRDSSU',
      '//* DELETE (USER.PROD.OLD)',
    ].join('\n');
    expect(scanJcl(jcl)).toEqual([]);
  });
});
