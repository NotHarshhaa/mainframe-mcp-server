/**
 * Shared console helpers — MVS command issuance via the z/OSMF Console API
 * (@zowe/zos-console-for-zowe-sdk) and follow-up message collection.
 */
import { IssueCommand, CollectCommand } from '@zowe/zos-console-for-zowe-sdk';
import type { ToolContext } from '../../types/tools.js';
import { effectiveSession } from '../../zowe/enduser.js';
import { ConnectionError } from '../../utils/errors.js';
import { getText } from '../../zowe/rest-client.js';

export interface ConsoleCommandResult {
  success: boolean;
  response: string;
  consoleName: string;
  lastResponseKey?: string;
}

/** Issue an MVS system command through a (dynamic) extended MCS console. */
export async function issueMvsCommand(
  ctx: ToolContext,
  command: string,
  consoleNameOverride?: string,
): Promise<ConsoleCommandResult> {
  const consoleName = (consoleNameOverride ?? ctx.config.enterprise.consoleName).trim().toUpperCase();
  const session = await effectiveSession(ctx);
  try {
    const response = await IssueCommand.issue(session, {
      command: command.trim(),
      consoleName,
      processResponses: true,
    });
    return {
      success: response.success,
      response: response.commandResponse?.trim() || '(no response captured — command may respond asynchronously)',
      consoleName,
      ...(response.lastResponseKey ? { lastResponseKey: response.lastResponseKey } : {}),
    };
  } catch (err) {
    throw new ConnectionError(
      `Console command failed (console ${consoleName}). Verify CONSOLE authority and ZOSMF_CONSOLE_NAME. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Collect follow-up (unsolicited) messages for a prior command's key. */
export async function collectConsoleMessages(
  ctx: ToolContext,
  consoleName: string,
  responseKey: string,
): Promise<string> {
  const session = await effectiveSession(ctx);
  try {
    const collected = await CollectCommand.collectCommon(session, consoleName.trim().toUpperCase(), responseKey);
    // IZosmfCollectResponse carries solmsgs on the console record.
    const consoles = (collected as unknown as { consoles?: { solmsgs?: { message?: string }[] }[] }).consoles ?? [];
    const msgs = (consoles[0]?.solmsgs ?? []).map((m) => m.message ?? '').filter(Boolean);
    return msgs.length > 0 ? msgs.join('\n') : '(no additional messages)';
  } catch (err) {
    throw new ConnectionError(
      `Collecting console messages failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** GET unsolicited messages (operations-log tail) from a console. */
export async function getUnsolicitedMessages(ctx: ToolContext, consoleName?: string): Promise<string[]> {
  const session = await effectiveSession(ctx);
  const name = (consoleName ?? ctx.config.enterprise.consoleName).trim().toUpperCase();
  try {
    const raw = await getText(session, `/zosmf/restconsoles/consoles/${encodeURIComponent(name)}/solmsgs`);
    return extractMessages(raw);
  } catch (err) {
    throw new ConnectionError(
      `Reading console messages failed (console ${name}). Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Defensive extraction of message text from the z/OSMF solmsgs response. */
export function extractMessages(rawXml: string): string[] {
  const messages: string[] = [];
  // JSON shape: {"consoles":[{... "solmsgs":[{"message":"..."}]}]} when the
  // endpoint returns JSON; XML shape: <w3907:message>...</w3907:message>.
  try {
    const parsed = JSON.parse(rawXml) as Record<string, unknown>;
    const consoles = (parsed.consoles as { solmsgs?: { message?: string }[] }[] | undefined) ?? [];
    for (const m of consoles[0]?.solmsgs ?? []) {
      if (m.message) messages.push(m.message);
    }
    if (messages.length > 0) return messages;
  } catch {
    // Not JSON — fall through to XML parsing.
  }
  for (const m of rawXml.matchAll(/<[^>]*message[^>]*>([^<]+)<\//g)) {
    messages.push(m[1].trim());
  }
  return messages;
}
