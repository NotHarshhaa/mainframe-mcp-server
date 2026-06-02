/**
 * `list_uss_directory` — list the contents of a USS directory.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatUssListing, textResult } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { listUssDirectory } from './shared.js';

const inputShape = {
  path: z.string().min(1).describe('Absolute USS directory path, e.g. "/u/payroll".'),
};

export const registerListDirectoryTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'list_uss_directory',
    'List the contents of a USS (Unix System Services) directory.',
    inputShape,
    securedHandler(
      ctx,
      'list_uss_directory',
      async ({ path }) => {
        const entries = await listUssDirectory(ctx, path);
        ctx.logger.debug({ path, count: entries.length }, 'list_uss_directory');
        return textResult(formatUssListing(path, entries));
      },
      ({ path }) => ({ ussPath: path }),
    ),
  );
};
