/**
 * `get_cics_region_status` — status of a single CICS region.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { textResult } from '../../utils/formatters.js';
import { getCicsRegion } from './shared.js';

const inputShape = {
  region: z.string().min(1).describe('CICS region APPLID, e.g. "CICSA".'),
  context: z.string().optional().describe('CMCI context. Defaults to CMCI_CONTEXT env var.'),
};

export const registerGetCicsRegionTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'get_cics_region_status',
    'Get the current status and attributes of a CICS region via CMCI.',
    inputShape,
    safeHandler(async ({ region, context }) => {
      const info = await getCicsRegion(ctx, region, context);
      ctx.logger.debug({ region: info.applid, status: info.status }, 'get_cics_region_status');
      const lines = [
        `Region:    ${info.applid}`,
        `Status:    ${info.status}`,
        `CICSPlex:  ${info.cicsplex ?? '—'}`,
        `SYSID:     ${info.sysid ?? '—'}`,
        `Job:       ${info.jobname ?? '—'} ${info.jobid ?? ''}`.trim(),
      ];
      return textResult(lines.join('\n'));
    }),
  );
};
