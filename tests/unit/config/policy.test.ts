import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPolicy,
  matchClassification,
  resolveRoleForUser,
  roleAllowsDataset,
  roleAllowsTool,
  roleAllowsUssPath,
} from '../../../src/config/policy.js';
import { ConfigError } from '../../../src/utils/errors.js';

const VALID_POLICY = `
version: 1
defaults:
  role: developer
  environment: dev
environments:
  dev:
    description: Development LPAR
    host: dev.zosmf.example.com
    readOnly: false
    password: \${env:POLICY_TEST_PASSWORD}
  prod:
    description: Production sysplex
    host: prod.zosmf.example.com
    readOnly: true
    allowedRoles: [operator, admin]
roles:
  viewer:
    description: Read-only monitoring
    tools:
      allow: ["list_*", "get_*", "read_*", "whoami"]
    readOnly: true
  developer:
    inherits: viewer
    tools:
      allow: ["submit_jcl", "list_jobs"]
      deny: ["approve_write"]
    datasets:
      allow: ["DEV.**", "TEST.**"]
  operator:
    inherits: developer
    readOnly: false
    changeTicketPattern: "CHG[0-9]{6}"
    datasets:
      allow: ["PROD.**"]
users:
  - username: alice
    roles: [operator]
  - username: bob
    roles: [viewer]
    environments: [dev]
dataProtection:
  redaction:
    default: "on"
    style: mask
  classifications:
    - name: pci-cards
      datasets: ["PROD.CARDS.**"]
      redact: [credit_card]
      maxLines: 100
      sample: { head: 50, tail: 10 }
`;

describe('loadPolicy', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-policy-'));
    process.env.POLICY_TEST_PASSWORD = 's3cret';
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.POLICY_TEST_PASSWORD;
  });

  const write = (content: string): string => {
    const path = join(dir, 'policy.yaml');
    writeFileSync(path, content, 'utf8');
    return path;
  };

  it('loads roles, inheritance, users, and environments', () => {
    const policy = loadPolicy(write(VALID_POLICY));
    expect(policy.defaultRole).toBe('developer');
    expect(policy.defaultEnvironment).toBe('dev');
    expect([...policy.roles.keys()].sort()).toEqual(['developer', 'operator', 'viewer']);
    expect(policy.environments.get('prod')?.readOnly).toBe(true);
    expect(policy.environments.get('dev')?.password).toBe('s3cret');
  });

  it('resolves inherited matchers (child allow replaces, deny accumulates)', () => {
    const policy = loadPolicy(write(VALID_POLICY));
    const { role } = resolveRoleForUser(policy, 'ALICE');
    expect(role.name).toBe('operator');
    // operator explicitly declares readOnly: false — inherited read-only from
    // viewer would otherwise flow down the whole chain.
    expect(role.readOnly).toBe(false);
    expect(role.changeTicketPattern).toBe('CHG[0-9]{6}');
    expect(roleAllowsTool(role, 'submit_jcl')).toBe(true);
    expect(roleAllowsTool(role, 'approve_write')).toBe(false);
    expect(roleAllowsTool(role, 'delete_dataset')).toBe(false);
    // developer inherits viewer's readOnly: true (fail-safe inheritance).
    const dev = resolveRoleForUser(policy, 'NOBODY').role;
    expect(dev.name).toBe('developer');
    expect(dev.readOnly).toBe(true);
  });

  it('unknown users fall back to defaults.role', () => {
    const policy = loadPolicy(write(VALID_POLICY));
    const { role } = resolveRoleForUser(policy, 'NOBODY');
    expect(role.name).toBe('developer');
  });

  it('enforces role dataset and USS patterns', () => {
    const policy = loadPolicy(write(VALID_POLICY));
    // developer has datasets.allow = DEV/TEST
    const { role } = resolveRoleForUser(policy, 'NOBODY');
    expect(roleAllowsDataset(role, 'DEV.MY.COPYLIB')).toBe(true);
    expect(roleAllowsDataset(role, 'PROD.PAYROLL.MASTER')).toBe(false);
    expect(roleAllowsUssPath(role, '/anything')).toBe(true); // no uss matcher
  });

  it('fails closed when an unknown user hits a policy without defaults.role', () => {
    const path = write('version: 1\nroles:\n  viewer:\n    tools: { allow: ["list_*"] }\nusers: []\n');
    expect(() => resolveRoleForUser(loadPolicy(path), 'NOBODY')).toThrow(ConfigError);
  });

  it('rejects undefined role references and cycles', () => {
    expect(() => loadPolicy(write('version: 1\nroles:\n  a:\n    inherits: b\n'))).toThrow(ConfigError);
    expect(() =>
      loadPolicy(write('version: 1\nroles:\n  a:\n    inherits: b\n  b:\n    inherits: a\n')),
    ).toThrow(ConfigError);
  });

  it('rejects invalid YAML and unknown fields', () => {
    expect(() => loadPolicy(write('version: 1\nroles: [unclosed\n'))).toThrow(ConfigError);
    expect(() => loadPolicy(write('version: 1\nbogusKey: true\n'))).toThrow(/failed validation/);
  });

  it('rejects unknown redaction rules with the valid list', () => {
    const bad = 'version: 1\ndataProtection:\n  classifications:\n    - name: x\n      datasets: ["A.**"]\n      redact: [not_a_rule]\n';
    expect(() => loadPolicy(write(bad))).toThrow(/Unknown redaction rule "not_a_rule"/);
  });

  it('fails on missing ${env:VAR} interpolation', () => {
    delete process.env.POLICY_TEST_PASSWORD;
    expect(() => loadPolicy(write(VALID_POLICY))).toThrow(/POLICY_TEST_PASSWORD/);
  });
});

describe('matchClassification', () => {
  let dir: string;
  let policy: ReturnType<typeof loadPolicy>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-policy-'));
    const path = join(dir, 'policy.yaml');
    writeFileSync(
      path,
      `
version: 1
dataProtection:
  classifications:
    - name: pci
      datasets: ["PROD.CARDS.**"]
      tools: [read_dataset]
    - name: pii-files
      uss: ["/prod/customers/**"]
`,
      'utf8',
    );
    policy = loadPolicy(path);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches dataset globs and honors the tool filter', () => {
    expect(matchClassification(policy, { tool: 'read_dataset', dataset: 'prod.cards.master' })?.name).toBe('pci');
    expect(matchClassification(policy, { tool: 'list_datasets', dataset: 'PROD.CARDS.MASTER' })).toBeUndefined();
  });
  it('matches USS paths', () => {
    expect(matchClassification(policy, { tool: 'read_uss_file', ussPath: '/prod/customers/jane.txt' })?.name).toBe('pii-files');
    expect(matchClassification(policy, { tool: 'read_uss_file', ussPath: '/etc/passwd' })).toBeUndefined();
  });
  it('resolves .. in USS paths before matching', () => {
    expect(matchClassification(policy, { tool: 'read_uss_file', ussPath: '/prod/customers/../customers/x' })?.name).toBe('pii-files');
  });
});
