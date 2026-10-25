/**
 * Data protection engine — masking of PII, PCI card numbers, SSNs, and
 * embedded secrets in tool output (dataset reads, USS file reads, JES spool).
 *
 * Two layers:
 *   1. Built-in redaction rules (SSN, credit card with Luhn validation, email,
 *      secrets, JWT, private-key blocks) applied to every content-returning
 *      tool unless disabled.
 *   2. Classification rules from the policy file that refine behavior for
 *      sensitive resources: extra rules, line caps, head/tail sampling, and
 *      role-based read gates.
 */

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

/** Stable ids for built-in redaction rules (referenced from policy files). */
export type RedactionRuleId =
  | 'ssn'
  | 'credit_card'
  | 'email'
  | 'secrets'
  | 'jwt'
  | 'private_key';

export type RedactionStyle = 'mask' | 'token';

export interface RedactionOptions {
  /** Rule ids to apply (order matters for display, not detection). */
  rules: readonly RedactionRuleId[];
  /** 'mask' keeps the last 4 chars of SSNs/cards; 'token' replaces fully. */
  style: RedactionStyle;
}

export interface RedactionResult {
  text: string;
  /** Total number of masked matches across all rules. */
  matches: number;
  /** Rule ids that matched at least once (in rule order). */
  rulesMatched: RedactionRuleId[];
}

/** Keep the trailing `keep` characters, mask the rest with `*`. */
function maskKeepTail(value: string, keep: number): string {
  if (value.length <= keep) return '*'.repeat(value.length);
  return '*'.repeat(value.length - keep) + value.slice(value.length - keep);
}

function styleValue(value: string, label: string, style: RedactionStyle, keep?: number): string {
  if (style === 'mask' && keep != null) return maskKeepTail(value, keep);
  return `[REDACTED:${label}]`;
}

/** Luhn checksum — used to suppress false positives on 13–19 digit runs. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

interface BuiltinRule {
  id: RedactionRuleId;
  regex: RegExp;
  /** Transform a match into its replacement (null → leave untouched). */
  replace: (match: string, groups: string[], style: RedactionStyle) => string | null;
}

/**
 * Card numbers: 13–19 digits with optional single-character separators
 * between digits, and only masked when the Luhn checksum passes so ordinary
 * numeric fields (job ids, record counts, dates) are left alone.
 */
const CARD_BODY = String.raw`\d(?:[ -]?\d){12,18}`;

const BUILTIN_RULES: readonly BuiltinRule[] = [
  {
    // US SSN: 123-45-6789 (also with dots/spaces separators). The area and
    // group fields must be non-zero (IRS/SSA validity).
    id: 'ssn',
    regex: /\b(?!000|666|9\d\d)([1-9]\d\d)[ \-.]([1-9]\d)[ \-.](\d{4})\b/g,
    replace: (m, _g, style) => styleValue(m, 'SSN', style, 4),
  },
  {
    id: 'credit_card',
    regex: new RegExp(`(?<![\\d.])${CARD_BODY}(?![\\d])`, 'g'),
    replace: (m, _g, style) => (passesLuhn(m.replace(/[ -]/g, '')) ? styleValue(m, 'CREDIT_CARD', style, 4) : null),
  },
  {
    id: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: (m, _g, style) => styleValue(m, 'EMAIL', style),
  },
  {
    // Credential assignments in JCL PARMs, USS configs, and job output:
    // PASSWORD=…, PSWD=…, api_key: …, Authorization: Bearer …
    // The key name and separator are preserved for readability.
    id: 'secrets',
    regex:
      /\b(password|passwd|pswd|pwd|secret|token|apikey|api[_-]key|access[_-]key|authorization)\b(\s*[:=|]\s*)(?!<)(\S{4,})/gi,
    replace: (_m, groups) => `${groups[0]}${groups[1]}[REDACTED:SECRET]`,
  },
  {
    id: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: (m, _g, style) => styleValue(m, 'JWT', style),
  },
  {
    id: 'private_key',
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g,
    replace: (_m, _g, style) => (style === 'mask' ? '-----BEGIN PRIVATE KEY----- ***** -----END PRIVATE KEY-----' : '[REDACTED:PRIVATE_KEY]'),
  },
];

export const DEFAULT_REDACTION_RULES: readonly RedactionRuleId[] = [
  'ssn',
  'credit_card',
  'email',
  'secrets',
  'jwt',
  'private_key',
];

function ruleById(id: RedactionRuleId): BuiltinRule | undefined {
  return BUILTIN_RULES.find((rule) => rule.id === id);
}

/**
 * Mask every configured rule in `text`. The `secrets` rule keeps its key name
 * and separator (`PASSWORD=[REDACTED:SECRET]`) so output stays readable.
 */
export function maskText(text: string, options: RedactionOptions): RedactionResult {
  let out = text;
  let matches = 0;
  const rulesMatched: RedactionRuleId[] = [];

  for (const id of options.rules) {
    const rule = ruleById(id);
    if (!rule) continue;
    let count = 0;
    out = out.replace(rule.regex, (...args: unknown[]) => {
      const match = args[0] as string;
      // Replace callback signature: (match, p1…pN, offset, string, groups?).
      // Capture groups are the string args before the numeric offset.
      const offsetIdx = args.findIndex((a, i) => i > 0 && typeof a === 'number');
      const groups = (offsetIdx === -1 ? args.slice(1) : args.slice(1, offsetIdx)) as string[];
      const replacement = rule.replace(match, groups, options.style);
      if (replacement == null) return match;
      count += 1;
      return replacement;
    });
    if (count > 0) {
      matches += count;
      rulesMatched.push(id);
    }
  }

  return { text: out, matches, rulesMatched };
}

// ---------------------------------------------------------------------------
// Line caps and sampling
// ---------------------------------------------------------------------------

export interface SamplingSpec {
  /** Keep the first `head` lines. */
  head: number;
  /** Keep the last `tail` lines (after the head block). */
  tail: number;
}

export interface ContentCapResult {
  text: string;
  totalLines: number;
  /** true when lines were dropped (cap or sampling). */
  trimmed: boolean;
  /** Human-readable description of what was dropped, for output notices. */
  notice?: string;
}

/** Truncate to `maxLines` lines with an explicit omission notice. */
export function capLines(text: string, maxLines: number): ContentCapResult {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text, totalLines: lines.length, trimmed: false };
  }
  return {
    text: `${lines.slice(0, maxLines).join('\n')}\n... [data protection: showing first ${maxLines} of ${lines.length} lines]`,
    totalLines: lines.length,
    trimmed: true,
    notice: `showing first ${maxLines} of ${lines.length} lines`,
  };
}

/**
 * Head/tail sampling: keep the first `head` and last `tail` lines around an
 * explicit omission marker. When the content fits, the text is untouched.
 */
export function sampleLines(text: string, spec: SamplingSpec): ContentCapResult {
  const lines = text.split(/\r?\n/);
  const head = Math.max(0, spec.head);
  const tail = Math.max(0, spec.tail);
  if (lines.length <= head + tail) {
    return { text, totalLines: lines.length, trimmed: false };
  }
  const omitted = lines.length - head - tail;
  const kept = [
    ...lines.slice(0, head),
    `... [data protection: ${omitted} lines omitted between samples]`,
    ...lines.slice(lines.length - tail),
  ];
  return {
    text: kept.join('\n'),
    totalLines: lines.length,
    trimmed: true,
    notice: `sampled first ${head} + last ${tail} of ${lines.length} lines (${omitted} omitted)`,
  };
}
