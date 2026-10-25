/**
 * Per-user identity via z/OSMF PassTicket generation.
 *
 * The server authenticates to z/OSMF with the configured service credential,
 * then calls the z/OSMF Generate PassTicket REST API (`POST
 * /zosmf/restconapi/passticket`) to obtain a short-lived PassTicket for the
 * end user. Every z/OSMF tool call then runs under a session authenticated as
 * that user, so RACF sees who asked — not just the MCP service account.
 *
 * Requirements on z/OS: the service account needs authority to generate
 * PassTickets for the target user, and the application ID must be defined in
 * RACF PTKTDATA (e.g. `RDEFINE PTKTDATA ZOSMF ...`).
 */
import { Session } from '@zowe/imperative';
import type { AppConfig } from '../config/schema.js';
import type { ToolContext } from '../types/tools.js';
import { ConfigError, ConnectionError } from '../utils/errors.js';
import { childLogger } from '../utils/logger.js';
import { postJson } from './rest-client.js';

/** z/OSMF Generate PassTicket REST endpoint. */
const PASS_TICKET_RESOURCE = '/zosmf/restconapi/passticket';

/** PassTickets are valid ~10 minutes; refresh well before expiry. */
const PASS_TICKET_TTL_MS = 8 * 60 * 1000;

/** z/OS user id: 1–8 alphanumeric/national characters. */
const USER_ID_RE = /^[A-Z0-9@#$]{1,8}$/;

interface PassTicketResponse {
  ticket?: string;
  rc?: number;
  safRc?: number;
  reasonCode?: number;
  errorMessage?: string;
}

interface CacheEntry {
  session: Session;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Validate and normalize a z/OS user id. */
export function normalizeUserId(userId: string): string {
  const upper = userId.trim().toUpperCase();
  if (!USER_ID_RE.test(upper)) {
    throw new ConfigError(
      `Invalid ZOSMF_USER_ID "${userId}". Must be 1–8 alphanumeric characters (A-Z, 0-9, @, #, $).`,
    );
  }
  return upper;
}

/** Generate a PassTicket for `userId` under `applicationId` (RACF PTKTDATA). */
export async function generatePassTicket(
  serviceSession: Session,
  userId: string,
  applicationId: string,
): Promise<string> {
  const body = { userId, applicationId: applicationId.trim().toUpperCase() };
  let response: PassTicketResponse;
  try {
    response = await postJson<PassTicketResponse>(serviceSession, PASS_TICKET_RESOURCE, body);
  } catch (err) {
    throw new ConnectionError(
      `PassTicket generation request failed for ${userId}. Verify the service account can generate PassTickets and that application "${applicationId}" is defined in PTKTDATA. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const failed = (response.rc ?? 0) !== 0 || !response.ticket;
  if (failed) {
    throw new ConnectionError(
      `PassTicket generation failed for ${userId} (rc=${response.rc ?? 'n/a'}, safRc=${response.safRc ?? 'n/a'}, reason=${response.reasonCode ?? 'n/a'})${response.errorMessage ? `: ${response.errorMessage}` : ''}. Check PTKTDATA setup for application "${applicationId}".`,
    );
  }
  return response.ticket as string;
}

/**
 * Create the per-request session resolver for {@link ToolContext.resolveSession},
 * or `undefined` when per-user identity is not configured (`ZOSMF_USER_ID` unset).
 */
export function createEndUserSessionResolver(
  config: AppConfig,
  serviceSession: Session,
  options?: { ttlMs?: number },
): (() => Promise<Session>) | undefined {
  if (!config.zosmf.userId) return undefined;
  const userId = normalizeUserId(config.zosmf.userId);
  const applicationId = config.zosmf.passticketApp || 'ZOSMF';
  const ttlMs = options?.ttlMs ?? PASS_TICKET_TTL_MS;
  const log = childLogger('identity');

  return async (): Promise<Session> => {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.session;

    log.info({ endUser: userId, applicationId }, 'generating PassTicket for end-user identity');
    const ticket = await generatePassTicket(serviceSession, userId, applicationId);
    const session = new Session({
      hostname: config.zosmf.host,
      port: config.zosmf.port,
      protocol: 'https',
      rejectUnauthorized: config.zosmf.rejectUnauthorized,
      basePath: config.zosmf.basePath,
      type: 'basic',
      user: userId,
      password: ticket,
    });
    cache.set(userId, { session, expiresAt: Date.now() + ttlMs });
    return session;
  };
}

/** Drop any cached end-user session (used on auth failures and by tests). */
export function invalidateEndUserSession(userId?: string): void {
  if (userId) cache.delete(normalizeUserId(userId));
  else cache.clear();
}

/**
 * The session a tool should issue z/OSMF calls on: the end-user session when
 * per-user identity is configured, otherwise the service session.
 */
export async function effectiveSession(ctx: ToolContext): Promise<Session> {
  if (ctx.resolveSession) return ctx.resolveSession();
  return ctx.session;
}
