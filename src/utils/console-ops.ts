/**
 * Pure console-operation helpers: JES2 hold/release command construction,
 * IMS command validation, and HSM message filtering.
 */
import { ValidationError } from './errors.js';

/**
 * Extract the numeric part of a JES job id for JES2 commands
 * ("JOB01234" → "01234", "STC01234" → "01234").
 */
export function jobNumberFromJobId(jobId: string): string {
  const digits = jobId.trim().toUpperCase().replace(/^[A-Z]+/, '');
  if (!/^\d{1,5}$/.test(digits)) {
    throw new ValidationError(
      `Cannot derive a JES2 job number from "${jobId}". Expected JOBnnnnn / STCnnnnn / TSUnnnnn.`,
      { jobId },
    );
  }
  return digits;
}

/** JES2 hold command for a job, e.g. "$HJ01234". */
export function buildHoldCommand(jobId: string): string {
  return `$HJ${jobNumberFromJobId(jobId)}`;
}

/** JES2 release command for a job, e.g. "$OJ01234". */
export function buildReleaseCommand(jobId: string): string {
  return `$OJ${jobNumberFromJobId(jobId)}`;
}

/**
 * Validate an IMS command. IMS commands issued from the z/OS system console
 * are prefixed with a slash, e.g. "/DIS TRAN TRAN1", "/DIS ACT".
 */
export function normalizeImsCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) throw new ValidationError('IMS command must not be empty.');
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!/^\/[A-Z]{2,4}\s/i.test(withSlash)) {
    throw new ValidationError(
      `"${command}" does not look like an IMS command. IMS commands start with a verb, e.g. "/DIS ACTIVE", "/DIS TRAN TRAN1", "/STA REGION".`,
      { command },
    );
  }
  return withSlash;
}

/** Message prefixes produced by DFSMShsm (recalls, migrations, backups). */
export const HSM_MESSAGE_PREFIXES = ['ARC', 'HSM', 'ICK', 'ITZ'] as const;

/** True when a console message line looks like DFSMShsm activity. */
export function isHsmMessage(line: string): boolean {
  const upper = line.trim().toUpperCase();
  return HSM_MESSAGE_PREFIXES.some(
    (prefix) => upper.startsWith(prefix) || /\bAR[CI]\d{3}[A-Z]\b/.test(upper) || /DFHSM|DFSM[SH]{2}SM/.test(upper),
  );
}

/** Filter console/operations-log lines down to DFSMShsm activity. */
export function filterHsmMessages(lines: string[], limit = 50): string[] {
  const matches = lines.filter(isHsmMessage);
  return [...new Set(matches.map((l) => l.trim()))].slice(0, limit);
}
