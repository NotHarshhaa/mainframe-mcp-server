/**
 * `list_cics_transactions` — list transactions in a CICS region.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { securedHandler } from '../../utils/tool-handler.js';
import { renderTable, textResult } from '../../utils/formatters.js';
import { listCicsTransactions } from './shared.js';

const inputShape = {
  region: z.string().min(1).describe('CICS region APPLID to query transactions for.'),
  context: z.string().optional().describe('CMCI context. Defaults to CMCI_CONTEXT env var.'),
};

export const registerListCicsTransactionsTool: ToolRegistrar = (server, ctx) => {
  server.tool(
    'list_cics_transactions',
    'List CICS transaction definitions installed in a region via CMCI.',
    inputShape,
    securedHandler(ctx, 'mainframe_list_cics_transactions', async ({ region, context }) => {
      const transactions = await listCicsTransactions(ctx, region, context);
      if (transactions.length === 0) {
        return textResult(`No transactions found for region ${region}.`);
      }

      const rows = transactions.map((txn) => [
        txn.tranid,
        txn.program,
        txn.status ?? '—',
        txn.taskcount ?? '—',
      ]);
      ctx.logger.debug({ region, count: transactions.length }, 'list_cics_transactions');
      return textResult(
        `CICS Transactions — ${region} (${transactions.length} found)\n\n` +
          renderTable(['Tran ID', 'Program', 'Status', 'Tasks'], rows),
      );
    }),
  );
};
