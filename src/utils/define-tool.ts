/**
 * Tool registration wrapper.
 *
 * `defineTool` replaces bare `server.tool(...)` calls so every tool gets, in
 * one place:
 *   - an optional `environment` argument (feature: multi-environment)
 *   - MCP tool annotations (readOnlyHint, destructiveHint, …) derived from
 *     the write-tool registry so advertised hints always match the security
 *     gates that actually run
 *   - the full secured call pipeline: security gates, policy RBAC, audit,
 *     data protection, safe errors (see utils/tool-handler.ts)
 *
 * The handler's argument type is derived from the shape (mirroring the SDK's
 * own inference), so tool implementations keep typed destructuring.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { TextToolResult, ToolContext } from '../types/tools.js';
import { WRITE_TOOLS } from './security.js';
import { executeSecuredCall } from './tool-handler.js';

/** Schema for the cross-cutting `environment` argument added to every tool. */
const environmentArg = {
  environment: z
    .string()
    .optional()
    .describe(
      'Named target environment (see list_environments), e.g. "dev", "prod". Omit to use the server default.',
    ),
};

/** Resource references a tool may address, extracted from its arguments. */
export interface ResourceRefs {
  dataset?: string;
  ussPath?: string;
}

/** Tools that can destroy or overwrite state (stronger than a plain write). */
const DESTRUCTIVE_TOOLS = new Set([
  'submit_jcl',
  'approve_write',
  'issue_console_command',
  'ims_command',
  'cancel_job',
  'delete_dataset',
  'delete_dataset_member',
  'delete_uss_file',
  'write_dataset',
  'write_dataset_member',
  'write_uss_file',
  'cics_disable_transaction',
]);

/** Tools whose annotations need to differ from the derived default. */
const ANNOTATION_OVERRIDES: Record<string, ToolAnnotations> = {
  // Creates an external ticket: a governed side effect, not a destructive one.
  create_incident_ticket: {
    destructiveHint: false,
    idempotentHint: false,
  },
};

/** "list_failed_jobs" → "List Failed Jobs". */
function titleize(name: string): string {
  return name
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * Derive MCP tool annotations from the write-tool registry.
 *
 * The hint contract mirrors the security gate exactly: a tool in WRITE_TOOLS
 * is advertised as mutating (readOnlyHint: false) and a tool in the
 * destructive list is additionally advertised as destructive — so clients
 * that enforce confirmations based on hints agree with what the server
 * itself enforces.
 */
export function deriveAnnotations(name: string): ToolAnnotations {
  const isWrite = WRITE_TOOLS.has(name);
  return {
    title: titleize(name),
    readOnlyHint: !isWrite,
    destructiveHint: DESTRUCTIVE_TOOLS.has(name),
    idempotentHint: !isWrite,
    openWorldHint: true,
    ...ANNOTATION_OVERRIDES[name],
  };
}

/** Extended shape = the tool's own shape + the cross-cutting environment arg. */
type ExtendedShape<TShape extends z.ZodRawShape> = TShape & typeof environmentArg;

/** Mirrors the SDK's ShapeOutput mapped type (schema output per shape key). */
type ShapeArgs<S extends z.ZodRawShape> = { [K in keyof S]: z.output<S[K]> };

/** The pipeline works on loosely-typed argument bags; tools keep their types. */
type LooseHandler = (args: Record<string, unknown>) => Promise<TextToolResult>;

/** Registration options: annotation overrides beyond the derived default. */
export interface DefineToolOptions {
  /** Merged over the derived annotations (title, hints, …). */
  annotations?: Partial<ToolAnnotations>;
}

/**
 * Register a tool with the environment argument and the secured pipeline.
 *
 * @param server - MCP server instance
 * @param ctx - shared tool context
 * @param name - stable tool identifier (used in audit records and gates)
 * @param description - tool description shown to MCP clients
 * @param shape - zod raw shape of the tool arguments
 * @param handler - the tool implementation
 * @param resources - optional extractor for the dataset/USS path the tool
 *   addresses, used for resource-boundary and classification enforcement
 * @param options - optional annotation overrides
 */
export function defineTool<TShape extends z.ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  name: string,
  description: string,
  shape: TShape,
  handler: (args: ShapeArgs<ExtendedShape<TShape>>) => Promise<TextToolResult>,
  resources?: (args: ShapeArgs<ExtendedShape<TShape>>) => ResourceRefs,
  options?: DefineToolOptions,
): void {
  const extendedShape = { ...environmentArg, ...shape } as ExtendedShape<TShape>;
  const annotations = { ...deriveAnnotations(name), ...options?.annotations };
  // The SDK's tool() ties its callback's parameter type to an internal mapped
  // type (ShapeOutput) that does not reduce over a generic shape, so the call
  // is made through a structural signature. Caller-facing typing is enforced
  // by defineTool's own signature above; runtime validation stays with zod.
  type ToolRegistrationFn = (
    name: string,
    description: string,
    paramsSchema: z.ZodRawShape,
    annotations: ToolAnnotations,
    cb: (args: Record<string, unknown>) => Promise<TextToolResult>,
  ) => unknown;
  (server.tool as unknown as ToolRegistrationFn)(
    name,
    description,
    extendedShape,
    annotations,
    (args: Record<string, unknown>) =>
      executeSecuredCall(
        ctx,
        name,
        args,
        handler as unknown as LooseHandler,
        resources as unknown as ((args: Record<string, unknown>) => ResourceRefs) | undefined,
      ),
  );
}
