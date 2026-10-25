/**
 * Zowe team config profile import.
 *
 * Reads a `zowe.config.json` team configuration and extracts a zosmf profile
 * so operators can reuse their existing Zowe connection settings instead of
 * duplicating them as environment variables.
 *
 * Scope: `properties` values and `secure` entries that are stored in the
 * config file itself (the case when `autoStore` runs without an external
 * credential manager). Values managed by an OS-keychain credential manager
 * are not readable by this process and are skipped.
 */
import { readFileSync } from 'node:fs';
import { ConfigError } from '../utils/errors.js';

export interface TeamProfileValues {
  host?: string;
  port?: number;
  basePath?: string;
  user?: string;
  password?: string;
  tokenType?: string;
  tokenValue?: string;
  rejectUnauthorized?: boolean;
}

interface RawProfile {
  name: string;
  path: string;
  type?: string;
  properties: Record<string, unknown>;
}

interface TeamConfigJson {
  profiles?: Record<string, unknown>;
  defaults?: Record<string, string>;
  secure?: Record<string, string>;
}

const SECURE_MARKER = '@secure';

/** Recursively collect profiles (team configs nest profiles by folder). */
function collectProfiles(
  node: Record<string, unknown>,
  parentPath: string,
  out: Map<string, RawProfile>,
): void {
  for (const [name, value] of Object.entries(node)) {
    if (value == null || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const path = parentPath ? `${parentPath}.${name}` : name;
    const nested = entry.profiles as Record<string, unknown> | undefined;
    if (entry.properties != null || entry.type != null) {
      out.set(path, {
        name,
        path,
        type: typeof entry.type === 'string' ? entry.type : undefined,
        properties: (entry.properties ?? {}) as Record<string, unknown>,
      });
    }
    if (nested && typeof nested === 'object') {
      collectProfiles(nested, path, out);
    }
  }
}

/** Pick the requested profile: exact path match first, then leaf-name match. */
function pickProfile(
  profiles: Map<string, RawProfile>,
  name?: string,
): RawProfile {
  if (name) {
    const exact = profiles.get(name);
    if (exact) return exact;
    const leaf = [...profiles.values()].find((p) => p.name === name);
    if (leaf) return leaf;
    throw new ConfigError(`Zowe profile "${name}" was not found in the team config.`, {
      available: [...profiles.keys()].slice(0, 10),
    });
  }
  const zosmf = [...profiles.values()].find((p) => p.type === 'zosmf');
  if (!zosmf) {
    throw new ConfigError(
      'No zosmf profile found in the Zowe team config. Set ZOSMF_PROFILE to name one explicitly.',
      { available: [...profiles.keys()].slice(0, 10) },
    );
  }
  return zosmf;
}

/**
 * Load connection values from a Zowe team config file. `profileName` may be a
 * full path ("lpar1.zosmf") or a leaf name; when omitted, the zosmf default
 * profile is used (`defaults.zosmf`, else the first profile typed `zosmf`).
 */
export function loadTeamProfile(
  filePath: string,
  profileName?: string,
): TeamProfileValues {
  let json: TeamConfigJson;
  try {
    json = JSON.parse(readFileSync(filePath, 'utf8')) as TeamConfigJson;
  } catch (err) {
    throw new ConfigError(
      `Unable to read the Zowe team config at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const profiles = new Map<string, RawProfile>();
  if (json.profiles && typeof json.profiles === 'object') {
    collectProfiles(json.profiles, '', profiles);
  }

  const requested = profileName ?? json.defaults?.zosmf;
  const profile = pickProfile(profiles, requested);

  const props = profile.properties;
  const secure = json.secure ?? {};
  // Secure entries are keyed by the profile path (not the JSON pointer),
  // e.g. "lpar1.zosmf.properties.user" for a profile nested under lpar1.
  const resolve = (key: string): unknown => {
    const direct = props[key];
    if (typeof direct === 'string' && direct !== SECURE_MARKER && direct !== '') return direct;
    const stored = secure[`${profile.path}.properties.${key}`];
    if (typeof stored === 'string' && stored !== '') return stored;
    return undefined;
  };

  const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
  const port = Number(props.port);

  return {
    host: str(props.host),
    port: Number.isInteger(port) && port > 0 ? port : undefined,
    basePath: str(props.basePath),
    user: str(resolve('user')),
    password: str(resolve('password')),
    tokenType: str(resolve('tokenType')) ?? str(props.tokenType),
    tokenValue: str(resolve('tokenValue')),
    rejectUnauthorized: typeof props.rejectUnauthorized === 'boolean' ? props.rejectUnauthorized : undefined,
  };
}
