/**
 * `lookup_abend_code` — query the built-in abend code reference table.
 *
 * Agents can look up a specific code (S0C7, S806, S222, …) or browse/search
 * the full catalog without hitting z/OSMF.
 *
 * Improvements over the original:
 *   - `category` filter to restrict search to system or user abend codes
 *   - Suggestions list is sorted by code and includes the explanation excerpt
 *   - Browse response includes all fields (previously only code / title)
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { lookupAbend, searchAbendCodes } from '../../utils/abend-codes.js';
import { findRunbookUrl, parseRunbooks } from '../../utils/runbooks.js';
import { formatDocExcerpts } from '../../utils/doc-rag.js';
import { defineTool } from '../../utils/define-tool.js';
import {
  formatAbendCatalog,
  formatAbendInfo,
  formatStructuredResponse,
  textResult,
} from '../../utils/formatters.js';

const inputShape = {
  code: z
    .string()
    .optional()
    .describe(
      'Abend code to look up, e.g. "S806", "0C7", "S0C7", or "U0100". ' +
        'Omit to list or search the full catalog.',
    ),
  search: z
    .string()
    .optional()
    .describe(
      'Filter the catalog by code, title, explanation, or common-cause text (case-insensitive).',
    ),
  category: z
    .enum(['system', 'user'])
    .optional()
    .describe(
      'Restrict results to "system" (Sxxx) or "user" (Uxxxx) codes. ' +
        'Omit to include both categories.',
    ),
};

export const registerLookupAbendTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'lookup_abend_code', 'Look up z/OS abend codes (S0C7, S806, S0C4, S322, S0CB, U4038, etc.) with explanations, common causes, and remediation steps. Supports catalog search and category filter.', inputShape, async ({ code, search, category }) => {
      if (code) {
        const info = lookupAbend(code);
        if (!info) {
          // Suggest similar codes from the catalog
          const suggestions = searchAbendCodes(code)
            .filter((e) => !category || e.category === category)
            .slice(0, 5);
          const hint =
            suggestions.length > 0
              ? `\n\nDid you mean:\n${suggestions.map((entry) => `  ${entry.code} — ${entry.title}`).join('\n')}`
              : '';
          return textResult(
            `No reference entry for abend code "${code.trim()}".${hint}`,
          );
        }

        // Apply category filter on exact lookup
        if (category && info.category !== category) {
          return textResult(
            `Abend code "${info.code}" is a ${info.category} code, not a ${category} code.`,
          );
        }

        ctx.logger.debug({ code: info.code }, 'lookup_abend_code');

        // Runbook link (INCIDENT_RUNBOOKS) and internal-doc excerpts (RAG).
        const runbookUrl = findRunbookUrl(info.code, parseRunbooks(ctx.config.incident.runbooks));
        let docBody: string | undefined;
        if (ctx.docIndex) {
          try {
            const matches = ctx.docIndex.search(info.code, ctx.config.docs.maxResults);
            if (matches.length > 0) {
              docBody = formatDocExcerpts(matches, ctx.config.docs.maxExcerptChars);
            }
          } catch (err) {
            ctx.logger.warn({ err }, 'doc-rag: retrieval failed; continuing without excerpts');
          }
        }

        return textResult(
          formatStructuredResponse(`Abend Reference — ${info.code}`, [
            { heading: 'Details', body: formatAbendInfo(info) },
            ...(runbookUrl
              ? [{ heading: 'Runbook', body: `${runbookUrl}\nFollow the organization runbook for environment-specific steps.` }]
              : []),
            ...(docBody ? [{ heading: 'Internal documentation (RAG)', body: docBody }] : []),
          ]),
        );
      }

      let catalog = searchAbendCodes(search);
      if (category) {
        catalog = catalog.filter((e) => e.category === category);
      }

      ctx.logger.debug({ search, category, count: catalog.length }, 'lookup_abend_code');
      return textResult(formatAbendCatalog(catalog));
    });
};
