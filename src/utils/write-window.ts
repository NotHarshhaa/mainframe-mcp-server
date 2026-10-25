/**
 * Change-window enforcement for governed writes.
 *
 * `SECURITY_WRITE_WINDOW="22:00-06:00"` (24h, overnight ranges supported),
 * `SECURITY_WRITE_DAYS="1-5"` (0=Sun … 6=Sat, default: every day) and
 * `SECURITY_WRITE_WINDOW_TZ` (IANA name, default UTC) define when
 * `submit_jcl` / `approve_write` may execute. Submissions outside the window
 * are rejected with a FORBIDDEN error.
 */
import { ForbiddenError, ValidationError } from './errors.js';

export interface ParsedWriteWindow {
  /** Minutes since midnight, window start (inclusive). */
  startMin: number;
  /** Minutes since midnight, window end (exclusive). May be < startMin for overnight windows. */
  endMin: number;
  /** Allowed weekdays, 0=Sun … 6=Sat. */
  days: number[];
  /** IANA timezone the window is evaluated in. */
  tz: string;
}

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

function parseHHMM(value: string, what: string): number {
  const m = value.match(HHMM_RE);
  if (!m) throw new ValidationError(`Invalid time "${value}" in ${what}. Expected 24h HH:MM.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new ValidationError(`Invalid time "${value}" in ${what}.`);
  return h * 60 + min;
}

/** Parse the weekday expression: "1-5", "0,2,4", "1-3,5". Empty → all days. */
export function parseWriteDays(expr: string | undefined): number[] {
  if (!expr || !expr.trim()) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const tokenRaw of expr.split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const range = token.match(/^([0-6])(?:-([0-6]))?$/);
    if (!range) {
      throw new ValidationError(
        `Invalid SECURITY_WRITE_DAYS token "${token}". Use weekdays 0=Sun … 6=Sat, e.g. "1-5" or "1,3,5".`,
      );
    }
    const from = Number(range[1]);
    const to = range[2] != null ? Number(range[2]) : from;
    for (let d = from; d <= to; d += 1) days.add(d);
  }
  if (days.size === 0) throw new ValidationError('SECURITY_WRITE_DAYS matched no weekdays.');
  return [...days].sort((a, b) => a - b);
}

/** Parse and validate the full window configuration. Throws ValidationError on bad input. */
export function parseWriteWindow(
  window: string,
  days?: string,
  tz?: string,
): ParsedWriteWindow {
  const m = window.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!m) {
    throw new ValidationError(
      `Invalid SECURITY_WRITE_WINDOW "${window}". Expected "HH:MM-HH:MM" in 24h time, e.g. "08:00-18:00" or "22:00-06:00".`,
    );
  }
  const startMin = parseHHMM(m[1], 'SECURITY_WRITE_WINDOW');
  const endMin = parseHHMM(m[2], 'SECURITY_WRITE_WINDOW');
  const timezone = tz?.trim() || 'UTC';
  try {
    // Validate the IANA timezone name up front.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ValidationError(
      `Invalid SECURITY_WRITE_WINDOW_TZ "${timezone}". Use an IANA timezone name, e.g. "Europe/Berlin".`,
    );
  }
  return { startMin, endMin, days: parseWriteDays(days), tz: timezone };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Current time-of-day in minutes and weekday number, evaluated in `tz`. */
export function zonedNow(now: Date, tz: string): { minutes: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const day = WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number]);
  return { minutes: hour * 60 + minute, day: day < 0 ? 0 : day };
}

function isWithin(window: ParsedWriteWindow, minutes: number, day: number): boolean {
  if (!window.days.includes(day)) return false;
  // Overnight window (e.g. 22:00-06:00) is open when either side matches.
  if (window.startMin <= window.endMin) {
    return minutes >= window.startMin && minutes < window.endMin;
  }
  return minutes >= window.startMin || minutes < window.endMin;
}

/**
 * Enforce the change window. Throws ForbiddenError when `now` falls outside.
 * Pure check — parse once with {@link parseWriteWindow} and pass the result.
 */
export function assertWithinWriteWindow(window: ParsedWriteWindow, now: Date = new Date()): void {
  if (isWithin(window, zonedNow(now, window.tz).minutes, zonedNow(now, window.tz).day)) return;
  const { minutes, day } = zonedNow(now, window.tz);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  throw new ForbiddenError(
    `Write operations are restricted to the change window ` +
      `${WEEKDAYS[window.days[0]]}–${WEEKDAYS[window.days[window.days.length - 1]]} ` +
      `${String(Math.floor(window.startMin / 60)).padStart(2, '0')}:${String(window.startMin % 60).padStart(2, '0')}` +
      `-${String(Math.floor(window.endMin / 60)).padStart(2, '0')}:${String(window.endMin % 60).padStart(2, '0')} ` +
      `(${window.tz}). Current ${window.tz} time is ${WEEKDAYS[day]} ${hh}:${mm}. ` +
      `Run submit_jcl with dryRun=true meanwhile, or adjust SECURITY_WRITE_WINDOW.`,
  );
}
