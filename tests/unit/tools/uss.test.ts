import {
  normalizeUssEntry,
  normalizePath,
  sortUssEntries,
  validateAbsolutePath,
} from '../../../src/tools/uss/shared.js';
import { ValidationError } from '../../../src/utils/errors.js';
import type { UssEntry } from '../../../src/types/zos.js';

function makeEntry(overrides: Partial<UssEntry>): UssEntry {
  return {
    name: 'run.log',
    type: 'file',
    ...overrides,
  };
}

describe('uss/shared', () => {
  describe('normalizeUssEntry', () => {
    it('classifies a regular file', () => {
      const entry = normalizeUssEntry({
        name: 'run.log',
        mode: '-rw-r--r--',
        size: 1024,
        user: 'PAYUSR',
        group: 'PAYGRP',
      });
      expect(entry.type).toBe('file');
      expect(entry.size).toBe(1024);
      expect(entry.user).toBe('PAYUSR');
    });

    it('classifies a directory', () => {
      const entry = normalizeUssEntry({ name: 'logs', mode: 'drwxr-xr-x' });
      expect(entry.type).toBe('directory');
    });

    it('classifies a symlink', () => {
      const entry = normalizeUssEntry({ name: 'current', mode: 'lrwxrwxrwx' });
      expect(entry.type).toBe('symlink');
    });

    it('falls back to "other" for unknown mode', () => {
      const entry = normalizeUssEntry({ name: 'x', mode: undefined });
      expect(entry.type).toBe('other');
    });

    it('maps symlink target from target field', () => {
      const entry = normalizeUssEntry({ name: 'current', mode: 'lrwxrwxrwx', target: '/u/payroll/v2' });
      expect(entry.target).toBe('/u/payroll/v2');
    });

    it('maps symlink target from linkTarget fallback field', () => {
      const entry = normalizeUssEntry({ name: 'current', mode: 'lrwxrwxrwx', linkTarget: '/u/payroll/v2' } as any);
      expect(entry.target).toBe('/u/payroll/v2');
    });

    it('maps inode from id field', () => {
      const entry = normalizeUssEntry({ name: 'script.sh', mode: '-rwxr-xr-x', id: 98765 } as any);
      expect(entry.inode).toBe(98765);
    });

    it('maps mtime to modified', () => {
      const entry = normalizeUssEntry({ name: 'data.csv', mtime: '2026-06-01T14:30:00Z' });
      expect(entry.modified).toBe('2026-06-01T14:30:00Z');
    });

    it('leaves target and inode undefined when not provided', () => {
      const entry = normalizeUssEntry({ name: 'plain.txt', mode: '-rw-r--r--' });
      expect(entry.target).toBeUndefined();
      expect(entry.inode).toBeUndefined();
    });
  });

  describe('normalizePath', () => {
    it('trims whitespace', () => {
      expect(normalizePath('  /u/payroll  ')).toBe('/u/payroll');
    });

    it('strips a trailing slash from non-root paths', () => {
      expect(normalizePath('/u/payroll/')).toBe('/u/payroll');
    });

    it('preserves root path "/" unchanged', () => {
      expect(normalizePath('/')).toBe('/');
    });

    it('handles deep paths with trailing slash', () => {
      expect(normalizePath('/u/payroll/logs/')).toBe('/u/payroll/logs');
    });

    it('does not strip slash from plain root path', () => {
      expect(normalizePath('/  ')).toBe('/');
    });
  });

  describe('validateAbsolutePath', () => {
    it('accepts a valid absolute path', () => {
      expect(() => validateAbsolutePath('/u/payroll')).not.toThrow();
    });

    it('accepts root path "/"', () => {
      expect(() => validateAbsolutePath('/')).not.toThrow();
    });

    it('accepts deep nested path', () => {
      expect(() => validateAbsolutePath('/u/payroll/scripts/run.sh')).not.toThrow();
    });

    it('rejects a relative path (no leading slash)', () => {
      expect(() => validateAbsolutePath('u/payroll')).toThrow(ValidationError);
    });

    it('rejects an empty string', () => {
      expect(() => validateAbsolutePath('')).toThrow(ValidationError);
    });

    it('rejects a whitespace-only string', () => {
      expect(() => validateAbsolutePath('   ')).toThrow(ValidationError);
    });

    it('rejects paths with directory traversal (/../)', () => {
      expect(() => validateAbsolutePath('/u/payroll/../secret')).toThrow(ValidationError);
    });

    it('rejects paths ending with /..',  () => {
      expect(() => validateAbsolutePath('/u/payroll/..')).toThrow(ValidationError);
    });
  });

  describe('sortUssEntries', () => {
    const entries: UssEntry[] = [
      makeEntry({ name: 'zebra.log', type: 'file', size: 500, modified: '2026-06-01' }),
      makeEntry({ name: 'apple.sh', type: 'file', size: 1200, modified: '2026-05-15' }),
      makeEntry({ name: 'logs', type: 'directory', size: undefined, modified: '2026-06-03' }),
      makeEntry({ name: 'current', type: 'symlink', size: 0, modified: '2026-01-01' }),
    ];

    it('sorts alphabetically by name (default)', () => {
      const sorted = sortUssEntries(entries, 'name');
      expect(sorted.map((e) => e.name)).toEqual(['apple.sh', 'current', 'logs', 'zebra.log']);
    });

    it('sorts by size largest first (undefined sizes go to bottom)', () => {
      const sorted = sortUssEntries(entries, 'size');
      expect(sorted[0].name).toBe('apple.sh'); // size 1200
      expect(sorted[1].name).toBe('zebra.log'); // size 500
    });

    it('sorts by modified newest first', () => {
      const sorted = sortUssEntries(entries, 'modified');
      expect(sorted[0].name).toBe('logs');   // 2026-06-03 newest
      expect(sorted[3].name).toBe('current'); // 2026-01-01 oldest
    });

    it('sorts by type — directories first, then files, symlinks, other', () => {
      const sorted = sortUssEntries(entries, 'type');
      expect(sorted[0].type).toBe('directory');
      expect(sorted[1].type).toBe('file');
    });

    it('does not mutate the original array', () => {
      const original = [...entries];
      sortUssEntries(entries, 'size');
      expect(entries.map((e) => e.name)).toEqual(original.map((e) => e.name));
    });
  });
});
