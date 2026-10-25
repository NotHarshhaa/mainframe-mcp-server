/**
 * Governance tools — environment discovery and identity introspection.
 *
 * `list_environments` enumerates the named z/OS systems the server can reach
 * (DEV/TEST/UAT/PROD, multiple LPARs), with per-environment policy highlights.
 * `whoami` shows the acting identity, its resolved role, and the effective
 * policy — the debugging entry point for RBAC setups.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult, formatStructuredResponse, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { resolveIdentity } from '../../utils/security.js';
import { getActiveEnvironmentName, resolveActingUser } from '../../utils/runtime.js';
import { roleAllowsTool } from '../../config/policy.js';
import { WRITE_TOOLS } from '../../utils/security.js';

export const registerGovernanceTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'list_environments',
    'List the named z/OS environments this server can reach (DEV/TEST/UAT/PROD, LPARs), with read-only and role policy per environment.',
    {},
    async () => {
      if (!ctx.environments) {
        return textResult(
          'No named environments are configured. This server targets a single z/OSMF endpoint (ZOSMF_HOST).\n' +
            'Define environments in the policy file (SECURITY_POLICY_FILE) or via ZOSMF_ENVIRONMENTS to enable multi-environment support.',
        );
      }
      const rows = ctx.environments.list().map((env) => {
        const summary = ctx.environments!.summarize(env.name);
        return [
          summary.name + (summary.isDefault ? ' *' : ''),
          summary.description ?? '—',
          summary.host ? `${summary.host}:${summary.port ?? 443}` : '—',
          summary.readOnly ? 'read-only' : 'read-write',
          summary.auth,
          summary.allowedRoles?.join(', ') ?? '—',
        ];
      });
      const body =
        `(* = default environment used when a call omits the \`environment\` argument)\n\n` +
        renderTable(['Name', 'Description', 'z/OSMF', 'Writes', 'Auth', 'Allowed Roles'], rows);
      return textResult(body);
    },
  );

  defineTool(
    server,
    ctx,
    'whoami',
    'Show the acting identity for this session: user, mapped role, permissions summary, active environment, and data-protection status.',
    {},
    async () => {
      const user = resolveActingUser(ctx.config.zosmf.userId, ctx.config.zosmf.user);
      const activeEnv = getActiveEnvironmentName();
      const { role } = resolveIdentity(ctx);
      const environmentName = ctx.environments ? activeEnv : 'default';
      const envReadOnly = ctx.environments
        ? ctx.environments.isReadOnly(environmentName)
        : ctx.config.security.readOnly;

      const sampleTools = [...WRITE_TOOLS].slice(0, 3);
      const writeAllowed = sampleTools.some((tool) => {
        if (!roleAllowsTool(role, tool)) return false;
        if (ctx.config.security.readOnly) return false;
        if (envReadOnly) return false;
        if (role.readOnly) return false;
        return true;
      });

      const sections = [
        {
          heading: 'Identity',
          body: [
            `User:             ${user}`,
            `Role:             ${role.name}${role.description ? ` — ${role.description}` : ''}`,
            `Policy source:    ${ctx.policy?.path ?? 'environment variables (no policy file)'}`,
            `Transport user:   (from X-MCP-User header, SSE) / ZOSMF_USER_ID / service account`,
          ].join('\n'),
        },
        {
          heading: 'Environment',
          body: ctx.environments
            ? [
                `Active:     ${environmentName}${environmentName === ctx.environments.defaultName() ? ' (default)' : ''}`,
                `Available:  ${ctx.environments.names().join(', ')}`,
                `Writes:     ${envReadOnly ? 'BLOCKED — environment is read-only' : 'permitted (policy permitting)'}`,
              ].join('\n')
            : 'Single-environment server (ZOSMF_HOST). Pass environment="..." only after environments are configured.',
        },
        {
          heading: 'Permissions',
          body: [
            `Write operations:  ${writeAllowed ? 'permitted' : 'blocked (read-only mode or role)'}`,
            `Tool allowlist:    ${role.tools.allow.length > 0 ? role.tools.allow.join(', ') : 'all tools'}`,
            `Tool denylist:     ${role.tools.deny.length > 0 ? role.tools.deny.join(', ') : 'none'}`,
            `Dataset patterns:  ${role.datasets.allow.length > 0 ? role.datasets.allow.join(', ') : 'unrestricted'}`,
            `USS paths:         ${role.uss.allow.length > 0 ? role.uss.allow.join(', ') : 'unrestricted'}`,
            `Change ticket:     ${role.changeTicketPattern ? `required, pattern /${role.changeTicketPattern}/` : 'not required by role'}`,
            `Read line cap:     ${role.maxDatasetReadLines ?? 'server default'}`,
          ].join('\n'),
        },
        {
          heading: 'Data protection',
          body: [
            `Masking:      ${ctx.config.security.dataProtection ? 'enabled' : 'disabled'} on content-returning tools`,
            `Rules:        ${(ctx.policy?.dataProtection.rules ?? []).join(', ') || 'defaults (ssn, credit_card, email, secrets, jwt, private_key)'}`,
            `Style:        ${ctx.policy?.dataProtection.style ?? ctx.config.security.redactionStyle}`,
            `Classifications: ${ctx.policy ? String(ctx.policy.dataProtection.classifications.length) : '0'} (policy file)`,
          ].join('\n'),
        },
      ];
      return textResult(formatStructuredResponse(`Who Am I — ${user}`, sections));
    },
  );

  ctx.logger.debug('Registered governance tools');
};
