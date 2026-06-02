/**
 * `lookup_abend_code` — query the built-in abend code reference table.
 *
 * Agents can look up a specific code (S0C7, S806, S222, …) or browse/search
 * the full catalog without hitting z/OSMF.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { lookupAbend, searchAbendCodes } from '../../utils/abend-codes.js';
import { safeHandler } from '../../utils/errors.js';
import { formatAbendCatalog, formatAbendInfo, formatStructuredResponse, textResult } from '../../utils/formatters.js';

const inputShape = {
  code: z
    .string()
    .optional()
    .describe(
      'Abend code to look up, e.g. "S806", "0C7", or "U0100". Omit to list or search the catalog.',
    ),
  search: z
    .string()
    .optional()
    .describe('Filter the catalog by code, title, or explanation substring.'),
};

export const registerLookupAbendTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'lookup_abend_code',
    'Look up z/OS abend codes (S0C7, S806, S222, S0C4, etc.) with explanations, common causes, and fixes.',
    inputShape,
    safeHandler(async ({ code, search }) => {
      if (code) {
        const info = lookupAbend(code);
        if (!info) {
          const suggestions = searchAbendCodes(code).slice(0, 5);
          const hint =
            suggestions.length > 0
              ? `\n\nDid you mean:\n${suggestions.map((entry) => `  ${entry.code} — ${entry.title}`).join('\n')}`
              : '';
          return textResult(
            `No reference entry for abend code "${code.trim()}".${hint}`,
          );
        }

        ctx.logger.debug({ code: info.code }, 'lookup_abend_code');
        return textResult(
          formatStructuredResponse(`Abend Reference — ${info.code}`, [
            { heading: 'Details', body: formatAbendInfo(info) },
          ]),
        );
      }

      const catalog = searchAbendCodes(search);
      ctx.logger.debug({ search, count: catalog.length }, 'lookup_abend_code');
      return textResult(formatAbendCatalog(catalog));
    }),
  );
};
