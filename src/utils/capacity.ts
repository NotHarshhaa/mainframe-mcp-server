/**
 * Capacity and cost utilities — CPU-time extraction from JES message logs,
 * MSU consumption estimates, and MLC cost attribution.
 *
 * The CPU parser reads the IEF373I/IEF374I (step start/stop) and IEF376I
 * (job total) messages that JES writes to JESMSGLG, so per-step and per-job
 * CPU come straight from the spool with no SMF access required.
 */

export interface StepCpu {
  stepName: string;
  /** Step CPU time in seconds. */
  cpuSeconds: number;
}

export interface JobCpuSummary {
  jobName: string | null;
  /** Per-step CPU seconds (from IEF374I), in step order. */
  steps: StepCpu[];
  /** Job-total CPU seconds (from IEF376I), when present. */
  totalCpuSeconds: number | null;
  /** True when the total was derived from the steps because IEF376I was absent. */
  totalFromSteps: boolean;
}

/** Parse "0 HR 12 MIN 30.42 SEC" into seconds. */
export function parseCpuHms(text: string): number {
  const h = Number(text.match(/(\d+)\s*HR/i)?.[1] ?? 0);
  const m = Number(text.match(/(\d+)\s*MIN/i)?.[1] ?? 0);
  const s = Number(text.match(/(\d+(?:\.\d+)?)\s*SEC/i)?.[1] ?? 0);
  return h * 3600 + m * 60 + s;
}

/** Round for display without float noise. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Extract per-step and total CPU seconds from JESMSGLG text.
 * Recognizes IEF374I (step stop, carries CPU) and IEF376I (job total).
 */
export function parseJobCpu(jesMsgLg: string): JobCpuSummary {
  const steps: StepCpu[] = [];
  let total: number | null = null;
  let jobName: string | null = null;

  for (const line of jesMsgLg.split(/\r?\n/)) {
    // IEF374I STEP/S1      /STOP 2026102.1041 /CPU  0 HR 00 MIN 00.42 SEC
    // (step names are padded to 8 chars — the separator before /STOP varies)
    const step = line.match(/IEF374I\s+STEP\/([A-Z0-9]+)\s*\/STOP.*?\/CPU\s+(.+?)\s*$/i);
    if (step) {
      steps.push({ stepName: step[1].toUpperCase(), cpuSeconds: parseCpuHms(step[2]) });
      continue;
    }
    // IEF376I JOB/PAYJOB01/STOP 2026102.1042 /CPU  0 HR 00 MIN 01.13 SEC
    const job = line.match(/IEF376I\s+JOB\/([A-Z0-9]+)\s*\/STOP.*?\/CPU\s+(.+?)\s*$/i);
    if (job) {
      jobName = job[1].toUpperCase();
      total = parseCpuHms(job[2]);
    }
  }

  const stepSum = steps.reduce((acc, s) => acc + s.cpuSeconds, 0);
  const totalFromSteps = total == null && steps.length > 0;
  return {
    jobName: jobName ?? null,
    steps,
    totalCpuSeconds: total ?? (totalFromSteps ? stepSum : null),
    totalFromSteps,
  };
}

/**
 * Estimate MSU consumption from CPU time. An LPAR rated at N MSU performs N
 * MSU of work per hour at full CPU occupancy, so consumed MSU = CPU hours × N.
 */
export function cpuSecondsToMsu(cpuSeconds: number, capacityMsu: number): number {
  return (cpuSeconds / 3600) * capacityMsu;
}

/** Convert a monthly $/MSU price into a per-MSU-hour rate. */
export function msuMonthlyPriceToHourly(monthlyPricePerMsu: number): number {
  return (monthlyPricePerMsu * 12) / 8760;
}

export interface MlcEstimate {
  /** Attribution basis shown in output. */
  basis: string;
  cpuSeconds?: number;
  msuConsumed: number;
  /** Estimated cost in the configured currency. */
  estimatedCost: number;
  currency: string;
  assumptions: string[];
}

/**
 * MLC cost attribution for one job (or an explicit CPU/MSU amount).
 * Pure math — callers supply the pricing assumptions; the output carries
 * them so agents can reproduce the numbers.
 */
export function estimateMlcCost(opts: {
  cpuSeconds?: number;
  msuConsumed?: number;
  capacityMsu?: number;
  monthlyPricePerMsu?: number;
  currency?: string;
}): MlcEstimate {
  const assumptions: string[] = [];
  let msu: number;
  let basis: string;

  if (opts.msuConsumed != null) {
    msu = opts.msuConsumed;
    basis = 'explicit MSU consumption';
  } else if (opts.cpuSeconds != null && opts.capacityMsu != null && opts.capacityMsu > 0) {
    msu = cpuSecondsToMsu(opts.cpuSeconds, opts.capacityMsu);
    basis = `CPU seconds (${round2(opts.cpuSeconds)}) at LPAR capacity ${opts.capacityMsu} MSU/hour`;
    assumptions.push(`MSU = CPU hours × ${opts.capacityMsu} MSU/hour (full-occupancy equivalent).`);
  } else {
    throw new Error('Either msuConsumed, or cpuSeconds together with capacityMsu, must be provided.');
  }

  assumptions.push('Peak/rolling-4HRA and defined-capacity contracts price differently; this is a flat MSU-hour attribution.');
  assumptions.push('zIIP/offload processing is included in CPU unless the source already excludes it.');

  const price = opts.monthlyPricePerMsu;
  const cost = price != null ? msu * msuMonthlyPriceToHourly(price) : NaN;
  if (price == null) {
    assumptions.push('No monthly $/MSU price configured (MLC_MSU_MONTHLY_PRICE) — cost omitted.');
  }

  return {
    basis,
    ...(opts.cpuSeconds != null ? { cpuSeconds: opts.cpuSeconds } : {}),
    msuConsumed: round2(msu),
    estimatedCost: Number.isNaN(cost) ? NaN : Math.round(cost * 100) / 100,
    currency: opts.currency ?? 'USD',
    assumptions,
  };
}
