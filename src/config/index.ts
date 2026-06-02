/**
 * Configuration loader.
 *
 * Reads from `process.env` (after `dotenv` has populated it), maps the flat
 * env vars onto the structured {@link configSchema}, validates, and returns a
 * typed, frozen {@link AppConfig}.
 */
import { config as loadDotenv } from 'dotenv';
import { configSchema, type AppConfig } from './schema.js';

let cached: AppConfig | undefined;

/** Build the raw (unvalidated) config object from environment variables. */
function readEnv(): unknown {
  return {
    zosmf: {
      host: process.env.ZOSMF_HOST,
      port: process.env.ZOSMF_PORT,
      basePath: process.env.ZOSMF_BASE_PATH,
      user: process.env.ZOSMF_USER,
      password: process.env.ZOSMF_PASSWORD,
      token: process.env.ZOSMF_TOKEN,
      tokenType: process.env.ZOSMF_TOKEN_TYPE,
      rejectUnauthorized: process.env.ZOSMF_REJECT_UNAUTHORIZED ?? 'true',
    },
    mcp: {
      name: process.env.MCP_SERVER_NAME,
      version: process.env.MCP_SERVER_VERSION,
      transport: process.env.MCP_TRANSPORT,
      ssePort: process.env.MCP_SSE_PORT,
    },
    logLevel: process.env.LOG_LEVEL,
    limits: {
      maxJobOutputLines: process.env.MAX_JOB_OUTPUT_LINES,
      maxDatasetReadLines: process.env.MAX_DATASET_READ_LINES,
      maxJesSpoolFiles: process.env.MAX_JES_SPOOL_FILES,
      maxAuditLines: process.env.MAX_AUDIT_LINES,
    },
    enterprise: {
      cmciHost: process.env.CMCI_HOST,
      cmciPort: process.env.CMCI_PORT,
      cmciContext: process.env.CMCI_CONTEXT,
      cmciBasePath: process.env.CMCI_BASE_PATH,
      db2Host: process.env.DB2_HOST,
      db2Port: process.env.DB2_PORT,
      db2Location: process.env.DB2_LOCATION,
      db2BasePath: process.env.DB2_BASE_PATH,
      smfSummaryDataset: process.env.SMF_SUMMARY_DATASET,
      rmfMetricsEnabled: process.env.RMF_METRICS_ENABLED ?? 'true',
      racfAuditUssPath: process.env.RACF_AUDIT_USS_PATH,
      racfAuditDataset: process.env.RACF_AUDIT_DATASET,
    },
  };
}

/**
 * Load and validate configuration. Result is cached after the first call so
 * repeated imports don't re-parse the environment.
 *
 * @param reload - Force a fresh read (primarily useful in tests).
 */
export function loadConfig(reload = false): AppConfig {
  if (cached && !reload) return cached;

  loadDotenv();

  const parsed = configSchema.safeParse(readEnv());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }

  cached = Object.freeze(parsed.data);
  return cached;
}

export type { AppConfig } from './schema.js';
