/**
 * PagerDuty provider — triggers an incident via the Events API v2
 * (routing key auth, no account credentials). The dedup key is derived from
 * the job so repeated triggers for the same failure deduplicate instead of
 * paging on-call repeatedly.
 */
import type { IncidentProvider, IncidentProviderConfig, TicketInput, TicketResult } from './types.js';
import { postJson } from './http.js';

/** Default Events API v2 endpoint; INCIDENT_BASE_URL overrides for tests. */
const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

/** Build the Events API v2 trigger payload (pure; unit-tested). */
export function buildPagerDutyPayload(
  input: TicketInput,
  config: Pick<IncidentProviderConfig, 'pagerDutyRoutingKey'>,
): Record<string, unknown> {
  const dedupKey = input.jobName && input.jobId
    ? `mainframe-${input.jobName}-${input.jobId}`
    : `mainframe-${input.title}`.replace(/\s+/g, '-').slice(0, 255);

  const customDetails: Record<string, string> = {
    source: input.source,
    severity: input.severity,
    ...(input.jobName ? { job_name: input.jobName } : {}),
    ...(input.jobId ? { job_id: input.jobId } : {}),
    ...(input.abendCode ? { abend_code: input.abendCode } : {}),
  };

  return {
    routing_key: config.pagerDutyRoutingKey,
    event_action: 'trigger',
    dedup_key: dedupKey,
    payload: {
      summary: input.title,
      source: input.source,
      severity: input.severity,
      component: input.jobName,
      custom_details: {
        ...customDetails,
        // Full bundle as flat text so context is visible in the PD UI.
        incident_bundle: input.description,
      },
    },
    ...(input.runbookUrl || input.labels.length > 0
      ? {
          links: [
            ...(input.runbookUrl
              ? [{ href: input.runbookUrl, text: `Runbook for ${input.abendCode ?? 'this failure'}` }]
              : []),
          ],
        }
      : {}),
  };
}

interface PagerDutyEnqueueResponse {
  status?: string;
  message?: string;
  dedup_key?: string;
}

export class PagerDutyProvider implements IncidentProvider {
  readonly name = 'pagerduty' as const;

  constructor(private readonly config: IncidentProviderConfig) {}

  async createTicket(input: TicketInput): Promise<TicketResult> {
    if (!this.config.pagerDutyRoutingKey) {
      throw new Error('PagerDuty integration requires INCIDENT_PAGERDUTY_ROUTING_KEY.');
    }
    const endpoint = this.config.baseUrl?.replace(/\/+$/, '') ?? PAGERDUTY_EVENTS_URL;

    const body = await postJson<PagerDutyEnqueueResponse>(
      endpoint,
      buildPagerDutyPayload(input, this.config),
      {},
      'PagerDuty',
    );

    if (!body.body.dedup_key) {
      throw new Error(`PagerDuty response did not include a dedup_key (status: ${body.body.status ?? 'unknown'}).`);
    }
    return {
      provider: this.name,
      key: body.body.dedup_key,
      // Events API v2 returns no incident URL; the incident appears on the
      // service dashboard under this dedup key.
    };
  }
}
