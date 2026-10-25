import { maskText, capLines, sampleLines, passesLuhn, DEFAULT_REDACTION_RULES } from '../../../src/utils/redaction.js';

const all = { rules: DEFAULT_REDACTION_RULES, style: 'mask' as const };

describe('passesLuhn', () => {
  it('accepts a valid card number', () => {
    expect(passesLuhn('4111111111111111')).toBe(true);
    expect(passesLuhn('5500005555555559')).toBe(true);
  });
  it('rejects invalid digit runs', () => {
    expect(passesLuhn('4111111111111112')).toBe(false);
    expect(passesLuhn('1234567890123')).toBe(false);
  });
});

describe('maskText — ssn', () => {
  it('masks grouped SSNs keeping the last four digits', () => {
    const { text, matches, rulesMatched } = maskText('Employee SSN: 123-45-6789 filed.', all);
    expect(text).toContain('*******6789');
    expect(text).not.toContain('123-45-6789');
    expect(matches).toBe(1);
    expect(rulesMatched).toEqual(['ssn']);
  });
  it('rejects invalid area/group fields (000, 666, 9xx)', () => {
    expect(maskText('SSN 000-45-6789', all).matches).toBe(0);
    expect(maskText('SSN 666-45-6789', all).matches).toBe(0);
    expect(maskText('SSN 900-45-6789', all).matches).toBe(0);
  });
  it('token style replaces fully', () => {
    const { text } = maskText('SSN: 123-45-6789', { rules: ['ssn'], style: 'token' });
    expect(text).toContain('[REDACTED:SSN]');
    expect(text).not.toContain('6789');
  });
});

describe('maskText — credit_card', () => {
  it('masks Luhn-valid card numbers with separators', () => {
    const { text, matches } = maskText('Card: 4111 1111 1111 1111', { rules: ['credit_card'], style: 'mask' });
    expect(matches).toBe(1);
    expect(text).toContain('***************1111');
    expect(text).not.toContain('4111 1111');
  });
  it('ignores numeric runs that fail the Luhn check', () => {
    // Dates, job numbers, record counts must survive.
    const { matches } = maskText('2026 10 25 JOB 12345 RECORDS 4111111111111112', { rules: ['credit_card'], style: 'mask' });
    expect(matches).toBe(0);
  });
});

describe('maskText — email', () => {
  it('masks email addresses', () => {
    const { text, matches } = maskText('Contact ops@example.com now', all);
    expect(text).not.toContain('ops@example.com');
    expect(matches).toBe(1);
  });
});

describe('maskText — secrets', () => {
  it('masks PASSWORD= assignments in JCL, keeping the key', () => {
    const { text, matches } = maskText("// PARM='PSWD=HUNTER2 X=1'", all);
    expect(text).toContain('PSWD=[REDACTED:SECRET]');
    expect(text).not.toContain('HUNTER2');
    expect(matches).toBe(1);
  });
  it('masks api_key and Authorization headers', () => {
    expect(maskText('api_key: abcd1234efgh', all).matches).toBe(1);
    expect(maskText('Authorization: Bearer abcdef123456', all).matches).toBe(1);
  });
});

describe('maskText — jwt and private_key', () => {
  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const { text, matches } = maskText(`token=${jwt}`, { rules: ['jwt'], style: 'token' });
    expect(matches).toBe(1);
    expect(text).toContain('[REDACTED:JWT]');
  });
  it('masks PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----';
    const { text, matches } = maskText(`cert: ${pem}`, all);
    expect(matches).toBe(1);
    expect(text).not.toContain('MIIEow');
  });
});

describe('capLines', () => {
  it('leaves short content untouched', () => {
    const result = capLines('a\nb\nc', 5);
    expect(result.text).toBe('a\nb\nc');
    expect(result.trimmed).toBe(false);
  });
  it('caps with an explicit notice', () => {
    const result = capLines(['l1', 'l2', 'l3', 'l4', 'l5'].join('\n'), 2);
    expect(result.text).toContain('l1');
    expect(result.text).not.toContain('l5');
    expect(result.text).toContain('showing first 2 of 5 lines');
    expect(result.trimmed).toBe(true);
  });
});

describe('sampleLines', () => {
  it('keeps head and tail with an omission marker', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    const result = sampleLines(lines.join('\n'), { head: 5, tail: 3 });
    expect(result.text).toContain('line-1');
    expect(result.text).toContain('line-100');
    expect(result.text).not.toContain('line-50\n');
    expect(result.text).toContain('92 lines omitted');
    expect(result.trimmed).toBe(true);
  });
  it('leaves content that fits untouched', () => {
    const result = sampleLines('a\nb\nc', { head: 5, tail: 5 });
    expect(result.trimmed).toBe(false);
    expect(result.text).toBe('a\nb\nc');
  });
});
