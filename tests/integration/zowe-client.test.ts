/**
 * Integration test — requires a live z/OSMF endpoint.
 *
 * This suite is skipped automatically unless RUN_INTEGRATION=1 and valid
 * z/OSMF connection env vars are present, so it never fails in CI by default.
 */
import { GetJobs } from '@zowe/zos-jobs-for-zowe-sdk';
import { loadConfig } from '../../src/config/index.js';
import { createSession, resetSession } from '../../src/zowe/client.js';

const enabled = process.env.RUN_INTEGRATION === '1' && Boolean(process.env.ZOSMF_HOST);
const describeMaybe = enabled ? describe : describe.skip;

describeMaybe('zowe client (integration)', () => {
  beforeEach(() => resetSession());

  it('creates a session and lists jobs from z/OSMF', async () => {
    const config = loadConfig(true);
    const session = createSession(config);
    expect(session.ISession.hostname).toBe(config.zosmf.host);

    const owner = process.env.ZOSMF_USER ?? '*';
    const jobs = await GetJobs.getJobsByOwnerAndPrefix(session, owner, '*');
    expect(Array.isArray(jobs)).toBe(true);
  }, 30000);
});
