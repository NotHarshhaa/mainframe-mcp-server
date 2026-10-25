/**
 * IBM MQ REST admin client (mqweb server, MQ REST API v2).
 *
 * Config: MQ_REST_HOST, MQ_REST_PORT (9443), MQ_REST_USER, MQ_REST_PASSWORD.
 * Basic auth is used; the `ibm-mq-rest-csrf-token` header required for POSTs
 * is set automatically. TLS verification follows ZOSMF_REJECT_UNAUTHORIZED.
 */
import type { AppConfig } from '../config/schema.js';
import { ConfigError, ConnectionError } from './errors.js';
import { childLogger } from './logger.js';

const log = childLogger('mq');

export interface MqQueueInfo {
  qmgr: string;
  queue: string;
  curdepth?: number;
  maxdepth?: number;
  /** Percentage of maxdepth in use, when both depths are known. */
  percentFull?: number;
  type?: string;
  raw: Record<string, unknown>;
}

export interface MqChannelInfo {
  qmgr: string;
  channel: string;
  channelStatus?: string;
  channelType?: string;
  xmitq?: string;
  connectionCount?: number;
  raw: Record<string, unknown>;
}

function requireMqConfig(config: AppConfig): { baseUrl: string; headers: Record<string, string> } {
  const { mqRestHost, mqRestPort, mqRestUser, mqRestPassword } = config.enterprise;
  if (!mqRestHost) {
    throw new ConfigError(
      'MQ tools require MQ_REST_HOST (mqweb server host). Optionally set MQ_REST_PORT (default 9443), MQ_REST_USER, MQ_REST_PASSWORD.',
    );
  }
  const auth: Record<string, string> = mqRestUser && mqRestPassword
    ? { Authorization: `Basic ${Buffer.from(`${mqRestUser}:${mqRestPassword}`).toString('base64')}` }
    : {};
  return {
    baseUrl: `https://${mqRestHost}:${mqRestPort}`,
    headers: { 'ibm-mq-rest-csrf-token': 'mcp', ...auth },
  };
}

async function mqFetch(config: AppConfig, path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
  const { baseUrl, headers } = requireMqConfig(config);
  const method = init?.method ?? 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  timeout.unref();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body != null ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ConnectionError(
        `MQ REST ${method} ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`,
      );
    }
    const text = await res.text();
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      return { raw: text };
    }
  } catch (err) {
    if (err instanceof ConnectionError) throw err;
    throw new ConnectionError(
      `MQ REST request failed (${method} ${path}): ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Query one or more queues' depth attributes. Accepts comma-separated queue names. */
export async function getMqQueues(config: AppConfig, qmgr: string, queues: string[]): Promise<MqQueueInfo[]> {
  const names = queues.map((q) => q.trim().toUpperCase()).filter(Boolean);
  if (names.length === 0) {
    throw new ConfigError('At least one queue name is required.');
  }
  const results: MqQueueInfo[] = [];
  for (const queue of names) {
    const encodedQmgr = encodeURIComponent(qmgr.trim().toUpperCase());
    const encodedQueue = encodeURIComponent(queue);
    const raw = (await mqFetch(
      config,
      `/ibmmq/rest/v2/admin/qmgr/${encodedQmgr}/queue/${encodedQueue}?attributes=curdepth,maxdepth,type`,
    )) as Record<string, unknown>;
    // MQ REST v2 shape: { qmgr: [{ name, queue: [{ name, curdepth, ... }] }] }
    const qmgrList = (raw.qmgr as Record<string, unknown>[] | undefined) ?? [];
    const queueList = qmgrList[0]?.queue as Record<string, unknown>[] | undefined;
    const entry = queueList?.[0] as Record<string, unknown> | undefined;
    const curdepth = num(entry?.curdepth);
    const maxdepth = num(entry?.maxdepth);
    results.push({
      qmgr: str(qmgrList[0]?.name) ?? qmgr.toUpperCase(),
      queue: str(entry?.name) ?? queue,
      curdepth,
      maxdepth,
      percentFull: curdepth != null && maxdepth ? Math.round((curdepth / maxdepth) * 1000) / 10 : undefined,
      type: str(entry?.type),
      raw: entry ?? raw,
    });
  }
  return results;
}

/** Query channel status. Without a channel name, all channels on the qmgr. */
export async function getMqChannelStatus(config: AppConfig, qmgr: string, channel?: string): Promise<MqChannelInfo[]> {
  const encodedQmgr = encodeURIComponent(qmgr.trim().toUpperCase());
  const body: Record<string, unknown> = {
    response: { attributes: ['channelStatus', 'channelType', 'xmitq', 'connectionCount'] },
  };
  if (channel) body.name = channel.trim().toUpperCase();
  const raw = (await mqFetch(
    config,
    `/ibmmq/rest/v2/admin/action/qmgr/${encodedQmgr}/channel/get-status`,
    { method: 'POST', body },
  )) as Record<string, unknown>;
  const qmgrList = (raw.qmgr as Record<string, unknown>[] | undefined) ?? [];
  const channels = (qmgrList[0]?.channel as Record<string, unknown>[] | undefined) ?? [];
  const log2 = log;
  if (channels.length === 0) log2.debug({ qmgr }, 'no channel status returned');
  return channels.map((c) => ({
    qmgr: str(qmgrList[0]?.name) ?? qmgr.toUpperCase(),
    channel: str(c.name) ?? '(unknown)',
    channelStatus: str(c.channelStatus),
    channelType: str(c.channelType),
    xmitq: str(c.xmitq),
    connectionCount: num(c.connectionCount),
    raw: c,
  }));
}
