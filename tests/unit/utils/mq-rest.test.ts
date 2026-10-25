import type { AppConfig } from '../../../src/config/schema.js';
import { getMqChannelStatus, getMqQueues } from '../../../src/utils/mq-rest.js';
import { ConfigError, ConnectionError } from '../../../src/utils/errors.js';

function makeConfig(host?: string): AppConfig {
  return {
    zosmf: { host: 'zosmf.example.com', port: 1443, rejectUnauthorized: true },
    enterprise: {
      mqRestHost: host,
      mqRestPort: 9443,
      mqRestUser: 'mqadmin',
      mqRestPassword: 'mqpass',
    },
  } as unknown as AppConfig;
}

const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(() => {
  fetchMock.mockReset();
});

describe('getMqQueues', () => {
  it('queries queue depth attributes and normalizes the response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          qmgr: [{ name: 'QM01', queue: [{ name: 'PAYROLL.IN', curdepth: 450, maxdepth: 1000, type: 'QLOCAL' }] }],
        }),
        { status: 200 },
      ),
    );
    const [info] = await getMqQueues(makeConfig('mq.example.com'), 'QM01', ['payroll.in']);
    expect(info.queue).toBe('PAYROLL.IN');
    expect(info.curdepth).toBe(450);
    expect(info.maxdepth).toBe(1000);
    expect(info.percentFull).toBe(45);
    expect(info.type).toBe('QLOCAL');
    expect(fetchMock.mock.calls[0][0]).toContain('/ibmmq/rest/v2/admin/qmgr/QM01/queue/PAYROLL.IN?attributes=curdepth,maxdepth,type');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers['ibm-mq-rest-csrf-token']).toBeTruthy();
  });

  it('requires MQ_REST_HOST', async () => {
    await expect(getMqQueues(makeConfig(undefined), 'QM01', ['Q1'])).rejects.toThrow(ConfigError);
  });

  it('maps HTTP failures to ConnectionError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    await expect(getMqQueues(makeConfig('mq.example.com'), 'QM01', ['Q1'])).rejects.toThrow(ConnectionError);
  });
});

describe('getMqChannelStatus', () => {
  it('posts the get-status action and maps channels', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          qmgr: [
            {
              name: 'QM01',
              channel: [
                { name: 'TO.QM2', channelStatus: 'RUNNING', channelType: 'SDR', xmitq: 'XQ2', connectionCount: 1 },
                { name: 'FROM.QM3', channelStatus: 'RETRYING', channelType: 'RCVR' },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const channels = await getMqChannelStatus(makeConfig('mq.example.com'), 'QM01');
    expect(channels).toHaveLength(2);
    expect(channels[0].channelStatus).toBe('RUNNING');
    expect(channels[1].channelStatus).toBe('RETRYING');
    expect(fetchMock.mock.calls[0][0]).toContain('/ibmmq/rest/v2/admin/action/qmgr/QM01/channel/get-status');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});
