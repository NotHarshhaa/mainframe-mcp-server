/**
 * Documentation tools (feature: doc-rag).
 *
 * `search_internal_docs` retrieves excerpts from the organization's internal
 * documentation (DOCS_SOURCES: local .md/.txt playbooks and runbooks) using
 * local TF-IDF retrieval. It complements `lookup_abend_code` (built-in
 * abend reference) with site-specific knowledge, and is attached
 * automatically to incident bundles and abend lookups when configured.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { formatStructuredResponse, textResult } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { formatDocExcerpts } from '../../utils/doc-rag.js';

const inputShape = {
  query: z
    .string()
    .min(1)
    .describe('Free-text query, e.g. "S0C7 payroll fix", "catalog refresh steps", "S806 load module".'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(10)
    .optional()
    .describe('Maximum excerpts to return (default DOCS_MAX_RESULTS, 3).'),
  refresh: z
    .boolean()
    .optional()
    .describe('Force a re-index from disk before searching (default: refresh only when the cache is stale).'),
};

export const registerDocTools: ToolRegistrar = (server, ctx) => {
  if (!ctx.docIndex) {
    ctx.logger.debug('Doc RAG not configured (DOCS_SOURCES); search_internal_docs skipped');
    return;
  }

  defineTool(
    server,
    ctx,
    'search_internal_docs',
    'Search the organization internal documentation (runbooks, playbooks, troubleshooting notes from DOCS_SOURCES) and return the most relevant excerpts with file and heading attribution. Complements lookup_abend_code with site-specific knowledge.',
    inputShape,
    async ({ query, maxResults, refresh }) => {
      if (refresh) ctx.docIndex?.build();
      const matches = ctx.docIndex!.search(
        query,
        maxResults ?? ctx.config.docs.maxResults,
      );
      if (matches.length === 0) {
        return textResult(
          `No matching internal documentation found for "${query}". ` +
            `Indexed chunks: ${ctx.docIndex!.size}. Check DOCS_SOURCES or rephrase the query.`,
        );
      }
      const missing = ctx.docIndex!.missing;
      return textResult(
        formatStructuredResponse(`Internal documentation — "${query}"`, [
          {
            heading: 'Excerpts',
            body: formatDocExcerpts(matches, ctx.config.docs.maxExcerptChars),
          },
          ...(missing.length > 0
            ? [{ heading: 'Warning', body: `Some configured DOCS_SOURCES resolved to no files: ${missing.join(', ')}` }]
            : []),
        ]),
      );
    },
    undefined,
    { annotations: { title: 'Search Internal Docs' } },
  );
};
