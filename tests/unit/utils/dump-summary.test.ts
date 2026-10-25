import { summarizeDump, detectDumpType } from '../../../src/utils/dump-summary.js';

const SYSUDUMP = [
  ' IEF142I PAYJOB01 STEP030 - COND CODE 0000',
  'IEA995I SYMPTOM DUMP OUTPUT  695',
  'SYSUDUMP OUTPUT FOR PAYJOB01 REPLY K TO RETAIN',
  ' COMPLETION CODE SYSTEM = 0C4  USER COMPLETION CODE = 1234',
  ' PSW AT TIME OF ERROR  078D1000  8FF5A2C6  ILC 2  INTC 000D',
  ' ACTIVE LOAD MODULE ADDRESS=0FF5A000  OFFSET=0000A2C6',
  ' LOAD MODULE NAME = PAYRPTX',
  ' REGISTERS AT TIME OF ERROR',
  ' STORAGE',
].join('\n');

const CEEDUMP = [
  'CEE3DMP V3 R2: Condition processing began at 10/25/26 10.41.02',
  'Information for enclave 1',
  'Information for thread 8000000000000000',
  'Traceback: ',
  '  DSA addr  Program      Unit      Lake PU    Statement   Offset',
  'Condition Information for Active Routines',
  '  Condition CEE3204S raised at offset X\'0001A2C6\' in module PAYRPTX.',
  '  CEE0813S The system or user abend S0C4 R=1234 was issued.',
  'GPR 0-3',
  'Storage dump',
].join('\n');

describe('detectDumpType', () => {
  it('identifies CEEDUMP and SYSUDUMP', () => {
    expect(detectDumpType(CEEDUMP)).toBe('CEEDUMP');
    expect(detectDumpType(SYSUDUMP)).toBe('SYSUDUMP');
    expect(detectDumpType('nothing recognizable')).toBe('UNKNOWN');
  });
});

describe('summarizeDump — SYSUDUMP', () => {
  const summary = summarizeDump(SYSUDUMP);

  it('extracts completion codes', () => {
    expect(summary.systemCompletionCode).toBe('S0C4');
    expect(summary.userCompletionCode).toBe('1234');
  });
  it('extracts failing module and offset', () => {
    expect(summary.failingModule).toBe('PAYRPTX');
    expect(summary.failingOffset).toBe('0000A2C6');
  });
  it('captures PSW and sections', () => {
    expect(summary.psw).toContain('078D1000');
    expect(summary.sections).toContain('REGISTERS');
    expect(summary.sections).toContain('STORAGE');
  });
  it('collects key lines', () => {
    expect(summary.keyLines.some((l) => l.includes('COMPLETION CODE'))).toBe(true);
  });
});

describe('summarizeDump — CEEDUMP', () => {
  const summary = summarizeDump(CEEDUMP);

  it('detects the type and LE conditions', () => {
    expect(summary.type).toBe('CEEDUMP');
    expect(summary.conditions).toContain('CEE3204S');
    expect(summary.conditions).toContain('CEE0813S');
  });
  it('extracts the module/offset from the condition text', () => {
    expect(summary.failingModule).toBe('PAYRPTX');
    expect(summary.failingOffset).toBe('0001A2C6');
  });
  it('suggests reviewing the traceback when conditions exist', () => {
    expect(summary.suggestedFix).toMatch(/Language Environment/);
  });
});

describe('summarizeDump — unknown', () => {
  it('returns UNKNOWN with a safe suggestion', () => {
    const summary = summarizeDump('random binary noise 0xFFEE');
    expect(summary.type).toBe('UNKNOWN');
    expect(summary.suggestedFix).toMatch(/IPCS/);
  });
});
