/**
 * Shared HTTP plumbing for the ITSM providers: one JSON POST helper with a
 * request timeout and provider-error normalization so callers always get a
 * readable message instead of a stack from deep inside fetch.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Result of a successful (any status) JSON POST. */
export interface JsonPostResult<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
}

/** POST a JSON document and parse the response. Throws on HTTP failure. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  serviceName: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<JsonPostResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${serviceName} request failed: ${reason}`);
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed !== null
      ? JSON.stringify(parsed).slice(0, 500)
      : text.slice(0, 500);
    throw new Error(`${serviceName} returned HTTP ${response.status}: ${detail}`);
  }
  return { status: response.status, ok: response.ok, body: (parsed ?? {}) as T };
}

/** Comma-separated label list → array. */
export function parseLabels(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}
