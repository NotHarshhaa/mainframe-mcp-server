/**
 * Dump summarization tool — CEEDUMP / SYSMDUMP / SYSUDUMP digest from spool
 * or a dataset, so agents get completion codes, failing modules, and
 * conditions without megabytes of hex storage.
 */
import { z } from 'zod';
import type { ToolRegistrar, ToolContext } from '../../types/tools.js';
import { textResult, formatStructuredResponse } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { summarizeDump } from '../../utils/dump-summary.js';
import { assertValidJobId, fetchJob, fetchSpoolFiles, fetchSpoolContent } from '../jobs/shared.js';
import { normalizeDatasetName, readDataset } from '../datasets/shared.js';
import { ValidationError } from '../../utils/errors.js';

export const registerDumpTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'summarize_dump',
    'Summarize an abend dump (CEEDUMP, SYSMDUMP, SYSUDUMP): completion codes, failing module/offset, LE conditions, and section inventory — from spool DD or dataset.',
    {
      jobId: z.string().optional().describe('JES job id when the dump is in spool, e.g. "JOB01234".'),
      ddName: z.string().optional().describe('Spool DD holding the dump, e.g. "SYSUDUMP", "SYSMDUMP", "CEEDUMP" (default: first of those found).'),
      dsn: z.string().optional().describe('Dataset containing the dump (alternative to jobId).'),
      member: z.string().optional().describe('PDS member name when dsn is a library.'),
    },
    async ({ jobId, ddName, dsn, member }) => {
      if (!jobId && !dsn) {
        throw new ValidationError('Provide either "jobId" (+ optional ddName) or "dsn" (+ optional member).');
      }

      let text: string;
      let source: string;
      if (jobId) {
        assertValidJobId(jobId);
        text = await readDumpFromSpool(ctx, jobId, ddName);
        source = `spool of ${jobId.toUpperCase()}${ddName ? ` DD ${ddName.toUpperCase()}` : ''}`;
      } else {
        const normalizedDsn = normalizeDatasetName(dsn as string);
        text = await readDataset(ctx, normalizedDsn, member?.toUpperCase());
        source = `dataset ${normalizedDsn}${member ? `(${member.toUpperCase()})` : ''}`;
      }

      const summary = summarizeDump(text);
      const sections = [
        { heading: 'Source', body: source },
        { heading: 'Dump type', body: summary.type },
        {
          heading: 'Completion codes',
          body:
            (summary.systemCompletionCode ? `System: ${summary.systemCompletionCode}` : 'System: not identified') +
            (summary.userCompletionCode ? ` · User: ${summary.userCompletionCode}` : ''),
        },
        ...(summary.failingModule || summary.failingOffset
          ? [{ heading: 'Failing module', body: `${summary.failingModule ?? '(unknown)'}${summary.failingOffset ? ` offset ${summary.failingOffset}` : ''}` }]
          : []),
        ...(summary.psw ? [{ heading: 'PSW at failure', body: summary.psw }] : []),
        ...(summary.program ? [{ heading: 'Program (enclave routine)', body: summary.program }] : []),
        ...(summary.conditions.length > 0
          ? [{ heading: 'LE conditions', body: summary.conditions.slice(0, 10).join(', ') + (summary.conditions.length > 10 ? ` (+${summary.conditions.length - 10} more)` : '') }]
          : []),
        { heading: 'Sections present', body: summary.sections.join(', ') || 'none recognized' },
        ...(summary.keyLines.length > 0 ? [{ heading: 'Key lines', body: summary.keyLines.join('\n') }] : []),
        { heading: 'Suggested next step', body: summary.suggestedFix },
      ];
      return textResult(formatStructuredResponse('Dump Summary', sections));
    },
  );

  ctx.logger.debug('Registered dump tools');
};

const DUMP_DDS = ['SYSUDUMP', 'SYSMDUMP', 'CEEDUMP', 'SYSABEND'];

/** Fetch dump text from spool: named DD, or the first dump-like DD found. */
async function readDumpFromSpool(ctx: ToolContext, jobId: string, ddName?: string): Promise<string> {
  const job = await fetchJob(ctx, jobId);
  const files = await fetchSpoolFiles(ctx, job.jobName, job.jobId);
  const candidates = ddName
    ? files.filter((f) => f.ddName.toUpperCase() === ddName.toUpperCase())
    : files.filter((f) => DUMP_DDS.includes(f.ddName.toUpperCase()));
  const target = candidates.sort((a, b) => b.id - a.id)[0];
  if (!target) {
    throw new ValidationError(
      `No dump spool file found for ${job.jobName} (${job.jobId})${ddName ? ` with DD ${ddName}` : ` (searched: ${DUMP_DDS.join(', ')})`}.`,
    );
  }
  return fetchSpoolContent(ctx, job.jobName, job.jobId, target.id);
}
