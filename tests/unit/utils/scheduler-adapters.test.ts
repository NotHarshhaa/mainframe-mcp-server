import {
  fetchSchedulerJobStatus,
  normalizeSchedulerStatus,
  parseSchedulerAdapters,
  resolveScheduler,
} from '../../../src/utils/scheduler-adapters.js';
import { ConfigError, ConnectionError, ValidationError } from '../../../src/utils/errors.js';

const ADAPTERS_JSON = JSON.stringify([
  { name: 'controlm', type: 'controlm', host: 'https://ctm.example.com:8443', token: 'ctm-token' },
  { name: 'ca7', type: 'ca7', host: 'https://ca7.example.com', user: 'ca7usr', password: 'ca7pass' },
]);

const fetchMock = jest.fn();

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
});
beforeEach(() => {
  fetchMock.mockReset();
});

describe('parseSchedulerAdapters', () => {
  it('applies default path templates per type', () => {
    const [ctm] = parseSchedulerAdapters(ADAPTERS_JSON);
    expect(ctm.jobStatusPath).toBe('/config/jobs?jobName={jobName}');
    const [ca7] = parseSchedulerAdapters(ADAPTERS_JSON).filter((a) => a.type === 'ca7');
    expect(ca7.jobStatusPath).toBe('/ca7/api/v2/jobs?jobName={jobName}');
  });
  it('rejects malformed JSON and missing fields', () => {
    expect(() => parseSchedulerAdapters('{nope')).toThrow(ConfigError);
    expect(() => parseSchedulerAdapters(JSON.stringify([{ name: 'x', host: 'https://h' }]))).toThrow(/token or user\+password/);
    expect(() => parseSchedulerAdapters(JSON.stringify([{ name: 'x', host: 'https://h', type: 'bogus', token: 't' }]))).toThrow(/unknown type/);
  });
  it('allows path overrides', () => {
    const [a] = parseSchedulerAdapters(
      JSON.stringify([{ name: 'x', type: 'generic', host: 'https://h', token: 't', jobStatusPath: '/api/j/{jobName}' }]),
    );
    expect(a.jobStatusPath).toBe('/api/j/{jobName}');
  });
});

describe('resolveScheduler', () => {
  const adapters = parseSchedulerAdapters(ADAPTERS_JSON);
  it('matches by name case-insensitively', () => {
    expect(resolveScheduler(adapters, 'ControlM').type).toBe('controlm');
  });
  it('requires a name when several are configured', () => {
    expect(() => resolveScheduler(adapters)).toThrow(ValidationError);
  });
  it('fails when nothing is configured', () => {
    expect(() => resolveScheduler([], 'x')).toThrow(ConfigError);
  });
});

describe('fetchSchedulerJobStatus', () => {
  const adapter = parseSchedulerAdapters(ADAPTERS_JSON)[0];

  it('builds the URL, sends the bearer token, and normalizes status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobs: [{ jobName: 'PAYROLL_DAILY', status: 'Ended OK' }] }), { status: 200 }),
    );
    const status = await fetchSchedulerJobStatus(adapter, 'payroll_daily');
    expect(fetchMock.mock.calls[0][0]).toBe('https://ctm.example.com:8443/config/jobs?jobName=PAYROLL_DAILY');
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer ctm-token');
    expect(status.normalizedStatus).toBe('ENDED OK');
    expect(status.matchCount).toBe(1);
  });

  it('uses basic auth when no token', async () => {
    const ca7 = parseSchedulerAdapters(ADAPTERS_JSON).find((a) => a.type === 'ca7')!;
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await fetchSchedulerJobStatus(ca7, 'X');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('maps HTTP errors to ConnectionError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(fetchSchedulerJobStatus(adapter, 'X')).rejects.toThrow(ConnectionError);
  });
});

describe('normalizeSchedulerStatus', () => {
  it('maps vendor spellings', () => {
    expect(normalizeSchedulerStatus('Ended OK')).toBe('ENDED OK');
    expect(normalizeSchedulerStatus('ENDED NOT OK - ABEND S0C4')).toBe('ENDED NOT OK');
    expect(normalizeSchedulerStatus('WAITING')).toBe('WAITING');
    expect(normalizeSchedulerStatus('EXECUTING')).toBe('EXECUTING');
    expect(normalizeSchedulerStatus('Something Else')).toBe('SOMETHING ELSE');
    expect(normalizeSchedulerStatus(42)).toBeUndefined();
  });
});
