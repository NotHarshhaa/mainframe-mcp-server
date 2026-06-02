import {
  allAbendCodes,
  extractAbendCode,
  lookupAbend,
  normalizeAbendCode,
  searchAbendCodes,
} from '../../../src/utils/abend-codes.js';

describe('abend-codes', () => {
  describe('normalizeAbendCode', () => {
    it('uppercases and trims', () => {
      expect(normalizeAbendCode('  s806 ')).toBe('S806');
    });

    it('prefixes bare hex codes with S', () => {
      expect(normalizeAbendCode('0C7')).toBe('S0C7');
      expect(normalizeAbendCode('806')).toBe('S806');
    });

    it('leaves user codes intact', () => {
      expect(normalizeAbendCode('u0100')).toBe('U0100');
    });
  });

  describe('lookupAbend', () => {
    it('finds a known system code', () => {
      const info = lookupAbend('S0C7');
      expect(info).toBeDefined();
      expect(info?.category).toBe('system');
      expect(info?.title).toMatch(/data exception/i);
    });

    it('finds a code by bare hex', () => {
      expect(lookupAbend('806')?.code).toBe('S806');
    });

    it('returns undefined for unknown codes', () => {
      expect(lookupAbend('SZZZ')).toBeUndefined();
    });
  });

  describe('extractAbendCode', () => {
    it('extracts an abend code from a spool line', () => {
      const line = 'IEF450I PAYJOB01 STEP030 - ABEND S806 U0000';
      expect(extractAbendCode(line)).toBe('S806');
    });

    it('extracts a data exception code', () => {
      expect(extractAbendCode('SYSTEM COMPLETION CODE=0C7')).toBe('S0C7');
    });

    it('returns null when no code is present', () => {
      expect(extractAbendCode('JOB ENDED NORMALLY')).toBeNull();
    });
  });

  describe('allAbendCodes', () => {
    it('returns a non-empty, well-formed list', () => {
      const all = allAbendCodes();
      expect(all.length).toBeGreaterThan(5);
      for (const entry of all) {
        expect(entry.code).toMatch(/^[SU]/);
        expect(entry.suggestedFix.length).toBeGreaterThan(0);
      }
    });
  });

  describe('searchAbendCodes', () => {
    it('returns all codes sorted when no query is given', () => {
      const results = searchAbendCodes();
      expect(results.length).toBeGreaterThan(5);
      expect(results[0].code.localeCompare(results[1].code)).toBeLessThanOrEqual(0);
    });

    it('finds codes by partial code match', () => {
      const results = searchAbendCodes('806');
      expect(results.some((entry) => entry.code === 'S806')).toBe(true);
    });

    it('finds codes by title keyword', () => {
      const results = searchAbendCodes('data exception');
      expect(results.some((entry) => entry.code === 'S0C7')).toBe(true);
    });
  });
});
