/**
 * `search_dataset` — search for datasets by pattern.
 *
 * Thin wrapper around the catalog list that accepts a free-form dataset
 * pattern (with wildcards) rather than requiring an explicit HLQ split.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { formatDatasetList, textResult } from '../../utils/formatters.js';
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
    safeHandler(async ({ pattern }) => {
      const datasets = await listDatasets(ctx, pattern);
      ctx.logger.debug({ pattern, count: datasets.length }, 'search_dataset');
      return textResult(formatDatasetList(datasets));
    }),
  );
};
