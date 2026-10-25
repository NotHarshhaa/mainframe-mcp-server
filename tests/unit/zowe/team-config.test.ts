import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTeamProfile } from '../../../src/zowe/team-config.js';
import { ConfigError } from '../../../src/utils/errors.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'team-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(json: unknown, file = 'zowe.config.json'): string {
  const p = join(dir, file);
  writeFileSync(p, JSON.stringify(json), 'utf8');
  return p;
}

describe('loadTeamProfile', () => {
  it('resolves the zosmf default profile (nested team config)', () => {
    const p = writeConfig({
      profiles: {
        lpar1: {
          profiles: {
            zosmf: {
              type: 'zosmf',
              properties: {
                host: 'mainframe.example.com',
                port: 1443,
                rejectUnauthorized: false,
              },
            },
          },
        },
      },
      defaults: { zosmf: 'lpar1.zosmf' },
    });

    expect(loadTeamProfile(p)).toEqual({
      host: 'mainframe.example.com',
      port: 1443,
      basePath: undefined,
      user: undefined,
      password: undefined,
      tokenType: undefined,
      tokenValue: undefined,
      rejectUnauthorized: false,
    });
  });

  it('resolves an explicit leaf name and @secure entries from the secure map', () => {
    const p = writeConfig({
      profiles: {
        lpar1: {
          profiles: {
            zosmf: {
              type: 'zosmf',
              properties: {
                host: 'mainframe.example.com',
                user: '@secure',
                password: '@secure',
                tokenValue: '@secure',
              },
            },
          },
        },
      },
      secure: {
        'lpar1.zosmf.properties.user': 'FIRMUSER',
        'lpar1.zosmf.properties.password': 's3cret',
        'lpar1.zosmf.properties.tokenValue': 'jwt-token-value',
      },
    });

    const profile = loadTeamProfile(p, 'zosmf');
    expect(profile.user).toBe('FIRMUSER');
    expect(profile.password).toBe('s3cret');
    expect(profile.tokenValue).toBe('jwt-token-value');
  });

  it('ignores values still managed by a credential manager (@secure without entry)', () => {
    const p = writeConfig({
      profiles: {
        zosmf: {
          type: 'zosmf',
          properties: { host: 'h', user: '@secure', password: '@secure' },
        },
      },
    });

    const profile = loadTeamProfile(p);
    expect(profile.host).toBe('h');
    expect(profile.user).toBeUndefined();
    expect(profile.password).toBeUndefined();
  });

  it('throws ConfigError for an unknown profile name', () => {
    const p = writeConfig({
      profiles: { zosmf: { type: 'zosmf', properties: { host: 'h' } } },
    });
    expect(() => loadTeamProfile(p, 'nope')).toThrow(ConfigError);
  });

  it('throws ConfigError for an unreadable file', () => {
    expect(() => loadTeamProfile(join(dir, 'missing.json'))).toThrow(ConfigError);
  });
});
