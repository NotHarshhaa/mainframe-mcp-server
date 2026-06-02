/**
 * Abend code lookup table.
 *
 * A curated set of the most common z/OS system (S...) and user (U...) abend
 * codes encountered in batch operations, with plain-language explanations and
 * remediation hints. This is reference data, not an exhaustive IBM catalog.
 */
import type { AbendCodeInfo } from '../types/zos.js';

const ABEND_TABLE: Record<string, AbendCodeInfo> = {
  S0C1: {
    code: 'S0C1',
    title: 'Operation Exception',
    category: 'system',
    explanation:
      'The program tried to execute an invalid machine instruction, often after branching into data or an uninitialized area.',
    commonCauses: [
      'Calling a subprogram that was not linked or could not be loaded',
      'A subscript/pointer error transferring control to non-executable storage',
      'Mismatched load module / missing entry point',
    ],
    suggestedFix:
      'Verify all called modules are linked and available in STEPLIB/JOBLIB; check for control transfers into data areas.',
  },
  S0C4: {
    code: 'S0C4',
    title: 'Protection / Addressing Exception',
    category: 'system',
    explanation:
      'The program referenced storage it does not own or that is not addressable (a memory protection violation).',
    commonCauses: [
      'Reading or writing past the end of a table or array (subscript out of range)',
      'Using an uninitialized or corrupted pointer / base register',
      'Reentrancy or working-storage overlay issues',
    ],
    suggestedFix:
      'Check array bounds and pointer initialization; review recent code changes around storage access.',
  },
  S0C7: {
    code: 'S0C7',
    title: 'Data Exception',
    category: 'system',
    explanation:
      'A decimal arithmetic instruction operated on a field that does not contain valid packed-decimal data.',
    commonCauses: [
      'Uninitialized numeric COBOL fields (spaces instead of zeros)',
      'Bad input data feeding a computational field',
      'Redefines / group moves placing non-numeric data into a numeric field',
    ],
    suggestedFix:
      'Initialize numeric fields, validate input with NUMERIC class tests, and inspect the offending record before the failing COMPUTE/arithmetic.',
  },
  S106: {
    code: 'S106',
    title: 'Program Fetch Error',
    category: 'system',
    explanation: 'An error occurred while loading (fetching) a program into storage.',
    commonCauses: ['I/O error reading the load library', 'Corrupted load module'],
    suggestedFix: 'Re-link the module and verify the load library is not damaged.',
  },
  S213: {
    code: 'S213',
    title: 'Dataset OPEN Failure (DISP=OLD/SHR)',
    category: 'system',
    explanation: 'A dataset could not be opened, frequently because it was not found on the volume.',
    commonCauses: ['Dataset not cataloged or missing', 'Wrong volume serial', 'DD statement error'],
    suggestedFix: 'Confirm the dataset exists and is cataloged; check the DD statement and volume.',
  },
  S222: {
    code: 'S222',
    title: 'Job Cancelled by Operator',
    category: 'system',
    explanation: 'The job was cancelled by an operator or by automation, not an internal program error.',
    commonCauses: ['Manual operator cancel', 'Automation killed a long-running/looping job', 'Exceeded run window'],
    suggestedFix:
      'Determine why it was cancelled (runtime, loop, or operational decision); rerun after addressing the cause.',
  },
  S322: {
    code: 'S322',
    title: 'Time / CPU Limit Exceeded',
    category: 'system',
    explanation: 'The step exceeded its allotted CPU or wall-clock time limit.',
    commonCauses: ['An infinite loop', 'Underestimated TIME= parameter', 'Unexpected data volume'],
    suggestedFix: 'Investigate for loops; raise TIME= on the JOB/EXEC card if the workload legitimately grew.',
  },
  S413: {
    code: 'S413',
    title: 'OPEN Error (Volume/Unit)',
    category: 'system',
    explanation: 'OPEN failed because the device or volume for the dataset was unavailable.',
    commonCauses: ['Volume not mounted', 'Unit allocation problem'],
    suggestedFix: 'Verify the volume is online and correctly allocated.',
  },
  S522: {
    code: 'S522',
    title: 'Wait Limit Exceeded',
    category: 'system',
    explanation: 'The job sat in a wait state longer than the installation limit allows.',
    commonCauses: ['Waiting on an unavailable resource', 'Operator reply never issued', 'Enqueue contention'],
    suggestedFix: 'Identify the resource being waited on (datasets, WTOR replies, locks) and resolve contention.',
  },
  S806: {
    code: 'S806',
    title: 'Module Not Found / Load Failure',
    category: 'system',
    explanation: 'The system could not locate a requested load module in any available library.',
    commonCauses: [
      'Program not compiled/linked into the expected load library',
      'STEPLIB/JOBLIB concatenation missing the library',
      'Misspelled program name on EXEC PGM=',
    ],
    suggestedFix:
      'Confirm the module is linked into a library on the STEPLIB/JOBLIB concatenation and that PGM= is spelled correctly.',
  },
  S837: {
    code: 'S837',
    title: 'Out of Space on Volume',
    category: 'system',
    explanation: 'A dataset could not be extended because the volume was full or out of extents.',
    commonCauses: ['Insufficient primary/secondary space', 'Volume full', 'Max extents reached'],
    suggestedFix: 'Increase SPACE allocation or direct output to a volume with free space.',
  },
  S913: {
    code: 'S913',
    title: 'Security Authorization Failure',
    category: 'system',
    explanation: 'The job was denied access to a resource by the security product (RACF/ACF2/TSS).',
    commonCauses: ['Insufficient dataset/resource permissions', 'Expired or wrong user id'],
    suggestedFix: 'Request the appropriate access for the service account from your security administrator.',
  },
  SB37: {
    code: 'SB37',
    title: 'Out of Space (End of Volume)',
    category: 'system',
    explanation: 'A dataset ran out of space at end-of-volume with no additional volume available.',
    commonCauses: ['Secondary space exhausted', 'No candidate volumes'],
    suggestedFix: 'Increase secondary space allocation or add candidate volumes.',
  },
  SD37: {
    code: 'SD37',
    title: 'Out of Space (No Secondary)',
    category: 'system',
    explanation: 'A dataset filled its primary allocation and no secondary extent was specified.',
    commonCauses: ['Primary too small', 'SPACE secondary set to zero'],
    suggestedFix: 'Add or increase the secondary SPACE quantity.',
  },
  SE37: {
    code: 'SE37',
    title: 'Out of Space (Max Extents/Volumes)',
    category: 'system',
    explanation: 'A dataset could not extend because it reached the maximum number of extents or volumes.',
    commonCauses: ['Too many small extents', 'Volume count limit'],
    suggestedFix: 'Reorganize/compress the dataset or reallocate with larger primary space.',
  },
  U0100: {
    code: 'U0100',
    title: 'User Abend 0100 (Application-Defined)',
    category: 'user',
    explanation:
      'A user (application) abend issued by the program logic. The meaning is defined by the application, not by z/OS.',
    commonCauses: ['Business-rule validation failure', 'Explicit ABEND in error handling'],
    suggestedFix: 'Consult the application documentation/source for the meaning of user code 0100.',
  },
  U4038: {
    code: 'U4038',
    title: 'Language Environment Abend',
    category: 'user',
    explanation: 'A severe runtime error detected by Language Environment (LE).',
    commonCauses: ['Unhandled condition in COBOL/C/PLI', 'Storage corruption', 'Failed CEE call'],
    suggestedFix: 'Review the LE message and CEEDUMP for the failing condition and offset.',
  },
};

/** Normalize a free-form code (e.g. " s806 ", "806") into table key form. */
export function normalizeAbendCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.startsWith('S') || trimmed.startsWith('U')) return trimmed;
  // Bare hex like "806" is conventionally a system completion code.
  if (/^[0-9A-F]{3,4}$/.test(trimmed)) return `S${trimmed}`;
  return trimmed;
}

/** Look up a single abend code. Returns `undefined` if unknown. */
export function lookupAbend(code: string): AbendCodeInfo | undefined {
  return ABEND_TABLE[normalizeAbendCode(code)];
}

/** All known abend codes (useful for documentation/tests). */
export function allAbendCodes(): AbendCodeInfo[] {
  return Object.values(ABEND_TABLE);
}

/**
 * Search the abend reference table. With no query, returns all codes sorted.
 * With a query, matches code, title, or explanation (case-insensitive).
 */
export function searchAbendCodes(query?: string): AbendCodeInfo[] {
  const all = allAbendCodes();
  const trimmed = query?.trim();
  if (!trimmed) {
    return all.sort((a, b) => a.code.localeCompare(b.code));
  }

  const upper = trimmed.toUpperCase();
  const normalized = normalizeAbendCode(trimmed);
  return all
    .filter(
      (entry) =>
        entry.code === normalized ||
        entry.code.includes(upper) ||
        entry.title.toUpperCase().includes(upper) ||
        entry.explanation.toUpperCase().includes(upper),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Scan free text (e.g. spool output) for the first recognizable abend code.
 * Returns the normalized code string or `null`.
 */
export function extractAbendCode(text: string): string | null {
  // 1. Explicit "ABEND Sxxx" / "ABEND Uxxxx" form.
  const abend = text.match(/\bABEND[=\s-]*([SU][0-9A-F]{3,4})\b/i);
  if (abend) return normalizeAbendCode(abend[1]);

  // 2. "SYSTEM (COMPLETION) CODE=0C7" form (no S prefix in the message).
  const sys = text.match(/SYSTEM(?:\s+COMPLETION)?\s+CODE\s*[=:]?\s*([0-9A-F]{3,4})\b/i);
  if (sys) return normalizeAbendCode(`S${sys[1]}`);

  // 3. "USER (COMPLETION) CODE=0100" form.
  const user = text.match(/USER(?:\s+COMPLETION)?\s+CODE\s*[=:]?\s*(\d{3,4})\b/i);
  if (user) return normalizeAbendCode(`U${user[1]}`);

  // 4. Bare "Sxxx"/"Uxxxx" token anywhere.
  const bare = text.match(/\b([SU][0-9A-F]{3,4})\b/);
  if (bare) return normalizeAbendCode(bare[1]);

  return null;
}
