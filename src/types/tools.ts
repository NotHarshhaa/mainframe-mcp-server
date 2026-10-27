/**
 * Shared tool wiring types.
 *
 * Every tool module receives a {@link ToolContext} that bundles the live Zowe
 * session, the validated configuration, and a logger. Tools register
 * themselves against an {@link McpServer} via a `register*Tools` function.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Session } from '@zowe/imperative';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/schema.js';
import type { ResolvedPolicy, ResolvedRole, ResolvedUser } from '../config/policy.js';
import type { AuditLogger } from '../utils/audit.js';
import type { EnvironmentRegistry } from '../environments/registry.js';
import type { DocIndex } from '../utils/doc-rag.js';

/** Everything a tool needs at runtime. */
export interface ToolContext {
  /** Authenticated z/OSMF session (service identity). */
  session: Session;
  /** Validated application configuration. */
  config: AppConfig;
  /** Scoped logger. */
  logger: Logger;
  /**
   * When per-user identity (PassTicket propagation) is configured, returns a
   * session authenticated as the end user; absent otherwise. Tools should use
   * {@link effectiveSession} instead of touching `session` directly so z/OSMF
   * sees who asked, not just the service account.
   */
  resolveSession?: () => Promise<Session>;
  /**
   * Resolved policy-as-code document (roles, RBAC, environments, data
   * classifications). Present only when SECURITY_POLICY_FILE is configured;
   * env-var controls apply regardless.
   */
  policy?: ResolvedPolicy;
  /** Named z/OSMF environments (feature: multi-environment). */
  environments?: EnvironmentRegistry;
  /** SIEM audit pipeline (feature: audit). Absent when no sinks are configured. */
  audit?: AuditLogger;
  /**
   * Local RAG index over internal documentation (feature: doc-rag). Present
   * only when DOCS_SOURCES is configured; absent means no RAG sections.
   */
  docIndex?: DocIndex;
}

/** The active role and user mapping for the current call. */
export interface ResolvedIdentity {
  user: string;
  role: ResolvedRole;
  userEntry?: ResolvedUser;
}

/** Signature shared by every tool-group registration function. */
export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

/**
 * The standard MCP text result shape. Helper for building tool responses.
 */
export interface TextToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** Index signature required for compatibility with the MCP SDK result type. */
  [key: string]: unknown;
}
