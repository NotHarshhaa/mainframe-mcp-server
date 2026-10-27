/**
 * Server wiring tests — build the real MCP server with an in-memory config
 * and verify the MCP-native surface (tools with annotations, prompts,
 * resources) over an in-memory transport. No z/OSMF connection is made.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../../src/server.js';
import { createLogger } from '../../src/utils/logger.js';
import { configSchema } from '../../src/config/schema.js';
import { resetSession } from '../../src/zowe/client.js';

function testConfig(extra: Record<string, unknown> = {}) {
  return configSchema.parse({
    zosmf: { host: 'mainframe.example.com', user: 'SVCACCT', password: 'secret' },
    mcp: {},
    limits: {},
    enterprise: {},
    security: {},
    incident: {
      provider: 'servicenow',
      baseUrl: 'https://acme.service-now.com',
      user: 'svc',
      token: 'pw',
      runbooks: JSON.stringify({ S0C7: 'https://runbooks.example.com/s0c7' }),
    },
    ...extra,
  });
}

async function connectClient(extra: Record<string, unknown> = {}) {
  const server = buildServer(testConfig(extra), createLogger({ level: 'silent' }));
  const client = new Client({ name: 'wiring-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe('server wiring — MCP-native surface', () => {
  afterEach(() => resetSession());

  it('exposes tools with derived annotations and the incident tool', async () => {
    const { client } = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('investigate_incident');
    expect(names).toContain('create_incident_ticket');
    // Doc RAG not configured in this scenario.
    expect(names).not.toContain('search_internal_docs');

    const investigate = tools.find((t) => t.name === 'investigate_incident')!;
    expect(investigate.annotations?.readOnlyHint).toBe(true);
    expect(investigate.annotations?.destructiveHint).toBe(false);
    expect(investigate.annotations?.title).toBe('Investigate Incident');

    const submit = tools.find((t) => t.name === 'submit_jcl')!;
    expect(submit.annotations?.readOnlyHint).toBe(false);
    expect(submit.annotations?.destructiveHint).toBe(true);

    const incident = tools.find((t) => t.name === 'create_incident_ticket')!;
    expect(incident.annotations?.readOnlyHint).toBe(false);
    expect(incident.annotations?.destructiveHint).toBe(false);

    await client.close();
  });

  it('exposes prompts and fills their arguments', async () => {
    const { client } = await connectClient();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(['triage_failed_job', 'morning_batch_health_check', 'investigate_abend']),
    );

    const triage = await client.getPrompt({ name: 'triage_failed_job', arguments: { jobId: 'job00042' } });
    expect(triage.messages).toHaveLength(1);
    expect(triage.messages[0].role).toBe('user');
    expect((triage.messages[0].content as { type: string; text: string }).text).toContain('JOB00042');
    // Incident integration is configured in this scenario.
    expect((triage.messages[0].content as { type: string; text: string }).text).toContain(
      'create_incident_ticket',
    );

    const health = await client.getPrompt({
      name: 'morning_batch_health_check',
      arguments: { lookbackHours: '24' },
    });
    expect((health.messages[0].content as { type: string; text: string }).text).toContain('24');

    await client.close();
  });

  it('exposes resource templates and the static abend reference', async () => {
    const { client } = await connectClient();
    const { resourceTemplates } = await client.listResourceTemplates();
    const templates = resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toContain('mainframe://jobs/{jobId}/spool');
    expect(templates).toContain('mainframe://jobs/{jobId}/spool/{ddName}');
    expect(templates).toContain('mainframe://datasets/{dsn}');
    expect(templates).toContain('mainframe://datasets/{dsn}/members/{member}');

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('mainframe://reference/abend-codes');

    const abendRef = await client.readResource({ uri: 'mainframe://reference/abend-codes' });
    const text = ('text' in abendRef.contents[0] ? abendRef.contents[0].text : '') ?? '';
    expect(text).toContain('S0C7');

    await client.close();
  });

  it('registers search_internal_docs and wires the doc index when DOCS_SOURCES is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wiring-docs-'));
    try {
      writeFileSync(
        join(dir, 'runbook.md'),
        '# S0C7 runbook\nPayroll S0C7 abends come from the new feed with spaces in COMP-3 fields.',
      );
      const { client } = await connectClient({ docs: { sources: dir, refreshSeconds: 0 } });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('search_internal_docs');

      const result = await client.callTool({
        name: 'search_internal_docs',
        arguments: { query: 'payroll S0C7 COMP-3 spaces' },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('runbook.md');
      expect(text).toContain('COMP-3');
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
