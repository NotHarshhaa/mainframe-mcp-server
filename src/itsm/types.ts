/**
 * Incident-management provider contracts.
 *
 * `create_incident_ticket` assembles an investigate_incident bundle and hands
 * it to the provider configured via INCIDENT_* settings. Payload builders are
 * pure functions (unit-testable); the provider classes only add HTTP.
 */

/** Normalized severity used across providers. */
export type IncidentSeverity = 'info' | 'warning' | 'error' | 'critical';

/** What a ticket is created from. */
export interface TicketInput {
  /** Short title, e.g. "PAYJOB1 (JOB01234) failed with S0C7". */
  title: string;
  /** Full incident bundle text (analysis, abend reference, spool, excerpts). */
  description: string;
  severity: IncidentSeverity;
  labels: string[];
  /** Reporting identity (server name; callers may pass the acting user). */
  source: string;
  jobId?: string;
  jobName?: string;
  abendCode?: string | null;
  /** Organization runbook URL matched for the abend code, when any. */
  runbookUrl?: string;
}

/** Provider-agnostic creation result. */
export interface TicketResult {
  provider: 'servicenow' | 'jira' | 'pagerduty';
  /** Human-facing key: INC number, Jira issue key, or PagerDuty dedup key. */
  key: string;
  /** Deep link to the ticket, when the provider exposes one. */
  url?: string;
  /** Provider-internal id (ServiceNow sys_id, Jira issue id). */
  externalId?: string;
}

/** A configured incident-management backend. */
export interface IncidentProvider {
  readonly name: 'servicenow' | 'jira' | 'pagerduty';
  createTicket(input: TicketInput): Promise<TicketResult>;
}

/** Subset of the incident config the providers consume. */
export type IncidentProviderConfig = {
  provider?: 'servicenow' | 'jira' | 'pagerduty';
  baseUrl?: string;
  user?: string;
  token?: string;
  table: string;
  callerId?: string;
  jiraProject?: string;
  jiraIssueType: string;
  pagerDutyRoutingKey?: string;
  severity: IncidentSeverity;
  labels?: string;
};
