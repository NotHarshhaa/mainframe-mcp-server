/**
 * Shared Db2 REST helpers.
 */
import type { Db2CatalogEntry } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import {
  createEndpointSession,
  postJson,
  requireDb2Config,
} from '../../zowe/rest-client.js';

interface Db2SqlResponse {
  rows?: Array<Record<string, unknown>>;
  resultSet?: Array<Record<string, unknown>>;
  error?: string;
  sqlState?: string;
}

/** Execute a read-only SQL statement via Db2 REST. */
export async function executeDb2Sql(
  ctx: ToolContext,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const { location } = requireDb2Config(ctx.config);
  const session = createEndpointSession(ctx.config, 'db2');
  const response = await postJson<Db2SqlResponse>(session, `/v4/sql/${location}`, { sql });

  if (response.error) {
    throw new Error(`Db2 SQL error (${response.sqlState ?? 'unknown'}): ${response.error}`);
  }

  return response.rows ?? response.resultSet ?? [];
}

/** List Db2 subsystems/locations visible to the REST service. */
export async function listDb2Subsystems(ctx: ToolContext): Promise<string[]> {
  requireDb2Config(ctx.config);
  const session = createEndpointSession(ctx.config, 'db2');
  try {
    const response = await postJson<{ locations?: string[]; rows?: Array<{ location: string }> }>(
      session,
      '/v4/locations',
      {},
    );
    if (response.locations) return response.locations;
    if (response.rows) return response.rows.map((row) => String(row.location));
  } catch {
    // Fall back to configured location only.
  }
  return [ctx.config.enterprise.db2Location!];
}

/** Search the Db2 catalog for tables, views, or aliases. */
export async function searchDb2Catalog(
  ctx: ToolContext,
  pattern: string,
  schema?: string,
): Promise<Db2CatalogEntry[]> {
  const schemaFilter = schema
    ? `AND CREATOR = '${schema.replace(/'/g, "''")}'`
    : '';
  const likePattern = pattern.replace(/'/g, "''").replace(/\*/g, '%').replace(/\?/g, '_');
  const sql = `
    SELECT CREATOR, NAME, TYPE
    FROM SYSIBM.SYSTABLES
    WHERE NAME LIKE '${likePattern}' ${schemaFilter}
    FETCH FIRST 50 ROWS ONLY
  `.trim();

  const rows = await executeDb2Sql(ctx, sql);
  return rows.map((row) => ({
    schema: String(row.CREATOR ?? row.creator ?? '—'),
    name: String(row.NAME ?? row.name ?? '—'),
    type: String(row.TYPE ?? row.type ?? '—'),
  }));
}
