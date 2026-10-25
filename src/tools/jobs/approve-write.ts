/**
 * `approve_write` — human-in-the-loop execution of a pending JCL submission.
 *
 * When SECURITY_WRITE_APPROVAL=true, submit_jcl validates everything, hands
 * back a one-time approval token, and does NOT touch JES. A human reviews the
 * JCL in the client, then the agent calls approve_write with that token.
 * The change window is re-checked at approval time so a submission validated
 * inside the window cannot be approved after it closes.
 */
import { z } from 'zod';
import type { ToolRegistrar } from '../../types/tools.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { formatStructuredResponse, textResult } from '../../utils/formatters.js';
import { defineTool } from '../../utils/define-tool.js';
import { parseWriteWindow, assertWithinWriteWindow } from '../../utils/write-window.js';
import { takePending } from './pending-approvals.js';
import { submitPreparedJcl } from './submit-jcl.js';

const inputShape = {
  token: z
    .string()
    .min(8)
    .describe('One-time approval token returned by submit_jcl when write approval is enforced.'),
};

export const registerApproveWriteTool: ToolRegistrar = (server, ctx) => {
  defineTool(server, ctx, 'approve_write', 'Approve and execute a pending JCL submission (human-in-the-loop). Requires the one-time token from submit_jcl; active only when SECURITY_WRITE_APPROVAL=true.', inputShape, async ({ token }) => {
      if (!ctx.config.security.writeApproval) {
        throw new ValidationError(
          'The approval flow is disabled (SECURITY_WRITE_APPROVAL=false). Use submit_jcl directly.',
        );
      }

      const pending = takePending(token.trim());
      if (!pending || pending.expiresAt <= Date.now()) {
        throw new NotFoundError(
          'No pending submission for this token. It was already approved, expired (10 minutes), or the server restarted — re-run submit_jcl.',
        );
      }

      // Re-check the change window at approval time: the window may have
      // closed between the original request and the human's approval.
      const { writeWindow, writeDays, writeWindowTz } = ctx.config.security;
      if (writeWindow) {
        const window = parseWriteWindow(writeWindow, writeDays, writeWindowTz);
        assertWithinWriteWindow(window);
      }

      const result = await submitPreparedJcl(ctx, pending.jcl, { prefix: 'approve_write' });

      const scanBody =
        pending.findings.length === 0
          ? 'No findings — JCL passed the pre-flight scan.'
          : pending.findings.map((f) => `  [${f.severity}] ${f.rule} (line ${f.line}): ${f.message}`).join('\n');

      return textResult(
        formatStructuredResponse('Approved submission executed', [
          { heading: 'Result', body: result },
          { heading: 'Change ticket', body: pending.changeTicket ?? 'not required' },
          { heading: 'Pre-flight scan (from original request)', body: scanBody },
        ]),
      );
    });
};
