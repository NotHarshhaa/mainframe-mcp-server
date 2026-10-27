import { buildServiceNowPayload, severityToImpact, ServiceNowProvider } from '../../../src/itsm/servicenow.js';
import { buildAdfDescription, buildJiraPayload, JiraProvider } from '../../../src/itsm/jira.js';
import { buildPagerDutyPayload, PagerDutyProvider } from '../../../src/itsm/pagerduty.js';
import { createIncidentProvider } from '../../../src/itsm/index.js';
import type { TicketInput } from '../../../src/itsm/types.js';
import type { IncidentProviderConfig } from '../../../src/itsm/types.js';

function ticketInput(overrides: Partial<TicketInput> = {}): TicketInput {
  return {
    title: 'PAYJOB1 (JOB01234) failed with S0C7',
    description: '=== Failure analysis ===\nS0C7 data exception.',
    severity: 'error',
    labels: ['mainframe', 'batch'],
    source: 'mainframe-mcp-server',
    jobId: 'JOB01234',
    jobName: 'PAYJOB1',
    abendCode: 'S0C7',
    runbookUrl: 'https://runbooks.example.com/s0c7',
    ...overrides,
  };
}

function providerConfig(overrides: Partial<IncidentProviderConfig> = {}): IncidentProviderConfig {
  return {
    table: 'incident',
    jiraIssueType: 'Bug',
    severity: 'error',
    ...overrides,
  };
}

describe('itsm providers', () => {
  describe('buildServiceNowPayload', () => {
    it('maps severity onto impact/urgency and includes caller when set', () => {
      const payload = buildServiceNowPayload(ticketInput(), providerConfig({ callerId: 'sys_abc' }));
      expect(payload.short_description).toContain('PAYJOB1');
      expect(payload.description).toContain('S0C7');
      expect(payload.impact).toBe(2);
      expect(payload.urgency).toBe(2);
      expect(payload.caller_id).toBe('sys_abc');
    });

    it(' escalates critical to impact 1 and degrades info to impact 3', () => {
      expect(severityToImpact('critical')).toBe(1);
      expect(severityToImpact('info')).toBe(3);
      expect(
        buildServiceNowPayload(ticketInput({ severity: 'critical' }), providerConfig()).impact,
      ).toBe(1);
    });
  });

  describe('buildJiraPayload', () => {
    it('builds ADF description with meta paragraph and bundle code block', () => {
      const payload = buildJiraPayload(ticketInput(), providerConfig({ jiraProject: 'OPS' }));
      const fields = payload.fields as Record<string, unknown>;
      expect(fields.project).toEqual({ key: 'OPS' });
      expect(fields.summary).toContain('PAYJOB1');
      expect(fields.labels).toEqual(['mainframe', 'batch']);
      const doc = fields.description as { type: string; content: Array<{ type: string; content?: Array<{ text?: string }> }> };
      expect(doc.type).toBe('doc');
      expect(doc.content[0].type).toBe('paragraph');
      expect(doc.content[0].content?.[0].text).toContain('Severity: error');
      expect(doc.content[0].content?.[0].text).toContain('https://runbooks.example.com/s0c7');
      expect(doc.content[1].type).toBe('codeBlock');
      expect(doc.content[1].content?.[0].text).toContain('Failure analysis');
    });

    it('omits labels when the input has none', () => {
      const payload = buildJiraPayload(ticketInput({ labels: [] }), providerConfig());
      expect((payload.fields as Record<string, unknown>).labels).toBeUndefined();
    });
  });

  describe('buildPagerDutyPayload', () => {
    it('builds a trigger with job-derived dedup key and runbook link', () => {
      const payload = buildPagerDutyPayload(ticketInput(), providerConfig({ pagerDutyRoutingKey: 'rk123' }));
      expect(payload.routing_key).toBe('rk123');
      expect(payload.event_action).toBe('trigger');
      expect(payload.dedup_key).toBe('mainframe-PAYJOB1-JOB01234');
      const inner = payload.payload as Record<string, unknown>;
      expect(inner.severity).toBe('error');
      expect(inner.source).toBe('mainframe-mcp-server');
      const details = inner.custom_details as Record<string, string>;
      expect(details.abend_code).toBe('S0C7');
      expect(details.incident_bundle).toContain('Failure analysis');
      expect(payload.links).toEqual([
        { href: 'https://runbooks.example.com/s0c7', text: 'Runbook for S0C7' },
      ]);
    });
  });

  describe('createIncidentProvider', () => {
    it('returns null when no provider is configured', () => {
      expect(createIncidentProvider(providerConfig() as never)).toBeNull();
    });

    it('returns the matching provider class', () => {
      expect(createIncidentProvider({ ...providerConfig(), provider: 'servicenow' } as never)).toBeInstanceOf(ServiceNowProvider);
      expect(createIncidentProvider({ ...providerConfig(), provider: 'jira' } as never)).toBeInstanceOf(JiraProvider);
      expect(createIncidentProvider({ ...providerConfig(), provider: 'pagerduty' } as never)).toBeInstanceOf(PagerDutyProvider);
    });
  });

  describe('provider HTTP behavior (fetch mocked)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('ServiceNowProvider posts to the Table API and maps the response', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ result: { sys_id: 'sys1', number: 'INC0010001' } }), { status: 201 }),
      );
      const provider = new ServiceNowProvider(
        providerConfig({ provider: 'servicenow', baseUrl: 'https://acme.service-now.com/', user: 'svc', token: 'pw' }),
      );
      const result = await provider.createTicket(ticketInput());
      expect(result).toMatchObject({ provider: 'servicenow', key: 'INC0010001', externalId: 'sys1' });
      expect(result.url).toContain('acme.service-now.com/nav_to.do?uri=incident.do?sys_id=sys1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://acme.service-now.com/api/now/table/incident');
      expect(String((init as RequestInit).headers && new Headers((init as RequestInit).headers).get('Authorization'))).toContain('Basic ');
    });

    it('JiraProvider posts ADF to REST v3 and builds the browse URL', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: '10001', key: 'OPS-42' }), { status: 201 }),
      );
      const provider = new JiraProvider(
        providerConfig({ provider: 'jira', baseUrl: 'https://acme.atlassian.net', user: 'a@b.c', token: 'tok', jiraProject: 'OPS' }),
      );
      const result = await provider.createTicket(ticketInput());
      expect(result).toMatchObject({ provider: 'jira', key: 'OPS-42', url: 'https://acme.atlassian.net/browse/OPS-42' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://acme.atlassian.net/rest/api/3/issue');
    });

    it('PagerDutyProvider posts to the Events API and returns the dedup key', async () => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'success', message: 'Event processed', dedup_key: 'mainframe-PAYJOB1-JOB01234' }), { status: 202 }),
      );
      const provider = new PagerDutyProvider(providerConfig({ provider: 'pagerduty', pagerDutyRoutingKey: 'rk123' }));
      const result = await provider.createTicket(ticketInput());
      expect(result).toMatchObject({ provider: 'pagerduty', key: 'mainframe-PAYJOB1-JOB01234' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://events.pagerduty.com/v2/enqueue');
    });

    it('converts HTTP failures into readable errors', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad token' }), { status: 401 }),
      );
      const provider = new ServiceNowProvider(
        providerConfig({ provider: 'servicenow', baseUrl: 'https://acme.service-now.com', user: 'svc', token: 'pw' }),
      );
      await expect(provider.createTicket(ticketInput())).rejects.toThrow(/HTTP 401/);
    });

    it('throws a config error when baseUrl is missing', async () => {
      const provider = new ServiceNowProvider(providerConfig({ provider: 'servicenow' }));
      await expect(provider.createTicket(ticketInput())).rejects.toThrow(/INCIDENT_BASE_URL/);
    });
  });
});
