/**
 * Zod schema describing every configuration value the server accepts.
 *
 * The schema is the single source of truth: it documents defaults, coerces the
 * string-typed environment variables into their proper types, and validates
 * mutually-exclusive auth options.
 */
import { z } from 'zod';

/** Coerce common truthy/falsy string env values into a boolean. */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const portSchema = z.coerce.number().int().min(1).max(65535);

export const configSchema = z
  .object({
    zosmf: z.object({
      host: z.string().min(1, 'ZOSMF_HOST is required'),
      port: portSchema.default(443),
      basePath: z.string().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      token: z.string().optional(),
      tokenType: z.string().optional(),
      rejectUnauthorized: booleanFromEnv.default(true),
      // mTLS client certificate (PEM file paths). Checked before token/basic.
      cert: z.string().optional(),
      certKey: z.string().optional(),
      // Read the token from a file at startup (vault/agent injection).
      tokenFile: z.string().optional(),
      // End-user identity: when set, PassTickets are generated for this user
      // and all z/OSMF calls run under that identity (RACF sees who asked).
      userId: z.string().optional(),
      // RACF PTKTDATA application name for PassTicket generation.
      passticketApp: z.string().default('ZOSMF'),
      // Zowe team config profile import (plaintext properties; secure entries
      // in the config file are honored when present).
      teamConfig: z.string().optional(),
      profile: z.string().optional(),
    }),
    mcp: z.object({
      name: z.string().default('mainframe-mcp-server'),
      version: z.string().default('2.5.0'),
      transport: z.enum(['stdio', 'sse']).default('stdio'),
      ssePort: portSchema.default(3000),
    }),
    logLevel: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    limits: z.object({
      maxJobOutputLines: z.coerce.number().int().positive().default(5000),
      maxDatasetReadLines: z.coerce.number().int().positive().default(2000),
      maxJesSpoolFiles: z.coerce.number().int().positive().default(20),
      maxAuditLines: z.coerce.number().int().positive().default(500),
      maxJobListResults: z.coerce.number().int().positive().default(500),
      maxFailedJobResults: z.coerce.number().int().positive().default(100),
    }),
    enterprise: z.object({
      cmciHost: z.string().optional(),
      cmciPort: portSchema.default(1490),
      cmciContext: z.string().optional(),
      cmciBasePath: z.string().default('/CICSSystemManagement'),
      db2Host: z.string().optional(),
      db2Port: portSchema.default(50400),
      db2Location: z.string().optional(),
      db2BasePath: z.string().default('/dbrest'),
      smfSummaryDataset: z.string().optional(),
      rmfMetricsEnabled: booleanFromEnv.default(true),
      racfAuditUssPath: z.string().optional(),
      racfAuditDataset: z.string().optional(),
    }),
    security: z.object({
      // Safe default: write tools are blocked unless explicitly enabled.
      readOnly: booleanFromEnv.default(true),
      allowedTools: z.string().optional(),
      blockedTools: z.string().optional(),
      allowedDatasetPatterns: z.string().optional(),
      allowedUssPaths: z.string().optional(),
      auditLogging: booleanFromEnv.default(true),
      maxJclBytes: z.coerce.number().int().positive().default(65536),
      // Governed writes.
      // Human-in-the-loop: submit_jcl registers a pending submission and
      // returns a one-time token; approve_write executes it.
      writeApproval: booleanFromEnv.default(false),
      // JCL pre-flight scanning (IDCAMS DELETE, IEFBR14 DISP DELETE, ...).
      jclScan: booleanFromEnv.default(true),
      // In strict mode WARN findings also block submissions.
      jclScanStrict: booleanFromEnv.default(false),
      // Comma-separated EXEC program names that may never run (extends the
      // built-in destructive-utility list).
      blockedPrograms: z.string().optional(),
      // Comma-separated JES job classes that may never be used.
      blockedJobClasses: z.string().optional(),
      // When set, writes require a changeTicket arg matching this regex
      // (e.g. "CHG[0-9]{6}").
      changeTicketPattern: z.string().optional(),
      // "HH:MM-HH:MM" in 24h time; overnight ranges (22:00-06:00) allowed.
      writeWindow: z.string().optional(),
      // Allowed weekdays: 0=Sun … 6=Sat. "1-5" or "1,3,5".
      writeDays: z.string().optional(),
      // IANA timezone for the write window (default UTC).
      writeWindowTz: z.string().optional(),
    }),
  })
  .superRefine((cfg, ctx) => {
    const hasBasic = Boolean(cfg.zosmf.user && cfg.zosmf.password);
    const hasToken = Boolean(cfg.zosmf.token);
    const hasCert = Boolean(cfg.zosmf.cert && cfg.zosmf.certKey);
    if ((cfg.zosmf.cert && !cfg.zosmf.certKey) || (cfg.zosmf.certKey && !cfg.zosmf.cert)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide both ZOSMF_CERT and ZOSMF_CERT_KEY for mTLS client-certificate auth.',
        path: ['zosmf', 'cert'],
      });
    }
    if (!hasBasic && !hasToken && !hasCert) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide ZOSMF_USER + ZOSMF_PASSWORD, ZOSMF_TOKEN, or ZOSMF_CERT + ZOSMF_KEY for authentication.',
        path: ['zosmf', 'auth'],
      });
    }
    if (cfg.security.changeTicketPattern) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(cfg.security.changeTicketPattern);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `SECURITY_CHANGE_TICKET_PATTERN is not a valid regex: ${cfg.security.changeTicketPattern}`,
          path: ['security', 'changeTicketPattern'],
        });
      }
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
