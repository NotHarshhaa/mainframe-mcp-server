/**
 * `read_uss_file` — read a USS file.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { safeHandler } from '../../utils/errors.js';
import { textResult, formatContentHeader, truncateLines } from '../../utils/formatters.js';
import { readUssFile } from './shared.js';

const inputShape = {
  path: z.string().min(1).describe('Absolute USS file path, e.g. "/u/payroll/run.log".'),
};

export const registerReadFileTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'read_uss_file',
    'Read the contents of a USS file (output is line-capped for safety).',
    inputShape,
    safeHandler(async ({ path }) => {
      const raw = await readUssFile(ctx, path);
      const { text, truncated, totalLines } = truncateLines(
        raw,
        ctx.config.limits.maxDatasetReadLines,
      );
      ctx.logger.debug({ path, totalLines, truncated }, 'read_uss_file');
      const header = formatContentHeader(path, truncated, totalLines, ctx.config.limits.maxDatasetReadLines);
      return textResult(header + text);
    }),
  );
};
