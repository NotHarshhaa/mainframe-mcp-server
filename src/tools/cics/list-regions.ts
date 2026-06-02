/**
 * `list_cics_regions` — list CICS regions via CMCI REST.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { listCicsRegions } from './shared.js';

const inputShape = {
  context: z
    .string()
    .optional()
    .describe('CMCI context (CICSplex name or region APPLID). Defaults to CMCI_CONTEXT env var.'),
};

export const registerListCicsRegionsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'list_cics_regions',
    'List CICS regions in a CMCI context (requires CMCI_CONTEXT and CMCI connectivity).',
    inputShape,
    safeHandler(async ({ context }) => {
      const regions = await listCicsRegions(ctx, context);
      if (regions.length === 0) return textResult('No CICS regions found in the specified context.');

      const rows = regions.map((region) => [
        region.applid,
        region.status,
        region.cicsplex ?? '—',
        region.sysid ?? '—',
      ]);
      ctx.logger.debug({ count: regions.length }, 'list_cics_regions');
      return textResult(
        `CICS Regions (${regions.length} found)\n\n` +
          renderTable(['APPLID', 'Status', 'CICSPlex', 'SYSID'], rows),
      );
    }),
  );
};
