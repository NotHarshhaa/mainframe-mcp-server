/**
 * MCP Server bootstrap.
 *
 * Builds the {@link McpServer}, loads the policy file (when configured),
 * creates the multi-environment registry and the SIEM audit pipeline, wires
 * up the shared {@link ToolContext}, and registers every tool group.
 * Transport selection (stdio vs SSE) lives here so the entry point stays thin.
 *
 * On SSE, the optional `X-MCP-User` request header is treated as the acting
 * identity for policy/RBAC and audit — intended for gateway deployments where
 * an authenticating proxy injects it. stdio servers derive the identity from
 * ZOSMF_USER_ID / ZOSMF_USER.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Logger } from 'pino';
import type { AppConfig } from './config/schema.js';
import { loadPolicy, type ResolvedPolicy } from './config/policy.js';
import { createAuditLogger, type AuditLogger, type SinkConfig } from './utils/audit.js';
import { setAgentInfo, runWithCallRuntime } from './utils/runtime.js';
import { setAuditTransport } from './utils/security.js';
import { createEnvironmentRegistry, type EnvironmentRegistry } from './environments/registry.js';
import type { ToolContext } from './types/tools.js';
import { createSession } from './zowe/client.js';
import { createEndUserSessionResolver } from './zowe/enduser.js';
import { registerJobTools } from './tools/jobs/index.js';
import { registerDatasetTools } from './tools/datasets/index.js';
import { registerUssTools } from './tools/uss/index.js';
import { registerOperationsTools } from './tools/operations/index.js';
import { registerCicsTools } from './tools/cics/index.js';
import { registerDb2Tools } from './tools/db2/index.js';
import { registerSmfTools } from './tools/smf/index.js';
import { registerSecurityTools } from './tools/security/index.js';
import { registerIntelligenceTools } from './tools/intelligence/index.js';
import { registerGovernanceTools } from './tools/governance/index.js';

export interface BuildServerOptions {
  /** Audit pipeline created by {@link createAuditFromConfig}; absent = no sinks. */
  audit?: AuditLogger;
}

/**
 * Create the audit pipeline from SECURITY_AUDIT_* settings, or `undefined`
 * when no sinks are configured (stderr pino audit lines still apply).
 */
export function createAuditFromConfig(config: AppConfig, logger: Logger): AuditLogger | undefined {
  const s = config.security;
  const sinks: SinkConfig = {
    ...(s.auditFile ? { file: s.auditFile } : {}),
    ...(s.auditSplunkUrl && s.auditSplunkToken
      ? { splunk: { url: s.auditSplunkUrl, token: s.auditSplunkToken } }
      : {}),
    ...(s.auditWebhookUrl
      ? { webhook: { url: s.auditWebhookUrl, ...(s.auditWebhookToken ? { token: s.auditWebhookToken } : {}) } }
      : {}),
    ...(s.auditOtlpUrl ? { otlp: { url: s.auditOtlpUrl } } : {}),
  };
  if (Object.keys(sinks).length === 0) return undefined;
  return createAuditLogger({ sinks }, logger);
}

/** Build the MCP server and register all tools. */
export function buildServer(config: AppConfig, logger: Logger, opts?: BuildServerOptions): McpServer {
  // Policy-as-code: fail closed on any structural problem.
  const policy: ResolvedPolicy | undefined = config.security.policyFile
    ? loadPolicy(config.security.policyFile)
    : undefined;
  if (policy) {
    logger.info(
      { path: policy.path, roles: [...policy.roles.keys()], environments: [...policy.environments.keys()] },
      'Policy file loaded',
    );
  }

  // Multi-environment: registry exists when named systems are configured
  // (policy file `environments:` or the ZOSMF_ENVIRONMENTS JSON variable).
  const environments: EnvironmentRegistry | undefined =
    (policy && policy.environments.size > 0) || config.zosmf.environments
      ? createEnvironmentRegistry(config, policy)
      : undefined;
  if (environments) {
    logger.info({ environments: environments.names(), default: environments.defaultName() }, 'Environments registered');
  }

  const server = new McpServer(
    { name: config.mcp.name, version: config.mcp.version },
    { capabilities: { tools: {}, logging: {} } },
  );

  // Capture the MCP client identity from the initialize handshake for audit.
  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    if (client) setAgentInfo({ name: client.name, version: client.version });
  };

  const serviceSession = createSession(config);
  const ctx: ToolContext = {
    session: serviceSession,
    config,
    logger,
    // Per-user identity: when ZOSMF_USER_ID is configured, z/OSMF calls run
    // under a PassTicket-authenticated end-user session instead of the
    // service account.
    resolveSession: createEndUserSessionResolver(config, serviceSession),
    policy,
    environments,
    audit: opts?.audit,
  };

  registerJobTools(server, ctx);
  registerDatasetTools(server, ctx);
  registerUssTools(server, ctx);
  registerOperationsTools(server, ctx);
  registerCicsTools(server, ctx);
  registerDb2Tools(server, ctx);
  registerSmfTools(server, ctx);
  registerSecurityTools(server, ctx);
  registerIntelligenceTools(server, ctx);
  registerGovernanceTools(server, ctx);

  logger.info('All tool groups registered');
  return server;
}

/** Connect the server over stdio (default transport). */
export async function startStdio(server: McpServer, logger: Logger): Promise<void> {
  setAuditTransport('stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('mainframe-mcp-server connected over stdio');
}

/** Connect the server over SSE behind a minimal HTTP listener. */
export async function startSse(
  server: McpServer,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  setAuditTransport('sse');
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.mcp.ssePort}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      await server.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(400).end('Unknown or missing sessionId');
        return;
      }
      // Acting identity for policy/RBAC and audit. Trust this header only
      // when the endpoint sits behind an authenticating gateway.
      const transportUser = req.headers['x-mcp-user'];
      const user = typeof transportUser === 'string' ? transportUser.trim() || undefined : undefined;
      await runWithCallRuntime(
        { transport: 'sse', sessionRef: sessionId, ...(user ? { transportUser: user } : {}) },
        () => transport.handlePostMessage(req, res),
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }

    res.writeHead(404).end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    // Surface listen failures (e.g. port already in use) as a clean startup error.
    httpServer.once('error', reject);
    httpServer.listen(config.mcp.ssePort, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
  logger.info(
    { port: config.mcp.ssePort, sse: '/sse', messages: '/messages' },
    'mainframe-mcp-server listening (SSE transport)',
  );
}
