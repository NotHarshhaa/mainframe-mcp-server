/**
 * z/OSMF Storage Management Interface (SMI) client — volume space inventory.
 *
 * Endpoint: GET /zosmf/restsmi/volumes (z/OSMF 2.4+). The response shape
 * varies slightly between releases, so normalization is defensive: unknown
 * fields are preserved in `raw` and the space figures are picked from the
 * likely attribute names.
 */
import type { ToolContext } from '../types/tools.js';
import { getJson } from '../zowe/rest-client.js';
import { effectiveSession } from '../zowe/enduser.js';

export interface VolumeSpace {
  volser: string;
  /** Free space (units reported by SMI, normalized below). */
  freeSpace?: number;
  totalSpace?: number;
  usedSpace?: number;
  /** Percent free, when computable. */
  percentFree?: number;
  status?: string;
  raw: Record<string, unknown>;
}

const FREE_KEYS = ['freeSpace', 'freespace', 'freeSpaceTracks', 'free_space'];
const TOTAL_KEYS = ['totalSpace', 'totalspace', 'totalSpaceTracks', 'total_space', 'totalCapacity'];
const USED_KEYS = ['usedSpace', 'usedspace', 'usedSpaceTracks', 'used_space'];
const VOLSER_KEYS = ['volser', 'volume', 'volumeSerial'];
const STATUS_KEYS = ['status', 'volStatus', 'volumeStatus'];

function pick(raw: Record<string, unknown>, keys: string[]): number | string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function normalizeVolume(raw: Record<string, unknown>): VolumeSpace {
  const volser = String(pick(raw, VOLSER_KEYS as string[]) ?? '(unknown)').toUpperCase();
  const freeSpace = pick(raw, FREE_KEYS);
  const totalSpace = pick(raw, TOTAL_KEYS);
  const usedSpace = pick(raw, USED_KEYS);
  const free = typeof freeSpace === 'number' ? freeSpace : undefined;
  const total = typeof totalSpace === 'number' ? totalSpace : undefined;
  const percentFree = free != null && total ? Math.round((free / total) * 1000) / 10 : undefined;
  const status = pick(raw, STATUS_KEYS);
  return {
    volser,
    ...(free != null ? { freeSpace: free } : {}),
    ...(total != null ? { totalSpace: total } : {}),
    ...(typeof usedSpace === 'number' ? { usedSpace } : {}),
    ...(percentFree != null ? { percentFree } : {}),
    ...(typeof status === 'string' ? { status } : {}),
    raw,
  };
}

/** Fetch volume space inventory (all volumes, or one volser). */
export async function getVolumeSpace(ctx: ToolContext, volser?: string): Promise<VolumeSpace[]> {
  const session = await effectiveSession(ctx);
  const path = volser
    ? `/zosmf/restsmi/volumes?volser=${encodeURIComponent(volser.trim().toUpperCase())}`
    : '/zosmf/restsmi/volumes';
  const raw = await getJson<{ volumes?: Record<string, unknown>[]; items?: Record<string, unknown>[] }>(session, path);
  const list = raw.volumes ?? raw.items ?? [];
  return list.map(normalizeVolume);
}

/** Flag volumes below the configured free-space threshold (percent). */
export function findSpaceAlerts(volumes: VolumeSpace[], thresholdPercent: number): VolumeSpace[] {
  return volumes.filter((v) => v.percentFree != null && v.percentFree < thresholdPercent);
}
