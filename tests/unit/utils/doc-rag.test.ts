import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DocIndex,
  chunkDocument,
  collectDocFiles,
  createDocIndexFromConfig,
  formatDocExcerpts,
  tokenize,
} from '../../../src/utils/doc-rag.js';

describe('utils/doc-rag', () => {
  describe('tokenize', () => {
    it('lowercases, splits on non-word chars, and drops stopwords/single chars', () => {
      expect(tokenize('The S0C7 Abend in PROD.PAYROLL!')).toEqual(['s0c7', 'abend', 'prod', 'payroll']);
      expect(tokenize('the of and x')).toEqual([]);
    });
  });

  describe('chunkDocument', () => {
    it('splits at markdown headings and keeps heading attribution', () => {
      const doc = [
        '# Runbook S0C7',
        'Fix packed decimal data first.',
        '',
        '## Verification',
        'Run NUMCHECK on the failing compile unit.',
      ].join('\n');
      const chunks = chunkDocument('runbook.md', doc);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({ source: 'runbook.md', heading: 'Runbook S0C7' });
      expect(chunks[0].text).toContain('packed decimal');
      expect(chunks[1].heading).toBe('Verification');
    });

    it('splits oversized sections at paragraph boundaries', () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${'detail '.repeat(30)}`);
      const chunks = chunkDocument('big.md', paragraphs.join('\n\n'));
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(2000);
      }
    });

    it('returns an empty list for empty content', () => {
      expect(chunkDocument('empty.md', '')).toEqual([]);
    });
  });

  describe('collectDocFiles', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'docrag-'));
      writeFileSync(join(dir, 'runbook.md'), '# Runbook\ncontent');
      writeFileSync(join(dir, 'notes.txt'), 'notes');
      writeFileSync(join(dir, 'skip.exe'), 'binary');
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'nested.md'), '# Nested');
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', 'dep.md'), '# Dep');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('collects .md/.txt recursively, skipping dot dirs, node_modules, and non-doc files', () => {
      const files = collectDocFiles([dir]);
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.endsWith('runbook.md'))).toBe(true);
      expect(files.some((f) => f.endsWith('notes.txt'))).toBe(true);
      expect(files.some((f) => f.endsWith('nested.md'))).toBe(true);
      expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    });

    it('silently skips missing sources', () => {
      const files = collectDocFiles([join(dir, 'missing-dir'), join(dir, 'runbook.md')]);
      expect(files).toHaveLength(1);
    });
  });

  describe('DocIndex', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'docrag-idx-'));
      writeFileSync(
        join(dir, 's0c7.md'),
        [
          '# S0C7 data exception runbook',
          'S0C7 means packed-decimal data was invalid. Initialize numeric fields and run NUMCHECK.',
          '',
          'Payroll jobs hitting S0C7 usually have spaces in a COMP-3 field from the new input feed.',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 's806.md'),
        ['# S806 module not found', 'S806 means the load module was not found in STEPLIB or JOBLIB.', '', 'Check the linkage and module availability.'].join('\n'),
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('indexes chunks and ranks the relevant document first', () => {
      const index = new DocIndex([dir], 0);
      expect(index.size).toBeGreaterThan(0);
      const matches = index.search('payroll S0C7 packed decimal invalid', 2);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].chunk.source).toContain('s0c7.md');
      expect(matches[0].score).toBeGreaterThan(0);
    });

    it('returns [] for an empty query or an empty index', () => {
      const empty = new DocIndex([join(dir, 'does-not-exist')], 0);
      expect(empty.search('anything', 3)).toEqual([]);
      expect(new DocIndex([dir], 0).search('   ', 3)).toEqual([]);
    });

    it('reports missing sources', () => {
      const index = new DocIndex([join(dir, 'nope')], 0);
      index.maybeRefresh();
      expect(index.missing).toHaveLength(1);
      expect(index.missing[0]).toContain('nope');
    });
  });

  describe('createDocIndexFromConfig', () => {
    it('returns undefined when no sources are configured', () => {
      expect(createDocIndexFromConfig({ docs: { refreshSeconds: 0 } })).toBeUndefined();
      expect(createDocIndexFromConfig({ docs: { sources: ' , ', refreshSeconds: 0 } })).toBeUndefined();
    });

    it('builds an index from a comma-separated source list', () => {
      const dir = mkdtempSync(join(tmpdir(), 'docrag-cfg-'));
      try {
        writeFileSync(join(dir, 'a.md'), 'alpha content');
        const index = createDocIndexFromConfig({ docs: { sources: dir, refreshSeconds: 0 } });
        expect(index).toBeDefined();
        expect(index!.size).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('formatDocExcerpts', () => {
    it('numbers excerpts with source+heading labels and caps excerpt length', () => {
      const text = formatDocExcerpts(
        [
          { chunk: { source: 'docs/s0c7.md', heading: 'Runbook', text: 'short excerpt' }, score: 0.9 },
          { chunk: { source: 'docs/other.md', text: 'x'.repeat(50) }, score: 0.5 },
        ],
        20,
      );
      expect(text).toContain('1. docs/s0c7.md — Runbook');
      expect(text).toContain('short excerpt');
      expect(text).toContain('2. docs/other.md');
      expect(text).toContain('xxxxxxxxxxxxxxxxxxxx…');
    });
  });
});
