/**
 * Operations / diagnostics tools registration.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { registerFailedJobsTool } from './failed-jobs.js';
import { registerAbendSummaryTool } from './abend-summary.js';
import { registerSystemHealthTool } from './system-health.js';
import { registerInvestigateTool } from './investigate.js';
import { registerLookupAbendTool } from './lookup-abend.js';

export const registerOperationsTools: ToolRegistrar = (server, ctx) => {
  registerFailedJobsTool(server, ctx);
  registerAbendSummaryTool(server, ctx);
  registerSystemHealthTool(server, ctx);
  registerInvestigateTool(server, ctx);
  registerLookupAbendTool(server, ctx);
  ctx.logger.debug('Registered operations tools');
};

export * from './shared.js';
