/**
 * `list_datasets` — list datasets matching an HLQ pattern.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { formatDatasetList, textResult } from '../../utils/formatters.js';
import { listDatasets } from './shared.js';

const inputShape = {
  hlq: z.string().min(1).describe('High-level qualifier, e.g. "SYS1".'),
  pattern: z
    .string()
    .optional()
    .describe('Optional lower-qualifier pattern appended to the HLQ, e.g. "PROC*".'),
};

export const registerListDatasetsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'list_datasets',
    'List catalog datasets matching a high-level qualifier (and optional pattern).',
    inputShape,
    safeHandler(async ({ hlq, pattern }) => {
      const search = pattern ? `${hlq}.${pattern}` : `${hlq}.*`;
      const datasets = await listDatasets(ctx, search);
      ctx.logger.debug({ search, count: datasets.length }, 'list_datasets');
      return textResult(formatDatasetList(datasets));
    }),
  );
};
