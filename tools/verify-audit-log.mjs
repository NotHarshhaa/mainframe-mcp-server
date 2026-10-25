#!/usr/bin/env node
/**
 * Tamper-evidence verifier for mainframe-mcp-server audit logs.
 *
 * Recomputes the SHA-256 hash chain over an NDJSON audit file (as written by
 * SECURITY_AUDIT_FILE) and reports the first broken link, if any.
 *
 * Usage:
 *   node tools/verify-audit-log.mjs <audit.ndjson> [<more.ndjson> ...]
 *
 * Exit codes: 0 = intact, 1 = chain broken or file unreadable.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GENESIS_LABEL = 'mainframe-mcp-server:audit:genesis';

function hashRecord(record) {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function verify(lines) {
  let prevHash = createHash('sha256').update(GENESIS_LABEL).digest('hex');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    count += 1;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      return { records: count, intact: false, brokenAtSeq: count, reason: 'unparseable JSON line' };
    }
    const { hash, ...rest } = record;
    if (hash !== hashRecord(rest)) {
      return { records: count, intact: false, brokenAtSeq: record.seq ?? count, reason: 'record hash mismatch (content was modified)' };
    }
    if (record.prevHash !== prevHash) {
      return { records: count, intact: false, brokenAtSeq: record.seq ?? count, reason: 'previous-hash link mismatch (records were inserted, deleted, or reordered)' };
    }
    prevHash = hash;
  }
  return { records: count, intact: true };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write('Usage: node tools/verify-audit-log.mjs <audit.ndjson> [...]\n');
  process.exit(1);
}

let broken = false;
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`${file}: unreadable — ${err.message}`);
    broken = true;
    continue;
  }
  const result = verify(content.split('\n'));
  if (result.intact) {
    console.log(`${file}: OK — ${result.records} record(s), hash chain intact.`);
  } else {
    console.error(
      `${file}: TAMPERED — first break at record seq=${result.brokenAtSeq} (${result.reason}). ` +
        'The log has been modified, truncated, or corrupted.',
    );
    broken = true;
  }
}
process.exit(broken ? 1 : 0);
