/**
 * CICS tools registration.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { registerListCicsRegionsTool } from './list-regions.js';
import { registerGetCicsRegionTool } from './region-status.js';
import { registerListCicsTransactionsTool } from './list-transactions.js';
import { registerCicsActionTools } from './actions.js';

export const registerCicsTools: ToolRegistrar = (server, ctx) => {
  registerListCicsRegionsTool(server, ctx);
  registerGetCicsRegionTool(server, ctx);
  registerListCicsTransactionsTool(server, ctx);
  registerCicsActionTools(server, ctx);
  ctx.logger.debug('Registered CICS tools');
};
