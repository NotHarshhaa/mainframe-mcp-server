import { filterAuditEntries, parseRacfAuditLine } from '../../../src/utils/racf-parser.js';

describe('racf-parser', () => {
  it('parses syslog-style RACF audit lines', () => {
    const line =
      'Mar 12 14:30:01 LPAR1 RACF: user PAYUSR resource SYS1.PROCLIB access READ result SUCCESS';
    const entry = parseRacfAuditLine(line);
    expect(entry.user).toBe('PAYUSR');
    expect(entry.resource).toBe('SYS1.PROCLIB');
    expect(entry.event).toBe('READ');
    expect(entry.result).toBe('SUCCESS');
  });

  it('filters audit entries by user', () => {
    const entries = [
      parseRacfAuditLine('USER= PAYUSR RESOURCE= DS1 ACCESS= READ RC= 0'),
      parseRacfAuditLine('USER= BATCH RESOURCE= DS2 ACCESS= UPDATE RC= 8'),
    ];
    const filtered = filterAuditEntries(entries, { user: 'PAY' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].user).toBe('PAYUSR');
  });
});
