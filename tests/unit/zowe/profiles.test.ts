import { resolveSessionConfig, isLtpaTokenType } from '../../../src/zowe/profiles.js';
import type { AppConfig } from '../../../src/config/schema.js';

function makeConfig(zosmf: Record<string, unknown>): AppConfig {
  return { zosmf } as unknown as AppConfig;
}

describe('resolveSessionConfig', () => {
  it('builds a basic session from user/password', () => {
    const s = resolveSessionConfig(makeConfig({
      host: 'h', port: 443, rejectUnauthorized: true, user: 'U', password: 'P',
    }));
    expect(s).toMatchObject({ type: 'basic', hostname: 'h', user: 'U', password: 'P' });
  });

  it('uses LTPA2 token sessions by default', () => {
    const s = resolveSessionConfig(makeConfig({ host: 'h', port: 443, token: 'T' }));
    expect(s).toMatchObject({ type: 'token', tokenType: 'LTPA2', tokenValue: 'T' });
  });

  it('maps JWT and APIML tokens onto Bearer auth', () => {
    for (const tokenType of ['JWT', 'APIML', 'APIMLAUTHENTICATIONTOKEN', 'BEARER']) {
      const s = resolveSessionConfig(makeConfig({ host: 'h', port: 443, token: 'T', tokenType }));
      expect(s.type).toBe('bearer');
    }
  });

  it('builds an mTLS session from cert file paths', () => {
    const s = resolveSessionConfig(makeConfig({
      host: 'h', port: 443, cert: '/pki/client.pem', certKey: '/pki/client.key',
    }));
    expect(s).toMatchObject({ type: 'cert-pem', cert: '/pki/client.pem', certKey: '/pki/client.key' });
  });

  it('prefers the certificate over token/basic when present', () => {
    const s = resolveSessionConfig(makeConfig({
      host: 'h', port: 443, token: 'T', cert: 'c.pem', certKey: 'c.key',
    }));
    expect(s.type).toBe('cert-pem');
  });
});

describe('isLtpaTokenType', () => {
  it('treats LTPA2 variants as LTPA and everything else as bearer-style', () => {
    expect(isLtpaTokenType(undefined)).toBe(true);
    expect(isLtpaTokenType('LTPA2')).toBe(true);
    expect(isLtpaTokenType('ltpatoken2')).toBe(true);
    expect(isLtpaTokenType('JWT')).toBe(false);
    expect(isLtpaTokenType('apimlAuthenticationToken')).toBe(false);
  });
});
