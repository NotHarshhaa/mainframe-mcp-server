/**
 * `search_db2_catalog` — search Db2 catalog tables/views via SQL over REST.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { searchDb2Catalog } from './shared.js';

const inputShape = {
  pattern: z
    .string()
    .min(1)
    .describe('Table/view name pattern with wildcards (*, ?), e.g. "PAY*".'),
  schema: z.string().optional().describe('Optional schema/creator filter, e.g. "PAYROLL".'),
};

export const registerSearchDb2CatalogTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'search_db2_catalog',
    'Search the Db2 catalog for tables and views matching a name pattern (Db2 REST required).',
    inputShape,
    safeHandler(async ({ pattern, schema }) => {
      const entries = await searchDb2Catalog(ctx, pattern, schema);
      if (entries.length === 0) {
        return textResult(`No Db2 catalog objects matched pattern "${pattern}".`);
      }

      const rows = entries.map((entry) => [entry.schema, entry.name, entry.type]);
      ctx.logger.debug({ pattern, count: entries.length }, 'search_db2_catalog');
      return textResult(
        `Db2 Catalog (${entries.length} matches)\n\n` +
          renderTable(['Schema', 'Name', 'Type'], rows),
      );
    }),
  );
};
