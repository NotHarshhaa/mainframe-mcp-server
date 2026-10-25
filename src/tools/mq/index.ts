/**
 * IBM MQ tools — queue depth and channel status via the MQ REST admin API
 * (mqweb server). Configuration: MQ_REST_HOST / _PORT / _USER / _PASSWORD.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { textResult, formatStructuredResponse, renderTable } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { getMqChannelStatus, getMqQueues } from '../../utils/mq-rest.js';

export const registerMqTools: ToolRegistrar = (server, ctx) => {
  defineTool(
    server,
    ctx,
    'mq_queue_status',
    'Current depth of MQ queues (curdepth vs maxdepth, percent full) via MQ REST. Comma-separated names query several queues at once.',
    {
      qmgr: z.string().min(1).describe('Queue manager name, e.g. "QM01".'),
      queues: z.string().min(1).describe('Queue name(s), comma-separated, e.g. "PAYROLL.IN, PAYROLL.DLQ".'),
    },
    async ({ qmgr, queues }) => {
      const infos = await getMqQueues(ctx.config, qmgr, queues.split(','));
      const rows = infos.map((q) => [
        q.queue,
        q.curdepth != null ? String(q.curdepth) : '—',
        q.maxdepth != null ? String(q.maxdepth) : '—',
        q.percentFull != null ? `${q.percentFull}%` : '—',
      ]);
      const warnings = infos
        .filter((q) => q.percentFull != null && q.percentFull >= 80)
        .map((q) => `${q.queue} at ${q.percentFull}% of maxdepth — consider triggering or draining.`);
      const sections = [
        { heading: 'Queue depths', body: renderTable(['Queue', 'CurDepth', 'MaxDepth', '% Full'], rows) },
        ...(warnings.length > 0 ? [{ heading: 'Warnings', body: warnings.join('\n') }] : []),
      ];
      return textResult(formatStructuredResponse(`MQ queues on ${qmgr.toUpperCase()}`, sections));
    },
  );

  defineTool(
    server,
    ctx,
    'mq_channel_status',
    'Channel status (RUNNING/RETRYING/STOPPED, connection counts) for a queue manager via MQ REST. Omit the channel name to list all.',
    {
      qmgr: z.string().min(1).describe('Queue manager name, e.g. "QM01".'),
      channel: z.string().optional().describe('Channel name filter (default: all channels).'),
    },
    async ({ qmgr, channel }) => {
      const infos = await getMqChannelStatus(ctx.config, qmgr, channel);
      const rows = infos.map((c) => [
        c.channel,
        c.channelStatus ?? '—',
        c.channelType ?? '—',
        c.xmitq ?? '—',
        c.connectionCount != null ? String(c.connectionCount) : '—',
      ]);
      const attention = infos
        .filter((c) => c.channelStatus && !/RUNNING|INACTIVE/i.test(c.channelStatus))
        .map((c) => `${c.channel}: ${c.channelStatus}`);
      const sections = [
        {
          heading: 'Channels',
          body: rows.length > 0
            ? renderTable(['Channel', 'Status', 'Type', 'XmitQ', 'Conns'], rows)
            : 'No channel status returned — verify the channel name and mqweb admin rights.',
        },
        ...(attention.length > 0 ? [{ heading: 'Needs attention', body: attention.join('\n') }] : []),
      ];
      return textResult(formatStructuredResponse(`MQ channels on ${qmgr.toUpperCase()}`, sections));
    },
  );

  ctx.logger.debug('Registered MQ tools');
};
