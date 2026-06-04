/**
 * `list_jobs` — list jobs filtered by owner, prefix, or status.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { formatJobList, textResult } from '../../utils/formatters.js';
import { listJobs } from './shared.js';

const inputShape = {
  owner: z
    .string()
    .optional()
    .describe('Owner (user id) filter. Use "*" for all. Defaults to "*".'),
  prefix: z
    .string()
    .optional()
    .describe('Job name prefix filter (wildcards allowed, e.g. "PAY*"). Defaults to "*".'),
  status: z
    .enum(['INPUT', 'ACTIVE', 'OUTPUT'])
    .optional()
    .describe('Optional lifecycle status filter applied after retrieval.'),
};

export const registerListJobsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'list_jobs',
    'List z/OS batch jobs filtered by owner, name prefix, or status.',
    inputShape,
    securedHandler(ctx, 'list_jobs', async ({ owner, prefix, status }) => {
      const jobs = await listJobs(ctx, owner ?? '*', prefix ?? '*');
      const filtered = status ? jobs.filter((job) => job.status === status) : jobs;
      const limit = ctx.config.limits.maxJobListResults;
      const capped = filtered.slice(0, limit);

      ctx.logger.debug(
        { count: capped.length, total: filtered.length, owner, prefix, status },
        'list_jobs',
      );
      return textResult(formatJobList(capped, filtered.length));
    }),
  );
};
