/**
 * `search_uss_files` — search for files in a USS path by name pattern.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatUssListing, textResult } from '../../utils/formatters.js';
import { globToRegExp } from '../../utils/glob.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { listUssDirectory } from './shared.js';

const inputShape = {
  path: z.string().min(1).describe('Absolute USS directory path to search within.'),
  pattern: z
    .string()
    .min(1)
    .describe('File name pattern with "*"/"?" wildcards, e.g. "*.log".'),
};

export const registerSearchFilesTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'search_uss_files',
    'Search for files within a USS directory matching a wildcard name pattern.',
    inputShape,
    securedHandler(
      ctx,
      'search_uss_files',
      async ({ path, pattern }) => {
        const entries = await listUssDirectory(ctx, path);
        const regex = globToRegExp(pattern, { caseInsensitive: true });
        const matched = entries.filter((entry) => regex.test(entry.name));
        ctx.logger.debug({ path, pattern, count: matched.length }, 'search_uss_files');

        if (matched.length === 0) {
          return textResult(`No files in ${path} matched pattern "${pattern}".`);
        }

        return textResult(formatUssListing(path, matched));
      },
      ({ path }) => ({ ussPath: path }),
    ),
  );
};
