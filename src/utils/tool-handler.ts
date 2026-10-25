/**
 * Secure MCP tool call pipeline.
 *
 * Every tool invocation flows through {@link executeSecuredCall}:
 *
 *   0. Environment resolution — validate the optional `environment` argument
 *      against the registry and the policy (RBAC per environment)
 *   1. Runtime context — correlation id, acting user, environment in an
 *      AsyncLocalStorage visible to every layer below
 *   2. Security gate — env-var lists, role gates, read-only modes, resource
 *      boundaries, classification access (throws ForbiddenError on violation)
 *   3. Handler execution
 *   4. Data protection — masking of PII/PCI/SSN/secrets plus classification
 *      line caps and sampling on content-returning tools
 *   5. Audit — one hash-chained SIEM record per call with outcome, duration,
 *      result size, and data-protection summary
 *   6. Safe error conversion so no uncaught exception crashes the server
 */
import type { TextToolResult, ToolContext, ResolvedIdentity } from '../types/tools.js';
import type { DataProtectionAudit } from './audit.js';
import { toToolErrorResult, MainframeMcpError, ForbiddenError, ValidationError } from './errors.js';
import { auditToolCall, enforceSecurity, resolveIdentity } from './security.js';
import {
  capLines,
  maskText,
  sampleLines,
  DEFAULT_REDACTION_RULES,
  type RedactionRuleId,
  type RedactionStyle,
} from './redaction.js';
import { matchClassification } from '../config/policy.js';
import { getCorrelationId, runWithCallRuntime } from './runtime.js';

// ---------------------------------------------------------------------------
// Content-returning tools that get default redaction
// ---------------------------------------------------------------------------

/**
 * Tools whose output carries z/OS content (dataset members, USS files, spool,
 * JCL) and therefore get PII/PCI/SSN/secret masking by default. Other tools
 * are only masked when a classification rule explicitly matches the resource.
 */
export const PROTECTED_OUTPUT_TOOLS = new Set([
  'read_dataset',
  'search_dataset',
  'search_members',
  'read_uss_file',
  'search_files',
  'get_job_output',
  'get_job_jcl',
  'analyze_failure',
  'investigate',
  'compare_jobs',
]);

// ---------------------------------------------------------------------------
// Environment argument resolution
// ---------------------------------------------------------------------------

/** Resolve and authorize the `environment` argument (before the ALS runtime). */
function resolveEnvironmentName(ctx: ToolContext, args: Record<string, unknown>): string {
  const requested = typeof args.environment === 'string' ? args.environment.trim() : undefined;

  if (!ctx.environments) {
    if (requested && requested !== 'default') {
      throw new ValidationError(
        `Environment "${requested}" was requested but no environments are configured on this server. Define environments in the policy file (SECURITY_POLICY_FILE) or ZOSMF_ENVIRONMENTS.`,
      );
    }
    return 'default';
  }

  const name = requested ?? ctx.environments.defaultName();
  // get() throws ValidationError with the available names for unknown values.
  ctx.environments.get(name);

  // RBAC is enforced here because it needs the identity before the gate runs.
  const identity = resolveIdentity(ctx);
  ctx.environments.assertAllowed(name, identity.user, identity.userEntry, identity.role.name);
  return name;
}

// ---------------------------------------------------------------------------
// Data protection post-processing
// ---------------------------------------------------------------------------

function resolveDefaultRules(ctx: ToolContext): RedactionRuleId[] {
  if (ctx.policy) return ctx.policy.dataProtection.rules;
  const csv = ctx.config.security.redactionRules
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return (csv?.length ? csv : [...DEFAULT_REDACTION_RULES]) as RedactionRuleId[];
}

function resolveStyle(ctx: ToolContext): RedactionStyle {
  return ctx.policy?.dataProtection.style ?? ctx.config.security.redactionStyle;
}

function textOf(result: TextToolResult): string | undefined {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : undefined;
}

function withText(result: TextToolResult, text: string): TextToolResult {
  return { ...result, content: [{ type: 'text', text }, ...result.content.slice(1)] };
}

/**
 * Apply the data-protection layers to a successful tool result and return the
 * audit summary. Masking applies to content-returning tools by default and to
 * any tool whose resource matches a classification rule; caps, sampling, and
 * rule overrides come from the classification; the role may lower line caps.
 */
export function applyDataProtection(
  ctx: ToolContext,
  toolName: string,
  result: TextToolResult,
  identity: ResolvedIdentity,
  resources?: { dataset?: string; ussPath?: string },
): { result: TextToolResult; audit?: DataProtectionAudit } {
  const original = textOf(result);
  if (original === undefined) return { result };

  const classification = ctx.policy
    ? matchClassification(ctx.policy, { tool: toolName, ...resources })
    : undefined;

  const dpEnabled =
    ctx.config.security.dataProtection && (ctx.policy?.dataProtection.redactionDefault ?? true);
  const ruleIds =
    classification?.redact ?? (dpEnabled && PROTECTED_OUTPUT_TOOLS.has(toolName) ? resolveDefaultRules(ctx) : undefined);

  let text = original;
  let masked = 0;
  const rulesMatched: RedactionRuleId[] = [];
  const notices: string[] = [];
  let trimmed = false;

  // 1. Masking
  if (ruleIds && ruleIds.length > 0) {
    const maskedResult = maskText(text, { rules: ruleIds, style: resolveStyle(ctx) });
    text = maskedResult.text;
    masked = maskedResult.matches;
    rulesMatched.push(...maskedResult.rulesMatched);
  }

  // 2. Role-level line cap (policy plane; the tool's own cap still applied first)
  const roleCap = identity.role.maxDatasetReadLines;
  if (roleCap != null) {
    const capped = capLines(text, roleCap);
    if (capped.trimmed) {
      text = capped.text;
      trimmed = true;
      notices.push(`role "${identity.role.name}" limit: ${capped.notice}`);
    }
  }

  // 3. Classification line cap / sampling
  if (classification?.maxLines != null) {
    const capped = capLines(text, classification.maxLines);
    if (capped.trimmed) {
      text = capped.text;
      trimmed = true;
      notices.push(`classification "${classification.name}": ${capped.notice}`);
    }
  }
  if (classification?.sample) {
    const sampled = sampleLines(text, classification.sample);
    if (sampled.trimmed) {
      text = sampled.text;
      trimmed = true;
      notices.push(`classification "${classification.name}": ${sampled.notice}`);
    }
  }

  // 4. Notice footer so agents understand what changed
  if (masked > 0) {
    notices.unshift(`${masked} item(s) masked (${rulesMatched.join(', ')})`);
  }
  if (notices.length > 0) {
    text = `${text}\n\n[data protection: ${notices.join('; ')}]`;
  }

  const audit: DataProtectionAudit = {
    masked,
    rules: rulesMatched,
    ...(classification ? { classification: classification.name } : {}),
    ...(trimmed ? { trimmed } : {}),
  };

  return { result: masked === 0 && !trimmed ? result : withText(result, text), audit };
}

// ---------------------------------------------------------------------------
// The secured pipeline
// ---------------------------------------------------------------------------

function errorCodeOf(err: unknown): string {
  return err instanceof MainframeMcpError ? err.code : 'UNEXPECTED_ERROR';
}

function resultChars(result: TextToolResult): number {
  const text = textOf(result);
  return text === undefined ? 0 : Buffer.byteLength(text, 'utf8');
}

/**
 * Run one tool invocation through the full enterprise pipeline and return an
 * MCP result. Never throws.
 */
export async function executeSecuredCall<T extends Record<string, unknown>>(
  ctx: ToolContext,
  toolName: string,
  args: T,
  handler: (args: T) => Promise<TextToolResult>,
  resources?: (args: T) => { dataset?: string; ussPath?: string },
): Promise<TextToolResult> {
  const start = Date.now();
  let outcomeAudited = false;

  try {
    // 0. Environment argument validation + RBAC (before entering the runtime,
    //    so the resolved name is frozen into the AsyncLocalStorage store).
    const environmentName = resolveEnvironmentName(ctx, args);

    return await runWithCallRuntime({ environment: environmentName }, async () => {
      // 1. Security gate — a ForbiddenError here means the call was blocked
      //    by policy (distinct from a handler that fails later).
      let identity: ResolvedIdentity;
      let resourceRefs: { dataset?: string; ussPath?: string } | undefined;
      try {
        resourceRefs = resources?.(args);
        identity = enforceSecurity(ctx, toolName, args, resourceRefs);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          auditToolCall(ctx, toolName, args, {
            outcome: 'blocked',
            durationMs: Date.now() - start,
            errorCode: err.code,
          });
          outcomeAudited = true;
        }
        throw err;
      }

      // 2. Handler execution
      const raw = await handler(args);

      // 3. Data protection + 4. Audit
      const protectedOut = applyDataProtection(ctx, toolName, raw, identity, resourceRefs);
      const outcome = protectedOut.result.isError ? 'error' : 'success';
      auditToolCall(ctx, toolName, args, {
        outcome,
        durationMs: Date.now() - start,
        resultChars: resultChars(protectedOut.result),
        ...(protectedOut.audit ? { dataProtection: protectedOut.audit } : {}),
      });
      outcomeAudited = true;
      return protectedOut.result;
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    if (!outcomeAudited) {
      auditToolCall(ctx, toolName, args, { outcome: 'error', durationMs, errorCode: errorCodeOf(err) });
      outcomeAudited = true;
    }
    return toToolErrorResult(err);
  }
}

/** Exposed for diagnostics: the correlation id of the current call. */
export function currentCorrelationId(): string {
  return getCorrelationId();
}
