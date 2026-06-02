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
    }),
    mcp: z.object({
      name: z.string().default('mainframe-mcp-server'),
      version: z.string().default('1.0.0'),
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
    }),
  })
  .superRefine((cfg, ctx) => {
    const hasBasic = Boolean(cfg.zosmf.user && cfg.zosmf.password);
    const hasToken = Boolean(cfg.zosmf.token);
    if (!hasBasic && !hasToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide either ZOSMF_USER + ZOSMF_PASSWORD or ZOSMF_TOKEN for authentication.',
        path: ['zosmf', 'auth'],
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;
