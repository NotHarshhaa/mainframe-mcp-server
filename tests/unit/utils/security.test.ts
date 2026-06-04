import type { AppConfig } from '../../../src/config/schema.js';
import { ForbiddenError } from '../../../src/utils/errors.js';
import {
  assertDatasetAllowed,
  assertJclSizeAllowed,
  assertToolAllowed,
  assertUssPathAllowed,
  assertWriteAllowed,
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

describe('security', () => {
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

  it('blocks write tools in read-only mode', () => {
    expect(() => assertWriteAllowed(config({ readOnly: true }), 'submit_jcl')).toThrow(
      ForbiddenError,
    );
  });

  it('restricts datasets to allowed patterns', () => {
    const cfg = config({ allowedDatasetPatterns: 'USERDEV.*,SYS1.*' });
    expect(() => assertDatasetAllowed(cfg, 'USERDEV.JCLLIB')).not.toThrow();
    expect(() => assertDatasetAllowed(cfg, 'PROD.PAYROLL')).toThrow(ForbiddenError);
  });

  it('restricts USS paths to allowed prefixes', () => {
    const cfg = config({ allowedUssPaths: '/u/userdev,/tmp/app' });
    expect(() => assertUssPathAllowed(cfg, '/u/userdev/logs')).not.toThrow();
    expect(() => assertUssPathAllowed(cfg, '/etc/profile')).toThrow(ForbiddenError);
  });

  it('enforces JCL size limits', () => {
    expect(() => assertJclSizeAllowed(config(), 'x'.repeat(2000))).toThrow(ForbiddenError);
  });
});
