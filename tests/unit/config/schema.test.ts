import { configSchema } from '../../../src/config/schema.js';

/** Minimal valid base config (mirrors the documented env-var contract). */
function baseConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    zosmf: { host: 'mainframe.example.com', user: 'SVCACCT', password: 'secret' },
    mcp: {},
    limits: {},
    enterprise: {},
    security: {},
    ...extra,
  };
}

describe('config schema — incident & docs sections', () => {
  it('applies defaults when incident/docs are not configured', () => {
    const parsed = configSchema.parse(baseConfig());
    expect(parsed.incident.provider).toBeUndefined();
    expect(parsed.incident.table).toBe('incident');
    expect(parsed.incident.jiraIssueType).toBe('Bug');
    expect(parsed.incident.severity).toBe('error');
    expect(parsed.docs.maxResults).toBe(3);
    expect(parsed.docs.maxExcerptChars).toBe(1200);
    expect(parsed.docs.refreshSeconds).toBe(300);
  });

  it('accepts a fully specified ServiceNow setup with runbooks', () => {
    const parsed = configSchema.parse(
      baseConfig({
        incident: {
          provider: 'servicenow',
          baseUrl: 'https://acme.service-now.com',
          user: 'svc',
          token: 'pw',
          runbooks: JSON.stringify({ S0C7: 'https://rb/s0c7', 'S2*': 'https://rb/s2' }),
        },
        docs: { sources: '/docs/runbooks,/docs/playbooks', maxResults: 5 },
      }),
    );
    expect(parsed.incident.provider).toBe('servicenow');
    expect(parsed.docs.maxResults).toBe(5);
  });

  it('rejects ServiceNow without credentials', () => {
    const result = configSchema.safeParse(baseConfig({ incident: { provider: 'servicenow' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('INCIDENT_BASE_URL'))).toBe(true);
    }
  });

  it('rejects Jira without a project', () => {
    const result = configSchema.safeParse(
      baseConfig({
        incident: { provider: 'jira', baseUrl: 'https://acme.atlassian.net', user: 'a@b.c', token: 't' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects PagerDuty without a routing key', () => {
    const result = configSchema.safeParse(baseConfig({ incident: { provider: 'pagerduty' } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('INCIDENT_PAGERDUTY_ROUTING_KEY'))).toBe(true);
    }
  });

  it('rejects malformed runbook JSON', () => {
    const result = configSchema.safeParse(
      baseConfig({ incident: { runbooks: '{S0C7: not json}' } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('INCIDENT_RUNBOOKS'))).toBe(true);
    }
  });

  it('rejects a runbook map whose values are not strings', () => {
    const result = configSchema.safeParse(
      baseConfig({ incident: { runbooks: JSON.stringify({ S0C7: 42 }) } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an unknown provider name', () => {
    const result = configSchema.safeParse(baseConfig({ incident: { provider: 'jira-server' } }));
    expect(result.success).toBe(false);
  });
});
