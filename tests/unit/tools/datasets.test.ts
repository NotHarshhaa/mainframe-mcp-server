import {
  normalizeDataset,
  normalizeMember,
  normalizeDatasetName,
  assertValidMemberName,
} from '../../../src/tools/datasets/shared.js';
import { buildDatasetPattern } from '../../../src/utils/glob.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('datasets/shared', () => {
  describe('normalizeDataset', () => {
    it('maps catalog attributes', () => {
      const ds = normalizeDataset({
        dsname: 'SYS1.PROCLIB',
        dsorg: 'PO',
        recfm: 'FB',
        lrecl: '80',
        vol: 'VOL001',
      });
      expect(ds.name).toBe('SYS1.PROCLIB');
      expect(ds.dsorg).toBe('PO');
      expect(ds.lrecl).toBe(80);
      expect(ds.volume).toBe('VOL001');
      expect(ds.migrated).toBe(false);
      expect(ds.pdse).toBeUndefined();
    });

    it('detects migrated datasets', () => {
      const ds = normalizeDataset({ dsname: 'OLD.DATA', migr: 'YES' });
      expect(ds.migrated).toBe(true);
      expect(ds.volume).toBeUndefined();
    });

    it('detects migration via MIGRAT volume', () => {
      const ds = normalizeDataset({ dsname: 'OLD.DATA', vol: 'MIGRAT' });
      expect(ds.migrated).toBe(true);
    });

    it('maps blksize from catalog attributes', () => {
      const ds = normalizeDataset({ dsname: 'PAY.JCL', blksize: '27920', lrecl: '80' });
      expect(ds.blksize).toBe(27920);
      expect(ds.lrecl).toBe(80);
    });

    it('detects PDSE via dsntype=LIBRARY', () => {
      const ds = normalizeDataset({ dsname: 'USERDEV.LIB', dsorg: 'PO', dsntype: 'LIBRARY' });
      expect(ds.pdse).toBe(true);
      expect(ds.dsorg).toBe('PO');
    });

    it('detects PDSE via dsorg=PO-E', () => {
      const ds = normalizeDataset({ dsname: 'USERDEV.LIB', dsorg: 'PO-E' });
      expect(ds.pdse).toBe(true);
    });

    it('does not set pdse for a plain PDS', () => {
      const ds = normalizeDataset({ dsname: 'SYS1.PROCLIB', dsorg: 'PO' });
      expect(ds.pdse).toBeUndefined();
    });
  });

  describe('normalizeMember', () => {
    it('maps member name and modified date', () => {
      const member = normalizeMember({ member: 'IKJEFT01', m4date: '2026/06/01', vers: 3 });
      expect(member.name).toBe('IKJEFT01');
      expect(member.modified).toBe('2026/06/01');
      expect(member.version).toBe(3);
    });

    it('falls back to creation date when no modified date', () => {
      const member = normalizeMember({ member: 'NEWMEM', c4date: '2026/01/01' });
      expect(member.modified).toBe('2026/01/01');
    });

    it('maps extended stats: user, size, changed time', () => {
      const member = normalizeMember({
        member: 'PAYJOB01',
        m4date: '2026/06/01',
        id: 'PAYUSR',
        size: '42',
        changed: '14:30',
      });
      expect(member.user).toBe('PAYUSR');
      expect(member.size).toBe(42);
      expect(member.changedTime).toBe('14:30');
    });

    it('leaves stats undefined when not provided', () => {
      const member = normalizeMember({ member: 'SIMPLE' });
      expect(member.user).toBeUndefined();
      expect(member.size).toBeUndefined();
      expect(member.changedTime).toBeUndefined();
    });
  });

  describe('normalizeDatasetName', () => {
    it('converts to uppercase', () => {
      expect(normalizeDatasetName('sys1.proclib')).toBe('SYS1.PROCLIB');
    });

    it('strips surrounding single quotes', () => {
      expect(normalizeDatasetName("'SYS1.PROCLIB'")).toBe('SYS1.PROCLIB');
    });

    it('trims whitespace', () => {
      expect(normalizeDatasetName('  SYS1.PROCLIB  ')).toBe('SYS1.PROCLIB');
    });

    it('handles mixed case with quotes and spaces', () => {
      expect(normalizeDatasetName("  'pay.jcllib'  ")).toBe('PAY.JCLLIB');
    });
  });

  describe('assertValidMemberName', () => {
    it('accepts valid 8-char member name', () => {
      expect(() => assertValidMemberName('IKJEFT01')).not.toThrow();
    });

    it('accepts single-char member name', () => {
      expect(() => assertValidMemberName('A')).not.toThrow();
    });

    it('accepts national characters (@, #, $) as first char', () => {
      expect(() => assertValidMemberName('@PROC')).not.toThrow();
      expect(() => assertValidMemberName('#JOB')).not.toThrow();
      expect(() => assertValidMemberName('$UTIL')).not.toThrow();
    });

    it('rejects a name longer than 8 characters', () => {
      expect(() => assertValidMemberName('TOOLONGNAME')).toThrow(ValidationError);
    });

    it('rejects a name starting with a digit', () => {
      expect(() => assertValidMemberName('1BADNAME')).toThrow(ValidationError);
    });

    it('rejects names with spaces or hyphens', () => {
      expect(() => assertValidMemberName('BAD NAME')).toThrow(ValidationError);
      expect(() => assertValidMemberName('BAD-NAME')).toThrow(ValidationError);
    });

    it('rejects an empty string', () => {
      expect(() => assertValidMemberName('')).toThrow(ValidationError);
    });
  });

  describe('buildDatasetPattern (glob)', () => {
    it('appends .* when HLQ has no wildcard', () => {
      expect(buildDatasetPattern('SYS1')).toBe('SYS1.*');
    });

    it('uses HLQ as-is when it already contains *', () => {
      expect(buildDatasetPattern('SYS1.*')).toBe('SYS1.*');
    });

    it('appends pattern to HLQ', () => {
      expect(buildDatasetPattern('SYS1', 'PROC*')).toBe('SYS1.PROC*');
    });

    it('uppercases the HLQ', () => {
      expect(buildDatasetPattern('sys1')).toBe('SYS1.*');
    });
  });
});
