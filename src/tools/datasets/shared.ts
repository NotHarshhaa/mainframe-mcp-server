/**
 * Shared dataset helpers: normalizers and fetch routines over the Zowe
 * zos-files SDK.
 */
import { Get, List } from '@zowe/zos-files-for-zowe-sdk';
import type { Dataset, Member } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { NotFoundError } from '../../utils/errors.js';

interface RawDataset {
  dsname?: string;
  dsorg?: string;
  recfm?: string;
  lrecl?: number | string;
  vol?: string;
  migr?: string;
}

interface RawMember {
  member?: string;
  c4date?: string;
  m4date?: string;
  vers?: number;
}

/** Normalize a raw dataset list entry. */
export function normalizeDataset(raw: RawDataset): Dataset {
  const migrated = (raw.migr ?? '').toUpperCase() === 'YES' || raw.vol === 'MIGRAT';
  return {
    name: raw.dsname ?? '',
    dsorg: raw.dsorg,
    recfm: raw.recfm,
    lrecl: raw.lrecl != null ? Number(raw.lrecl) : undefined,
    volume: migrated ? undefined : raw.vol,
    migrated,
  };
}

/** Normalize a raw PDS member entry. */
export function normalizeMember(raw: RawMember): Member {
  return {
    name: raw.member ?? '',
    modified: raw.m4date ?? raw.c4date,
    version: raw.vers,
  };
}

/** List datasets matching a pattern (e.g. "SYS1.*"). */
export async function listDatasets(ctx: ToolContext, pattern: string): Promise<Dataset[]> {
  const response = await List.dataSet(ctx.session, pattern, { attributes: true });
  const items = (response.apiResponse?.items ?? []) as RawDataset[];
  return items.map(normalizeDataset).filter((ds) => ds.name.length > 0);
}

/** List members of a PDS. */
export async function listMembers(ctx: ToolContext, dsn: string): Promise<Member[]> {
  const response = await List.allMembers(ctx.session, dsn, {});
  const items = (response.apiResponse?.items ?? []) as RawMember[];
  return items.map(normalizeMember).filter((m) => m.name.length > 0);
}

/** Read a sequential dataset or PDS member as text. */
export async function readDataset(
  ctx: ToolContext,
  dsn: string,
  member?: string,
): Promise<string> {
  const target = member ? `${dsn}(${member})` : dsn;
  const buffer = await Get.dataSet(ctx.session, target, {});
  if (buffer == null) {
    throw new NotFoundError(`Dataset ${target} could not be read or is empty.`, { target });
  }
  return buffer.toString('utf8');
}
