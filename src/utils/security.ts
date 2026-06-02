/**
 * Enterprise security guards — tool allowlists, read-only mode, resource
 * boundaries, and audit logging for every MCP tool invocation.
 */
import type { AppConfig } from '../config/schema.js';
import type { ToolContext } from '../types/tools.js';
import { ForbiddenError } from './errors.js';
import { globToRegExp } from './glob.js';

/** Tools that mutate z/OS state (blocked when SECURITY_READ_ONLY=true). */
export const WRITE_TOOLS = new Set(['submit_jcl']);

function parseCsv(value?: string): string[] {
  return value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

/** Ensure the tool is permitted by allow/block lists. */
export function assertToolAllowed(config: AppConfig, toolName: string): void {
  const blocked = parseCsv(config.security.blockedTools);
  if (blocked.includes(toolName)) {
    throw new ForbiddenError(`Tool "${toolName}" is blocked by server policy.`, { toolName });
  }

  const allowed = parseCsv(config.security.allowedTools);
  if (allowed.length > 0 && !allowed.includes(toolName)) {
    throw new ForbiddenError(`Tool "${toolName}" is not in the allowed tool list.`, { toolName });
  }
}

/** Block write tools when read-only mode is enabled. */
export function assertWriteAllowed(config: AppConfig, toolName: string): void {
  if (config.security.readOnly && WRITE_TOOLS.has(toolName)) {
    throw new ForbiddenError(
      `Tool "${toolName}" is disabled because SECURITY_READ_ONLY=true.`,
      { toolName },
    );
  }
}

/** Restrict dataset access to configured HLQ/patterns (if any are set). */
export function assertDatasetAllowed(config: AppConfig, dsn: string): void {
  const patterns = parseCsv(config.security.allowedDatasetPatterns);
  if (patterns.length === 0) return;

  const upper = dsn.trim().toUpperCase();
  const permitted = patterns.some((pattern) =>
    globToRegExp(pattern.toUpperCase()).test(upper),
  );
  if (!permitted) {
    throw new ForbiddenError(`Dataset "${dsn}" is outside allowed dataset patterns.`, { dsn });
  }
}

/** Restrict USS access to configured path prefixes (if any are set). */
export function assertUssPathAllowed(config: AppConfig, path: string): void {
  const prefixes = parseCsv(config.security.allowedUssPaths);
  if (prefixes.length === 0) return;

  const normalized = path.trim();
  const permitted = prefixes.some((prefix) => normalized.startsWith(prefix));
  if (!permitted) {
    throw new ForbiddenError(`USS path "${path}" is outside allowed USS paths.`, { path });
  }
}

/** Enforce JCL size limits for submit operations. */
export function assertJclSizeAllowed(config: AppConfig, jcl: string): void {
  const bytes = Buffer.byteLength(jcl, 'utf8');
  if (bytes > config.security.maxJclBytes) {
    throw new ForbiddenError(
      `JCL payload (${bytes} bytes) exceeds SECURITY_MAX_JCL_BYTES (${config.security.maxJclBytes}).`,
      { bytes, limit: config.security.maxJclBytes },
    );
  }
}

/** Redact sensitive argument fields before writing audit logs. */
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/password|token|secret|credential/i.test(key)) {
      redacted[key] = '[REDACTED]';
    } else if (key === 'jcl' && typeof value === 'string') {
      redacted[key] = `[JCL ${Buffer.byteLength(value, 'utf8')} bytes]`;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Write a structured audit record for compliance trails. */
export function auditToolCall(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
): void {
  if (!ctx.config.security.auditLogging) return;

  ctx.logger.info(
    {
      audit: true,
      tool: toolName,
      user: ctx.config.zosmf.user ?? '(token-auth)',
      host: ctx.config.zosmf.host,
      args: redactArgs(args),
    },
    'MCP tool invocation',
  );
}

/** Run all applicable security checks before a tool handler executes. */
export function enforceSecurity(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
  resources?: { dataset?: string; ussPath?: string },
): void {
  assertToolAllowed(ctx.config, toolName);
  assertWriteAllowed(ctx.config, toolName);
  auditToolCall(ctx, toolName, args);

  if (resources?.dataset) assertDatasetAllowed(ctx.config, resources.dataset);
  if (resources?.ussPath) assertUssPathAllowed(ctx.config, resources.ussPath);
}
