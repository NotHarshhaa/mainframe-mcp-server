/**
 * `search_dataset` — search for datasets by pattern.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatDatasetList, textResult } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { listDatasets } from './shared.js';

const inputShape = {
  pattern: z
    .string()
    .min(1)
    .describe('Dataset name pattern with wildcards, e.g. "PROD.**.LOADLIB".'),
};

export const registerSearchDatasetTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'search_dataset',
    'Search the catalog for datasets matching a wildcard pattern.',
    inputShape,
    securedHandler(
      ctx,
      'search_dataset',
      async ({ pattern }) => {
        const datasets = await listDatasets(ctx, pattern);
        ctx.logger.debug({ pattern, count: datasets.length }, 'search_dataset');
        return textResult(formatDatasetList(datasets));
      },
      ({ pattern }) => ({ dataset: pattern.split('.')[0] ?? pattern }),
    ),
  );
};
