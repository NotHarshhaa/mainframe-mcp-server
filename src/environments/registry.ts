/**
 * Multi-environment registry (DEV/TEST/UAT/PROD, multiple LPARs/sysplexes).
 *
 * Environments are named z/OSMF endpoints declared either in the policy file
 * (`environments:` section) or inline via the ZOSMF_ENVIRONMENTS JSON
 * environment variable. The server's base z/OSMF connection is always
 * available as the synthetic environment "default".
 *
 * Each environment carries its own credentials and its own policy surface:
 * `readOnly` (e.g. PROD), `allowedRoles`, and optional extra dataset/USS
 * fences. Sessions are created lazily per environment and cached.
 */
import { Session } from '@zowe/imperative';
import type { AppConfig } from '../config/schema.js';
import type { PolicyEnvironment, ResolvedPolicy, ResolvedUser } from '../config/policy.js';
import { ConfigError, ForbiddenError, ValidationError } from '../utils/errors.js';
import { childLogger } from '../utils/logger.js';
import { buildSessionConfig } from '../zowe/profiles.js';

/** Synthetic environment name for the base z/OSMF connection. */
export const DEFAULT_ENVIRONMENT = 'default';

/** A named target system. Either from policy YAML or ZOSMF_ENVIRONMENTS JSON. */
export interface EnvironmentDefinition extends PolicyEnvironment {
  name: string;
  /** Where the definition came from (for diagnostics). */
  source: 'base' | 'env' | 'policy';
}

export interface EnvironmentSummary {
  name: string;
  description?: string;
  host?: string;
  port?: number;
  readOnly: boolean;
  isDefault: boolean;
  auth: 'basic' | 'token' | 'certificate' | 'none';
  allowedRoles?: string[];
}

export interface EnvironmentRegistry {
  /** All environments, default first. */
  list(): EnvironmentDefinition[];
  /** Names of every environment. */
  names(): string[];
  /** Resolve a definition; throws ValidationError with available names. */
  get(name: string): EnvironmentDefinition;
  /** The environment used when a call does not name one. */
  defaultName(): string;
  /** Whether the name exists. */
  has(name: string): boolean;
  /** Cached (lazily created) Session for the environment. */
  getSession(name: string): Session;
  /** Redacted summary for tools and logs. */
  summarize(name?: string): EnvironmentSummary;
  /** Effective read-only for the environment (policy override, base fallback). */
  isReadOnly(name: string): boolean;
  /** RBAC gate: may this user (and their role) use this environment? */
  assertAllowed(name: string, user: string, userEntry: ResolvedUser | undefined, roleName: string): void;
}

/** Parse the ZOSMF_ENVIRONMENTS JSON variable into environment definitions. */
function parseEnvironmentsEnv(json: string): EnvironmentDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ConfigError(
      `ZOSMF_ENVIRONMENTS is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((entry, index): EnvironmentDefinition => {
    if (entry === null || typeof entry !== 'object') {
      throw new ConfigError(`ZOSMF_ENVIRONMENTS entry #${index + 1} must be an object.`);
    }
    const obj = entry as Record<string, unknown>;
    const name = obj.name ?? obj.environment;
    if (typeof name !== 'string' || !name.trim()) {
      throw new ConfigError(`ZOSMF_ENVIRONMENTS entry #${index + 1} is missing a "name".`);
    }
    if (typeof obj.host !== 'string' || !obj.host.trim()) {
      throw new ConfigError(`ZOSMF_ENVIRONMENTS entry "${name}" is missing "host".`);
    }
    return {
      name: name.trim(),
      source: 'env',
      description: typeof obj.description === 'string' ? obj.description : undefined,
      host: obj.host,
      port: typeof obj.port === 'number' ? obj.port : 443,
      basePath: typeof obj.basePath === 'string' ? obj.basePath : undefined,
      rejectUnauthorized: typeof obj.rejectUnauthorized === 'boolean' ? obj.rejectUnauthorized : true,
      user: typeof obj.user === 'string' ? obj.user : undefined,
      password: typeof obj.password === 'string' ? obj.password : undefined,
      token: typeof obj.token === 'string' ? obj.token : undefined,
      tokenType: typeof obj.tokenType === 'string' ? obj.tokenType : undefined,
      cert: typeof obj.cert === 'string' ? obj.cert : undefined,
      certKey: typeof obj.certKey === 'string' ? obj.certKey : undefined,
      readOnly: typeof obj.readOnly === 'boolean' ? obj.readOnly : undefined,
      allowedRoles: Array.isArray(obj.allowedRoles) ? (obj.allowedRoles as string[]) : undefined,
      datasets: undefined,
      uss: undefined,
    };
  });
}

function authMethod(def: EnvironmentDefinition): EnvironmentSummary['auth'] {
  if (def.cert && def.certKey) return 'certificate';
  if (def.token) return 'token';
  if (def.user) return 'basic';
  return 'none';
}

/** Create the registry from app config and (optionally) the policy document. */
export function createEnvironmentRegistry(
  config: AppConfig,
  policy?: ResolvedPolicy,
): EnvironmentRegistry {
  const log = childLogger('environments');

  const base: EnvironmentDefinition = {
    name: DEFAULT_ENVIRONMENT,
    source: 'base',
    description: 'Base z/OSMF connection (ZOSMF_* configuration)',
    host: config.zosmf.host,
    port: config.zosmf.port,
    basePath: config.zosmf.basePath,
    rejectUnauthorized: config.zosmf.rejectUnauthorized,
    user: config.zosmf.user,
    password: config.zosmf.password,
    token: config.zosmf.token,
    tokenType: config.zosmf.tokenType,
    cert: config.zosmf.cert,
    certKey: config.zosmf.certKey,
    readOnly: config.security.readOnly,
  };

  const byName = new Map<string, EnvironmentDefinition>([[base.name, base]]);

  if (config.zosmf.environments) {
    for (const def of parseEnvironmentsEnv(config.zosmf.environments)) {
      byName.set(def.name, def);
    }
  }
  if (policy) {
    // Policy definitions win over the JSON env var on name collisions —
    // the policy file is the reviewed, versioned source of truth.
    for (const [name, env] of policy.environments) {
      byName.set(name, { source: 'policy', ...env, name });
    }
  }

  const configuredDefault = config.zosmf.activeEnvironment ?? policy?.defaultEnvironment;
  if (configuredDefault && !byName.has(configuredDefault)) {
    throw new ConfigError(
      `Default environment "${configuredDefault}" is not defined. Defined: ${[...byName.keys()].join(', ')}.`,
    );
  }
  const defaultName = configuredDefault ?? DEFAULT_ENVIRONMENT;
  const sessions = new Map<string, Session>();

  const get = (name: string): EnvironmentDefinition => {
    const def = byName.get(name);
    if (!def) {
      throw new ValidationError(
        `Unknown environment "${name}". Available: ${[...byName.keys()].join(', ')}.`,
        { environment: name, available: [...byName.keys()] },
      );
    }
    return def;
  };

  return {
    list: () => [byName.get(defaultName)!, ...[...byName.values()].filter((d) => d.name !== defaultName)],
    names: () => [...byName.keys()],
    get,
    has: (name) => byName.has(name),
    defaultName: () => defaultName,
    getSession(name: string): Session {
      const def = get(name);
      const cached = sessions.get(name);
      if (cached) return cached;
      if (!def.host) {
        throw new ConfigError(`Environment "${name}" has no host configured.`);
      }
      if (!def.user && !def.token && !(def.cert && def.certKey)) {
        throw new ConfigError(
          `Environment "${name}" has no usable credentials. Define user+password, token, or cert+certKey.`,
        );
      }
      const session = new Session(
        buildSessionConfig({
          host: def.host,
          port: def.port ?? 443,
          basePath: def.basePath,
          rejectUnauthorized: def.rejectUnauthorized ?? true,
          user: def.user,
          password: def.password,
          token: def.token,
          tokenType: def.tokenType,
          cert: def.cert,
          certKey: def.certKey,
        }),
      );
      sessions.set(name, session);
      log.info(
        { environment: name, host: def.host, readOnly: def.readOnly ?? config.security.readOnly },
        'environment session initialized',
      );
      return session;
    },
    summarize(name?: string): EnvironmentSummary {
      const def = get(name ?? defaultName);
      return {
        name: def.name,
        description: def.description,
        host: def.host,
        port: def.port,
        readOnly: def.readOnly ?? config.security.readOnly,
        isDefault: def.name === defaultName,
        auth: authMethod(def),
        allowedRoles: def.allowedRoles,
      };
    },
    isReadOnly(name: string): boolean {
      const def = get(name);
      return def.readOnly ?? config.security.readOnly;
    },
    assertAllowed(name: string, user: string, userEntry: ResolvedUser | undefined, roleName: string): void {
      const def = get(name);
      if (userEntry?.environments && !userEntry.environments.includes(name)) {
        throw new ForbiddenError(
          `User "${user}" is not permitted to use environment "${name}" (policy: user environments: ${userEntry.environments.join(', ')}).`,
          { environment: name, user },
        );
      }
      if (def.allowedRoles && !def.allowedRoles.includes(roleName)) {
        throw new ForbiddenError(
          `Role "${roleName}" may not access environment "${name}" (policy: allowedRoles: ${def.allowedRoles.join(', ')}).`,
          { environment: name, role: roleName },
        );
      }
    },
  };
}
