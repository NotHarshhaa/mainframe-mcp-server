/**
 * CEEDUMP / SYSMDUMP / SYSUDUMP summarizer.
 *
 * Extracts the diagnostic signal an agent needs — dump type, completion
 * codes, failing module and offset, Language Environment conditions, and the
 * section inventory — without shipping megabytes of storage hex to the model.
 */

export interface DumpSection {
  name: string;
  /** Lines captured from the section (already trimmed). */
  excerpt: string[];
}

export interface DumpSummary {
  /** Detected dump flavor. */
  type: 'CEEDUMP' | 'SYSMDUMP' | 'SYSUDUMP' | 'SVCDUMP' | 'UNKNOWN';
  /** System completion code, e.g. "S0C4". */
  systemCompletionCode?: string;
  /** User/REASON completion code when present. */
  userCompletionCode?: string;
  /** Language Environment condition messages (CEEDUMP), e.g. "CEE3204S". */
  conditions: string[];
  /** Active load module at failure, when identified. */
  failingModule?: string;
  /** Hex offset into the failing module. */
  failingOffset?: string;
  /** PSW at time of error, when present. */
  psw?: string;
  /** Program being executed (CEEDUMP enclave / routine info). */
  program?: string;
  /** Section inventory (REGISTER/STORAGE/CONTROL BLOCKS/...). */
  sections: string[];
  /** Most diagnostic lines, de-duplicated and capped. */
  keyLines: string[];
  /** Practical next step. */
  suggestedFix: string;
}

const SYS_CC_RE = /COMPLETION\s+CODE\s+SYSTEM\s*=\s*([0-9A-F]{3})/i;
const USER_CC_RE = /(?:USER\s+COMPLETION\s+CODE|REASON\s+CODE)\s*=\s*(\d+)/i;

function normalizeScc(raw: string): string {
  const digits = raw.toUpperCase().replace(/[^0-9A-F]/g, '');
  // "0C4" already carries the S; "X'0C4'" style too.
  return digits.startsWith('0') ? `S${digits}` : `S${digits}`;
}

function extractPsw(text: string): string | undefined {
  // SYSUDUMP: "PSW AT TIME OF ERROR  078D1000  8FF5A2C6  ILC 2  INTC 000D"
  const m = text.match(/PSW AT TIME OF ERROR\s+([0-9A-F]+\s+[0-9A-F]+[^\n]*)/i);
  return m ? m[1].trim().split(/\s{2,}/)[0] : undefined;
}

function extractModule(text: string): { module?: string; offset?: string } {
  // SYSUDUMP: "ACTIVE LOAD MODULE ADDRESS=0FF5A000  OFFSET=0000A2C6"
  // and typically "LOAD MODULE NAME = PAYRPTX" nearby.
  const active = text.match(/ACTIVE\s+(?:LOAD\s+)?MODULE\s+ADDRESS=[0-9A-F]+\s+OFFSET=([0-9A-F]+)/i);
  const named = text.match(/LOAD\s+MODULE\s+NAME\s*=\s*([A-Z0-9#$@]{1,8})/i);
  // CEEDUMP: "Condition CEE3204S raised at offset X'0001A2C6' in module PAYRPTX."
  // The X'…' quoting is the reliable discriminator (a traceback header also
  // contains the word "offset").
  const ceedumpOffset = text.match(/offset\s+X'([0-9A-F]+)'/i) ?? text.match(/offset\s+X'?([0-9A-F]{6,})/i);
  const ceedumpModule = text.match(/\bin\s+module\s+([A-Z0-9#$@]{1,8})/i);
  if (active) {
    return { module: named?.[1], offset: active[1] };
  }
  if (ceedumpOffset || ceedumpModule) {
    return { module: ceedumpModule?.[1], offset: ceedumpOffset?.[1] };
  }
  return {};
}

function extractConditions(text: string): string[] {
  const conditions = new Set<string>();
  for (const m of text.matchAll(/\bCEE[0-9]{4}[SUITEW]\b/g)) {
    conditions.add(m[0].toUpperCase());
  }
  return [...conditions];
}

function extractProgram(text: string): string | undefined {
  // CEEDUMP: "Information for enclave 1 ... program XYZ" or "Routine: PAYRPTX"
  const routine = text.match(/Routine:\s*([A-Z0-9#$@]{1,8})/i);
  return routine ? routine[1].toUpperCase() : undefined;
}

const SECTION_MARKERS = [
  'REGISTERS', 'STORAGE', 'CONTROL BLOCKS', 'TRACEBACK', 'CALL STACK', 'ENCLAVE',
  'SYMBOL TABLE', 'LOAD MODULE LIST', 'DXD', 'WLM-ENV', 'TGT', 'PSW', 'GPR', 'FPR',
];

function extractSections(text: string): string[] {
  const sections = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const upper = line.toUpperCase();
    for (const marker of SECTION_MARKERS) {
      if (upper.includes(marker) && upper.length < 80) sections.add(marker);
    }
  }
  return [...sections];
}

function collectKeyLines(text: string, limit = 12): string[] {
  const interesting = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        /COMPLETION CODE|ABEND|CEE[0-9]{4}|IEA995I|PSW AT TIME|ACTIVE MODULE|LOAD MODULE|CONDITION|TRACEBACK|SYMTOM|S0[0-9A-F][0-9A-F]|EYECATCHER/i.test(
          l,
        ) && l.length > 0,
    );
  return [...new Set(interesting)].slice(0, limit);
}

/** Detect the dump flavor from characteristic markers. */
export function detectDumpType(text: string): DumpSummary['type'] {
  if (/CEE3DMP|Information for [Ee]nclave/i.test(text)) return 'CEEDUMP';
  if (/SYSMDUMP/i.test(text) && /COMPLETION CODE/i.test(text)) return 'SYSMDUMP';
  if (/SVCDUMP|IEA79AI|DUMP MANAGEMENT/i.test(text)) return 'SVCDUMP';
  if (/SYSUDUMP/i.test(text) || /COMPLETION\s+CODE\s+SYSTEM\s*=/i.test(text)) return 'SYSUDUMP';
  return 'UNKNOWN';
}

/** Summarize dump text. Pure — fully unit-testable. */
export function summarizeDump(raw: string): DumpSummary {
  const text = raw.replace(/\r\n/g, '\n');
  const type = detectDumpType(text);

  let systemCompletionCode: string | undefined;
  let userCompletionCode: string | undefined;
  const sysMatch = text.match(SYS_CC_RE);
  if (sysMatch?.[1]) {
    systemCompletionCode = normalizeScc(sysMatch[1]);
    const userMatch = text.match(USER_CC_RE);
    if (userMatch?.[1]) userCompletionCode = userMatch[1];
  }

  const conditions = extractConditions(text);
  const { module, offset } = extractModule(text);

  const suggestedFix =
    conditions.length > 0
      ? `Language Environment reported ${conditions.length} condition(s) (${[...conditions].slice(0, 3).join(', ')}). Review the traceback and the failing routine before touching code.`
      : systemCompletionCode
        ? `Review the failing module${module ? ` (${module})` : ''} and storage around the failure; use lookup_abend_code for ${systemCompletionCode} context.`
        : 'Dump type could not be identified confidently — inspect the raw dump or run IPCS for SVC dumps.';

  return {
    type,
    ...(systemCompletionCode ? { systemCompletionCode } : {}),
    ...(userCompletionCode ? { userCompletionCode } : {}),
    conditions,
    ...(module ? { failingModule: module } : {}),
    ...(offset ? { failingOffset: offset } : {}),
    ...(extractPsw(text) ? { psw: extractPsw(text) } : {}),
    ...(extractProgram(text) ? { program: extractProgram(text) } : {}),
    sections: extractSections(text),
    keyLines: collectKeyLines(text),
    suggestedFix,
  };
}
