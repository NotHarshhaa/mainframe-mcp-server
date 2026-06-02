/**
 * `search_uss_files` — search for files in a USS path by name pattern.
 *
 * Lists the directory and filters by a simple wildcard pattern. (A full
 * recursive find can be added later; this keeps the call bounded and fast.)
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { formatUssListing, textResult } from '../../utils/formatters.js';
import { listUssDirectory } from './shared.js';

const inputShape = {
  path: z.string().min(1).describe('Absolute USS directory path to search within.'),
  pattern: z
    .string()
    .min(1)
    .describe('File name pattern with "*"/"?" wildcards, e.g. "*.log".'),
};

/** Convert a simple file glob (* and ?) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export const registerSearchFilesTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'search_uss_files',
    'Search for files within a USS directory matching a wildcard name pattern.',
    inputShape,
    safeHandler(async ({ path, pattern }) => {
      const entries = await listUssDirectory(ctx, path);
      const regex = globToRegExp(pattern);
      const matched = entries.filter((entry) => regex.test(entry.name));
      ctx.logger.debug({ path, pattern, count: matched.length }, 'search_uss_files');
      return textResult(formatUssListing(path, matched));
    }),
  );
};
