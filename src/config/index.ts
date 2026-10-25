/**
 * Configuration loader.
 *
 * Configuration is supplied by the MCP client (Cursor, VS Code, Claude Desktop,
 * etc.) through the `env` block in the user's MCP config file — not from a
 * `.env` file. The IDE prompts for values at install/setup time and passes
 * them as environment variables when launching this server.
 */
import { readFileSync } from 'node:fs';
import { configSchema, type AppConfig } from './schema.js';
import { loadTeamProfile } from '../zowe/team-config.js';

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
      rejectUnauthorized: process.env.ZOSMF_REJECT_UNAUTHORIZED,
      cert: process.env.ZOSMF_CERT,
      certKey: process.env.ZOSMF_CERT_KEY,
      tokenFile: process.env.ZOSMF_TOKEN_FILE,
      userId: process.env.ZOSMF_USER_ID,
      passticketApp: process.env.ZOSMF_PASSTICKET_APP,
      teamConfig: process.env.ZOWE_TEAM_CONFIG,
      profile: process.env.ZOSMF_PROFILE,
      environments: process.env.ZOSMF_ENVIRONMENTS,
      activeEnvironment: process.env.ZOSMF_ENV,
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
      maxJobListResults: process.env.MAX_JOB_LIST_RESULTS,
      maxFailedJobResults: process.env.MAX_FAILED_JOB_RESULTS,
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
      rmfMetricsEnabled: process.env.RMF_METRICS_ENABLED,
      racfAuditUssPath: process.env.RACF_AUDIT_USS_PATH,
      racfAuditDataset: process.env.RACF_AUDIT_DATASET,
      consoleName: process.env.ZOSMF_CONSOLE_NAME,
      logrecDataset: process.env.LOGREC_DATASET,
      mqRestHost: process.env.MQ_REST_HOST,
      mqRestPort: process.env.MQ_REST_PORT,
      mqRestUser: process.env.MQ_REST_USER,
      mqRestPassword: process.env.MQ_REST_PASSWORD,
      schedulerAdapters: process.env.SCHEDULER_ADAPTERS,
      capacityMsuRating: process.env.CAPACITY_MSU_RATING,
      mlcMsuMonthlyPrice: process.env.MLC_MSU_MONTHLY_PRICE,
      mlcCurrency: process.env.MLC_CURRENCY,
      storageFreeThreshold: process.env.STORAGE_FREE_THRESHOLD,
    },
    security: {
      readOnly: process.env.SECURITY_READ_ONLY,
      allowedTools: process.env.SECURITY_ALLOWED_TOOLS,
      blockedTools: process.env.SECURITY_BLOCKED_TOOLS,
      allowedDatasetPatterns: process.env.SECURITY_ALLOWED_DATASET_PATTERNS,
      allowedUssPaths: process.env.SECURITY_ALLOWED_USS_PATHS,
      auditLogging: process.env.SECURITY_AUDIT_LOGGING,
      maxJclBytes: process.env.SECURITY_MAX_JCL_BYTES,
      writeApproval: process.env.SECURITY_WRITE_APPROVAL,
      jclScan: process.env.SECURITY_JCL_SCAN,
      jclScanStrict: process.env.SECURITY_JCL_SCAN_STRICT,
      blockedPrograms: process.env.SECURITY_BLOCKED_PROGRAMS,
      blockedJobClasses: process.env.SECURITY_BLOCKED_JOB_CLASSES,
      changeTicketPattern: process.env.SECURITY_CHANGE_TICKET_PATTERN,
      writeWindow: process.env.SECURITY_WRITE_WINDOW,
      writeDays: process.env.SECURITY_WRITE_DAYS,
      writeWindowTz: process.env.SECURITY_WRITE_WINDOW_TZ,
      policyFile: process.env.SECURITY_POLICY_FILE,
      auditFile: process.env.SECURITY_AUDIT_FILE,
      auditSplunkUrl: process.env.SECURITY_AUDIT_SPLUNK_URL,
      auditSplunkToken: process.env.SECURITY_AUDIT_SPLUNK_TOKEN,
      auditWebhookUrl: process.env.SECURITY_AUDIT_WEBHOOK_URL,
      auditWebhookToken: process.env.SECURITY_AUDIT_WEBHOOK_TOKEN,
      auditOtlpUrl: process.env.SECURITY_AUDIT_OTLP_URL,
      dataProtection: process.env.SECURITY_DATA_PROTECTION,
      redactionRules: process.env.SECURITY_REDACTION_RULES,
      redactionStyle: process.env.SECURITY_REDACTION_STYLE,
    },
  };
}

const SETUP_HINT = `
Configure this server in your IDE's MCP settings (not a .env file).
Copy config/mcp-client.example.json and fill in your values, or use your IDE's
MCP install wizard when adding @notharshhaa/mainframe-mcp-server.

Required at minimum:
  ZOSMF_HOST, and one of:
    ZOSMF_USER + ZOSMF_PASSWORD  |  ZOSMF_TOKEN  |  ZOSMF_CERT + ZOSMF_CERT_KEY

See docs/configuration.md for the full variable reference.
`.trim();

/** Read a token from a file (vault/agent injection) into the raw config. */
function applyTokenFile(raw: { zosmf: Record<string, unknown> }): void {
  const tokenFile = raw.zosmf.tokenFile;
  if (!tokenFile || raw.zosmf.token) return;
  try {
    raw.zosmf.token = readFileSync(String(tokenFile), 'utf8').trim();
  } catch (err) {
    throw new Error(
      `Unable to read ZOSMF_TOKEN_FILE (${String(tokenFile)}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Fill empty z/OSMF settings from a Zowe team config profile. Explicit
 * environment variables always win; the profile only fills gaps.
 */
function applyTeamProfile(raw: { zosmf: Record<string, unknown> }): void {
  const teamConfig = raw.zosmf.teamConfig;
  if (!teamConfig) return;
  const profile = loadTeamProfile(
    String(teamConfig),
    raw.zosmf.profile ? String(raw.zosmf.profile) : undefined,
  );
  if (!profile) return;
  const fill = (key: string, value: unknown): void => {
    if (value == null || value === '') return;
    if (raw.zosmf[key] == null || raw.zosmf[key] === '') raw.zosmf[key] = value;
  };
  fill('host', profile.host);
  fill('port', profile.port != null ? String(profile.port) : undefined);
  fill('basePath', profile.basePath);
  fill('user', profile.user);
  fill('password', profile.password);
  fill('tokenType', profile.tokenType);
  fill('token', profile.tokenValue);
  fill('rejectUnauthorized', profile.rejectUnauthorized != null ? String(profile.rejectUnauthorized) : undefined);
}

/**
 * Load and validate configuration. Result is cached after the first call so
 * repeated imports don't re-parse the environment.
 *
 * @param reload - Force a fresh read (primarily useful in tests).
 */
export function loadConfig(reload = false): AppConfig {
  if (cached && !reload) return cached;

  const raw = readEnv() as { zosmf: Record<string, unknown> };
  applyTokenFile(raw);
  applyTeamProfile(raw);

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}\n\n${SETUP_HINT}`);
  }

  cached = Object.freeze(parsed.data);
  return cached;
}

export type { AppConfig } from './schema.js';
