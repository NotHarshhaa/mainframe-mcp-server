import { normalizeDataset, normalizeMember } from '../../../src/tools/datasets/shared.js';

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
  });
});
