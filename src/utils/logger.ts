/**
 * Structured logging via pino.
 *
 * IMPORTANT: when the MCP server uses the stdio transport, stdout is the
 * JSON-RPC channel. Any stray bytes on stdout corrupt the protocol, so all log
 * output is directed to stderr (file descriptor 2).
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

let rootLogger: Logger | undefined;

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  /** Server name, attached to every log line as `name`. */
  name?: string;
}

/** Create (once) and return the process-wide root logger. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  if (rootLogger) return rootLogger;

  const { level = 'info', name = 'mainframe-mcp-server' } = options;

  rootLogger = pino(
    {
      name,
      level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    // Write to stderr so stdout stays clean for the MCP stdio transport.
    pino.destination(2),
  );

  return rootLogger;
}

/** Get the already-initialized root logger, creating a default one if needed. */
export function getLogger(): Logger {
  return rootLogger ?? createLogger();
}

/** Create a child logger scoped to a component (e.g. a tool group). */
export function childLogger(component: string): Logger {
  return getLogger().child({ component });
}

export type { Logger };
