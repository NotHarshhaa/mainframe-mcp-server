/**
 * In-memory pending-submission store for the human-in-the-loop write flow.
 *
 * When SECURITY_WRITE_APPROVAL=true, submit_jcl validates everything, then
 * registers the prepared JCL here and returns a one-time approval token.
 * approve_write consumes the token and actually submits. Tokens expire after
 * 10 minutes and are never logged (the audit redactor masks `token` keys).
 */
import { randomBytes } from 'node:crypto';

const PENDING_TTL_MS = 10 * 60 * 1000;

export interface PendingWrite {
  token: string;
  /** Prepared JCL (normalized, overrides applied, scanned). */
  jcl: string;
  changeTicket?: string;
  createdAt: number;
  expiresAt: number;
  /** Scan findings attached for the approval report. */
  findings: { severity: string; rule: string; message: string; line: number }[];
}

const pending = new Map<string, PendingWrite>();

function sweep(): void {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(token);
  }
}

/** Register a prepared JCL and return its one-time approval token. */
export function registerPending(
  jcl: string,
  changeTicket: string | undefined,
  findings: PendingWrite['findings'],
): PendingWrite {
  sweep();
  const entry: PendingWrite = {
    token: randomBytes(12).toString('hex'),
    jcl,
    changeTicket,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_TTL_MS,
    findings,
  };
  pending.set(entry.token, entry);
  return entry;
}

/** Atomically consume a pending submission (one-time use). */
export function takePending(token: string): PendingWrite | undefined {
  sweep();
  const entry = pending.get(token);
  pending.delete(token);
  return entry;
}

/** Number of pending submissions (tests/observability). */
export function pendingCount(): number {
  sweep();
  return pending.size;
}

/** Clear the store (tests). */
export function clearPending(): void {
  pending.clear();
}
