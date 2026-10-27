/**
 * Jira provider — creates an issue via Jira REST API v3 (basic auth with
 * account email + API token). The bundle text becomes an Atlassian Document
 * Format description: a summary paragraph plus the full bundle in a code
 * block so formatting survives.
 */
import { Buffer } from 'node:buffer';
import type { IncidentProvider, IncidentProviderConfig, TicketInput, TicketResult } from './types.js';
import { postJson } from './http.js';

/** One ADF inline/text node. */
interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  /** Only present on the document root (ADF version, always 1). */
  version?: number;
}

/** Build a minimal Atlassian Document Format document (pure; unit-tested). */
export function buildAdfDescription(input: TicketInput): AdfNode {
  const meta = [
    `Source: ${input.source}`,
    `Severity: ${input.severity}`,
    ...(input.jobName && input.jobId ? [`Job: ${input.jobName} (${input.jobId})`] : []),
    ...(input.abendCode ? [`Abend code: ${input.abendCode}`] : []),
    ...(input.runbookUrl ? [`Runbook: ${input.runbookUrl}`] : []),
  ].join('\n');

  const paragraph = (text: string): AdfNode => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  const codeBlock = (text: string): AdfNode => ({
    type: 'codeBlock',
    attrs: { language: 'text' },
    content: [{ type: 'text', text }],
  });

  return {
    type: 'doc',
    version: 1,
    content: [paragraph(meta), codeBlock(input.description)],
  };
}

/** Build the REST v3 create-issue payload (pure; unit-tested). */
export function buildJiraPayload(
  input: TicketInput,
  config: Pick<IncidentProviderConfig, 'jiraProject' | 'jiraIssueType'>,
): Record<string, unknown> {
  return {
    fields: {
      project: { key: config.jiraProject },
      summary: input.title,
      issuetype: { name: config.jiraIssueType },
      description: buildAdfDescription(input),
      ...(input.labels.length > 0 ? { labels: input.labels } : {}),
    },
  };
}

interface JiraCreateResponse {
  id?: string;
  key?: string;
  self?: string;
}

export class JiraProvider implements IncidentProvider {
  readonly name = 'jira' as const;

  constructor(private readonly config: IncidentProviderConfig) {}

  async createTicket(input: TicketInput): Promise<TicketResult> {
    const baseUrl = this.config.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Jira integration requires INCIDENT_BASE_URL.');
    const auth = Buffer.from(`${this.config.user}:${this.config.token}`).toString('base64');

    const body = await postJson<JiraCreateResponse>(
      `${baseUrl}/rest/api/3/issue`,
      buildJiraPayload(input, this.config),
      { Authorization: `Basic ${auth}` },
      'Jira',
    );

    if (!body.body.key) {
      throw new Error('Jira response did not include an issue key.');
    }
    return {
      provider: this.name,
      key: body.body.key,
      ...(body.body.id ? { externalId: body.body.id } : {}),
      url: `${baseUrl}/browse/${body.body.key}`,
    };
  }
}
