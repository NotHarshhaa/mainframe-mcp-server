import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditLogger, redactAuditArgs, verifyAuditChain, type AuditEvent } from '../../../src/utils/audit.js';
import { createLogger } from '../../../src/utils/logger.js';

const logger = createLogger({ level: 'silent' });

function baseEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    tool: 'read_dataset',
    user: 'OPSUSR',
    transport: 'stdio',
    environment: 'prod',
    host: 'zosmf.example.com',
    correlationId: 'corr-1',
    arguments: { dsn: 'PROD.DATA' },
    outcome: 'success',
    durationMs: 12,
    resultChars: 100,
    ...overrides,
  };
}

describe('redactAuditArgs', () => {
  it('redacts sensitive keys', () => {
    const out = redactAuditArgs({ password: 'x', token: 'y', nested: { apiKey: 'z' } }) as Record<string, unknown>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
  });
  it('elides long strings and keeps short values', () => {
    const out = redactAuditArgs({ dsn: 'PROD.DATA', jcl: 'x'.repeat(600) }) as Record<string, unknown>;
    expect(out.dsn).toBe('PROD.DATA');
    expect(String(out.jcl)).toMatch(/\[\d+ bytes\]/);
  });
  it('passes through arrays and primitives', () => {
    expect(redactAuditArgs([1, 'a'])).toEqual([1, 'a']);
    expect(redactAuditArgs(5)).toBe(5);
  });
});

describe('audit hash chain (file sink)', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-audit-'));
    file = join(dir, 'audit.ndjson');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a verifiable hash chain', () => {
    const audit = createAuditLogger({ sinks: { file } }, logger);
    audit.record(baseEvent({ correlationId: 'c1' }));
    audit.record(baseEvent({ correlationId: 'c2', outcome: 'blocked', errorCode: 'FORBIDDEN' }));
    audit.record(baseEvent({ correlationId: 'c3', outcome: 'error' }));

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const result = verifyAuditChain(lines);
    expect(result.intact).toBe(true);
    expect(result.records).toBe(3);

    const first = JSON.parse(lines[0]) as { seq: number; prevHash: string; dataProtection?: unknown };
    const second = JSON.parse(lines[1]) as { seq: number; prevHash: string; errorCode?: string };
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(JSON.parse(lines[0]).hash);
    expect(second.errorCode).toBe('FORBIDDEN');
    audit.close();
  });

  it('detects tampering of any field', () => {
    const audit = createAuditLogger({ sinks: { file } }, logger);
    audit.record(baseEvent({ correlationId: 'c1' }));
    audit.record(baseEvent({ correlationId: 'c2' }));

    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    lines[1].tool = 'submit_jcl'; // forged record
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));

    const result = verifyAuditChain(lines.map((l) => JSON.stringify(l)));
    expect(result.intact).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
    audit.close();
  });

  it('detects deletion by chain break', () => {
    const audit = createAuditLogger({ sinks: { file } }, logger);
    audit.record(baseEvent({ correlationId: 'c1' }));
    audit.record(baseEvent({ correlationId: 'c2' }));
    audit.record(baseEvent({ correlationId: 'c3' }));

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    // Remove the middle record: record 3's prevHash no longer links.
    const result = verifyAuditChain([lines[0], lines[2]]);
    expect(result.intact).toBe(false);
    audit.close();
  });

  it('redacts arguments and records data protection summary', () => {
    const audit = createAuditLogger({ sinks: { file } }, logger);
    audit.record(
      baseEvent({
        arguments: { password: 'supersecret', dsn: 'PROD.X' },
        dataProtection: { masked: 3, rules: ['ssn', 'credit_card'], classification: 'pci' },
      }),
    );
    const record = JSON.parse(readFileSync(file, 'utf8').trim()) as {
      arguments: Record<string, unknown>;
      dataProtection?: { masked: number; classification?: string };
    };
    expect(record.arguments.password).toBe('[REDACTED]');
    expect(record.arguments.dsn).toBe('PROD.X');
    expect(record.dataProtection?.masked).toBe(3);
    expect(record.dataProtection?.classification).toBe('pci');
    audit.close();
  });

  it('carries agent info when provided', () => {
    const audit = createAuditLogger({ sinks: { file } }, logger);
    audit.record(baseEvent({ agent: { name: 'claude-code', version: '1.2.3' } }));
    const record = JSON.parse(readFileSync(file, 'utf8').trim()) as { agent?: { name?: string } };
    expect(record.agent?.name).toBe('claude-code');
    audit.close();
  });
});

describe('createAuditLogger without sinks', () => {
  it('never throws when no sinks are configured', () => {
    const audit = createAuditLogger({ sinks: {} }, logger);
    expect(() => audit.record(baseEvent())).not.toThrow();
  });
});
