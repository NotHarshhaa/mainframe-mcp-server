import type { AppConfig } from '../../../src/config/schema.js';
import type { ToolContext } from '../../../src/types/tools.js';
import type { AuditLogger, AuditEvent } from '../../../src/utils/audit.js';
import { executeSecuredCall, applyDataProtection, PROTECTED_OUTPUT_TOOLS } from '../../../src/utils/tool-handler.js';
import { ForbiddenError } from '../../../src/utils/errors.js';

function makeConfig(overrides?: { readOnly?: boolean; dataProtection?: boolean }): AppConfig {
  return {
    zosmf: { host: 'zosmf.example.com', port: 1443, user: 'SVCACCT', rejectUnauthorized: true },
    security: {
      readOnly: overrides?.readOnly ?? true,
      auditLogging: true,
      dataProtection: overrides?.dataProtection ?? true,
      redactionStyle: 'mask',
    },
  } as unknown as AppConfig;
}

function makeCtx(overrides?: { config?: AppConfig; audit?: AuditLogger; environments?: ToolContext['environments'] }): ToolContext {
  return {
    session: {} as ToolContext['session'],
    config: overrides?.config ?? makeConfig(),
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as ToolContext['logger'],
    audit: overrides?.audit,
    environments: overrides?.environments,
  } as ToolContext;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const recordMock = jest.fn();
const audit: AuditLogger = {
  record: recordMock,
  flush: async () => {},
  close: async () => {},
};

beforeEach(() => {
  recordMock.mockClear();
});

describe('executeSecuredCall — pipeline', () => {
  it('runs the handler and emits one audit record with outcome and result size', async () => {
    const ctx = makeCtx({ audit });
    const result = await executeSecuredCall(
      ctx,
      'list_jobs',
      { owner: 'OPS' },
      async () => textResult('jobs list'),
    );
    expect(result.isError).toBeUndefined();
    expect(recordMock).toHaveBeenCalledTimes(1);
    const event = recordMock.mock.calls[0][0] as AuditEvent;
    expect(event.tool).toBe('list_jobs');
    expect(event.user).toBe('SVCACCT');
    expect(event.outcome).toBe('success');
    expect(event.resultChars).toBe(Buffer.byteLength('jobs list'));
    expect(event.correlationId).toBeTruthy();
  });

  it('blocks write tools in read-only mode and audits the block', async () => {
    const ctx = makeCtx({ audit, config: makeConfig({ readOnly: true }) });
    const result = await executeSecuredCall(
      ctx,
      'submit_jcl',
      { jcl: '//JOB JOB' },
      async () => textResult('should not run'),
    );
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/read-only mode/);
    const event = recordMock.mock.calls[0][0] as AuditEvent;
    expect(event.outcome).toBe('blocked');
    expect(event.errorCode).toBe('FORBIDDEN');
  });

  it('permits write tools when read-only is disabled', async () => {
    const ctx = makeCtx({ audit, config: makeConfig({ readOnly: false }) });
    const result = await executeSecuredCall(ctx, 'submit_jcl', { jcl: '//X JOB' }, async () => textResult('submitted'));
    expect(result.isError).toBeUndefined();
  });

  it('audits handler failures with the error outcome and code', async () => {
    const ctx = makeCtx({ audit });
    const result = await executeSecuredCall(ctx, 'read_dataset', { dsn: 'X.Y' }, async () => {
      throw new ForbiddenError('nope');
    });
    expect(result.isError).toBe(true);
    const event = recordMock.mock.calls[0][0] as AuditEvent;
    expect(event.outcome).toBe('error');
    expect(event.errorCode).toBe('FORBIDDEN');
  });
});

describe('executeSecuredCall — environment argument', () => {
  const registry = {
    defaultName: () => 'default',
    names: () => ['default', 'dev'],
    has: (n: string) => ['default', 'dev'].includes(n),
    get: (n: string) => {
      if (!['default', 'dev'].includes(n)) {
        throw Object.assign(new Error(`Unknown environment "${n}". Available: default, dev.`), { name: 'ValidationError' });
      }
      return { name: n, source: 'env' as const, host: 'h.example.com' };
    },
    list: () => [],
    getSession: jest.fn(),
    summarize: () => ({ name: 'default', readOnly: false, isDefault: true, auth: 'basic' as const }),
    isReadOnly: (n: string) => n === 'default',
    assertAllowed: jest.fn(),
  } as unknown as ToolContext['environments'];

  it('rejects unknown environment names with available options', async () => {
    const ctx = makeCtx({ audit, environments: registry });
    const result = await executeSecuredCall(ctx, 'list_jobs', { environment: 'staging' }, async () => textResult('x'));
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/Available: default, dev/);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('blocks write tools on read-only environments', async () => {
    const ctx = makeCtx({ audit, environments: registry, config: makeConfig({ readOnly: false }) });
    const result = await executeSecuredCall(
      ctx,
      'submit_jcl',
      { environment: 'default', jcl: '//X JOB' },
      async () => textResult('x'),
    );
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/environment "default" is read-only/);
  });

  it('rejects an environment argument when no environments are configured', async () => {
    const ctx = makeCtx({ audit });
    const result = await executeSecuredCall(ctx, 'list_jobs', { environment: 'dev' }, async () => textResult('x'));
    expect(result.isError).toBe(true);
    expect(String(result.content[0].text)).toMatch(/no environments are configured/);
  });
});

describe('applyDataProtection', () => {
  const identity = { user: 'U', role: { name: 'x', tools: { allow: [], deny: [] }, datasets: { allow: [], deny: [] }, uss: { allow: [], deny: [] } } } as Parameters<typeof applyDataProtection>[3];

  it('masks SSNs and cards in protected tool output', () => {
    const ctx = makeCtx();
    const raw = textResult('SSN 123-45-6789 and card 4111 1111 1111 1111');
    const { result } = applyDataProtection(ctx, 'read_dataset', raw, identity);
    const text = String((result.content[0] as { text: string }).text);
    // mask style keeps the trailing four characters
    expect(text).toContain('*******6789');
    expect(text).toContain('***************1111');
    expect(text).not.toContain('123-45-6789');
    expect(text).not.toContain('4111 1111 1111 1111');
    expect(text).toContain('[data protection:');
  });

  it('leaves other tools untouched by default', () => {
    const ctx = makeCtx();
    const raw = textResult('SSN 123-45-6789');
    const { result, audit: dp } = applyDataProtection(ctx, 'list_datasets', raw, identity);
    expect(String((result.content[0] as { text: string }).text)).toContain('123-45-6789');
    expect(dp?.masked).toBe(0);
  });

  it('can be disabled via SECURITY_DATA_PROTECTION=false', () => {
    const ctx = makeCtx({ config: makeConfig({ dataProtection: false }) });
    const raw = textResult('SSN 123-45-6789');
    const { result } = applyDataProtection(ctx, 'get_job_output', raw, identity);
    expect(String((result.content[0] as { text: string }).text)).toContain('123-45-6789');
  });

  it('applies classification caps and sampling when the policy matches', () => {
    const ctx = makeCtx();
    (ctx as { policy?: unknown }).policy = {
      dataProtection: {
        redactionDefault: true,
        rules: ['ssn'],
        style: 'mask',
        classifications: [
          {
            name: 'pci',
            datasets: ['PROD.CARDS.**'],
            uss: [],
            redact: ['credit_card'],
            maxLines: 3,
          },
        ],
      },
    };
    const lines = Array.from({ length: 50 }, (_, i) => `row ${i + 1}`).join('\n');
    const { result, audit: dp } = applyDataProtection(
      ctx,
      'read_dataset',
      textResult(`SSN 123-45-6789\n${lines}`),
      identity,
      { dataset: 'PROD.CARDS.MASTER' },
    );
    const text = String((result.content[0] as { text: string }).text);
    // ssn default rule replaced by classification redact list → SSN survives, cards would not
    expect(text).toContain('123-45-6789');
    expect(text).toContain('classification "pci": showing first 3 of 51 lines');
    expect(dp?.classification).toBe('pci');
    expect(dp?.masked).toBe(0);
  });

  it('enumerates the protected output tools', () => {
    expect(PROTECTED_OUTPUT_TOOLS.has('get_job_output')).toBe(true);
    expect(PROTECTED_OUTPUT_TOOLS.has('read_uss_file')).toBe(true);
    expect(PROTECTED_OUTPUT_TOOLS.has('list_environments')).toBe(false);
  });
});
