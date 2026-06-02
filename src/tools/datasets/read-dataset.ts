/**
 * `read_dataset` — read a sequential dataset or PDS member.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatContentHeader, textResult, truncateLines } from '../../utils/formatters.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { readDataset } from './shared.js';

const inputShape = {
  dsn: z.string().min(1).describe('Dataset name, e.g. "SYS1.PROCLIB".'),
  member: z
    .string()
    .optional()
    .describe('PDS member name. Omit for a sequential dataset.'),
};

export const registerReadDatasetTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'read_dataset',
    'Read the content of a sequential dataset or a PDS member (output is line-capped).',
    inputShape,
    securedHandler(
      ctx,
      'read_dataset',
      async ({ dsn, member }) => {
        const raw = await readDataset(ctx, dsn, member);
        const { text, truncated, totalLines } = truncateLines(
          raw,
          ctx.config.limits.maxDatasetReadLines,
        );
        ctx.logger.debug({ dsn, member, totalLines, truncated }, 'read_dataset');

        const label = member ? `${dsn}(${member})` : dsn;
        const header = formatContentHeader(
          label,
          truncated,
          totalLines,
          ctx.config.limits.maxDatasetReadLines,
        );
        return textResult(header + text);
      },
      ({ dsn }) => ({ dataset: dsn }),
    ),
  );
};
