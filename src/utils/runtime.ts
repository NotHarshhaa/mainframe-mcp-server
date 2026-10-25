/**
 * Per-call runtime context, carried in an {@link AsyncLocalStorage} so every
 * layer (security gate, audit sink, session resolution, data protection) can
 * see who is calling, through which MCP client, against which environment —
 * without threading new parameters through every tool.
 *
 * The store merges parent contexts: the SSE transport wraps each HTTP request
 * with a transport-level store (acting user header, session reference), and
 * each tool call layers the call-level fields (correlation id, environment)
 * on top. Direct `runWithCallRuntime` calls outside any parent start fresh.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** MCP client identity reported during `initialize`. */
export interface AgentInfo {
  name?: string;
  version?: string;
}

/** Everything known about the in-flight call. */
export interface CallRuntime {
  /** Transport serving this call ('stdio' | 'sse'). */
  transport?: string;
  /** SSE session id, when the call arrived over HTTP. */
  sessionRef?: string;
  /** Acting identity (SSE `X-MCP-User` header, when the transport supplies one). */
  transportUser?: string;
  /** MCP client that issued the call (from the `initialize` handshake). */
  agent?: AgentInfo;
  /** Unique id for this tool invocation — travels into every audit record. */
  correlationId?: string;
  /** Name of the environment this call executes against ('default' = base config). */
  environment?: string;
}

const als = new AsyncLocalStorage<CallRuntime>();

/** Latest MCP client info from the `initialize` handshake (process-wide). */
let lastAgent: AgentInfo | undefined;

/** Record the MCP client identity reported by `initialize`. */
export function setAgentInfo(agent: AgentInfo | undefined): void {
  if (agent && (agent.name || agent.version)) lastAgent = agent;
}

/** The most recent MCP client identity, if the handshake completed. */
export function getAgentInfo(): AgentInfo | undefined {
  return als.getStore()?.agent ?? lastAgent;
}

/**
 * Run `fn` inside a call context, merging `overrides` over any enclosing
 * context (transport-level store). A new correlation id is generated when the
 * merged context does not already carry one.
 */
export function runWithCallRuntime<T>(
  overrides: Partial<CallRuntime>,
  fn: () => T,
): T {
  const parent = als.getStore();
  const merged: CallRuntime = {
    ...parent,
    ...overrides,
    agent: overrides.agent ?? parent?.agent ?? lastAgent,
  };
  if (!merged.correlationId) merged.correlationId = randomUUID();
  return als.run(merged, fn);
}

/** The active call context, or `undefined` outside any tool call. */
export function getCallRuntime(): CallRuntime | undefined {
  return als.getStore();
}

/** Active environment name for the current call ('default' = base config). */
export function getActiveEnvironmentName(): string {
  return als.getStore()?.environment ?? 'default';
}

/** Correlation id of the current call, or '(no-call)' in library code. */
export function getCorrelationId(): string {
  return als.getStore()?.correlationId ?? '(no-call)';
}

/**
 * Acting identity for the current call. Resolution order:
 *   1. `X-MCP-User` header captured by the SSE transport (gateway deployments)
 *   2. Per-user identity configured via ZOSMF_USER_ID
 *   3. Service account user (ZOSMF_USER)
 *   4. 'anonymous'
 */
export function resolveActingUser(userId?: string, serviceUser?: string): string {
  const runtime = als.getStore();
  const candidate = runtime?.transportUser ?? userId ?? serviceUser;
  return candidate ? candidate.toUpperCase() : 'ANONYMOUS';
}
