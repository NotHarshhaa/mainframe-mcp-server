import { buildDatasetPattern, globToRegExp } from '../../../src/utils/glob.js';

describe('glob', () => {
  describe('globToRegExp', () => {
    it('matches wildcard patterns case-insensitively when requested', () => {
      const regex = globToRegExp('pay*', { caseInsensitive: true });
      expect(regex.test('PAYJOB')).toBe(true);
      expect(regex.test('OTHER')).toBe(false);
    });

    it('treats ? as a single character', () => {
      const regex = globToRegExp('IKJ??T01');
      expect(regex.test('IKJEFT01')).toBe(true);
      expect(regex.test('IKJEF001')).toBe(false);
    });
  });

  describe('buildDatasetPattern', () => {
    it('appends .* when only an HLQ is given', () => {
      expect(buildDatasetPattern('SYS1')).toBe('SYS1.*');
    });

    it('joins HLQ and lower-qualifier pattern', () => {
      expect(buildDatasetPattern('SYS1', 'PROC*')).toBe('SYS1.PROC*');
    });

    it('preserves a full wildcard HLQ', () => {
      expect(buildDatasetPattern('USER.*')).toBe('USER.*');
    });
  });
});
