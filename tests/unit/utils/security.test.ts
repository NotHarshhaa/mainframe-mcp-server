import type { AppConfig } from '../../../src/config/schema.js';
import { ForbiddenError } from '../../../src/utils/errors.js';
import {
  assertDatasetAllowed,
  assertJclSizeAllowed,
  assertToolAllowed,
  assertUssPathAllowed,
  assertWriteAllowed,
  redactArgs,
  WRITE_TOOLS,
} from '../../../src/utils/security.js';

function config(overrides: Partial<AppConfig['security']> = {}): AppConfig {
  return {
    zosmf: {
      host: 'host',
      port: 443,
      rejectUnauthorized: true,
      user: 'USER1',
      password: 'secret',
    },
    mcp: { name: 'test', version: '2.0.0', transport: 'stdio', ssePort: 3000 },
    logLevel: 'silent',
    limits: {
      maxJobOutputLines: 100,
      maxDatasetReadLines: 100,
      maxJesSpoolFiles: 5,
      maxAuditLines: 100,
      maxJobListResults: 500,
      maxFailedJobResults: 100,
    },
    enterprise: {
      cmciPort: 1490,
      cmciBasePath: '/CICSSystemManagement',
      db2Port: 50400,
      db2BasePath: '/dbrest',
      rmfMetricsEnabled: true,
    },
    security: {
      readOnly: false,
      auditLogging: true,
      maxJclBytes: 1024,
      ...overrides,
    },
  } as AppConfig;
}

// ---------------------------------------------------------------------------
// assertToolAllowed
// ---------------------------------------------------------------------------
describe('assertToolAllowed', () => {
  it('blocks tools on the blocklist', () => {
    expect(() =>
      assertToolAllowed(config({ blockedTools: 'submit_jcl' }), 'submit_jcl'),
    ).toThrow(ForbiddenError);
  });

  it('allows only tools on the allowlist', () => {
    const cfg = config({ allowedTools: 'list_jobs,get_job_status' });
    expect(() => assertToolAllowed(cfg, 'list_jobs')).not.toThrow();
    expect(() => assertToolAllowed(cfg, 'submit_jcl')).toThrow(ForbiddenError);
  });

  it('permits any tool when no lists are configured', () => {
    expect(() => assertToolAllowed(config(), 'mainframe_list_jobs')).not.toThrow();
  });

  it('blocklist takes priority even if tool is in allowlist', () => {
    const cfg = config({
      blockedTools: 'mainframe_submit_jcl',
      allowedTools: 'mainframe_submit_jcl,mainframe_list_jobs',
    });
    expect(() => assertToolAllowed(cfg, 'mainframe_submit_jcl')).toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// assertWriteAllowed
// ---------------------------------------------------------------------------
describe('assertWriteAllowed', () => {
  it('blocks write tools in read-only mode', () => {
    expect(() => assertWriteAllowed(config({ readOnly: true }), 'submit_jcl')).toThrow(
      ForbiddenError,
    );
  });

  it('blocks all registered write tools in read-only mode', () => {
    const cfg = config({ readOnly: true });
    for (const tool of WRITE_TOOLS) {
      expect(() => assertWriteAllowed(cfg, tool)).toThrow(ForbiddenError);
    }
  });

  it('allows write tools when read-only is false', () => {
    expect(() => assertWriteAllowed(config({ readOnly: false }), 'mainframe_submit_jcl')).not.toThrow();
  });

  it('does not block read tools in read-only mode', () => {
    expect(() => assertWriteAllowed(config({ readOnly: true }), 'mainframe_list_jobs')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertDatasetAllowed
// ---------------------------------------------------------------------------
describe('assertDatasetAllowed', () => {
  it('restricts datasets to allowed patterns', () => {
    const cfg = config({ allowedDatasetPatterns: 'USERDEV.*,SYS1.*' });
    expect(() => assertDatasetAllowed(cfg, 'USERDEV.JCLLIB')).not.toThrow();
    expect(() => assertDatasetAllowed(cfg, 'PROD.PAYROLL')).toThrow(ForbiddenError);
  });

  it('normalizes dataset name (trims whitespace and dots)', () => {
    const cfg = config({ allowedDatasetPatterns: 'USERDEV.*' });
    expect(() => assertDatasetAllowed(cfg, '  USERDEV.DATA  ')).not.toThrow();
    expect(() => assertDatasetAllowed(cfg, '.USERDEV.DATA.')).not.toThrow();
  });

  it('allows any dataset when no patterns are set', () => {
    expect(() => assertDatasetAllowed(config(), 'PROD.PAYROLL')).not.toThrow();
  });

  it('error message includes the dataset name', () => {
    const cfg = config({ allowedDatasetPatterns: 'USERDEV.*' });
    expect(() => assertDatasetAllowed(cfg, 'PROD.SECRET')).toThrowError(/PROD\.SECRET/);
  });
});

// ---------------------------------------------------------------------------
// assertUssPathAllowed
// ---------------------------------------------------------------------------
describe('assertUssPathAllowed', () => {
  it('restricts USS paths to allowed prefixes', () => {
    const cfg = config({ allowedUssPaths: '/u/userdev,/tmp/app' });
    expect(() => assertUssPathAllowed(cfg, '/u/userdev/logs')).not.toThrow();
    expect(() => assertUssPathAllowed(cfg, '/etc/profile')).toThrow(ForbiddenError);
  });

  it('allows any USS path when no prefixes are configured', () => {
    expect(() => assertUssPathAllowed(config(), '/etc/secret')).not.toThrow();
  });

  it('prevents path traversal via .. sequences', () => {
    const cfg = config({ allowedUssPaths: '/u/userdev' });
    expect(() => assertUssPathAllowed(cfg, '/u/userdev/../../etc/passwd')).toThrow(ForbiddenError);
  });

  it('does not allow a prefix to match a sibling directory', () => {
    const cfg = config({ allowedUssPaths: '/u/userdev' });
    expect(() => assertUssPathAllowed(cfg, '/u/userdev2/file')).toThrow(ForbiddenError);
  });

  it('allows an exact prefix match', () => {
    const cfg = config({ allowedUssPaths: '/u/userdev' });
    expect(() => assertUssPathAllowed(cfg, '/u/userdev')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertJclSizeAllowed
// ---------------------------------------------------------------------------
describe('assertJclSizeAllowed', () => {
  it('enforces JCL size limits', () => {
    expect(() => assertJclSizeAllowed(config(), 'x'.repeat(2000))).toThrow(ForbiddenError);
  });

  it('permits JCL within the size limit', () => {
    expect(() => assertJclSizeAllowed(config(), 'x'.repeat(100))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// redactArgs
// ---------------------------------------------------------------------------
describe('redactArgs', () => {
  it('redacts password fields', () => {
    const result = redactArgs({ password: 'secret123' }) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts token fields', () => {
    const result = redactArgs({ token: 'abc.def.ghi' }) as Record<string, unknown>;
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts apiKey and api_key variants', () => {
    const result = redactArgs({ apiKey: 'key1', api_key: 'key2' }) as Record<string, unknown>;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
  });

  it('replaces jcl string with byte-count placeholder', () => {
    const jcl = '//JOB card\n// EXEC PGM=IEFBR14';
    const result = redactArgs({ jcl }) as Record<string, unknown>;
    expect(typeof result.jcl).toBe('string');
    expect((result.jcl as string).startsWith('[JCL')).toBe(true);
  });

  it('preserves non-sensitive fields unchanged', () => {
    const result = redactArgs({ jobId: 'JOB01234', hours: 72 }) as Record<string, unknown>;
    expect(result.jobId).toBe('JOB01234');
    expect(result.hours).toBe(72);
  });

  it('redacts a parent key that matches the sensitive pattern (entire value replaced)', () => {
    const result = redactArgs({ credentials: { password: 'secret', user: 'admin' } }) as Record<string, unknown>;
    expect(result.credentials).toBe('[REDACTED]');
  });

  it('recursively redacts sensitive keys inside a non-sensitive parent', () => {
    const result = redactArgs({ config: { password: 'secret', host: 'localhost' } }) as Record<string, unknown>;
    const inner = result.config as Record<string, unknown>;
    expect(inner.password).toBe('[REDACTED]');
    expect(inner.host).toBe('localhost');
  });

  it('handles arrays correctly', () => {
    const result = redactArgs([{ password: 'x' }, { user: 'y' }]) as Array<Record<string, unknown>>;
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].user).toBe('y');
  });

  it('passes through primitives unchanged', () => {
    expect(redactArgs('plain string')).toBe('plain string');
    expect(redactArgs(42)).toBe(42);
    expect(redactArgs(null)).toBeNull();
  });
});

