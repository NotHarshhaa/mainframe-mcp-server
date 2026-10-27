/**
 * ServiceNow provider — creates an incident (or change_request, per
 * INCIDENT_SERVICENOW_TABLE) via the Table API with basic auth.
 *
 * Severity maps to impact/urgency (1=highest … 3=lowest).
 */
import { Buffer } from 'node:buffer';
import type { IncidentProvider, IncidentProviderConfig, TicketInput, TicketResult } from './types.js';
import { postJson } from './http.js';

/** Map normalized severity onto ServiceNow impact/urgency levels. */
export function severityToImpact(severity: TicketInput['severity']): 1 | 2 | 3 {
  switch (severity) {
    case 'critical':
      return 1;
    case 'error':
      return 2;
    default:
      return 3;
  }
}

/** Build the Table API payload (pure; unit-tested). */
export function buildServiceNowPayload(
  input: TicketInput,
  config: Pick<IncidentProviderConfig, 'callerId' | 'severity'>,
): Record<string, unknown> {
  const impact = severityToImpact(input.severity);
  const payload: Record<string, unknown> = {
    short_description: input.title,
    description: input.description,
    impact,
    urgency: impact,
    // Severity surfaces in the description header for triage visibility even
    // though Table API has no portable free-text severity field.
    comments: `Reported by ${input.source} with severity "${input.severity}".`,
  };
  if (config.callerId) payload.caller_id = config.callerId;
  return payload;
}

interface ServiceNowCreateResponse {
  result?: { sys_id?: string; number?: string };
}

export class ServiceNowProvider implements IncidentProvider {
  readonly name = 'servicenow' as const;

  constructor(private readonly config: IncidentProviderConfig) {}

  async createTicket(input: TicketInput): Promise<TicketResult> {
    const baseUrl = this.config.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl) throw new Error('ServiceNow integration requires INCIDENT_BASE_URL.');
    const auth = Buffer.from(`${this.config.user}:${this.config.token}`).toString('base64');

    const body = await postJson<ServiceNowCreateResponse>(
      `${baseUrl}/api/now/table/${this.config.table}`,
      buildServiceNowPayload(input, this.config),
      { Authorization: `Basic ${auth}` },
      'ServiceNow',
    );

    const result = body.body.result ?? {};
    if (!result.number && !result.sys_id) {
      throw new Error('ServiceNow response did not include a ticket number or sys_id.');
    }
    return {
      provider: this.name,
      key: result.number ?? result.sys_id!,
      ...(result.sys_id ? { externalId: result.sys_id } : {}),
      ...(result.sys_id
        ? { url: `${baseUrl}/nav_to.do?uri=${this.config.table}.do?sys_id=${result.sys_id}` }
        : {}),
    };
  }
}
