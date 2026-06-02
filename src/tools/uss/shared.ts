/**
 * Shared USS (Unix System Services) helpers: normalizers and fetch routines.
 */
import { Get, List } from '@zowe/zos-files-for-zowe-sdk';
import type { UssEntry } from '../../types/zos.js';
import type { ToolContext } from '../../types/tools.js';
import { NotFoundError } from '../../utils/errors.js';

interface RawUssItem {
  name?: string;
  mode?: string;
  size?: number;
  user?: string;
  group?: string;
  mtime?: string;
}

/** Map a Unix mode string's leading char to an entry type. */
function typeFromMode(mode: string | undefined): UssEntry['type'] {
  switch ((mode ?? '').charAt(0)) {
    case 'd':
      return 'directory';
    case 'l':
      return 'symlink';
    case '-':
      return 'file';
    default:
      return 'other';
  }
}

/** Normalize a raw USS list item. */
export function normalizeUssEntry(raw: RawUssItem): UssEntry {
  return {
    name: raw.name ?? '',
    type: typeFromMode(raw.mode),
    size: raw.size,
    user: raw.user,
    group: raw.group,
    mode: raw.mode,
    modified: raw.mtime,
  };
}

/** List a USS directory. The "." and ".." entries are filtered out. */
export async function listUssDirectory(ctx: ToolContext, path: string): Promise<UssEntry[]> {
  const response = await List.fileList(ctx.session, path, {});
  const items = (response.apiResponse?.items ?? []) as RawUssItem[];
  return items
    .map(normalizeUssEntry)
    .filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..');
}

/** Read a USS file as UTF-8 text. */
export async function readUssFile(ctx: ToolContext, path: string): Promise<string> {
  const buffer = await Get.USSFile(ctx.session, path, {});
  if (buffer == null) {
    throw new NotFoundError(`USS file ${path} could not be read or is empty.`, { path });
  }
  return buffer.toString('utf8');
}
