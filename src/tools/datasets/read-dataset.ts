/**
 * `read_dataset` — read a sequential dataset or PDS member.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { textResult, truncateLines } from '../../utils/formatters.js';
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
    safeHandler(async ({ dsn, member }) => {
      const raw = await readDataset(ctx, dsn, member);
      const { text, truncated, totalLines } = truncateLines(
        raw,
        ctx.config.limits.maxDatasetReadLines,
      );
      ctx.logger.debug({ dsn, member, totalLines, truncated }, 'read_dataset');

      const label = member ? `${dsn}(${member})` : dsn;
      const header = `${label}\n${'─'.repeat(Math.min(label.length, 48))}\n`;
      return textResult(header + text);
    }),
  );
};
