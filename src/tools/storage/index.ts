/**
 * Storage tools — volume space inventory via the z/OSMF Storage Management
 * Interface (SMI), with configurable low-space alerts.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult, formatStructuredResponse, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { findSpaceAlerts, getVolumeSpace } from '../../utils/smi.js';

export const registerStorageTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'get_volume_space',
    'DASD volume space inventory via z/OSMF Storage Management Interface. Flags volumes below the free-space threshold (STORAGE_FREE_THRESHOLD, default 10%).',
    {
      volser: z.string().max(6).optional().describe('Volume serial to inspect (default: all volumes).'),
    },
    async ({ volser }) => {
      const volumes = await getVolumeSpace(ctx, volser);
      if (volumes.length === 0) {
        return textResult('No volume data returned by SMI. Verify z/OSMF version (2.4+) and storage-admin authorization.');
      }
      const rows = volumes.slice(0, 100).map((v) => [
        v.volser,
        v.totalSpace != null ? String(v.totalSpace) : '—',
        v.freeSpace != null ? String(v.freeSpace) : '—',
        v.percentFree != null ? `${v.percentFree}%` : '—',
        v.status ?? '—',
      ]);
      const alerts = findSpaceAlerts(volumes, ctx.config.enterprise.storageFreeThreshold);
      const sections = [
        {
          heading: 'Volumes',
          body:
            renderTable(['Volser', 'Total', 'Free', '% Free', 'Status'], rows) +
            (volumes.length > 100 ? `\n[showing first 100 of ${volumes.length} volumes]` : ''),
        },
        {
          heading: 'Space alerts',
          body:
            alerts.length > 0
              ? alerts.map((a) => `⚠ ${a.volser}: ${a.percentFree}% free (below ${ctx.config.enterprise.storageFreeThreshold}% threshold)`).join('\n')
              : `No volumes below the ${ctx.config.enterprise.storageFreeThreshold}% free threshold.`,
        },
        {
          heading: 'Units',
          body: 'Space figures use the units reported by SMI for your z/OSMF release (typically tracks or cylinders per the raw record).',
        },
      ];
      return textResult(formatStructuredResponse(`Volume space${volser ? ` — ${volser.toUpperCase()}` : ` (${volumes.length} volumes)`}`, sections));
    },
  );

  ctx.logger.debug('Registered storage tools');
};
