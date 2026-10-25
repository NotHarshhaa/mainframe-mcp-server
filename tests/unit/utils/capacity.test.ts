import { parseJobCpu, parseCpuHms, cpuSecondsToMsu, estimateMlcCost, msuMonthlyPriceToHourly } from '../../../src/utils/capacity.js';

const JESMSGLG = [
  'ICH70001I MCPUSR LAST ACCESS AT 10:40:01 ON TUESDAY, OCTOBER 25, 2026',
  'IEF452I PAYJOB01 - JOB NOT RUN - JCL ERROR',
  ' IEF472I PAYJOB01 PAYUPDT - COMPLETION CODE - SYSTEM=000 USER=0000',
  'IEF373I STEP/PAYUPDT/START 2026262.1040',
  'IEF374I STEP/PAYUPDT/STOP  2026262.1041 /CPU  0 HR 00 MIN 00.42 SEC',
  'IEF373I STEP/SORT2/START 2026262.1041',
  'IEF374I STEP/SORT2  /STOP  2026262.1042 /CPU  0 HR 00 MIN 01.20 SEC',
  'IEF375I JOB/PAYJOB01/STOP  2026262.1042',
  'IEF376I JOB/PAYJOB01/STOP  2026262.1042 /CPU  0 HR 00 MIN 02.02 SEC',
].join('\n');

describe('parseCpuHms', () => {
  it('parses hours, minutes, seconds', () => {
    expect(parseCpuHms('0 HR 00 MIN 00.42 SEC')).toBeCloseTo(0.42, 5);
    expect(parseCpuHms('1 HR 02 MIN 30 SEC')).toBe(3750);
  });
});

describe('parseJobCpu', () => {
  it('extracts per-step CPU and the job total', () => {
    const cpu = parseJobCpu(JESMSGLG);
    expect(cpu.jobName).toBe('PAYJOB01');
    expect(cpu.steps).toEqual([
      { stepName: 'PAYUPDT', cpuSeconds: 0.42 },
      { stepName: 'SORT2', cpuSeconds: 1.2 },
    ]);
    expect(cpu.totalCpuSeconds).toBe(2.02);
    expect(cpu.totalFromSteps).toBe(false);
  });

  it('falls back to summing steps when IEF376I is absent', () => {
    const cpu = parseJobCpu('IEF374I STEP/A/STOP 2026262.1000 /CPU 0 HR 01 MIN 00.00 SEC');
    expect(cpu.totalCpuSeconds).toBe(60);
    expect(cpu.totalFromSteps).toBe(true);
  });

  it('returns empty for unrelated text', () => {
    const cpu = parseJobCpu('NO MESSAGES HERE');
    expect(cpu.steps).toHaveLength(0);
    expect(cpu.totalCpuSeconds).toBeNull();
  });
});

describe('MSU and MLC math', () => {
  it('converts CPU seconds to MSU via capacity', () => {
    // 3600 CPU seconds at 100 MSU/hour capacity = 100 MSU.
    expect(cpuSecondsToMsu(3600, 100)).toBe(100);
    expect(cpuSecondsToMsu(60, 100)).toBeCloseTo(1.6667, 3);
  });

  it('converts monthly $/MSU to hourly rate', () => {
    // $1000/MSU-month → 1000*12/8760 ≈ 1.3699 per MSU-hour
    expect(msuMonthlyPriceToHourly(1000)).toBeCloseTo(1.3699, 4);
  });

  it('estimates MLC cost from CPU + capacity', () => {
    const est = estimateMlcCost({ cpuSeconds: 3600, capacityMsu: 100, monthlyPricePerMsu: 1000, currency: 'USD' });
    expect(est.msuConsumed).toBe(100);
    expect(est.estimatedCost).toBeCloseTo(136.99, 1);
    expect(est.currency).toBe('USD');
    expect(est.assumptions.length).toBeGreaterThan(0);
  });

  it('estimates directly from explicit MSU', () => {
    const est = estimateMlcCost({ msuConsumed: 50, monthlyPricePerMsu: 1000 });
    expect(est.msuConsumed).toBe(50);
    expect(est.estimatedCost).toBeCloseTo(68.49, 1);
  });

  it('omits cost when no price is configured', () => {
    const est = estimateMlcCost({ msuConsumed: 50 });
    expect(Number.isNaN(est.estimatedCost)).toBe(true);
  });

  it('throws without a usable basis', () => {
    expect(() => estimateMlcCost({})).toThrow();
    // CPU without capacity cannot convert.
    expect(() => estimateMlcCost({ cpuSeconds: 100 })).toThrow();
  });
});
