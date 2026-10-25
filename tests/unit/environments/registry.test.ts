import type { AppConfig } from '../../../src/config/schema.js';
import {
  createEnvironmentRegistry,
  DEFAULT_ENVIRONMENT,
} from '../../../src/environments/registry.js';
import { ForbiddenError, ValidationError } from '../../../src/utils/errors.js';

function makeConfig(overrides?: { environments?: string; activeEnvironment?: string; readOnly?: boolean }): AppConfig {
  return {
    zosmf: {
      host: 'base.zosmf.example.com',
      port: 1443,
      rejectUnauthorized: true,
      user: 'SVCACCT',
      password: 'svc-cred',
      environments: overrides?.environments,
      activeEnvironment: overrides?.activeEnvironment,
    },
    security: {
      readOnly: overrides?.readOnly ?? true,
    },
  } as unknown as AppConfig;
}

describe('createEnvironmentRegistry (base only)', () => {
  it('always provides the synthetic default environment', () => {
    const registry = createEnvironmentRegistry(makeConfig());
    expect(registry.names()).toEqual([DEFAULT_ENVIRONMENT]);
    expect(registry.defaultName()).toBe(DEFAULT_ENVIRONMENT);
    const summary = registry.summarize();
    expect(summary.host).toBe('base.zosmf.example.com');
    expect(summary.readOnly).toBe(true);
    expect(summary.auth).toBe('basic');
  });

  it('rejects unknown environments with the available list', () => {
    const registry = createEnvironmentRegistry(makeConfig());
    expect(() => registry.get('prod')).toThrow(ValidationError);
    expect(() => registry.get('prod')).toThrow(/Available: default/);
  });
});

describe('createEnvironmentRegistry (ZOSMF_ENVIRONMENTS JSON)', () => {
  const json = JSON.stringify([
    { name: 'dev', host: 'dev.example.com', user: 'U1', password: 'P1', readOnly: false, description: 'Dev LPAR' },
    { name: 'prod', host: 'prod.example.com', token: 'tok', readOnly: true },
  ]);

  it('parses, lists, and summarizes environments', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    expect(registry.names().sort()).toEqual([DEFAULT_ENVIRONMENT, 'dev', 'prod']);
    const dev = registry.summarize('dev');
    expect(dev.host).toBe('dev.example.com');
    expect(dev.readOnly).toBe(false);
    expect(dev.auth).toBe('basic');
    expect(registry.summarize('prod').auth).toBe('token');
  });

  it('honors ZOSMF_ENV as the default environment', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json, activeEnvironment: 'dev' }));
    expect(registry.defaultName()).toBe('dev');
    expect(registry.summarize().isDefault).toBe(true);
  });

  it('fails closed on malformed JSON or missing fields', () => {
    expect(() => createEnvironmentRegistry(makeConfig({ environments: '{nope' }))).toThrow(/not valid JSON/);
    expect(() =>
      createEnvironmentRegistry(makeConfig({ environments: JSON.stringify([{ host: 'h.example.com' }]) })),
    ).toThrow(/missing a "name"/);
    expect(() =>
      createEnvironmentRegistry(makeConfig({ environments: JSON.stringify([{ name: 'x' }]) })),
    ).toThrow(/missing "host"/);
  });

  it('rejects a configured default that does not exist', () => {
    expect(() => createEnvironmentRegistry(makeConfig({ environments: json, activeEnvironment: 'staging' }))).toThrow(
      /Default environment "staging" is not defined/,
    );
  });
});

describe('environment sessions', () => {
  const json = JSON.stringify([
    { name: 'dev', host: 'dev.example.com', user: 'U1', password: 'P1' },
    { name: 'noauth', host: 'noauth.example.com' },
  ]);

  it('creates and caches a Session per environment', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    const s1 = registry.getSession('dev');
    const s2 = registry.getSession('dev');
    expect(s1).toBe(s2);
  });

  it('fails when an environment has no usable credentials', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    expect(() => registry.getSession('noauth')).toThrow(/no usable credentials/);
  });
});

describe('environment RBAC (assertAllowed)', () => {
  const json = JSON.stringify([{ name: 'prod', host: 'prod.example.com', user: 'U', password: 'P', allowedRoles: ['admin'] }]);

  it('permits users whose roles are allowed', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    expect(() =>
      registry.assertAllowed('prod', 'ADMINUSR', undefined, 'admin'),
    ).not.toThrow();
  });

  it('blocks roles not in allowedRoles', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    expect(() => registry.assertAllowed('prod', 'DEVUSR', undefined, 'developer')).toThrow(ForbiddenError);
  });

  it('blocks users restricted to other environments', () => {
    const registry = createEnvironmentRegistry(makeConfig({ environments: json }));
    expect(() =>
      registry.assertAllowed('prod', 'BOB', { username: 'BOB', roles: ['admin'], environments: ['dev'] }, 'admin'),
    ).toThrow(/not permitted to use environment "prod"/);
  });
});

describe('isReadOnly', () => {
  it('lets an environment override the server-wide flag', () => {
    const json = JSON.stringify([{ name: 'test', host: 't.example.com', user: 'U', password: 'P', readOnly: false }]);
    const registry = createEnvironmentRegistry(makeConfig({ environments: json, readOnly: true }));
    expect(registry.isReadOnly('test')).toBe(false);
    expect(registry.isReadOnly(DEFAULT_ENVIRONMENT)).toBe(true);
  });
});
