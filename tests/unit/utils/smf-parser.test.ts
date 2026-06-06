import { parseRmfJson, parseSmfSummaryText } from '../../../src/utils/smf-parser.js';
import { sanitizeSqlLiteral } from '../../../src/tools/db2/shared.js';

describe('smf-parser', () => {
  describe('parseRmfJson', () => {
    it('extracts numeric metrics from RMF JSON', () => {
      const metrics = parseRmfJson({ processor: { cpuBusy: 42.5, count: 2 } });
      expect(metrics.some((m) => m.name.includes('cpuBusy'))).toBe(true);
      expect(metrics.some((m) => m.value === '42.5')).toBe(true);
    });

    it('assigns "cpu" category to CPU-related metrics', () => {
      const metrics = parseRmfJson({ cpuBusy: 72.1 });
      expect(metrics[0].category).toBe('cpu');
    });

    it('assigns "io" category to IO-related metrics', () => {
      const metrics = parseRmfJson({ ioRate: 1500 });
      expect(metrics[0].category).toBe('io');
    });

    it('assigns "memory" category to memory-related metrics', () => {
      const metrics = parseRmfJson({ memUtil: 88.0 });
      expect(metrics[0].category).toBe('memory');
    });

    it('assigns "counter" category to count/error metrics', () => {
      const metrics = parseRmfJson({ failCount: 3 });
      expect(metrics[0].category).toBe('counter');
    });

    it('processes nested objects recursively', () => {
      const metrics = parseRmfJson({ a: { b: { cpuBusy: 30 } } });
      expect(metrics.some((m) => m.name === 'a.b.cpuBusy')).toBe(true);
    });

    it('caps output at 50 metrics', () => {
      const big: Record<string, number> = {};
      for (let i = 0; i < 60; i++) big[`cpuMetric${i}`] = i;
      const metrics = parseRmfJson(big);
      expect(metrics.length).toBeLessThanOrEqual(50);
    });
  });

  describe('parseSmfSummaryText', () => {
    it('parses key=value SMF summary lines', () => {
      const metrics = parseSmfSummaryText('CPU_BUSY=45.2\nIO_RATE=1200');
      expect(metrics).toHaveLength(2);
      expect(metrics[0]).toMatchObject({ name: 'CPU_BUSY', value: '45.2' });
    });

    it('parses key: value (colon separator) format', () => {
      const metrics = parseSmfSummaryText('CPU_BUSY: 45.2\nMEM_UTIL: 78.3');
      expect(metrics[0]).toMatchObject({ name: 'CPU_BUSY', value: '45.2' });
    });

    it('assigns "cpu" category to CPU metrics', () => {
      const metrics = parseSmfSummaryText('CPU_BUSY=45.2');
      expect(metrics[0].category).toBe('cpu');
    });

    it('assigns "memory" category to memory metrics', () => {
      const metrics = parseSmfSummaryText('MEM_UTIL=78.3');
      expect(metrics[0].category).toBe('memory');
    });

    it('falls back to "record" name for unstructured lines', () => {
      const metrics = parseSmfSummaryText('This is a raw log line with no key value separator');
      expect(metrics[0].name).toBe('record');
    });

    it('ignores blank lines', () => {
      const metrics = parseSmfSummaryText('CPU_BUSY=45.2\n\n\nIO_RATE=1200');
      expect(metrics).toHaveLength(2);
    });
  });
});

describe('db2/shared — sanitizeSqlLiteral', () => {
  it('escapes single quotes', () => {
    expect(sanitizeSqlLiteral("O'Brien")).toBe("O''Brien");
  });

  it('strips statement terminators', () => {
    expect(sanitizeSqlLiteral('DROP TABLE; SELECT')).not.toContain(';');
  });

  it('strips inline SQL comment sequences (--)', () => {
    expect(sanitizeSqlLiteral("PAY' -- DROP TABLE USERS")).not.toContain('--');
  });

  it('strips block SQL comments (/* */)', () => {
    expect(sanitizeSqlLiteral("PAY' /* comment */ other")).not.toContain('/*');
  });

  it('strips newlines', () => {
    expect(sanitizeSqlLiteral('abc\ndef')).not.toContain('\n');
  });

  it('caps at 64 characters', () => {
    const long = 'A'.repeat(100);
    expect(sanitizeSqlLiteral(long)).toHaveLength(64);
  });
});
