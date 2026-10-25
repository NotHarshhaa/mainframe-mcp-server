/**
 * `list_db2_subsystems` — list Db2 locations/subsystems via Db2 REST.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { defineTool } from '../../utils/define-tool.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { listDb2Subsystems } from './shared.js';

export const registerListDb2SubsystemsTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'list_db2_subsystems', 'List Db2 subsystems (locations) available via Db2 REST (requires DB2_LOCATION).', {}, async () => {
      const locations = await listDb2Subsystems(ctx);
      ctx.logger.debug({ count: locations.length }, 'list_db2_subsystems');
      const rows = locations.map((loc) => [loc, 'AVAILABLE']);
      return textResult(
        `Db2 Subsystems (${locations.length} found)\n\n` +
          renderTable(['Location', 'Status'], rows),
      );
    });
};
