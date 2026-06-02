/**
 * Shared RACF audit helpers.
 */
import type { ToolContext } from '../../types/tools.js';
import { filterAuditEntries, parseRacfAuditLine, type RacfAuditEntry } from '../../utils/racf-parser.js';
import { requireRacfAuditSource } from '../../zowe/rest-client.js';
import { readDataset } from '../datasets/shared.js';
import { readUssFile } from '../uss/shared.js';
import { truncateLines } from '../../utils/formatters.js';

/** Load and parse RACF audit records from the configured source. */
export async function loadRacfAuditRecords(ctx: ToolContext): Promise<RacfAuditEntry[]> {
  const source = requireRacfAuditSource(ctx.config);
  let text: string;

  if (source.ussPath) {
    text = await readUssFile(ctx, source.ussPath);
  } else {
    text = await readDataset(ctx, source.dataset!);
  }

  const { text: capped } = truncateLines(text, ctx.config.limits.maxAuditLines);
  return capped
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseRacfAuditLine);
}

/** Query RACF audit records with optional filters. */
export async function queryRacfAudit(
  ctx: ToolContext,
  filters: { user?: string; resource?: string; hours?: number },
): Promise<RacfAuditEntry[]> {
  const records = await loadRacfAuditRecords(ctx);
  return filterAuditEntries(records, filters);
}
