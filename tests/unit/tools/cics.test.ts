import {
  assertValidApplid,
  normalizeApplid,
  normalizeCicsStatus,
} from '../../../src/tools/cics/shared.js';
import { ValidationError } from '../../../src/utils/errors.js';

describe('cics/shared', () => {
  describe('normalizeApplid', () => {
    it('converts to uppercase', () => {
      expect(normalizeApplid('cicspay1')).toBe('CICSPAY1');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeApplid('  CICSA  ')).toBe('CICSA');
    });
  });

  describe('assertValidApplid', () => {
    it('accepts a valid 8-char APPLID', () => {
      expect(() => assertValidApplid('CICSPAY1')).not.toThrow();
    });

    it('accepts a short APPLID', () => {
      expect(() => assertValidApplid('CICSA')).not.toThrow();
    });

    it('accepts national characters @, #, $', () => {
      expect(() => assertValidApplid('CICS@PAY')).not.toThrow();
    });

    it('rejects an APPLID longer than 8 characters', () => {
      expect(() => assertValidApplid('CICSPAYROLL')).toThrow(ValidationError);
    });

    it('rejects an empty string', () => {
      expect(() => assertValidApplid('')).toThrow(ValidationError);
    });

    it('rejects an APPLID with invalid characters (spaces)', () => {
      expect(() => assertValidApplid('CICS PAY')).toThrow(ValidationError);
    });

    it('rejects lowercase input (after normalisation still validates length/chars)', () => {
      expect(() => assertValidApplid('cicspayroll')).toThrow(ValidationError);
    });
  });

  describe('normalizeCicsStatus', () => {
    it('canonicalises "ENABLED" to "ACTIVE"', () => {
      expect(normalizeCicsStatus('ENABLED')).toBe('ACTIVE');
    });

    it('canonicalises "DISABLED" to "INACTIVE"', () => {
      expect(normalizeCicsStatus('DISABLED')).toBe('INACTIVE');
    });

    it('canonicalises "active" to "ACTIVE"', () => {
      expect(normalizeCicsStatus('active')).toBe('ACTIVE');
    });

    it('passes through unknown statuses in uppercase', () => {
      expect(normalizeCicsStatus('DRAINING')).toBe('DRAINING');
    });

    it('defaults to "UNKNOWN" for undefined input', () => {
      expect(normalizeCicsStatus(undefined)).toBe('UNKNOWN');
    });
  });
});
