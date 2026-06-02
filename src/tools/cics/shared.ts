/**
 * Shared CICS CMCI helpers.
 */
import type { CicsRegion, CicsTransaction } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { parseCmciXml, type CmciRecord } from '../../utils/cmci-parser.js';
import { createEndpointSession, getText, requireCmciContext } from '../../zowe/rest-client.js';

function mapRegion(record: CmciRecord): CicsRegion {
  return {
    applid: record.applid ?? record.cicsregion ?? record.name ?? '—',
    status: record.cicsstatus ?? record.status ?? record.cicsstate ?? 'UNKNOWN',
    cicsplex: record.cicsplexname ?? record.cicsplex,
    sysid: record.sysid,
    jobname: record.jobname,
    jobid: record.jobid,
  };
}

function mapTransaction(record: CmciRecord): CicsTransaction {
  return {
    tranid: record.tranid ?? record.transaction ?? '—',
    program: record.program ?? record.pgmname ?? '—',
    status: record.status ?? record.trstatus,
    taskcount: record.taskcount ?? record.currtasks,
  };
}

/** Build a CMCI GET resource path. */
function cmciPath(context: string, resource: string, scope = '*'): string {
  return `/${resource}/${encodeURIComponent(context)}/${encodeURIComponent(scope)}/`;
}

/** List CICS regions in a CMCI context. */
export async function listCicsRegions(ctx: ToolContext, context?: string): Promise<CicsRegion[]> {
  const cmciContext = requireCmciContext(ctx.config, context);
  const session = createEndpointSession(ctx.config, 'cmci');
  const xml = await getText(session, cmciPath(cmciContext, 'CICSRegion'));
  return parseCmciXml(xml).map(mapRegion);
}

/** Get status for a specific CICS region APPLID. */
export async function getCicsRegion(ctx: ToolContext, region: string, context?: string): Promise<CicsRegion> {
  const cmciContext = requireCmciContext(ctx.config, context);
  const session = createEndpointSession(ctx.config, 'cmci');
  const xml = await getText(
    session,
    cmciPath(cmciContext, 'CICSRegion', region),
  );
  const records = parseCmciXml(xml).map(mapRegion);
  if (records.length === 0) {
    return { applid: region, status: 'NOT FOUND' };
  }
  return records[0];
}

/** List transactions in a CICS region. */
export async function listCicsTransactions(
  ctx: ToolContext,
  region: string,
  context?: string,
): Promise<CicsTransaction[]> {
  const cmciContext = requireCmciContext(ctx.config, context);
  const session = createEndpointSession(ctx.config, 'cmci');
  const xml = await getText(
    session,
    cmciPath(cmciContext, 'CICSTransaction', region),
  );
  return parseCmciXml(xml).map(mapTransaction);
}
