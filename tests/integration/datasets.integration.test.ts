/**
 * Integration tests — dataset tools against a live z/OSMF sandbox.
 *
 * Requires ZOSMF_DATASET_PATTERN or ZOSMF_USER (uses `<user>.*`).
 */
import { List } from '@zowe/zos-files-for-zowe-sdk';
import {
  datasetPattern,
  describeIntegration,
  getIntegrationContext,
  integrationSetup,
} from './helpers.js';

describeIntegration('datasets (integration)', () => {
  integrationSetup();

  it('lists datasets matching the sandbox pattern', async () => {
    const { config, session } = getIntegrationContext();
    const pattern = datasetPattern(config);
    if (!pattern) {
      throw new Error('Set ZOSMF_DATASET_PATTERN or ZOSMF_USER for dataset integration tests.');
    }

    const response = await List.dataSet(session, pattern, { attributes: true });
    const items = response.apiResponse?.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  }, 30000);
});
