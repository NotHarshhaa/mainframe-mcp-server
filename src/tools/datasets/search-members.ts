/**
 * `search_members` — search for members in a PDS by name pattern.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { formatMemberList, textResult } from '../../utils/formatters.js';
import { globToRegExp } from '../../utils/glob.js';
import { listMembers } from './shared.js';

const inputShape = {
  dsn: z.string().min(1).describe('PDS dataset name, e.g. "SYS1.PROCLIB".'),
  pattern: z
    .string()
    .optional()
    .describe('Member name pattern with "*"/"?" wildcards, e.g. "IKJ*". Omit to list all.'),
};

export const registerSearchMembersTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'search_members',
    'Search for members in a PDS, optionally filtered by a wildcard name pattern.',
    inputShape,
    safeHandler(async ({ dsn, pattern }) => {
      const members = await listMembers(ctx, dsn);
      const filtered = pattern
        ? members.filter((member) => globToRegExp(pattern, { caseInsensitive: true }).test(member.name))
        : members;
      ctx.logger.debug({ dsn, pattern, count: filtered.length }, 'search_members');
      return textResult(formatMemberList(dsn, filtered, pattern));
    }),
  );
};
