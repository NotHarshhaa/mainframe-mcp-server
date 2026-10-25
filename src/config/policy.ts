/**
 * Policy-as-code: a single YAML file mapping roles to tools, dataset
 * patterns, USS paths, and environments (SECURITY_POLICY_FILE).
 *
 * The policy document is the enterprise control plane for the env-var
 * allowlists: roles declare tool allow/deny lists (wildcards supported),
 * resource globs, per-role read-only and change-ticket requirements, and
 * users map to roles per environment. Environment definitions (feature:
 * multi-environment) also live here, each carrying its own z/OSMF endpoint
 * and optional read-only flag (e.g. PROD).
 *
 * Composition rules (both must pass — the policy never loosens env vars):
 *   - env-var tool/dataset/uss allowlists and read-only mode still apply
 *   - the active role adds further allow/deny on top
 *   - environment-level readOnly overrides the server-wide flag for that env
 *
 * `${env:VAR_NAME}` placeholders in any string value are interpolated at load
 * time so credentials never live in the file itself.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { RedactionRuleId, RedactionStyle } from '../utils/redaction.js';
import { DEFAULT_REDACTION_RULES } from '../utils/redaction.js';
import { globToRegExp } from '../utils/glob.js';
import { ConfigError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// YAML schema
// ---------------------------------------------------------------------------

const matcherSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

const roleSchema = z
  .object({
    description: z.string().optional(),
    inherits: z.string().optional(),
    tools: matcherSchema.optional(),
    datasets: matcherSchema.optional(),
    uss: matcherSchema.optional(),
    readOnly: z.boolean().optional(),
    changeTicketPattern: z.string().optional(),
    maxDatasetReadLines: z.number().int().positive().optional(),
  })
  .strict();

const environmentSchema = z
  .object({
    description: z.string().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    basePath: z.string().optional(),
    rejectUnauthorized: z.boolean().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    tokenType: z.string().optional(),
    cert: z.string().optional(),
    certKey: z.string().optional(),
    readOnly: z.boolean().optional(),
    allowedRoles: z.array(z.string()).optional(),
    datasets: matcherSchema.optional(),
    uss: matcherSchema.optional(),
  })
  .strict();

const userSchema = z
  .object({
    username: z.string().min(1),
    roles: z.array(z.string()).optional(),
    environments: z.array(z.string()).optional(),
  })
  .strict();

const classificationSchema = z
  .object({
    name: z.string().min(1),
    datasets: z.array(z.string()).optional(),
    uss: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    roles: z.array(z.string()).optional(),
    redact: z.array(z.string()).optional(),
    maxLines: z.number().int().positive().optional(),
    sample: z
      .object({ head: z.number().int().nonnegative(), tail: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();

const policySchema = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        role: z.string().optional(),
        environment: z.string().optional(),
      })
      .strict()
      .optional(),
    environments: z.record(z.string(), environmentSchema).optional(),
    roles: z.record(z.string(), roleSchema).optional(),
    users: z.array(userSchema).optional(),
    dataProtection: z
      .object({
        redaction: z
          .object({
            default: z.enum(['on', 'off']).optional(),
            rules: z.array(z.string()).optional(),
            style: z.enum(['mask', 'token']).optional(),
          })
          .strict()
          .optional(),
        classifications: z.array(classificationSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Resolved shapes
// ---------------------------------------------------------------------------

export interface ResolvedMatcher {
  allow: string[];
  deny: string[];
}

export interface ResolvedRole {
  name: string;
  description?: string;
  tools: ResolvedMatcher;
  datasets: ResolvedMatcher;
  uss: ResolvedMatcher;
  readOnly?: boolean;
  changeTicketPattern?: string;
  maxDatasetReadLines?: number;
}

export interface ResolvedUser {
  username: string;
  roles: string[];
  environments?: string[];
}

/** An environment as declared in the policy file (feature: multi-environment). */
export interface PolicyEnvironment {
  name: string;
  description?: string;
  host?: string;
  port?: number;
  basePath?: string;
  rejectUnauthorized?: boolean;
  user?: string;
  password?: string;
  token?: string;
  tokenType?: string;
  cert?: string;
  certKey?: string;
  readOnly?: boolean;
  allowedRoles?: string[];
  datasets?: ResolvedMatcher;
  uss?: ResolvedMatcher;
}

export interface ResolvedClassification {
  name: string;
  datasets: string[];
  uss: string[];
  tools?: string[];
  roles?: string[];
  redact?: RedactionRuleId[];
  maxLines?: number;
  sample?: { head: number; tail: number };
}

export interface ResolvedPolicy {
  /** Source file (absent when built programmatically). */
  path?: string;
  defaultRole: string;
  defaultEnvironment?: string;
  roles: Map<string, ResolvedRole>;
  users: ResolvedUser[];
  environments: Map<string, PolicyEnvironment>;
  dataProtection: {
    redactionDefault: boolean;
    rules: RedactionRuleId[];
    style: RedactionStyle;
    classifications: ResolvedClassification[];
  };
}

// ---------------------------------------------------------------------------
// `${env:VAR}` interpolation
// ---------------------------------------------------------------------------

const ENV_VAR_RE = /\$\{env:([A-Z0-9_]+)\}/g;

/** Recursively replace `${env:NAME}` placeholders; missing vars fail loudly. */
export function interpolateEnvVars(value: unknown, context: string): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_RE, (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        throw new ConfigError(
          `Policy ${context} references \${env:${name}} but that environment variable is not set.`,
        );
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnvVars(v, context));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = interpolateEnvVars(v, context);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Role resolution (inheritance + matching)
// ---------------------------------------------------------------------------

const EMPTY_MATCHER: ResolvedMatcher = { allow: [], deny: [] };

function mergeMatcher(
  child: ResolvedMatcher | undefined,
  parent: ResolvedMatcher | undefined,
): ResolvedMatcher {
  return {
    // A child allow list replaces the parent's; deny lists accumulate.
    allow: child?.allow ?? parent?.allow ?? [],
    deny: [...(parent?.deny ?? []), ...(child?.deny ?? [])],
  };
}

function resolveRoleInheritance(
  name: string,
  raw: Map<string, z.infer<typeof roleSchema>>,
  cache: Map<string, ResolvedRole>,
  stack: string[] = [],
): ResolvedRole {
  const cached = cache.get(name);
  if (cached) return cached;
  if (stack.includes(name)) {
    throw new ConfigError(`Policy role inheritance cycle: ${[...stack, name].join(' -> ')}`);
  }
  const def = raw.get(name);
  if (!def) {
    throw new ConfigError(`Policy role "${name}" is referenced (inherits or user mapping) but not defined.`);
  }
  const parent = def.inherits
    ? resolveRoleInheritance(def.inherits, raw, cache, [...stack, name])
    : undefined;

  const resolved: ResolvedRole = {
    name,
    description: def.description ?? parent?.description,
    tools: mergeMatcher(def.tools as ResolvedMatcher | undefined, parent?.tools),
    datasets: mergeMatcher(def.datasets as ResolvedMatcher | undefined, parent?.datasets),
    uss: mergeMatcher(def.uss as ResolvedMatcher | undefined, parent?.uss),
    readOnly: def.readOnly ?? parent?.readOnly,
    changeTicketPattern: def.changeTicketPattern ?? parent?.changeTicketPattern,
    maxDatasetReadLines: def.maxDatasetReadLines ?? parent?.maxDatasetReadLines,
  };
  cache.set(name, resolved);
  return resolved;
}

/** Match a name against a comma-free list of mainframe globs (`*`, `?`). */
export function matchesAnyGlob(value: string, patterns: readonly string[], caseInsensitive: boolean): boolean {
  return patterns.some((p) => globToRegExp(p, { caseInsensitive }).test(value));
}

/** Role tool gate: deny wins; empty allow list means unrestricted. */
export function roleAllowsTool(role: ResolvedRole, toolName: string): boolean {
  if (role.tools.deny.length > 0 && matchesAnyGlob(toolName, role.tools.deny, false)) return false;
  if (role.tools.allow.length === 0) return true;
  return matchesAnyGlob(toolName, role.tools.allow, false);
}

function roleAllowsResource(
  matcher: ResolvedMatcher,
  normalized: string,
): boolean {
  if (matcher.deny.length > 0 && matchesAnyGlob(normalized, matcher.deny, true)) return false;
  if (matcher.allow.length === 0) return true;
  return matchesAnyGlob(normalized, matcher.allow, true);
}

export function roleAllowsDataset(role: ResolvedRole, normalizedDsn: string): boolean {
  return roleAllowsResource(role.datasets ?? EMPTY_MATCHER, normalizedDsn);
}

export function roleAllowsUssPath(role: ResolvedRole, normalizedPath: string): boolean {
  return roleAllowsResource(role.uss ?? EMPTY_MATCHER, normalizedPath);
}

/** Resolve the role that applies to `user` (case-insensitive username match). */
export function resolveRoleForUser(
  policy: ResolvedPolicy,
  user: string,
): { role: ResolvedRole; userEntry?: ResolvedUser } {
  const entry = policy.users.find((u) => u.username.toUpperCase() === user.toUpperCase());
  const roleNames = entry?.roles?.length ? entry.roles : [policy.defaultRole];
  const role = policy.roles.get(roleNames[0]);
  if (!role) {
    throw new ConfigError(
      `Role "${roleNames[0]}" (for user "${user}") is not defined in the policy. Defined: ${[...policy.roles.keys()].join(', ') || '(none)'}.`,
    );
  }
  return { role, userEntry: entry };
}

// ---------------------------------------------------------------------------
// Classification matching (feature: data protection)
// ---------------------------------------------------------------------------

export interface ResourceRef {
  tool: string;
  dataset?: string;
  ussPath?: string;
}

/**
 * First classification rule that matches the resource and tool, in document
 * order. Dataset globs match the normalized upper DSN; USS globs are
 * case-sensitive.
 */
export function matchClassification(
  policy: ResolvedPolicy,
  ref: ResourceRef,
): ResolvedClassification | undefined {
  for (const c of policy.dataProtection.classifications) {
    if (ref.dataset && c.datasets.length > 0) {
      const upper = ref.dataset.trim().toUpperCase().replace(/^\.+|\.+$/g, '');
      if (matchesAnyGlob(upper, c.datasets, true)) {
        if (!c.tools || c.tools.includes(ref.tool)) return c;
      }
    }
    if (ref.ussPath && c.uss.length > 0) {
      const normalized = normalizeUssForMatch(ref.ussPath);
      if (matchesAnyGlob(normalized, c.uss.map((p) => normalizeUssForMatch(p)), false)) {
        if (!c.tools || c.tools.includes(ref.tool)) return c;
      }
    }
  }
  return undefined;
}

/** Canonicalize a USS path for glob matching (resolve `.`/`..` lexically). */
function normalizeUssForMatch(path: string): string {
  const segments: string[] = [];
  for (const segment of path.trim().split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return '/' + segments.join('/');
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function validateRedactRules(ids: readonly string[], source: string): RedactionRuleId[] {
  const valid = new Set<string>(DEFAULT_REDACTION_RULES);
  for (const id of ids) {
    if (!valid.has(id)) {
      throw new ConfigError(
        `Unknown redaction rule "${id}" in policy ${source}. Valid rules: ${[...valid].join(', ')}.`,
      );
    }
  }
  return ids as RedactionRuleId[];
}

/**
 * Load and resolve the policy file. Throws {@link ConfigError} with a precise
 * message on any structural, reference, or interpolation problem — fail
 * closed, never start with a half-applied policy.
 */
export function loadPolicy(path: string): ResolvedPolicy {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `Unable to read policy file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(raw);
  } catch (err) {
    throw new ConfigError(`Policy file "${path}" is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = policySchema.safeParse(interpolateEnvVars(parsedYaml, path));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Policy file "${path}" failed validation:\n${details}`);
  }
  const doc = parsed.data;

  // ---- Roles -------------------------------------------------------------
  const rawRoles = new Map(Object.entries(doc.roles ?? {}));
  const roles = new Map<string, ResolvedRole>();
  for (const name of rawRoles.keys()) {
    roles.set(name, resolveRoleInheritance(name, rawRoles, roles));
  }

  const defaultRole = doc.defaults?.role;
  if (defaultRole && !roles.has(defaultRole)) {
    throw new ConfigError(`Policy defaults.role "${defaultRole}" is not defined. Defined: ${[...roles.keys()].join(', ') || '(none)'}.`);
  }

  // ---- Environments --------------------------------------------------------
  const environments = new Map<string, PolicyEnvironment>();
  for (const [name, env] of Object.entries(doc.environments ?? {})) {
    environments.set(name, {
      name,
      ...env,
      datasets: env.datasets
        ? { allow: env.datasets.allow ?? [], deny: env.datasets.deny ?? [] }
        : undefined,
      uss: env.uss ? { allow: env.uss.allow ?? [], deny: env.uss.deny ?? [] } : undefined,
    });
  }
  const defaultEnvironment = doc.defaults?.environment;
  if (defaultEnvironment && !environments.has(defaultEnvironment)) {
    throw new ConfigError(`Policy defaults.environment "${defaultEnvironment}" is not defined. Defined: ${[...environments.keys()].join(', ') || '(none)'}.`);
  }

  // ---- Users ---------------------------------------------------------------
  const users: ResolvedUser[] = (doc.users ?? []).map((u) => ({
    username: u.username,
    roles: u.roles ?? (defaultRole ? [defaultRole] : []),
    environments: u.environments,
  }));
  for (const user of users) {
    for (const roleName of user.roles) {
      if (!roles.has(roleName)) {
        throw new ConfigError(`Policy user "${user.username}" references undefined role "${roleName}".`);
      }
    }
    for (const envName of user.environments ?? []) {
      if (!environments.has(envName)) {
        throw new ConfigError(`Policy user "${user.username}" references undefined environment "${envName}".`);
      }
    }
  }

  // ---- Data protection -----------------------------------------------------
  const redactionCfg = doc.dataProtection?.redaction;
  const dp: ResolvedPolicy['dataProtection'] = {
    redactionDefault: redactionCfg?.default !== 'off',
    rules: redactionCfg?.rules
      ? validateRedactRules(redactionCfg.rules, 'dataProtection.redaction.rules')
      : [...DEFAULT_REDACTION_RULES],
    style: redactionCfg?.style ?? 'mask',
    classifications: (doc.dataProtection?.classifications ?? []).map((c) => ({
      name: c.name,
      datasets: c.datasets ?? [],
      uss: c.uss ?? [],
      tools: c.tools,
      roles: c.roles,
      redact: c.redact ? validateRedactRules(c.redact, `classification "${c.name}".redact`) : undefined,
      maxLines: c.maxLines,
      sample: c.sample,
    })),
  };

  return {
    path,
    defaultRole: defaultRole ?? '(none)',
    defaultEnvironment,
    roles,
    users,
    environments,
    dataProtection: dp,
  };
}
