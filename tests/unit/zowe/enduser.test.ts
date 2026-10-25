import { Session } from '@zowe/imperative';
import type { AppConfig } from '../../../src/config/schema.js';
import { createEndUserSessionResolver, generatePassTicket, normalizeUserId, invalidateEndUserSession } from '../../../src/zowe/enduser.js';
import { postJson } from '../../../src/zowe/rest-client.js';
import { ConfigError, ConnectionError } from '../../../src/utils/errors.js';

jest.mock('../../../src/zowe/rest-client.js', () => ({
  ...jest.requireActual('../../../src/zowe/rest-client.js'),
  postJson: jest.fn(),
}));

const postJsonMock = jest.mocked(postJson);

function makeConfig(userId?: string): AppConfig {
  return {
    zosmf: {
      host: 'zosmf.example.com',
      port: 1443,
      rejectUnauthorized: true,
      user: 'MCPUSR',
      password: 'service-cred',
      userId,
      passticketApp: 'ZOSMF',
    },
  } as unknown as AppConfig;
}

describe('normalizeUserId', () => {
  it('trims and uppercases', () => {
    expect(normalizeUserId(' endusr ')).toBe('ENDUSR');
  });
  it('rejects invalid z/OS user ids', () => {
    expect(() => normalizeUserId('TOOLONGUSER')).toThrow(ConfigError);
    expect(() => normalizeUserId('')).toThrow(ConfigError);
  });
});

describe('generatePassTicket', () => {
  const session = new Session({ hostname: 'h', type: 'basic', user: 'u', password: 'p' });

  it('posts to the z/OSMF passticket API and returns the ticket', async () => {
    postJsonMock.mockResolvedValueOnce({ ticket: 'PT123', rc: 0 });
    const ticket = await generatePassTicket(session, 'ENDUSR', 'ZOSMF');
    expect(ticket).toBe('PT123');
    expect(postJsonMock).toHaveBeenCalledWith(
      session,
      '/zosmf/restconapi/passticket',
      { userId: 'ENDUSR', applicationId: 'ZOSMF' },
    );
  });

  it('raises ConnectionError when RACF refuses generation', async () => {
    postJsonMock.mockResolvedValueOnce({ rc: 8, safRc: 4, reasonCode: 12 });
    await expect(generatePassTicket(session, 'ENDUSR', 'ZOSMF')).rejects.toThrow(ConnectionError);
  });
});

describe('createEndUserSessionResolver', () => {
  const serviceSession = new Session({ hostname: 'h', type: 'basic', user: 'u', password: 'p' });

  beforeEach(() => {
    postJsonMock.mockReset();
    invalidateEndUserSession();
  });

  it('returns undefined when no end-user identity is configured', () => {
    expect(createEndUserSessionResolver(makeConfig(undefined), serviceSession)).toBeUndefined();
  });

  it('generates a passticket and caches the end-user session', async () => {
    postJsonMock.mockResolvedValue({ ticket: 'PT123', rc: 0 });
    const resolver = createEndUserSessionResolver(makeConfig('ENDUSR'), serviceSession, { ttlMs: 60_000 })!;

    const s1 = await resolver();
    expect(postJsonMock).toHaveBeenCalledTimes(1);

    const s2 = await resolver();
    expect(postJsonMock).toHaveBeenCalledTimes(1); // served from cache
    expect(s2).toBe(s1);
  });

  it('regenerates after the TTL expires', async () => {
    postJsonMock.mockResolvedValue({ ticket: 'PT123', rc: 0 });
    const resolver = createEndUserSessionResolver(makeConfig('ENDUSR'), serviceSession, { ttlMs: -1 })!;

    await resolver();
    await resolver();
    expect(postJsonMock).toHaveBeenCalledTimes(2);
  });

  it('propagates passticket generation failures', async () => {
    postJsonMock.mockResolvedValueOnce({ rc: 8, safRc: 4, reasonCode: 12 });
    const resolver = createEndUserSessionResolver(makeConfig('ENDUSR'), serviceSession, { ttlMs: 60_000 })!;
    await expect(resolver()).rejects.toThrow(ConnectionError);
  });
});
