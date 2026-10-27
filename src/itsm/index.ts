/**
 * ITSM provider factory — resolves the configured INCIDENT_* settings to a
 * concrete provider instance. Exported payload builders are pure and covered
 * by unit tests; provider classes only add the HTTP call.
 */
import type { AppConfig } from '../config/schema.js';
import type { IncidentProvider, IncidentProviderConfig } from './types.js';
import { ServiceNowProvider } from './servicenow.js';
import { JiraProvider } from './jira.js';
import { PagerDutyProvider } from './pagerduty.js';

export * from './types.js';
export { postJson, parseLabels } from './http.js';
export { buildServiceNowPayload, severityToImpact } from './servicenow.js';
export { buildAdfDescription, buildJiraPayload } from './jira.js';
export { buildPagerDutyPayload } from './pagerduty.js';

/** Build the provider from config, or null when no INCIDENT_PROVIDER is set. */
export function createIncidentProvider(config: AppConfig['incident']): IncidentProvider | null {
  if (!config.provider) return null;
  const providerConfig: IncidentProviderConfig = config;
  switch (config.provider) {
    case 'servicenow':
      return new ServiceNowProvider(providerConfig);
    case 'jira':
      return new JiraProvider(providerConfig);
    case 'pagerduty':
      return new PagerDutyProvider(providerConfig);
  }
}
