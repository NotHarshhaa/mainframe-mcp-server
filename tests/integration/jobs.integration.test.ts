/**
 * Integration tests — jobs and operational tools against a live z/OSMF sandbox.
 */
import { GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import { lookupAbend, extractAbendCode } from '../../src/utils/abend-codes.js';
import { aggregateAbends, findFailedJobs } from '../../src/tools/operations/shared.js';
import { isFailedJob, normalizeJob } from '../../src/tools/jobs/shared.js';
import { createLogger } from '../../src/utils/logger.js';
import type { ToolContext } from '../../src/types/tools.js';
import {
  describeIntegration,
  getIntegrationContext,
  integrationSetup,
} from './helpers.js';

function createToolContext(): ToolContext {
  const { config, session } = getIntegrationContext();
  return {
    session,
    config,
    logger: createLogger({ level: 'silent', name: 'integration-test' }),
  };
}

describeIntegration('jobs (integration)', () => {
  integrationSetup();

  it('creates a session and lists jobs from z/OSMF', async () => {
    const { config, session } = getIntegrationContext();
    expect(session.ISession.hostname).toBe(config.zosmf.host);

    const owner = config.zosmf.user ?? '*';
    const jobs = await GetJobs.getJobsByOwnerAndPrefix(session, owner, '*');
    expect(Array.isArray(jobs)).toBe(true);
  }, 30000);

  it('finds failed jobs in the output queue (may be zero)', async () => {
    const ctx = createToolContext();
    const failures = await findFailedJobs(ctx, 24, ctx.config.zosmf.user ?? '*');
    expect(Array.isArray(failures)).toBe(true);
    for (const summary of failures) {
      expect(isFailedJob(summary.job)).toBe(true);
    }
  }, 30000);
});

describeIntegration('operations (integration)', () => {
  integrationSetup();

  it('aggregates abend codes from live job output queue', async () => {
    const ctx = createToolContext();
    const failures = await findFailedJobs(ctx, 48, ctx.config.zosmf.user ?? '*');
    const aggregated = aggregateAbends(failures);
    expect(Array.isArray(aggregated)).toBe(true);

    for (const entry of aggregated) {
      if (/^S[0-9A-F]{3,4}$/.test(entry.code)) {
        expect(lookupAbend(entry.code)).toBeDefined();
      }
    }
  }, 30000);

  it('builds a system health snapshot from live jobs', async () => {
    const { session } = getIntegrationContext();
    const raws = await GetJobs.getJobsByOwnerAndPrefix(session, '*', '*');
    const jobs = raws.map(normalizeJob);

    const active = jobs.filter((job) => job.status === 'ACTIVE');
    const failed = jobs.filter(isFailedJob);

    expect(Array.isArray(active)).toBe(true);
    expect(Array.isArray(failed)).toBe(true);

    for (const job of failed) {
      const code = extractAbendCode(job.returnCode ?? '');
      if (code) expect(code).toMatch(/^[SU]/);
    }
  }, 30000);
});
