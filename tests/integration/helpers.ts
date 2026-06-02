/**
 * Shared helpers for z/OSMF sandbox integration tests.
 *
 * Set RUN_INTEGRATION=1 and valid ZOSMF_* env vars to enable the suite.
 * Optional ZOSMF_DATASET_PATTERN and ZOSMF_USS_PATH target dataset/USS tests.
 */
import { loadConfig } from '../../src/config/index.js';
import { createSession, resetSession } from '../../src/zowe/client.js';
import type { AppConfig } from '../../src/config/schema.js';
import type { Session } from '@zowe/imperative';

export const integrationEnabled =
  process.env.RUN_INTEGRATION === '1' && Boolean(process.env.ZOSMF_HOST);

export const describeIntegration = integrationEnabled ? describe : describe.skip;

export function integrationSetup(): void {
  beforeEach(() => resetSession());
}

export function getIntegrationContext(): { config: AppConfig; session: Session } {
  const config = loadConfig(true);
  const session = createSession(config);
  return { config, session };
}

/** Dataset pattern for catalog tests — defaults to the configured user HLQ. */
export function datasetPattern(config: AppConfig): string | undefined {
  if (process.env.ZOSMF_DATASET_PATTERN) return process.env.ZOSMF_DATASET_PATTERN;
  if (config.zosmf.user) return `${config.zosmf.user}.*`;
  return undefined;
}

/** USS home path for directory tests — defaults to /u/<user> when user is set. */
export function ussHomePath(config: AppConfig): string | undefined {
  if (process.env.ZOSMF_USS_PATH) return process.env.ZOSMF_USS_PATH;
  if (config.zosmf.user) return `/u/${config.zosmf.user.toLowerCase()}`;
  return undefined;
}
