/**
 * Secure MCP tool handler wrapper.
 */
import type { ToolContext } from '../types/tools.js';
import type { TextToolResult } from '../types/tools.js';
import { safeHandler } from './errors.js';
import { enforceSecurity } from './security.js';

/** Wrap a tool handler with enterprise security checks and audit logging. */
export function securedHandler<T extends Record<string, unknown>>(
  ctx: ToolContext,
  toolName: string,
  handler: (args: T) => Promise<TextToolResult>,
  resources?: (args: T) => { dataset?: string; ussPath?: string },
): (args: T) => Promise<TextToolResult> {
  return safeHandler(async (args: T) => {
    enforceSecurity(ctx, toolName, args, resources?.(args));
    return handler(args);
  });
}
