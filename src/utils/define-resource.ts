/**
 * Resource registration wrapper (feature: mcp-native).
 *
 * `defineResource` wraps `server.registerResource` so every resource read
 * flows through the same enterprise pipeline as a tool call:
 *   - runtime context (correlation id, acting user, default environment)
 *   - policy RBAC on the default environment
 *   - the security gate of the *underlying tool* the resource exposes, so
 *     SECURITY_ALLOWED/BLOCKED_TOOLS and dataset boundary patterns apply
 *     consistently between tools and resources
 *   - data protection (masking / classification caps) on the returned text
 *   - one hash-chained audit record per read
 *
 * Resource URIs carry no `environment` argument, so reads resolve against
 * the default environment.
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ResolvedIdentity } from '../types/tools.js';
import type { ResourceRefs } from './define-tool.js';
import { toToolErrorResult, MainframeMcpError } from './errors.js';
import { auditToolCall, enforceSecurity, resolveIdentity } from './security.js';
import { applyDataProtection } from './tool-handler.js';
import { runWithCallRuntime } from './runtime.js';
import type { StructuredSection } from './formatters.js';
import { formatStructuredResponse, textResult } from './formatters.js';

/** Read implementation for a resource: returns the text body. */
export type ResourceReader = (
  uri: URL,
  variables: Record<string, string>,
) => Promise<string>;

export interface DefineResourceOptions {
  /** Stable resource name (shown to clients). */
  name: string;
  /** Static URI or a URI template like `mainframe://jobs/{jobId}/spool`. */
  uri: string;
  title: string;
  description: string;
  mimeType?: string;
  /**
   * Underlying tool whose security gate runs for this read (e.g.
   * `read_dataset` for a dataset-member resource). Also used in audit.
   */
  gateToolName: string;
  /** Extractor for the dataset/USS path the resource addresses. */
  resourceRefs?: (variables: Record<string, string>) => ResourceRefs | undefined;
  read: ResourceReader;
}

/** Build a structured section response body for a resource read. */
export function resourceBody(title: string, sections: StructuredSection[]): string {
  return formatStructuredResponse(title, sections);
}

function decodeVariables(variables: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    const first = Array.isArray(value) ? value[0] : value;
    try {
      out[key] = decodeURIComponent(first ?? '');
    } catch {
      out[key] = first ?? '';
    }
  }
  return out;
}

/**
 * Register one resource (static or template) behind the secured pipeline.
 * Never throws at registration time; read errors are converted to MCP errors
 * and audited.
 */
export function defineResource(server: McpServer, ctx: ToolContext, options: DefineResourceOptions): void {
  const mimeType = options.mimeType ?? 'text/plain';

  const securedRead = async (
    uri: URL,
    rawVariables: Record<string, string | string[]>,
  ): Promise<ReadResourceResult> => {
    const start = Date.now();
    const variables = decodeVariables(rawVariables);
    let outcomeAudited = false;

    try {
      return await runWithCallRuntime(
        { environment: ctx.environments ? ctx.environments.defaultName() : 'default' },
        async () => {
          // RBAC on the default environment (resources carry no environment arg).
          const identity: ResolvedIdentity = resolveIdentity(ctx);
          if (ctx.environments) {
            ctx.environments.assertAllowed(
              ctx.environments.defaultName(),
              identity.user,
              identity.userEntry,
              identity.role.name,
            );
          }

          const refs = options.resourceRefs?.(variables);
          const args = { ...variables } as Record<string, unknown>;
          try {
            enforceSecurity(ctx, options.gateToolName, args, refs);
          } catch (err) {
            if (err instanceof MainframeMcpError) {
              auditToolCall(ctx, options.gateToolName, args, {
                outcome: 'blocked',
                durationMs: Date.now() - start,
                errorCode: err.code,
                resourceUri: uri.toString(),
              });
              outcomeAudited = true;
            }
            throw err;
          }

          const text = await options.read(uri, variables);
          const protectedOut = applyDataProtection(
            ctx,
            options.gateToolName,
            textResult(text),
            identity,
            refs,
          );
          const body = protectedOut.result.content[0]?.type === 'text' ? protectedOut.result.content[0].text : text;
          auditToolCall(ctx, options.gateToolName, args, {
            outcome: 'success',
            durationMs: Date.now() - start,
            resultChars: Buffer.byteLength(body, 'utf8'),
            resourceUri: uri.toString(),
            ...(protectedOut.audit ? { dataProtection: protectedOut.audit } : {}),
          });
          outcomeAudited = true;
          return { contents: [{ uri: uri.toString(), mimeType, text: body }] };
        },
      );
    } catch (err) {
      if (!outcomeAudited) {
        auditToolCall(ctx, options.gateToolName, variables, {
          outcome: 'error',
          durationMs: Date.now() - start,
          errorCode: err instanceof MainframeMcpError ? err.code : 'UNEXPECTED_ERROR',
          resourceUri: uri.toString(),
        });
      }
      // Surface as an MCP error result rather than crashing the transport.
      const converted = toToolErrorResult(err);
      throw new Error(
        converted.content[0]?.type === 'text' ? converted.content[0].text : 'Resource read failed',
      );
    }
  };

  const isTemplate = /\{[^}]+\}/.test(options.uri);
  if (isTemplate) {
    server.registerResource(
      options.name,
      new ResourceTemplate(options.uri, { list: undefined }),
      { title: options.title, description: options.description },
      securedRead,
    );
  } else {
    server.registerResource(
      options.name,
      options.uri,
      { title: options.title, description: options.description, mimeType },
      async (uri) => securedRead(uri, {}),
    );
  }
}
