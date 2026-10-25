/**
 * Batch scheduler REST adapters — Control-M, CA 7, and IBM Workload
 * Automation (IWSz).
 *
 * The scheduler endpoint is configured via SCHEDULER_ADAPTERS (JSON):
 *
 *   [
 *     {
 *       "name": "controlm",
 *       "type": "controlm",
 *       "host": "https://ctm.example.com:8443",
 *       "token": "${CTM_API_TOKEN}",           // bearer; or "user"/"password" for basic
 *       "jobStatusPath": "/config/jobs?jobName={jobName}"   // optional override
 *     }
 *   ]
 *
 * Default path templates per scheduler type (adjust to your version):
 *   controlm → /config/jobs?jobName={jobName}
 *   ca7      → /ca7/api/v2/jobs?jobName={jobName}
 *   iws      → /twsz/plan/current/jobs?jobName={jobName}
 *
 * Responses are passed through as JSON (truncated) so version differences do
 * not break the tool; a normalized status guess is provided when a common
 * status field is recognizable.
 */
import { ConfigError, ConnectionError, ValidationError } from './errors.js';
import { childLogger } from './logger.js';

const log = childLogger('scheduler');

export type SchedulerType = 'controlm' | 'ca7' | 'iws' | 'generic';

export interface SchedulerAdapter {
  name: string;
  type: SchedulerType;
  host: string;
  token?: string;
  user?: string;
  password?: string;
  jobStatusPath: string;
}

const DEFAULT_PATHS: Record<SchedulerType, string> = {
  controlm: '/config/jobs?jobName={jobName}',
  ca7: '/ca7/api/v2/jobs?jobName={jobName}',
  iws: '/twsz/plan/current/jobs?jobName={jobName}',
  generic: '/jobs?jobName={jobName}',
};

const VALID_TYPES: SchedulerType[] = ['controlm', 'ca7', 'iws', 'generic'];

/** Parse and validate the SCHEDULER_ADAPTERS config. */
export function parseSchedulerAdapters(json: string | undefined): SchedulerAdapter[] {
  if (!json?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ConfigError(
      `SCHEDULER_ADAPTERS is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((entry, index): SchedulerAdapter => {
    if (entry === null || typeof entry !== 'object') {
      throw new ConfigError(`SCHEDULER_ADAPTERS entry #${index + 1} must be an object.`);
    }
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) throw new ConfigError(`SCHEDULER_ADAPTERS entry #${index + 1} is missing "name".`);
    const type = (typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : 'generic') as SchedulerType;
    if (!VALID_TYPES.includes(type)) {
      throw new ConfigError(`SCHEDULER_ADAPTERS "${name}" has unknown type "${type}". Valid: ${VALID_TYPES.join(', ')}.`);
    }
    const host = typeof obj.host === 'string' ? obj.host.replace(/\/+$/, '') : '';
    if (!host) throw new ConfigError(`SCHEDULER_ADAPTERS "${name}" is missing "host".`);
    const token = typeof obj.token === 'string' ? obj.token : undefined;
    const user = typeof obj.user === 'string' ? obj.user : undefined;
    const password = typeof obj.password === 'string' ? obj.password : undefined;
    if (!token && !(user && password)) {
      throw new ConfigError(`SCHEDULER_ADAPTERS "${name}" needs a token or user+password.`);
    }
    const jobStatusPath =
      typeof obj.jobStatusPath === 'string' && obj.jobStatusPath.trim()
        ? obj.jobStatusPath.trim()
        : DEFAULT_PATHS[type];
    return { name, type, host, token, user, password, jobStatusPath };
  });
}

/** Resolve the adapter to use, matching by name (case-insensitive). */
export function resolveScheduler(adapters: SchedulerAdapter[], name?: string): SchedulerAdapter {
  if (adapters.length === 0) {
    throw new ConfigError(
      'No schedulers configured. Define SCHEDULER_ADAPTERS (JSON) with Control-M, CA 7, or IWS endpoints.',
    );
  }
  if (!name) {
    if (adapters.length === 1) return adapters[0];
    throw new ValidationError(
      `Multiple schedulers are configured (${adapters.map((a) => a.name).join(', ')}); pass the "scheduler" argument.`,
      { available: adapters.map((a) => a.name) },
    );
  }
  const adapter = adapters.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  if (!adapter) {
    throw new ValidationError(
      `Unknown scheduler "${name}". Configured: ${adapters.map((a) => a.name).join(', ')}.`,
      { available: adapters.map((a) => a.name) },
    );
  }
  return adapter;
}

/** Best-effort normalization of a scheduler status value. */
export function normalizeSchedulerStatus(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.toUpperCase();
  const map: [RegExp, string][] = [
    [/ENDED\s*OK|SUCCEEDED|COMPLETE|COMPLETED|SU\b/, 'ENDED OK'],
    [/ENDED\s*NOT\s*OK|FAILED|FAILED_|ABEND|EX abend/i, 'ENDED NOT OK'],
    [/WAIT|HOLD|QUEUED|PENDING|SCHEDULED/, 'WAITING'],
    [/EXECUTING|EXECUTING|RUNNING|ACTIVE|IN PROGRESS/, 'EXECUTING'],
  ];
  for (const [re, status] of map) {
    if (re.test(upper)) return status;
  }
  return upper;
}

export interface SchedulerJobStatus {
  scheduler: string;
  type: SchedulerType;
  jobName: string;
  status?: string;
  /** Normalized status guess when a common field was recognizable. */
  normalizedStatus?: string;
  /** How many records matched, when countable. */
  matchCount?: number;
  /** Pass-through of the scheduler response (already JSON). */
  response: unknown;
}

function authHeaders(adapter: SchedulerAdapter): Record<string, string> {
  if (adapter.token) return { Authorization: `Bearer ${adapter.token}` };
  const basic = Buffer.from(`${adapter.user}:${adapter.password}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

/** Query a scheduler for job status. Response is passed through. */
export async function fetchSchedulerJobStatus(
  adapter: SchedulerAdapter,
  jobName: string,
): Promise<SchedulerJobStatus> {
  if (!jobName.trim()) throw new ValidationError('jobName is required.');
  const path = adapter.jobStatusPath.replace(/\{jobName\}/g, encodeURIComponent(jobName.trim().toUpperCase()));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  timeout.unref();
  try {
    const res = await fetch(`${adapter.host}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders(adapter) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ConnectionError(
        `Scheduler "${adapter.name}" request failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`,
      );
    }
    // Parse defensively: JSON bodies regardless of content-type quirks.
    const text = await res.text();
    let response: unknown;
    try {
      response = text ? JSON.parse(text) : {};
    } catch {
      response = { raw: text };
    }
    log.debug({ scheduler: adapter.name, jobName }, 'scheduler status fetched');

    // Best-effort normalization across the three vendors' shapes.
    const records = Array.isArray(response)
      ? response
      : ((response as Record<string, unknown>)?.jobs as unknown[] | undefined) ??
        ((response as Record<string, unknown>)?.returnedJobs as unknown[] | undefined) ??
        [];
    const first = (Array.isArray(response) ? response[0] : records[0]) as Record<string, unknown> | undefined;
    const rawStatus =
      first?.status ??
      first?.jobStatus ??
      first?.state ??
      first?.jobState ??
      ((response as Record<string, unknown>)?.status as string | undefined);
    const status = normalizeSchedulerStatus(rawStatus);

    return {
      scheduler: adapter.name,
      type: adapter.type,
      jobName: jobName.trim().toUpperCase(),
      ...(rawStatus != null ? { status: String(rawStatus) } : {}),
      ...(status ? { normalizedStatus: status } : {}),
      ...(Array.isArray(response) || records.length ? { matchCount: Array.isArray(response) ? response.length : records.length } : {}),
      response,
    };
  } catch (err) {
    if (err instanceof ConnectionError || err instanceof ValidationError || err instanceof ConfigError) throw err;
    throw new ConnectionError(
      `Scheduler "${adapter.name}" request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
