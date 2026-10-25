/**
 * CICS statistics and gated actions via CMCI.
 *
 * `get_cics_region_stats` returns the attributes CMCI reports for a region
 * (CICSRegion resource). `cics_newcopy` and `cics_disable_transaction` are
 * governed writes implemented as CMCI resource actions (PUT), available on
 * CICS TS 5.6+/6.x systems with CMCI actions enabled.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult, formatStructuredResponse, truncateLines } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { ValidationError } from '../../utils/errors.js';
import {
  assertValidApplid,
  normalizeApplid,
} from './shared.js';
import { parseCmciXml, type CmciRecord } from '../../utils/cmci-parser.js';
import { createEndpointSession, getText, putText, requireCmciContext } from '../../zowe/rest-client.js';

function cmciPath(context: string, resource: string, scope = '*'): string {
  return `/${resource}/${encodeURIComponent(context)}/${encodeURIComponent(scope)}/`;
}

/** Render region attributes as a two-column table, sorted, capped. */
function renderAttributes(record: CmciRecord): string {
  const entries = Object.entries(record)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 40);
  if (entries.length === 0) return '(no attributes returned)';
  const width = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `${k.padEnd(width)}  ${String(v)}`).join('\n');
}

export const registerCicsActionTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'get_cics_region_stats',
    'Statistics and attributes of a CICS region from the CMCI CICSRegion resource (uptime, task counts, and other region-level fields your CMCI release provides).',
    {
      region: z.string().min(1).describe('CICS region APPLID.'),
      context: z.string().optional().describe('CMCI context (CICSplex or APPLID). Defaults to CMCI_CONTEXT.'),
    },
    async ({ region, context }) => {
      assertValidApplid(region);
      const applid = normalizeApplid(region);
      const cmciContext = requireCmciContext(ctx.config, context);
      const session = createEndpointSession(ctx.config, 'cmci');
      const xml = await getText(session, cmciPath(cmciContext, 'CICSRegion', applid));
      const records = parseCmciXml(xml);
      if (records.length === 0) {
        return textResult(`No CMCI record returned for region ${applid} in context ${cmciContext}.`);
      }
      return textResult(
        formatStructuredResponse(`CICS region statistics — ${applid}`, [
          { heading: 'Attributes', body: renderAttributes(records[0]) },
          { heading: 'Note', body: 'Attribute availability depends on CICS TS/CMCI version. Detailed SMF statistics require CICS statistics domains.' },
        ]),
      );
    },
  );

  defineTool(
    server,
    ctx,
    'cics_newcopy',
    'NEWCOPY a CICS program (phased-in fresh copy) via a CMCI resource action — gated write. Requires CMCI with actions enabled (CICS TS 5.6+).',
    {
      region: z.string().min(1).describe('CICS region APPLID.'),
      program: z.string().min(1).max(8).describe('Program name (1–8 chars).'),
      context: z.string().optional().describe('CMCI context. Defaults to CMCI_CONTEXT.'),
    },
    async ({ region, program, context }) => {
      assertValidApplid(region);
      const applid = normalizeApplid(region);
      const progName = program.trim().toUpperCase();
      if (!/^[A-Z0-9#$@]{1,8}$/.test(progName)) {
        throw new ValidationError(`Invalid CICS program name "${program}". Must be 1–8 alphanumeric/national characters.`, { program });
      }
      const cmciContext = requireCmciContext(ctx.config, context);
      const session = createEndpointSession(ctx.config, 'cmci');
      const path = `${cmciPath(cmciContext, 'CICSProgram', applid)}?CRITERIA=(PROGRAM=${progName})`;
      const body = `<?xml version="1.0" encoding="UTF-8"?><request><action name="NEWCOPY"/></request>`;
      const responseXml = await putText(session, path, body);
      const records = parseCmciXml(responseXml);
      const resultSummary =
        responseXml.match(/<resultsummary[\s\S]{0,300}?(?:\/>|<\/resultsummary>)/i)?.[0] ?? '(no result summary in response)';
      return textResult(
        formatStructuredResponse(`CICS NEWCOPY — ${progName} in ${applid}`, [
          { heading: 'Action', body: `NEWCOPY ${progName} via CMCI (${cmciContext}/${applid})` },
          { heading: 'Records matched', body: String(records.length) },
          { heading: 'CMCI result summary', body: truncateLines(resultSummary, 20).text },
          {
            heading: 'Note',
            body: 'If the CMCI result reports an error code, verify the program is enabled for NEWCOPY and your CICS TS version supports CMCI actions.',
          },
        ]),
      );
    },
  );

  defineTool(
    server,
    ctx,
    'cics_disable_transaction',
    'Disable a CICS local transaction via a CMCI SET action (ENABLESTATUS=DISABLED) — gated write. New work is refused; in-flight tasks finish.',
    {
      region: z.string().min(1).describe('CICS region APPLID.'),
      transaction: z.string().min(1).max(4).describe('Transaction id (1–4 chars).'),
      enable: z.boolean().optional().describe('true = ENABLE the transaction instead (default false = disable).'),
      context: z.string().optional().describe('CMCI context. Defaults to CMCI_CONTEXT.'),
    },
    async ({ region, transaction, enable, context }) => {
      assertValidApplid(region);
      const applid = normalizeApplid(region);
      const tranId = transaction.trim().toUpperCase();
      if (!/^[A-Z0-9#$@]{1,4}$/.test(tranId)) {
        throw new ValidationError(`Invalid CICS transaction id "${transaction}". Must be 1–4 alphanumeric/national characters.`, { transaction });
      }
      const cmciContext = requireCmciContext(ctx.config, context);
      const session = createEndpointSession(ctx.config, 'cmci');
      const path = `${cmciPath(cmciContext, 'CICSLocalTransaction', applid)}?CRITERIA=(TRANID=${tranId})`;
      const status = enable ? 'ENABLED' : 'DISABLED';
      const body = `<?xml version="1.0" encoding="UTF-8"?><request><action name="SET"><parameter name="ENABLESTATUS" value="${status}"/></parameter></action></request>`;
      const responseXml = await putText(session, path, body);
      const records = parseCmciXml(responseXml);
      return textResult(
        formatStructuredResponse(`CICS transaction ${tranId} → ${status}`, [
          { heading: 'Action', body: `SET ENABLESTATUS=${status} for ${tranId} in ${applid} (via CMCI)` },
          { heading: 'Records matched', body: String(records.length) },
          { heading: 'CMCI response', body: truncateLines(responseXml, 30).text },
          {
            heading: 'Note',
            body: 'DISABLED refuses new attaches; tasks already running finish normally. Re-enable with enable=true. Verify with list_cics_transactions.',
          },
        ]),
      );
    },
  );

  ctx.logger.debug('Registered CICS action tools');
};
