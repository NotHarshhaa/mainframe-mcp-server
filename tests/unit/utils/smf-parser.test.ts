import { parseRmfJson, parseSmfSummaryText } from '../../../src/utils/smf-parser.js';

describe('smf-parser', () => {
  it('extracts numeric metrics from RMF JSON', () => {
    const metrics = parseRmfJson({ processor: { cpuBusy: 42.5, count: 2 } });
    expect(metrics.some((m) => m.name.includes('cpuBusy'))).toBe(true);
    expect(metrics.some((m) => m.value === '42.5')).toBe(true);
  });

  it('parses key=value SMF summary lines', () => {
    const metrics = parseSmfSummaryText('CPU_BUSY=45.2\nIO_RATE=1200');
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toEqual({ name: 'CPU_BUSY', value: '45.2' });
  });
});
