import { filterAuditEntries, parseRacfAuditLine } from '../../../src/utils/racf-parser.js';

describe('racf-parser', () => {
  describe('parseRacfAuditLine', () => {
    it('parses syslog-style RACF audit lines', () => {
      const line =
        'Mar 12 14:30:01 LPAR1 RACF: user PAYUSR resource SYS1.PROCLIB access READ result SUCCESS';
      const entry = parseRacfAuditLine(line);
      expect(entry.user).toBe('PAYUSR');
      expect(entry.resource).toBe('SYS1.PROCLIB');
      expect(entry.event).toBe('READ');
      expect(entry.result).toBe('SUCCESS');
      expect(entry.accessType).toBe('READ');
    });

    it('parses IRRADU00-style lines including CLASS= field', () => {
      const line = 'USER= PAYUSR RESOURCE= SYS1.PROCLIB CLASS= DATASET ACCESS= UPDATE RC= 0';
      const entry = parseRacfAuditLine(line);
      expect(entry.user).toBe('PAYUSR');
      expect(entry.resource).toBe('SYS1.PROCLIB');
      expect(entry.event).toBe('UPDATE');
      expect(entry.result).toBe('0');
      expect(entry.class).toBe('DATASET');
      expect(entry.accessType).toBe('UPDATE');
    });

    it('parses generic keyword lines', () => {
      const line = 'user=BATCHUSR resource=MY.DATASET access=READ result=FAIL class=FACILITY';
      const entry = parseRacfAuditLine(line);
      expect(entry.user).toBe('BATCHUSR');
      expect(entry.class).toBe('FACILITY');
    });

    it('returns null fields for blank lines', () => {
      const entry = parseRacfAuditLine('');
      expect(entry.user).toBeNull();
      expect(entry.resource).toBeNull();
      expect(entry.class).toBeNull();
    });

    it('extracts ISO timestamp from generic lines', () => {
      const line = '2026-06-01T14:30:01 user=SYS1 resource=PROG.LOAD access=EXECUTE result=0';
      const entry = parseRacfAuditLine(line);
      expect(entry.timestamp).toBe('2026-06-01T14:30:01');
    });
  });

  describe('filterAuditEntries', () => {
    const entries = [
      parseRacfAuditLine('USER= PAYUSR RESOURCE= DS1 CLASS= DATASET ACCESS= READ RC= 0'),
      parseRacfAuditLine('USER= BATCH RESOURCE= DS2 CLASS= FACILITY ACCESS= UPDATE RC= 8'),
      parseRacfAuditLine('USER= PAYUSR RESOURCE= PROG.LOAD CLASS= PROGRAM ACCESS= EXECUTE RC= 0'),
    ];

    it('filters by user (substring, case-insensitive)', () => {
      const filtered = filterAuditEntries(entries, { user: 'PAY' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.user?.startsWith('PAY'))).toBe(true);
    });

    it('filters by resource (substring)', () => {
      const filtered = filterAuditEntries(entries, { resource: 'DS' });
      expect(filtered).toHaveLength(2);
    });

    it('filters by event/access type', () => {
      const filtered = filterAuditEntries(entries, { event: 'READ' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].event).toBe('READ');
    });

    it('filters by result', () => {
      const filtered = filterAuditEntries(entries, { result: '8' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].result).toBe('8');
    });

    it('filters by class', () => {
      const filtered = filterAuditEntries(entries, { class: 'DATASET' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].class).toBe('DATASET');
    });

    it('applies combined filters (user + event)', () => {
      const filtered = filterAuditEntries(entries, { user: 'PAYUSR', event: 'EXECUTE' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].resource).toBe('PROG.LOAD');
    });

    it('returns all when no filters are provided', () => {
      expect(filterAuditEntries(entries, {})).toHaveLength(3);
    });

    it('returns empty when no entries match', () => {
      expect(filterAuditEntries(entries, { user: 'NONEXISTENT' })).toHaveLength(0);
    });
  });
});
