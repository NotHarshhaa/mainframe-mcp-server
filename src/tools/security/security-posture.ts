/**
 * `security_posture_summary` — report enterprise security configuration.
 */
import type { ToolRegistrar } from '../../types/tools.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { WRITE_TOOLS } from '../../utils/security.js';
import { securedHandler } from '../../utils/tool-handler.js';

function flag(enabled: boolean): string {
  return enabled ? 'ENABLED' : 'disabled';
}

export const registerSecurityPostureTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'security_posture_summary',
    'Report the server security posture: read-only mode, allowlists, TLS, audit logging, and resource boundaries.',
    {},
    securedHandler(ctx, 'security_posture_summary', async () => {
      const { security, zosmf, enterprise } = ctx.config;
      const allowedTools = security.allowedTools?.split(',').filter(Boolean) ?? [];
      const blockedTools = security.blockedTools?.split(',').filter(Boolean) ?? [];
      const datasetPatterns = security.allowedDatasetPatterns?.split(',').filter(Boolean) ?? [];
      const ussPaths = security.allowedUssPaths?.split(',').filter(Boolean) ?? [];

      const controls = renderTable(
        ['Control', 'Status'],
        [
          ['Read-only mode', flag(security.readOnly)],
          ['Audit logging', flag(security.auditLogging)],
          ['TLS verification', flag(zosmf.rejectUnauthorized)],
          ['Token auth', flag(Boolean(zosmf.token))],
          ['Tool allowlist', allowedTools.length > 0 ? `${allowedTools.length} tool(s)` : 'all tools'],
          ['Tool blocklist', blockedTools.length > 0 ? blockedTools.join(', ') : 'none'],
          ['Dataset boundaries', datasetPatterns.length > 0 ? `${datasetPatterns.length} pattern(s)` : 'unrestricted'],
          ['USS boundaries', ussPaths.length > 0 ? `${ussPaths.length} path(s)` : 'unrestricted'],
          ['Max JCL bytes', String(security.maxJclBytes)],
          ['Write tools blocked in RO', [...WRITE_TOOLS].join(', ')],
          ['RACF audit source', enterprise.racfAuditUssPath ?? enterprise.racfAuditDataset ?? 'not configured'],
        ],
      );

      const recommendations: string[] = [];
      if (!security.readOnly) recommendations.push('Consider SECURITY_READ_ONLY=true for production AI agents.');
      if (!zosmf.rejectUnauthorized) recommendations.push('Enable TLS verification (ZOSMF_REJECT_UNAUTHORIZED=true).');
      if (datasetPatterns.length === 0) recommendations.push('Set SECURITY_ALLOWED_DATASET_PATTERNS to scope dataset access.');
      if (ussPaths.length === 0) recommendations.push('Set SECURITY_ALLOWED_USS_PATHS to scope USS file access.');
      if (allowedTools.length === 0) recommendations.push('Set SECURITY_ALLOWED_TOOLS to a least-privilege tool list.');
      if (!enterprise.racfAuditUssPath && !enterprise.racfAuditDataset) {
        recommendations.push('Configure RACF_AUDIT_USS_PATH or RACF_AUDIT_DATASET for audit correlation.');
      }

      const recBody =
        recommendations.length > 0
          ? recommendations.map((item, index) => `${index + 1}. ${item}`).join('\n')
          : 'All recommended enterprise controls appear to be configured.';

      ctx.logger.debug('security_posture_summary');
      return textResult(
        formatStructuredResponse('Security Posture Summary', [
          { heading: 'Active controls', body: controls },
          { heading: 'Recommendations', body: recBody },
        ]),
      );
    }),
  );
};
