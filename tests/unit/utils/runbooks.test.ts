import { findRunbookUrl, parseRunbooks } from '../../../src/utils/runbooks.js';

describe('utils/runbooks', () => {
  describe('parseRunbooks', () => {
    it('returns an empty list for undefined/blank config', () => {
      expect(parseRunbooks(undefined)).toEqual([]);
      expect(parseRunbooks('')).toEqual([]);
      expect(parseRunbooks('   ')).toEqual([]);
    });

    it('parses a JSON map into ordered entries with uppercased patterns', () => {
      const links = parseRunbooks('{"s0c7":"https://rb/s0c7","S2*":"https://rb/s2xx"}');
      expect(links).toEqual([
        { pattern: 'S0C7', url: 'https://rb/s0c7' },
        { pattern: 'S2*', url: 'https://rb/s2xx' },
      ]);
    });

    it('drops entries whose URL is not a non-empty string', () => {
      const links = parseRunbooks('{"S0C4":"https://rb/s0c4","S0C7":""}');
      expect(links).toHaveLength(1);
      expect(links[0].pattern).toBe('S0C4');
    });

    it('throws on malformed JSON', () => {
      expect(() => parseRunbooks('not json')).toThrow();
      expect(() => parseRunbooks('["S0C4"]')).toThrow(/JSON object/);
    });
  });

  describe('findRunbookUrl', () => {
    const links = parseRunbooks(
      '{"S0C7":"https://rb/s0c7","S2*":"https://rb/s2xx","U*":"https://rb/user-abends"}',
    );

    it('matches an exact code first', () => {
      expect(findRunbookUrl('S0C7', links)).toBe('https://rb/s0c7');
    });

    it('matches a glob pattern when no exact entry exists', () => {
      expect(findRunbookUrl('S222', links)).toBe('https://rb/s2xx');
      expect(findRunbookUrl('U4038', links)).toBe('https://rb/user-abends');
    });

    it('is case-insensitive and tolerant of whitespace', () => {
      expect(findRunbookUrl(' s0c7 ', links)).toBe('https://rb/s0c7');
    });

    it('returns undefined for unmatched and nullish codes', () => {
      expect(findRunbookUrl('S806', links)).toBeUndefined();
      expect(findRunbookUrl(null, links)).toBeUndefined();
      expect(findRunbookUrl(undefined, links)).toBeUndefined();
      expect(findRunbookUrl('S0C7', [])).toBeUndefined();
    });
  });
});
