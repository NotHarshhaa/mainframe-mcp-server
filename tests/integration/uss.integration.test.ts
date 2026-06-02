/**
 * Integration tests — USS tools against a live z/OSMF sandbox.
 *
 * Requires ZOSMF_USS_PATH or ZOSMF_USER (uses `/u/<user>`).
 */
import { List } from '@zowe/zos-files-for-zowe-sdk';
import {
  describeIntegration,
  getIntegrationContext,
  integrationSetup,
  ussHomePath,
} from './helpers.js';

describeIntegration('uss (integration)', () => {
  integrationSetup();

  it('lists a USS directory on the sandbox', async () => {
    const { config, session } = getIntegrationContext();
    const path = ussHomePath(config);
    if (!path) {
      throw new Error('Set ZOSMF_USS_PATH or ZOSMF_USER for USS integration tests.');
    }

    const response = await List.fileList(session, path, {});
    const items = response.apiResponse?.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  }, 30000);
});
