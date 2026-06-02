/**
 * `query_racf_audit` — search RACF audit records from a configured log source.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { formatStructuredResponse, renderTable, textResult } from '../../utils/formatters.js';
import { queryRacfAudit } from './shared.js';

const inputShape = {
  user: z.string().optional().describe('Filter by user id (substring match).'),
  resource: z.string().optional().describe('Filter by resource name (substring match).'),
  hours: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Look-back window in hours (best-effort when timestamps are present).'),
};

export const registerQueryRacfAuditTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'query_racf_audit',
    'Query RACF security audit records from a configured USS path or dataset (RACF_AUDIT_USS_PATH / RACF_AUDIT_DATASET).',
    inputShape,
    safeHandler(async ({ user, resource, hours }) => {
      const entries = await queryRacfAudit(ctx, { user, resource, hours });
      if (entries.length === 0) {
        return textResult('No RACF audit records matched the given filters.');
      }

      const rows = entries.slice(0, 100).map((entry) => [
        entry.timestamp ?? '—',
        entry.user ?? '—',
        entry.event ?? '—',
        entry.resource ?? '—',
        entry.result ?? '—',
      ]);

      ctx.logger.debug({ count: entries.length }, 'query_racf_audit');
      const note = entries.length > 100 ? `\n\n(Showing first 100 of ${entries.length} records.)` : '';
      return textResult(
        formatStructuredResponse('RACF Audit Query', [
          {
            heading: `Records (${entries.length} matched)`,
            body: renderTable(['Timestamp', 'User', 'Event', 'Resource', 'Result'], rows) + note,
          },
        ]),
      );
    }),
  );
};
