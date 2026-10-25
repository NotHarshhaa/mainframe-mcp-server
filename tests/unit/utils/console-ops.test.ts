import {
  buildHoldCommand,
  buildReleaseCommand,
  filterHsmMessages,
  isHsmMessage,
  jobNumberFromJobId,
  normalizeImsCommand,
} from '../../../src/utils/console-ops.js';
import { buildErepJcl, parseErepSummary } from '../../../src/utils/erep.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('JES2 hold/release commands', () => {
  it('derives the job number from the job id', () => {
    expect(jobNumberFromJobId('JOB01234')).toBe('01234');
    expect(jobNumberFromJobId('STC123')).toBe('123');
  });
  it('builds $HJ and $OJ commands', () => {
    expect(buildHoldCommand('JOB01234')).toBe('$HJ01234');
    expect(buildReleaseCommand('JOB01234')).toBe('$OJ01234');
  });
  it('rejects job ids without a numeric part', () => {
    expect(() => jobNumberFromJobId('MASTER')).toThrow(ValidationError);
  });
});

describe('normalizeImsCommand', () => {
  it('adds the leading slash when missing', () => {
    expect(normalizeImsCommand('DIS ACTIVE')).toBe('/DIS ACTIVE');
    expect(normalizeImsCommand(' /DIS TRAN TRAN1 ')).toBe('/DIS TRAN TRAN1');
  });
  it('rejects non-IMS text', () => {
    expect(() => normalizeImsCommand('HELLO WORLD')).toThrow(ValidationError);
    expect(() => normalizeImsCommand('')).toThrow(ValidationError);
  });
});

describe('HSM message filtering', () => {
  it('matches ARC/HSM/ICK message prefixes', () => {
    expect(isHsmMessage('ARC0150I PRIMARY VOLUME MIGRATED')).toBe(true);
    expect(isHsmMessage('ARC1143I RECALL REQUESTED FOR DS PROD.X')).toBe(true);
    expect(isHsmMessage('HSM COMMAND HSEND COMPLETED')).toBe(true);
    expect(isHsmMessage('ICK30530I VOL SER = PROD01')).toBe(true);
    expect(isHsmMessage('IEF404I PAYJOB01 ENDED')).toBe(false);
  });
  it('filters and caps the list', () => {
    const lines = ['IEF404I ENDED', 'ARC0150I MIGRATED', 'ARC0150I MIGRATED', 'ARC1143I RECALL'];
    expect(filterHsmMessages(lines)).toEqual(['ARC0150I MIGRATED', 'ARC1143I RECALL']);
  });
});

describe('buildErepJcl', () => {
  it('builds a canned EREP job for the LOGREC dataset', () => {
    const jcl = buildErepJcl('SYS1.LOGREC', 'SUMMARY');
    expect(jcl).toContain('//EREP EXEC PGM=IFCEREP');
    expect(jcl).toContain('DSN=SYS1.LOGREC');
    expect(jcl).toContain('REPORT=SUMMARY');
  });
  it('builds the HISTORY variant', () => {
    expect(buildErepJcl('SYS1.LOGREC', 'HISTORY')).toContain('REPORT=HISTORY');
  });
});

describe('parseErepSummary', () => {
  const REPORT = [
    'EREP SUMMARY REPORT',
    'TYPE OF RECORD          COUNT',
    'TEMP ERRORS                12',
    'PERM ERRORS                 3',
    'MACH CHECKS                 1',
    '  MOD=IFCEREP1  CPU SER=012345',
    '  ABEND S0C4 OCCURRED',
    '  ABEND S0C7 OCCURRED',
  ].join('\n');

  it('extracts record counts sorted descending', () => {
    const summary = parseErepSummary(REPORT);
    expect(summary.recordCounts[0]).toEqual({ label: 'TEMP ERRORS', count: 12 });
    expect(summary.recordCounts.map((r) => r.label)).toContain('PERM ERRORS');
    expect(summary.totalRecords).toBeGreaterThan(0);
  });
  it('extracts abend codes and modules', () => {
    const summary = parseErepSummary(REPORT);
    expect(summary.abendCodes).toContain('S0C4');
    expect(summary.abendCodes).toContain('S0C7');
    expect(summary.entries).toContain('IFCEREP1');
    expect(summary.entries).toContain('CPU 012345');
  });
  it('collects key diagnostic lines', () => {
    const summary = parseErepSummary(REPORT);
    expect(summary.keyLines.some((l) => l.includes('S0C4'))).toBe(true);
  });
});
