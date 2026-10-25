/**
 * SIEM audit pipeline.
 *
 * Every tool invocation produces one structured JSON audit record with a
 * correlation id, acting user, MCP client, environment, redacted arguments,
 * outcome, duration, and result size. Records are chained with SHA-256
 * (each record hashes the previous record's hash), making the stream
 * tamper-evident: any edit or deletion breaks the chain at that sequence
 * number. `verifyAuditChain` (see tools/verify-audit-log.mjs) recomputes it.
 *
 * Export sinks are best-effort and never block or crash the tool path:
 *   - NDJSON file (SECURITY_AUDIT_FILE) — for ELK/Filebeat and long-term retention
 *   - Splunk HEC (SECURITY_AUDIT_SPLUNK_URL + _TOKEN)
 *   - Generic webhook (SECURITY_AUDIT_WEBHOOK_URL) — e.g. ELK ingest, syslog-over-HTTP
 *   - OpenTelemetry (SECURITY_AUDIT_OTLP_URL, OTLP/JSON /v1/logs)
 *
 * HTTP sinks are batched (flush on size or interval) with bounded retry;
 * failed batches are kept briefly and dropped after the buffer fills, with a
 * rate-limited warning on stderr.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { RedactionRuleId, RedactionStyle } from './redaction.js';

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

export type AuditOutcome = 'success' | 'error' | 'blocked';

export interface DataProtectionAudit {
  /** Masked match count. */
  masked: number;
  /** Rule ids that matched. */
  rules: string[];
  /** Classification rule that matched the resource, when any. */
  classification?: string;
  /** Lines dropped by caps/sampling. */
  trimmed?: boolean;
}

export interface AuditRecord {
  v: 1;
  seq: number;
  time: string;
  correlationId: string;
  user: string;
  agent?: { name?: string; version?: string };
  transport: string;
  environment: string;
  tool: string;
  host: string;
  arguments: unknown;
  resources?: { dataset?: string; ussPath?: string };
  outcome: AuditOutcome;
  errorCode?: string;
  durationMs?: number;
  resultChars?: number;
  dataProtection?: DataProtectionAudit;
  hashAlg: 'sha256';
  prevHash: string;
  hash: string;
}

/** The audit-worthy fields of one tool invocation (before chaining). */
export interface AuditEvent {
  tool: string;
  user: string;
  transport: string;
  environment: string;
  host: string;
  correlationId: string;
  agent?: { name?: string; version?: string };
  arguments: unknown;
  resources?: { dataset?: string; ussPath?: string };
  outcome: AuditOutcome;
  errorCode?: string;
  durationMs?: number;
  resultChars?: number;
  dataProtection?: DataProtectionAudit;
}

// ---------------------------------------------------------------------------
// Argument redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|credential|apikey|api_key|auth|passphrase|private/i;

/** Recursively redact sensitive keys and elide large string payloads. */
export function redactAuditArgs(args: unknown): unknown {
  if (Array.isArray(args)) return args.map(redactAuditArgs);
  if (args !== null && typeof args === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 512) {
        out[key] = `[${Buffer.byteLength(value, 'utf8')} bytes]`;
      } else {
        out[key] = redactAuditArgs(value);
      }
    }
    return out;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Hash chain
// ---------------------------------------------------------------------------

const GENESIS_LABEL = 'mainframe-mcp-server:audit:genesis';

function hashRecord(record: Omit<AuditRecord, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

/**
 * Verify a hash-chained NDJSON audit file. Returns the number of records and
 * the first sequence number where the chain breaks (0 = intact).
 */
export function verifyAuditChain(
  lines: readonly string[],
): { records: number; intact: boolean; brokenAtSeq?: number; reason?: string } {
  let prevHash = createHash('sha256').update(GENESIS_LABEL).digest('hex');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    count += 1;
    let record: AuditRecord;
    try {
      record = JSON.parse(trimmed) as AuditRecord;
    } catch {
      return { records: count, intact: false, brokenAtSeq: count, reason: 'unparseable JSON line' };
    }
    const { hash, ...rest } = record;
    const expected = hashRecord(rest as Omit<AuditRecord, 'hash'>);
    if (hash !== expected) {
      return { records: count, intact: false, brokenAtSeq: record.seq ?? count, reason: 'record hash mismatch' };
    }
    if (record.prevHash !== prevHash) {
      return { records: count, intact: false, brokenAtSeq: record.seq ?? count, reason: 'previous-hash link mismatch' };
    }
    prevHash = hash;
  }
  return { records: count, intact: true };
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export interface SinkConfig {
  file?: string;
  splunk?: { url: string; token: string };
  webhook?: { url: string; token?: string };
  otlp?: { url: string };
}

interface Sink {
  name: string;
  write(record: AuditRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

class FileSink implements Sink {
  readonly name = 'file';
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  write(record: AuditRecord): void {
    // Synchronous append: audit durability beats throughput at MCP call rates.
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

/** Shared batching + delivery logic for the HTTP-based sinks. */
class HttpSink implements Sink {
  private queue: AuditRecord[] = [];
  private readonly maxBatch: number;
  private readonly maxQueue = 256;
  private timer: NodeJS.Timeout | undefined;
  private lastWarnAt = 0;
  private closed = false;

  constructor(
    readonly name: string,
    private readonly buildRequest: (records: readonly AuditRecord[]) => {
      url: string;
      headers: Record<string, string>;
      body: string;
    },
    private readonly log: Logger,
    options?: { maxBatch?: number; flushIntervalMs?: number },
  ) {
    this.maxBatch = options?.maxBatch ?? 25;
    const interval = options?.flushIntervalMs ?? 2000;
    this.timer = setInterval(() => void this.flush(), interval);
    // Never hold the process open just for audit delivery.
    this.timer.unref();
  }

  write(record: AuditRecord): void {
    if (this.closed) return;
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift(); // bounded: drop oldest rather than grow without limit
      this.warn('audit sink buffer full; dropping oldest records');
    }
    this.queue.push(record);
    if (this.queue.length >= this.maxBatch) void this.flush();
  }

  async flush(): Promise<void> {
    while (this.queue.length > 0 && !this.closed) {
      const batch = this.queue.splice(0, this.maxBatch);
      const attempt = this.deliver(batch);
      try {
        await attempt;
      } catch (err) {
        this.warn(`delivery failed: ${err instanceof Error ? err.message : String(err)}`);
        // Give the batch one more chance on the next flush cycle.
        this.queue.unshift(...batch);
        if (this.queue.length > this.maxQueue) this.queue.length = this.maxQueue;
        break;
      }
    }
  }

  private async deliver(batch: readonly AuditRecord[]): Promise<void> {
    const req = this.buildRequest(batch);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref();
    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.log.warn({ sink: this.name }, `audit sink ${this.name}: ${message}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    // Best-effort final delivery.
    const batch = this.queue.splice(0, this.maxBatch);
    if (batch.length > 0) {
      try {
        await this.deliver(batch);
      } catch {
        // Intentionally ignored on close.
      }
    }
  }
}

function splunkSink(cfg: { url: string; token: string }, log: Logger): Sink {
  return new HttpSink(
    'splunk',
    (records) => ({
      url: cfg.url,
      headers: { Authorization: `Splunk ${cfg.token}`, 'Content-Type': 'application/json' },
      // HEC accepts a newline-concatenated stream of event objects.
      body: records
        .map((r) => JSON.stringify({ time: Math.floor(new Date(r.time).getTime() / 1000), sourcetype: 'mainframe:mcp:audit', event: r }))
        .join('\n'),
    }),
    log,
  );
}

function webhookSink(cfg: { url: string; token?: string }, log: Logger): Sink {
  return new HttpSink(
    'webhook',
    (records) => ({
      url: cfg.url,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      },
      body: JSON.stringify(records.length === 1 ? records[0] : { records }),
    }),
    log,
  );
}

function otlpSink(cfg: { url: string }, log: Logger): Sink {
  const url = cfg.url.replace(/\/+$/, '') + '/v1/logs';
  return new HttpSink(
    'otlp',
    (records) => ({
      url,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'mainframe-mcp-server' } },
              ],
            },
            scopeLogs: [
              {
                scope: { name: 'audit' },
                logRecords: records.map((r) => ({
                  timeUnixNano: String(new Date(r.time).getTime()) + '000000',
                  observedTimeUnixNano: String(Date.now()) + '000000',
                  severityText: r.outcome === 'success' ? 'INFO' : 'WARN',
                  body: { stringValue: JSON.stringify(r) },
                  attributes: [
                    { key: 'audit.tool', value: { stringValue: r.tool } },
                    { key: 'audit.user', value: { stringValue: r.user } },
                    { key: 'audit.environment', value: { stringValue: r.environment } },
                    { key: 'audit.correlation_id', value: { stringValue: r.correlationId } },
                    { key: 'audit.outcome', value: { stringValue: r.outcome } },
                  ],
                })),
              },
            ],
          },
        ],
      }),
    }),
    log,
  );
}

// ---------------------------------------------------------------------------
// Audit logger
// ---------------------------------------------------------------------------

export interface AuditLoggerOptions {
  sinks: SinkConfig;
  /** Redaction applied to the `arguments` field before export. */
  redactionRules?: readonly RedactionRuleId[];
  redactionStyle?: RedactionStyle;
}

export interface AuditLogger {
  /** Build the chained record and fan it out to every sink. Never throws. */
  record(event: AuditEvent): void;
  /** Force delivery of any queued HTTP batches. */
  flush(): Promise<void>;
  /** Stop timers and deliver what remains. */
  close(): Promise<void>;
}

/** Create the audit pipeline. Always returns a usable logger (sinks optional). */
export function createAuditLogger(options: AuditLoggerOptions, logger: Logger): AuditLogger {
  const sinks: Sink[] = [];
  if (options.sinks.file) {
    try {
      sinks.push(new FileSink(options.sinks.file));
    } catch (err) {
      logger.warn(
        { path: options.sinks.file },
        `audit file sink unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (options.sinks.splunk) sinks.push(splunkSink(options.sinks.splunk, logger));
  if (options.sinks.webhook) sinks.push(webhookSink(options.sinks.webhook, logger));
  if (options.sinks.otlp) sinks.push(otlpSink(options.sinks.otlp, logger));

  // Deterministic chain anchor: the verifier (tools/verify-audit-log.mjs)
  // recomputes the same constant, so any file is verifiable without config.
  let prevHash = createHash('sha256').update(GENESIS_LABEL).digest('hex');
  let seq = 0;

  return {
    record(event: AuditEvent): void {
      if (sinks.length === 0) return;
      try {
        seq += 1;
        const base: Omit<AuditRecord, 'hash'> = {
          v: 1,
          seq,
          time: new Date().toISOString(),
          correlationId: event.correlationId,
          user: event.user,
          ...(event.agent && (event.agent.name || event.agent.version) ? { agent: event.agent } : {}),
          transport: event.transport,
          environment: event.environment,
          tool: event.tool,
          host: event.host,
          arguments: redactAuditArgs(event.arguments),
          ...(event.resources ? { resources: event.resources } : {}),
          outcome: event.outcome,
          ...(event.errorCode ? { errorCode: event.errorCode } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.resultChars !== undefined ? { resultChars: event.resultChars } : {}),
          ...(event.dataProtection ? { dataProtection: event.dataProtection } : {}),
          hashAlg: 'sha256',
          prevHash,
        };
        const record: AuditRecord = { ...base, hash: hashRecord(base) };
        prevHash = record.hash;
        for (const sink of sinks) {
          try {
            sink.write(record);
          } catch (err) {
            logger.warn(
              { sink: sink.name, seq },
              `audit sink write failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err) {
        // Audit must never take the tool call down with it.
        logger.warn(
          { tool: event.tool },
          `audit record construction failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    async flush(): Promise<void> {
      await Promise.all(sinks.map((s) => s.flush()));
    },
    async close(): Promise<void> {
      await Promise.all(sinks.map((s) => s.close()));
    },
  };
}

/** Built-in rule ids, exported so configuration can validate its CSV list. */
export { DEFAULT_REDACTION_RULES } from './redaction.js';
