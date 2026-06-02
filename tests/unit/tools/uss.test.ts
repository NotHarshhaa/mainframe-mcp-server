import { normalizeUssEntry } from '../../../src/tools/uss/shared.js';

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
  });
});
