/**
 * RAG over internal documentation.
 *
 * Indexes a set of local .md/.txt playbooks (DOCS_SOURCES: files or
 * directories, walked recursively) into sentence-ish chunks and retrieves
 * the most relevant excerpts for a query. Retrieval is local TF-IDF with
 * cosine similarity — no external embedding service, and document contents
 * never leave the host. This is deliberately lightweight: it grounds abend
 * lookups and incident bundles in the organization's own runbooks and
 * troubleshooting notes, alongside the built-in abend reference.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import type { Logger } from 'pino';

/** One indexed piece of documentation. */
export interface DocChunk {
  /** Absolute (or configured) file path the chunk came from. */
  source: string;
  /** Nearest preceding markdown heading, when present. */
  heading?: string;
  /** Chunk text. */
  text: string;
}

/** A retrieval hit. */
export interface DocMatch {
  chunk: DocChunk;
  /** Cosine similarity score in [0, 1]. */
  score: number;
}

/** Files larger than this are skipped (protects memory on runaway paths). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Hard cap on indexed chunks across all sources. */
const MAX_CHUNKS = 5000;
/** Target chunk size in characters; long sections are split at paragraph breaks. */
const TARGET_CHUNK_CHARS = 1200;
/** Directories never descended into. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.zcode']);

const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

/** Minimal English stopword set for tokenization. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'if', 'in', 'into', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'our',
  'she', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your', 'do',
  'does', 'did', 'can', 'cannot', 'how', 'i', 'no', 'yes', 'up', 'out', 'about', 'also',
]);

/** Tokenize text into lowercase terms, dropping stopwords and single chars. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9#@$_]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

/**
 * Chunk a markdown/text document: split at headings first, then split long
 * sections at paragraph boundaries so chunks stay near TARGET_CHUNK_CHARS.
 */
export function chunkDocument(source: string, content: string): DocChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text.length === 0) return;
    if (text.length <= TARGET_CHUNK_CHARS) {
      chunks.push({ source, ...(heading ? { heading } : {}), text });
      return;
    }
    // Split oversized sections at blank-line paragraph boundaries.
    let current: string[] = [];
    let currentLen = 0;
    for (const line of text.split('\n')) {
      current.push(line);
      currentLen += line.length + 1;
      const atParagraph = line.trim() === '';
      if ((atParagraph && currentLen >= TARGET_CHUNK_CHARS / 2) || currentLen >= TARGET_CHUNK_CHARS) {
        const part = current.join('\n').trim();
        if (part.length > 0) chunks.push({ source, ...(heading ? { heading } : {}), text: part });
        current = [];
        currentLen = 0;
      }
    }
    const rest = current.join('\n').trim();
    if (rest.length > 0) chunks.push({ source, ...(heading ? { heading } : {}), text: rest });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[2].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}

/** Recursively collect documentation files from a comma-separated source list. */
export function collectDocFiles(sources: string[]): string[] {
  const files: string[] = [];
  const walk = (entry: string): void => {
    let stats;
    try {
      stats = statSync(entry);
    } catch {
      return; // Missing source entries are skipped; callers warn.
    }
    if (stats.isFile()) {
      if (DOC_EXTENSIONS.has(extname(entry).toLowerCase())) files.push(entry);
      return;
    }
    if (!stats.isDirectory()) return;
    for (const name of readdirSync(entry)) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      walk(join(entry, name));
    }
  };
  for (const source of sources) walk(source.trim());
  return files.sort();
}

/** Sparse term vector: term → weight. */
type TermVector = Map<string, number>;

function termVector(text: string, idf: Map<string, number>): TermVector {
  const counts = new Map<string, number>();
  const terms = tokenize(text);
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const vector: TermVector = new Map();
  const norm = Math.sqrt(terms.length) || 1;
  for (const [term, count] of counts) {
    vector.set(term, ((count / terms.length) * (idf.get(term) ?? 1)) / norm);
  }
  return vector;
}

function cosine(a: TermVector, b: TermVector): number {
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) dot += weight * other;
  }
  return dot; // Both vectors are unit-length.
}

/**
 * A searchable documentation index. Build once (lazily) and re-index on
 * demand after `refreshSeconds` so edited playbooks are picked up without a
 * server restart (0 disables refresh).
 */
export class DocIndex {
  private chunks: DocChunk[] = [];
  private vectors: TermVector[] = [];
  private idf: Map<string, number> = new Map();
  private builtAt = 0;
  private missingSources = new Set<string>();

  constructor(
    private readonly sources: string[],
    private readonly refreshSeconds: number,
    private readonly logger?: Logger,
  ) {}

  /** Number of indexed chunks (builds the index on first access). */
  get size(): number {
    this.maybeRefresh();
    return this.chunks.length;
  }

  /** Source paths that did not resolve on the last build (for warnings). */
  get missing(): string[] {
    return [...this.missingSources];
  }

  /** Rebuild the index if it is stale (or not built yet). */
  maybeRefresh(): void {
    const age = (Date.now() - this.builtAt) / 1000;
    if (this.builtAt !== 0 && age < this.refreshSeconds) return;
    this.build();
  }

  /** (Re)build the index from the configured sources. */
  build(): void {
    const files = collectDocFiles(this.sources);
    // Missing = configured sources that matched no collected file (compare
    // resolved paths so separators match on both POSIX and Windows).
    const missing = new Set<string>();
    for (const raw of this.sources) {
      const source = raw.trim();
      if (source === '') continue;
      const resolvedSource = resolve(source);
      const matched = files.some((f) => {
        const resolvedFile = resolve(f);
        return resolvedFile === resolvedSource || resolvedFile.startsWith(resolvedSource + sep);
      });
      if (!matched) missing.add(source);
    }
    this.missingSources = missing;

    const chunks: DocChunk[] = [];
    const df = new Map<string, number>();
    for (const file of files) {
      if (chunks.length >= MAX_CHUNKS) break;
      let content: string;
      try {
        const stats = statSync(file);
        if (stats.size > MAX_FILE_BYTES) {
          this.logger?.debug({ file, size: stats.size }, 'doc-rag: skipping oversized file');
          continue;
        }
        content = readFileSync(file, 'utf8');
      } catch (err) {
        this.logger?.debug({ file, err }, 'doc-rag: unreadable file skipped');
        continue;
      }
      for (const chunk of chunkDocument(file, content)) {
        if (chunks.length >= MAX_CHUNKS) break;
        const seen = new Set<string>();
        for (const term of new Set(tokenize(chunk.text))) {
          if (!seen.has(term)) {
            df.set(term, (df.get(term) ?? 0) + 1);
            seen.add(term);
          }
        }
        chunks.push(chunk);
      }
    }

    // Smoothed idf; terms appearing in every document still carry weight.
    const n = Math.max(chunks.length, 1);
    this.idf = new Map([...df.entries()].map(([term, count]) => [term, Math.log((n + 1) / (count + 1)) + 1]));
    this.vectors = chunks.map((chunk) => termVector(chunk.text, this.idf));
    this.chunks = chunks;
    this.builtAt = Date.now();
    if (this.missingSources.size > 0) {
      this.logger?.warn(
        { missing: [...this.missingSources] },
        'doc-rag: some DOCS_SOURCES entries resolved to no files',
      );
    }
    this.logger?.debug(
      { files: files.length, chunks: this.chunks.length },
      'doc-rag: index built',
    );
  }

  /**
   * Retrieve the top-k chunks for a query. Returns [] when the index is
   * empty or nothing scores above zero.
   */
  search(query: string, maxResults: number): DocMatch[] {
    this.maybeRefresh();
    if (this.chunks.length === 0 || query.trim() === '') return [];
    const queryVector = termVector(query, this.idf);
    if (queryVector.size === 0) return [];
    const scored: DocMatch[] = [];
    for (let i = 0; i < this.chunks.length; i++) {
      const score = cosine(queryVector, this.vectors[i]);
      if (score > 0) scored.push({ chunk: this.chunks[i], score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
}

/**
 * Render retrieval hits as bounded excerpts with source attribution:
 *
 *   1. runbooks/abend-s0c7.md — Handling S0C4 Data Exceptions
 *   <excerpt>
 */
export function formatDocExcerpts(matches: DocMatch[], maxExcerptChars: number): string {
  return matches
    .map((match, index) => {
      const label = match.chunk.heading
        ? `${match.chunk.source} — ${match.chunk.heading}`
        : match.chunk.source;
      const text =
        match.chunk.text.length > maxExcerptChars
          ? `${match.chunk.text.slice(0, maxExcerptChars)}…`
          : match.chunk.text;
      return `${index + 1}. ${label}\n${text}`;
    })
    .join('\n\n');
}

/**
 * Build a DocIndex from config. Returns undefined when DOCS_SOURCES is not
 * configured so callers can skip RAG sections entirely.
 */
export function createDocIndexFromConfig(
  config: { docs: { sources?: string; refreshSeconds: number } },
  logger?: Logger,
): DocIndex | undefined {
  const sources = (config.docs.sources ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (sources.length === 0) return undefined;
  return new DocIndex(sources, config.docs.refreshSeconds, logger);
}
