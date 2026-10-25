import {
  parseWriteWindow,
  parseWriteDays,
  assertWithinWriteWindow,
  zonedNow,
} from '../../../src/utils/write-window.js';
import { ForbiddenError, ValidationError } from '../../../src/utils/errors.js';

// 2026-06-15 is a Monday; 2026-06-13 is a Saturday.
const MONDAY_10_UTC = new Date('2026-06-15T10:00:00.000Z');
const MONDAY_20_UTC = new Date('2026-06-15T20:00:00.000Z');
const MONDAY_23_UTC = new Date('2026-06-15T23:00:00.000Z');
const TUESDAY_05_UTC = new Date('2026-06-16T05:00:00.000Z');
const SATURDAY_10_UTC = new Date('2026-06-13T10:00:00.000Z');

describe('parseWriteWindow', () => {
  it('parses a simple window', () => {
    const w = parseWriteWindow('08:00-18:00');
    expect(w).toMatchObject({ startMin: 8 * 60, endMin: 18 * 60, tz: 'UTC' });
    expect(w.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('parses an overnight window with days and timezone', () => {
    const w = parseWriteWindow('22:00-06:00', '1-5', 'Europe/Berlin');
    expect(w.startMin).toBe(22 * 60);
    expect(w.endMin).toBe(6 * 60);
    expect(w.days).toEqual([1, 2, 3, 4, 5]);
    expect(w.tz).toBe('Europe/Berlin');
  });

  it('rejects malformed windows, times, days, and timezones', () => {
    expect(() => parseWriteWindow('8am-6pm')).toThrow(ValidationError);
    expect(() => parseWriteWindow('25:00-26:00')).toThrow(ValidationError);
    expect(() => parseWriteWindow('08:00-18:00', '9-5')).toThrow(ValidationError);
    expect(() => parseWriteWindow('08:00-18:00', undefined, 'Mars/Olympus')).toThrow(ValidationError);
  });

  it('parses mixed day expressions', () => {
    expect(parseWriteDays('0,2-4')).toEqual([0, 2, 3, 4]);
  });
});

describe('zonedNow', () => {
  it('converts an instant into the requested timezone', () => {
    // 10:00Z is 12:00 in Berlin (CEST, summer 2026).
    expect(zonedNow(MONDAY_10_UTC, 'Europe/Berlin')).toEqual({ minutes: 12 * 60, day: 1 });
    expect(zonedNow(MONDAY_10_UTC, 'UTC')).toEqual({ minutes: 10 * 60, day: 1 });
    // 23:00Z Monday is 19:00 Monday in New York (EDT, UTC-4 in summer).
    expect(zonedNow(MONDAY_23_UTC, 'America/New_York')).toEqual({ minutes: 19 * 60, day: 1 });
  });
});

describe('assertWithinWriteWindow', () => {
  it('passes inside the window', () => {
    const w = parseWriteWindow('08:00-18:00');
    expect(() => assertWithinWriteWindow(w, MONDAY_10_UTC)).not.toThrow();
  });

  it('throws outside the window', () => {
    const w = parseWriteWindow('08:00-18:00');
    expect(() => assertWithinWriteWindow(w, MONDAY_20_UTC)).toThrow(ForbiddenError);
    expect(() => assertWithinWriteWindow(w, MONDAY_20_UTC)).toThrow(/change window/);
  });

  it('supports overnight windows', () => {
    const w = parseWriteWindow('22:00-06:00');
    expect(() => assertWithinWriteWindow(w, MONDAY_23_UTC)).not.toThrow();
    expect(() => assertWithinWriteWindow(w, TUESDAY_05_UTC)).not.toThrow();
    expect(() => assertWithinWriteWindow(w, MONDAY_10_UTC)).toThrow(ForbiddenError);
  });

  it('enforces the weekday list', () => {
    const w = parseWriteWindow('00:00-23:59', '1-5');
    expect(() => assertWithinWriteWindow(w, MONDAY_10_UTC)).not.toThrow();
    expect(() => assertWithinWriteWindow(w, SATURDAY_10_UTC)).toThrow(ForbiddenError);
  });

  it('evaluates the window in the configured timezone', () => {
    // Window 08:00-18:00 Berlin (CEST). 10:00Z = 12:00 Berlin → inside.
    const w = parseWriteWindow('08:00-18:00', undefined, 'Europe/Berlin');
    expect(() => assertWithinWriteWindow(w, MONDAY_10_UTC)).not.toThrow();
    // 20:00Z = 22:00 Berlin → outside.
    expect(() => assertWithinWriteWindow(w, MONDAY_20_UTC)).toThrow(ForbiddenError);
  });
});
