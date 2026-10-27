/**
 * Runbook linking.
 *
 * INCIDENT_RUNBOOKS holds a JSON map of abend code (exact, e.g. "S0C7", or
 * glob pattern, e.g. "S2*" / "U*") to an internal runbook URL. Abend lookups,
 * incident bundles, and created tickets attach the matching link so agents
 * land on the organization's own remediation steps, not just the generic
 * reference entry.
 */
import { globToRegExp } from './glob.js';

/** One parsed runbook entry. */
export interface RunbookLink {
  /** Exact abend code or glob pattern it matches. */
  pattern: string;
  /** Runbook URL. */
  url: string;
}

/**
 * Parse the INCIDENT_RUNBOOKS JSON into ordered entries.
 * Throws when the value is malformed (config validation normally catches
 * this at startup; the throw is a backstop for direct callers).
 */
export function parseRunbooks(json: string | undefined): RunbookLink[] {
  if (!json || json.trim() === '') return [];
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('INCIDENT_RUNBOOKS must be a JSON object');
  }
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([, url]) => typeof url === 'string' && url.trim() !== '')
    .map(([pattern, url]) => ({ pattern: pattern.trim().toUpperCase(), url: String(url).trim() }));
}

/**
 * Find the runbook URL for an abend code. Exact matches win over patterns;
 * among patterns the first (most specific in map order) match is used.
 */
export function findRunbookUrl(
  code: string | null | undefined,
  runbooks: RunbookLink[],
): string | undefined {
  if (!code) return undefined;
  const upper = code.trim().toUpperCase();
  const exact = runbooks.find((entry) => entry.pattern === upper);
  if (exact) return exact.url;
  const pattern = runbooks.find((entry) => globToRegExp(entry.pattern).test(upper));
  return pattern?.url;
}
