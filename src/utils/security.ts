/**
 * Enterprise security guards — tool allowlists, read-only mode, resource
 * boundaries, policy-as-code RBAC, classification access, and audit logging
 * for every tool invocation.
 *
 * Two control planes compose (both must pass):
 *   1. Environment variables (SECURITY_*) — always enforced.
 *   2. The policy file (SECURITY_POLICY_FILE), when configured — role-based
 *      tool/resource gates, per-role read-only and change-ticket rules, and
 *      classification-based access on sensitive resources.
 */
import type { AppConfig } from '../config/schema.js';
import type { ToolContext, ResolvedIdentity } from '../types/tools.js';
import type { ResolvedPolicy, ResolvedRole } from '../config/policy.js';
import { matchClassification, resolveRoleForUser, roleAllowsDataset, roleAllowsTool, roleAllowsUssPath } from '../config/policy.js';
import type { DataProtectionAudit } from './audit.js';
import { ForbiddenError } from './errors.js';
import { globToRegExp } from './glob.js';
import { getActiveEnvironmentName, getCorrelationId, resolveActingUser } from './runtime.js';

// ---------------------------------------------------------------------------
// Write-tool registry
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = new Set([
  'submit_jcl',
  'approve_write',
  'delete_dataset',
  'delete_dataset_member',
  'write_dataset',
  'write_dataset_member',
  'create_dataset',
  'rename_dataset',
  'delete_uss_file',
  'write_uss_file',
  'create_uss_directory',
  'change_uss_permissions',
  // Console & operator actions (gated writes)
  'issue_console_command',
  'hold_job',
  'release_job',
  'cancel_job',
  'get_wlm_status',
  'ims_command',
  'analyze_logrec',
  // CICS actions (gated writes)
  'cics_newcopy',
  'cics_disable_transaction',
]);

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

function parseCsv(value?: string): string[] {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

// ---------------------------------------------------------------------------
// Tool access controls (env-var plane)
// ---------------------------------------------------------------------------

export function assertToolAllowed(config: AppConfig, toolName: string): void {
  const blocked = parseCsv(config.security.blockedTools);
  if (blocked.includes(toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is blocked by server policy (SECURITY_BLOCKED_TOOLS).`,
      { toolName },
    );
  }

  const allowed = parseCsv(config.security.allowedTools);
  if (allowed.length > 0 && !allowed.includes(toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is not in the server's allowed tool list (SECURITY_ALLOWED_TOOLS).`,
      { toolName },
    );
  }
}

/** Read-only gate for a single environment: `envDef.readOnly ?? server flag`. */
export function assertWriteAllowed(config: AppConfig, toolName: string): void {
  if (config.security.readOnly && WRITE_TOOLS.has(toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is a write operation and the server is running in read-only mode (SECURITY_READ_ONLY=true).`,
      { toolName },
    );
  }
}

// ---------------------------------------------------------------------------
// Resource boundary guards (env-var plane)
// ---------------------------------------------------------------------------

function normalizeDatasetName(dsn: string): string {
  return dsn.trim().toUpperCase().replace(/^\.+|\.+$/g, '');
}

export function assertDatasetAllowed(config: AppConfig, dsn: string): void {
  const patterns = parseCsv(config.security.allowedDatasetPatterns);
  if (patterns.length === 0) return;

  const upper = normalizeDatasetName(dsn);
  const permitted = patterns.some((pattern) =>
    globToRegExp(pattern.toUpperCase()).test(upper),
  );
  if (!permitted) {
    throw new ForbiddenError(
      `Dataset "${dsn}" is outside the allowed dataset patterns (SECURITY_ALLOWED_DATASET_PATTERNS).`,
      { dsn },
    );
  }
}

function normalizeUssPath(rawPath: string): string {
  const segments: string[] = [];
  for (const segment of rawPath.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return '/' + segments.join('/');
}

export function assertUssPathAllowed(config: AppConfig, path: string): void {
  const prefixes = parseCsv(config.security.allowedUssPaths);
  if (prefixes.length === 0) return;

  const normalized = normalizeUssPath(path.trim());
  const permitted = prefixes.some((prefix) => {
    const normalizedPrefix = normalizeUssPath(prefix.trim());
    // Require the normalized path to start with the prefix followed by '/' or be an exact match,
    // so '/u/userdev' does not accidentally permit '/u/userdev2'.
    return (
      normalized === normalizedPrefix ||
      normalized.startsWith(normalizedPrefix + '/')
    );
  });

  if (!permitted) {
    throw new ForbiddenError(
      `USS path "${path}" is outside the allowed USS path prefixes (SECURITY_ALLOWED_USS_PATHS).`,
      { path },
    );
  }
}

export function assertJclSizeAllowed(config: AppConfig, jcl: string): void {
  const bytes = Buffer.byteLength(jcl, 'utf8');
  if (bytes > config.security.maxJclBytes) {
    throw new ForbiddenError(
      `JCL payload (${bytes} bytes) exceeds the server limit of ${config.security.maxJclBytes} bytes (SECURITY_MAX_JCL_BYTES).`,
      { bytes, limit: config.security.maxJclBytes },
    );
  }
}

/**
 * Enforce the change-ticket requirement on governed writes. When
 * SECURITY_CHANGE_TICKET_PATTERN is configured (or the active policy role
 * declares its own pattern), every write must carry a `changeTicket`
 * argument matching the expression. The role pattern, when present,
 * overrides the server-wide one.
 */
export function assertChangeTicket(config: AppConfig, ticket?: string, patternOverride?: string): void {
  const pattern = patternOverride ?? config.security.changeTicketPattern;
  if (!pattern) return;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new ForbiddenError(
      `SECURITY_CHANGE_TICKET_PATTERN is not a valid regex: ${pattern}`,
    );
  }
  if (!ticket) {
    throw new ForbiddenError(
      `A change ticket is required for write operations: pass changeTicket matching /${pattern}/ (SECURITY_CHANGE_TICKET_PATTERN).`,
      { pattern },
    );
  }
  if (!regex.test(ticket)) {
    throw new ForbiddenError(
      `Change ticket "${ticket}" does not match the required format /${pattern}/ (SECURITY_CHANGE_TICKET_PATTERN).`,
      { pattern, ticket },
    );
  }
}

// ---------------------------------------------------------------------------
// Policy-as-code plane (feature: policy & RBAC)
// ---------------------------------------------------------------------------

/** Synthetic unrestricted role used when no policy file is configured. */
const UNRESTRICTED_ROLE: ResolvedRole = {
  name: '(no-policy)',
  tools: { allow: [], deny: [] },
  datasets: { allow: [], deny: [] },
  uss: { allow: [], deny: [] },
};

/**
 * Resolve the acting identity for the current call: the user (transport
 * header, per-user identity, or service account) mapped through the policy
 * file's roles. Returns an unrestricted synthetic role when no policy exists,
 * so downstream checks are uniform.
 */
export function resolveIdentity(ctx: ToolContext): ResolvedIdentity {
  const user = resolveActingUser(ctx.config.zosmf.userId, ctx.config.zosmf.user);
  if (!ctx.policy) return { user, role: UNRESTRICTED_ROLE };
  const { role, userEntry } = resolveRoleForUser(ctx.policy, user);
  return { user, role, userEntry };
}

/** Role-based tool gate (policy plane). */
export function assertPolicyToolAllowed(identity: ResolvedIdentity, toolName: string): void {
  if (!roleAllowsTool(identity.role, toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is not permitted for role "${identity.role.name}" (policy file).`,
      { toolName, role: identity.role.name },
    );
  }
}

/** Role-based read-only gate (policy plane; environment readOnly checked separately). */
export function assertPolicyWriteAllowed(role: ResolvedRole, toolName: string): void {
  if (role.readOnly && WRITE_TOOLS.has(toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is a write operation and role "${role.name}" is read-only (policy file).`,
      { toolName, role: role.name },
    );
  }
}

/** Role + classification access gate for the addressed resources. */
export function assertPolicyResourcesAllowed(
  policy: ResolvedPolicy,
  identity: ResolvedIdentity,
  toolName: string,
  resources?: { dataset?: string; ussPath?: string },
): void {
  if (resources?.dataset) {
    const upper = normalizeDatasetName(resources.dataset);
    if (!roleAllowsDataset(identity.role, upper)) {
      throw new ForbiddenError(
        `Dataset "${resources.dataset}" is outside the dataset patterns of role "${identity.role.name}" (policy file).`,
        { dataset: resources.dataset, role: identity.role.name },
      );
    }
    assertClassificationAccess(policy, identity, { tool: toolName, dataset: resources.dataset });
  }
  if (resources?.ussPath) {
    const normalized = normalizeUssPath(resources.ussPath.trim());
    if (!roleAllowsUssPath(identity.role, normalized)) {
      throw new ForbiddenError(
        `USS path "${resources.ussPath}" is outside the USS paths of role "${identity.role.name}" (policy file).`,
        { path: resources.ussPath, role: identity.role.name },
      );
    }
    assertClassificationAccess(policy, identity, { tool: toolName, ussPath: resources.ussPath });
  }
}

/** Classification role gate: some classified resources are role-restricted. */
export function assertClassificationAccess(
  policy: ResolvedPolicy,
  identity: ResolvedIdentity,
  ref: { tool: string; dataset?: string; ussPath?: string },
): void {
  const classification = matchClassification(policy, ref);
  if (classification?.roles && !classification.roles.includes(identity.role.name)) {
    throw new ForbiddenError(
      `Resource is classified "${classification.name}" and requires one of roles: ${classification.roles.join(', ')} (policy file).`,
      { classification: classification.name, role: identity.role.name },
    );
  }
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|credential|apikey|api_key|auth|passphrase|private/i;

export function redactArgs(args: unknown): unknown {
  if (Array.isArray(args)) {
    return args.map(redactArgs);
  }
  if (args !== null && typeof args === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else if (key === 'jcl' && typeof value === 'string') {
        out[key] = `[JCL ${Buffer.byteLength(value, 'utf8')} bytes]`;
      } else {
        out[key] = redactArgs(value);
      }
    }
    return out;
  }
  return args;
}

export type AuditOutcome = 'success' | 'error' | 'blocked';

export interface AuditCallOptions {
  outcome?: AuditOutcome;
  durationMs?: number;
  errorCode?: string;
  resultChars?: number;
  dataProtection?: DataProtectionAudit;
}

/**
 * Emit the audit trail for a tool call: a structured pino line (stderr, as
 * before) plus — once the outcome is known — a hash-chained record fanned out
 * to the configured SIEM sinks (file, Splunk HEC, webhook, OTLP).
 */
export function auditToolCall(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  opts?: AuditCallOptions,
): void {
  if (!ctx.config.security.auditLogging) return;

  const environment = ctx.environments ? getActiveEnvironmentName() : 'default';
  const host =
    (ctx.environments ? safeEnvHost(ctx, environment) : undefined) ?? ctx.config.zosmf.host;
  const user = resolveActingUser(ctx.config.zosmf.userId, ctx.config.zosmf.user);

  ctx.logger.info(
    {
      audit: true,
      tool: toolName,
      user,
      host,
      environment,
      args: redactArgs(args),
      ...(opts?.outcome !== undefined && { outcome: opts.outcome }),
      ...(opts?.durationMs !== undefined && { durationMs: opts.durationMs }),
      ...(opts?.errorCode !== undefined && { errorCode: opts.errorCode }),
    },
    'MCP tool invocation',
  );

  // Structured SIEM record: emitted once per call, when the outcome is known.
  if (ctx.audit && opts?.outcome !== undefined) {
    ctx.audit.record({
      tool: toolName,
      user,
      transport: currentTransport,
      environment,
      host,
      correlationId: getCorrelationId(),
      arguments: args,
      ...(safeResources(args) ? { resources: safeResources(args) } : {}),
      outcome: opts.outcome,
      ...(opts.errorCode ? { errorCode: opts.errorCode } : {}),
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
      ...(opts.resultChars !== undefined ? { resultChars: opts.resultChars } : {}),
      ...(opts.dataProtection ? { dataProtection: opts.dataProtection } : {}),
    });
  }
}

/** Transport label stamped into audit records (set once at startup). */
let currentTransport = 'stdio';

export function setAuditTransport(transport: string): void {
  currentTransport = transport;
}

function safeEnvHost(ctx: ToolContext, environment: string): string | undefined {
  try {
    return ctx.environments?.get(environment).host;
  } catch {
    return undefined;
  }
}

function safeResources(args: Record<string, unknown>): { dataset?: string; ussPath?: string } | undefined {
  const dataset = typeof args.dsn === 'string' ? args.dsn : typeof args.hlq === 'string' ? args.hlq : undefined;
  const ussPath = typeof args.path === 'string' ? args.path : undefined;
  if (dataset === undefined && ussPath === undefined) return undefined;
  return {
    ...(dataset !== undefined ? { dataset } : {}),
    ...(ussPath !== undefined ? { ussPath } : {}),
  };
}

// ---------------------------------------------------------------------------
// Composite security gate
// ---------------------------------------------------------------------------

/**
 * Enforce every access-control plane for one tool call. Runs inside the call
 * runtime, so the active environment (from the `environment` argument) is
 * already resolved by the caller.
 */
export function enforceSecurity(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  resources?: { dataset?: string; ussPath?: string },
): ResolvedIdentity {
  // Plane 1: env-var tool lists.
  assertToolAllowed(ctx.config, toolName);

  // Plane 2: policy-as-code (identity, role gates, environment RBAC).
  const identity = resolveIdentity(ctx);
  if (ctx.policy) {
    assertPolicyToolAllowed(identity, toolName);
  }

  // Write gating: server-wide flag, active environment flag, role flag.
  assertWriteAllowed(ctx.config, toolName);
  if (ctx.environments) {
    const envName = getActiveEnvironmentName();
    if (ctx.environments.isReadOnly(envName) && WRITE_TOOLS.has(toolName)) {
      throw new ForbiddenError(
        `Tool "${toolName}" is a write operation and environment "${envName}" is read-only (policy: environments.${envName}.readOnly).`,
        { toolName, environment: envName },
      );
    }
  }
  assertPolicyWriteAllowed(identity.role, toolName);

  // Resource boundaries: env-var patterns, then role patterns, then
  // classification access rules.
  if (resources?.dataset) assertDatasetAllowed(ctx.config, resources.dataset);
  if (resources?.ussPath) assertUssPathAllowed(ctx.config, resources.ussPath);
  if (ctx.policy) {
    assertPolicyResourcesAllowed(ctx.policy, identity, toolName, resources);
  }

  auditToolCall(ctx, toolName, args);

  return identity;
}
