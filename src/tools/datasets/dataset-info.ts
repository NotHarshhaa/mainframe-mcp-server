/**
 * `get_dataset_info` — catalog attributes for a dataset without reading content.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { getDatasetInfo } from './shared.js';

const inputShape = {
  dsn: z.string().min(1).describe('Fully-qualified dataset name, e.g. "SYS1.PROCLIB".'),
};

export const registerDatasetInfoTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_dataset_info',
    'Get catalog attributes (DSORG, RECFM, LRECL, volume) for a dataset without reading its content.',
    inputShape,
    securedHandler(ctx, 'get_dataset_info', async ({ dsn }) => {
      const info = await getDatasetInfo(ctx, dsn);
      ctx.logger.debug({ dsn }, 'get_dataset_info');

      const body = renderTable(
        ['Attribute', 'Value'],
        [
          ['Name', info.name],
          ['DSORG', info.dsorg ?? '—'],
          ['RECFM', info.recfm ?? '—'],
          ['LRECL', info.lrecl != null ? String(info.lrecl) : '—'],
          ['Volume', info.migrated ? 'MIGRATED' : (info.volume ?? '—')],
        ],
      );

      return textResult(formatStructuredResponse(`Dataset Info — ${info.name}`, [{ heading: 'Attributes', body }]));
    }, ({ dsn }) => ({ dataset: dsn })),
  );
};
