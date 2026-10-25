/**
 * Profile resolution.
 *
 * Translates the validated {@link AppConfig} into the `ISession` shape the Zowe
 * SDK expects. Supports four auth methods, in resolution order:
 *
 *   1. mTLS client certificate (ZOSMF_CERT + ZOSMF_CERT_KEY)
 *   2. token (LTPA2 → `Authorization: LtpaToken2`, JWT/APIML → `Authorization: Bearer`)
 *   3. basic (user/password — also the carrier for PassTickets)
 */
import type { ISession } from '@zowe/imperative';
import type { AppConfig } from '../config/schema.js';
import { ConfigError } from '../utils/errors.js';

/** Map a ZOSMF_TOKEN_TYPE value onto the header semantics the SDK expects. */
export function isLtpaTokenType(tokenType: string | undefined): boolean {
  const t = (tokenType ?? 'LTPA2').trim().toUpperCase();
  return t === 'LTPA2' || t === 'LTPATOKEN2';
}

/** Minimal connection description the session builder needs. */
export interface SessionConnection {
  host: string;
  port: number;
  basePath?: string;
  rejectUnauthorized?: boolean;
  user?: string;
  password?: string;
  token?: string;
  tokenType?: string;
  cert?: string;
  certKey?: string;
}

/**
 * Build the Zowe session config for any connection description. Supports the
 * same four auth methods, in the same resolution order, as the top-level
 * z/OSMF config — used for the base session and for each named environment.
 */
export function buildSessionConfig(conn: SessionConnection): ISession {
  const base: ISession = {
    hostname: conn.host,
    port: conn.port,
    protocol: 'https',
    rejectUnauthorized: conn.rejectUnauthorized ?? true,
    basePath: conn.basePath,
  };

  if (conn.cert && conn.certKey) {
    // Imperative takes PEM file paths and loads the material itself.
    return {
      ...base,
      type: 'cert-pem',
      cert: conn.cert,
      certKey: conn.certKey,
      user: conn.user,
      password: conn.password,
    };
  }

  if (conn.token) {
    if (isLtpaTokenType(conn.tokenType)) {
      return {
        ...base,
        type: 'token',
        tokenType: 'LTPA2',
        tokenValue: conn.token,
      };
    }
    // JWT / APIML (apimlAuthenticationToken) / bearer tokens all travel as
    // `Authorization: Bearer <token>`.
    return {
      ...base,
      type: 'bearer',
      tokenValue: conn.token,
    };
  }

  if (conn.user && conn.password) {
    return {
      ...base,
      type: 'basic',
      user: conn.user,
      password: conn.password,
    };
  }

  // Should be unreachable: config schema enforces one auth method.
  throw new ConfigError('No usable z/OSMF authentication method was resolved.');
}

/** Build the Zowe session configuration from app config. */
export function resolveSessionConfig(config: AppConfig): ISession {
  return buildSessionConfig(config.zosmf);
}

/** A redacted summary of the connection, safe for logging. */
export function describeConnection(config: AppConfig): Record<string, unknown> {
  const { zosmf } = config;
  return {
    host: zosmf.host,
    port: zosmf.port,
    auth: zosmf.cert ? 'mTLS certificate' : zosmf.token ? `token (${(zosmf.tokenType ?? 'LTPA2').toUpperCase()})` : 'basic',
    user: zosmf.user ? `${zosmf.user.slice(0, 2)}***` : undefined,
    endUser: zosmf.userId,
    rejectUnauthorized: zosmf.rejectUnauthorized,
  };
}
