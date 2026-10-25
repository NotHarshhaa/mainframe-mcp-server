/**
 * JCL pre-flight scanner for governed writes.
 *
 * Scans inline JCL for destructive or restricted constructs before a
 * submission is allowed. Deliberately line-based and conservative: it catches
 * the standard foot-guns enterprises care about, and every finding is
 * reported with its rule name and JCL line number so the operator can judge it.
 *
 * Rules (BLOCK unless noted):
 *   idcams-delete      — IDCAMS DELETE in SYSIN instream data
 *   iefbr14-delete     — IEFBR14 step that deletes a dataset via DISP=(...,DELETE)
 *   blocked-program    — EXEC PGM on the blocked utility list
 *                        (default: ADRDSSU, ICKDSF, IEHINITT; extendable via
 *                        SECURITY_BLOCKED_PROGRAMS)
 *   blocked-job-class  — CLASS= on the restricted class list
 *   idcams-alter       — WARN: IDCAMS ALTER in SYSIN (blocks in strict mode)
 */

export type JclFindingSeverity = 'BLOCK' | 'WARN';

export interface JclFinding {
  severity: JclFindingSeverity;
  rule: string;
  message: string;
  /** 1-based JCL line number. */
  line: number;
}

export interface JclScanOptions {
  /** Extra EXEC program names to block (uppercase). Extends the default list. */
  blockedPrograms?: string[];
  /** Restricted JES job classes (uppercase, single characters). */
  blockedJobClasses?: string[];
}

export const DEFAULT_BLOCKED_PROGRAMS = ['ADRDSSU', 'ICKDSF', 'IEHINITT'];

/** Job card statement, e.g. `//PAYJOB01 JOB (ACCT),'demo',CLASS=A`. */
const JOB_CARD_RE = /^\/\/[A-Z0-9@#$]{1,8}\s+JOB\b/i;
/** EXEC statement: `//S1 EXEC PGM=X`, `//S1 EXEC PROC=X`, `//S1 EXEC X`. */
const EXEC_RE = /^\/\/\S*\s+EXEC\s+(?:(?:PGM|PROC)=)?([A-Z0-9@#$]{1,8})/i;
/** DD statement. */
const DD_RE = /^\/\/(\S+)\s+DD\b/i;
/** Instream data start (`DD *`) and terminator (`/*`). */
const INSTREAM_START_RE = /(?:^|[\s,])\*\s*$/;
const INSTREAM_END_RE = /^\/\*\s*$/;
/** DISP= parameter, with up to three sub-parameters. */
const DISP_RE = /\bDISP=\(?([^\s,)]*),?([^,)]*),?([^)]*)\)?/i;

function parseBlocked(values: string[] | undefined, defaults: string[]): string[] {
  const merged = values ? [...defaults, ...values.map((v) => v.trim().toUpperCase())] : defaults;
  return [...new Set(merged.filter(Boolean))];
}

/**
 * Scan JCL text and return all findings. Pure function — no I/O. The caller
 * decides whether findings block the submission (strict mode also blocks
 * WARN-level findings).
 */
export function scanJcl(jcl: string, options: JclScanOptions = {}): JclFinding[] {
  const findings: JclFinding[] = [];
  const blockedPrograms = parseBlocked(options.blockedPrograms, DEFAULT_BLOCKED_PROGRAMS);
  const blockedClasses = (options.blockedJobClasses ?? [])
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  let currentProgram: string | null = null;
  let inInstream = false;
  let instreamIsIdcams = false;

  const lines = jcl.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = lines[i].trimEnd();

    // Instream data terminator.
    if (INSTREAM_END_RE.test(line.trim())) {
      inInstream = false;
      instreamIsIdcams = false;
      continue;
    }
    // Comment cards.
    if (line.startsWith('//*') || line.startsWith('/*')) continue;

    const exec = line.match(EXEC_RE);
    if (exec) {
      currentProgram = exec[1].toUpperCase();
      inInstream = false;
      instreamIsIdcams = false;
      if (blockedPrograms.includes(currentProgram)) {
        findings.push({
          severity: 'BLOCK',
          rule: 'blocked-program',
          message: `Utility ${currentProgram} is on the blocked program list (SECURITY_BLOCKED_PROGRAMS).`,
          line: lineNo,
        });
      }
    }

    if (JOB_CARD_RE.test(line)) {
      const cls = line.match(/\bCLASS=([A-Z0-9])/i);
      if (cls && blockedClasses.includes(cls[1].toUpperCase())) {
        findings.push({
          severity: 'BLOCK',
          rule: 'blocked-job-class',
          message: `Job class ${cls[1].toUpperCase()} is restricted (SECURITY_BLOCKED_JOB_CLASSES).`,
          line: lineNo,
        });
      }
    }

    const dd = line.match(DD_RE);
    if (dd && INSTREAM_START_RE.test(line)) {
      // Start of instream data — remember whether this SYSIN feeds IDCAMS.
      inInstream = true;
      instreamIsIdcams = currentProgram === 'IDCAMS';
      continue;
    }

    if (currentProgram === 'IEFBR14' && dd) {
      const disp = line.match(DISP_RE);
      if (disp) {
        const parts = [disp[1], disp[2], disp[3]].map((p) => (p ?? '').trim().toUpperCase());
        if (parts.includes('DELETE')) {
          findings.push({
            severity: 'BLOCK',
            rule: 'iefbr14-delete',
            message: `IEFBR14 step deletes a dataset via DISP=(${parts.filter(Boolean).join(',')}).`,
            line: lineNo,
          });
        }
      }
    }

    if (inInstream && instreamIsIdcams) {
      const cmd = line.trim().match(/^(DELETE|ALTER)\b/i);
      if (cmd) {
        const verb = cmd[1].toUpperCase();
        findings.push({
          severity: verb === 'DELETE' ? 'BLOCK' : 'WARN',
          rule: verb === 'DELETE' ? 'idcams-delete' : 'idcams-alter',
          message:
            verb === 'DELETE'
              ? 'IDCAMS DELETE command detected in SYSIN instream data.'
              : 'IDCAMS ALTER command detected in SYSIN instream data.',
          line: lineNo,
        });
      }
    }
  }

  return findings;
}
