import { analyzeJclDependencies, classifyDisps, parseDdStatement } from '../../../src/utils/jcl-dependencies.js';
import { ValidationError } from '../../../src/utils/errors.js';

const SAMPLE_JCL = [
  '//PAYJOB01 JOB (MCP),CLASS=A',
  '//* Payroll master update',
  '//UPD EXEC PGM=PAYUPDT',
  '//MASTER  DD DSN=PROD.PAY.MASTER,DISP=OLD',
  '//TRANS   DD DSN=PROD.PAY.TRANS,DISP=SHR',
  '//REPORT  DD SYSOUT=A',
  '//MERGE EXEC PROC=PAYMERGE,COND=(4,LT)',
  '//INP     DD DSN=DEV.PAY.EXTRACT,DISP=SHR',
  '//OUT     DD DSN=PROD.PAY.RESULTS,DISP=(NEW,CATLG,DELETE),',
  '//           UNIT=SYSDA,SPACE=(CYL,(10,5))',
  '//LOG     DD DSN=PROD.PAY.LOG,DISP=MOD',
  '//COPY DD DSN=*.UPD.MASTER,DISP=SHR',
  '//DUMMY1 DD DUMMY',
  '//INSTR  DD *',
  'SOME INSTREAM DATA',
  '/*',
].join('\n');

describe('classifyDisps', () => {
  it('maps dispositions to usage', () => {
    expect(classifyDisps('SHR')).toBe('input');
    expect(classifyDisps('(NEW,CATLG,DELETE)')).toBe('output');
    expect(classifyDisps('MOD')).toBe('output');
    expect(classifyDisps('OLD')).toBe('update');
    expect(classifyDisps(undefined)).toBe('reference');
  });
});

describe('parseDdStatement', () => {
  it('extracts dsn and usage', () => {
    const dd = parseDdStatement('//MASTER  DD DSN=PROD.PAY.MASTER,DISP=OLD');
    expect(dd?.ddName).toBe('MASTER');
    expect(dd?.flows[0].dsn).toBe('PROD.PAY.MASTER');
    expect(dd?.flows[0].usage).toBe('update');
  });
  it('handles DSNAME= spelling and instream data', () => {
    expect(parseDdStatement('//X DD DSNAME=A.B,DISP=SHR')?.flows[0].dsn).toBe('A.B');
    expect(parseDdStatement('//X DD *')?.flows[0].usage).toBe('instream');
    expect(parseDdStatement('//X DD DUMMY')?.flows[0].dsn).toBe('DUMMY');
  });
});

describe('analyzeJclDependencies', () => {
  const analysis = analyzeJclDependencies(SAMPLE_JCL);

  it('captures job name and steps', () => {
    expect(analysis.jobName).toBe('PAYJOB01');
    // Only EXEC statements create steps; the trailing DDs belong to MERGE.
    expect(analysis.steps.map((s) => s.stepName)).toEqual(['UPD', 'MERGE']);
  });

  it('classifies inputs, updates, outputs', () => {
    expect(analysis.inputDatasets).toContain('PROD.PAY.TRANS');
    expect(analysis.inputDatasets).toContain('DEV.PAY.EXTRACT');
    expect(analysis.updateDatasets).toContain('PROD.PAY.MASTER');
    expect(analysis.outputDatasets).toContain('PROD.PAY.RESULTS');
    expect(analysis.outputDatasets).toContain('PROD.PAY.LOG');
  });

  it('captures PROC references and COND', () => {
    expect(analysis.procedures).toContain('PAYMERGE');
    const mergeStep = analysis.steps.find((s) => s.stepName === 'MERGE');
    expect(mergeStep?.cond).toBe('(4,LT)');
    expect(mergeStep?.program).toBeUndefined();
  });

  it('handles backward references, dummies, instream', () => {
    expect(analysis.inputDatasets).toContain('*.UPD.MASTER');
    expect(analysis.inputDatasets).not.toContain('DUMMY');
  });

  it('rejects non-JCL input', () => {
    expect(() => analyzeJclDependencies('SELECT * FROM T')).toThrow(ValidationError);
  });
});
