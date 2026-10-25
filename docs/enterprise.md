# Enterprise features

This server ships four enterprise capabilities that layer on top of the
existing governed-writes and env-var security controls:

1. **Multi-environment support** — several named systems (DEV/TEST/UAT/PROD,
   multiple LPARs/sysplexes), each with its own policy, e.g. read-only on
   PROD.
2. **Policy-as-code and RBAC** — one YAML file mapping roles to tools,
   dataset patterns, USS paths, and systems.
3. **Audit and SIEM** — structured JSON audit logs with correlation ids,
   exported to Splunk, ELK, syslog-over-HTTP, or OpenTelemetry, with
   tamper-evident hash chaining.
4. **Data protection** — redaction of PII, card numbers (PCI), SSNs, and
   secrets in job output and dataset/USS reads, with size caps, sampling, and
   classification-based access rules.

All four compose: a call is gated by env-var controls **and** the policy file
(the policy never loosens an env-var restriction), every decision lands in the
audit stream, and every content response passes through the data-protection
engine.

---

## 1. Multi-environment support

Environments are named z/OSMF endpoints. Two ways to define them — the policy
file (preferred) or inline JSON:

### In the policy file (SECURITY_POLICY_FILE)

```yaml
environments:
  dev:
    host: dev.zosmf.example.com
    user: SVCMCPD
    password: ${env:ZOSMF_DEV_PASSWORD}
    readOnly: false
  prod:
    host: prod.zosmf.example.com
    user: SVCMCPP
    password: ${env:ZOSMF_PROD_PASSWORD}
    readOnly: true            # writes are refused against PROD
    allowedRoles: [operator]  # only these roles may target PROD
```

### Inline via ZOSMF_ENVIRONMENTS

```json
[
  { "name": "dev", "host": "dev.example.com", "user": "U1", "password": "...", "readOnly": false },
  { "name": "prod", "host": "prod.example.com", "token": "...", "readOnly": true }
]
```

The server's own `ZOSMF_*` connection is always available as the environment
named `default`. Policy definitions win over `ZOSMF_ENVIRONMENTS` on name
collisions.

### Selecting an environment

Every tool accepts an optional `environment` argument:

```json
{ "tool": "list_jobs", "arguments": { "owner": "OPS*", "environment": "prod" } }
```

Omitted → the default environment (set with `ZOSMF_ENV` or
`defaults.environment` in the policy). `list_environments` shows every target
with its read-only status; the registry validates unknown names with the list
of available environments.

### Per-environment policy

| Control | Meaning |
| --- | --- |
| `readOnly` | Write tools are refused against this environment (overrides the server-wide `SECURITY_READ_ONLY` for that environment). |
| `allowedRoles` | Only these roles may pass an `environment` argument pointing at it. |
| user `environments:` | Per-user restriction — a user mapped to `[dev, test]` cannot target `prod`. |

Each environment holds its own credentials and lazily-created cached Zowe
session. Per-user identity (PassTicket propagation via `ZOSMF_USER_ID`)
applies to the base connection; named environments authenticate with their own
credentials.

---

## 2. Policy-as-code and RBAC

Enable with `SECURITY_POLICY_FILE=/path/to/policy.yaml`. Start from
[config/policy.example.yaml](../config/policy.example.yaml).

```yaml
version: 1
defaults:
  role: viewer
  environment: dev
roles:
  viewer:
    tools: { allow: ["list_*", "get_*", "read_*", "search_*"] }
    readOnly: true
  operator:
    inherits: viewer
    readOnly: false                      # explicit — parents are read-only
    datasets: { allow: ["PROD.**"] }
    changeTicketPattern: "CHG[0-9]{6}"
users:
  - username: BOB
    roles: [operator]
    environments: [dev, prod]
```

### What roles control

| Field | Semantics |
| --- | --- |
| `tools.allow` / `tools.deny` | Glob patterns over tool names (`list_*`). Deny wins; empty allow = all tools. |
| `datasets.allow` / `datasets.deny` | Mainframe globs over dataset names (`DEV.**`, `PAY.*.JCL`). |
| `uss.allow` / `uss.deny` | Path globs (`/u/dev/**`). |
| `readOnly` | Refuse all write tools for this role, in every environment. Inherited by child roles; children that must write declare `readOnly: false` explicitly. |
| `changeTicketPattern` | Role-level change-ticket regex — overrides `SECURITY_CHANGE_TICKET_PATTERN` for this role. |
| `maxDatasetReadLines` | Lower the read cap for this role. |

### Identity resolution

The acting user resolves in order: SSE `X-MCP-User` header (for gateway
deployments where an authenticating proxy injects it) → `ZOSMF_USER_ID` →
`ZOSMF_USER` → `ANONYMOUS`. Users are matched case-insensitively; unmapped
users get `defaults.role`, and if no default role is configured, calls fail
closed. A user's first mapped role applies.

### Composition with env vars

`SECURITY_ALLOWED_TOOLS`, `SECURITY_BLOCKED_TOOLS`,
`SECURITY_ALLOWED_DATASET_PATTERNS`, `SECURITY_ALLOWED_USS_PATHS`, and
`SECURITY_READ_ONLY` keep working and are enforced **in addition to** the
policy. The policy file is the reviewed, versioned control plane; env vars
remain the coarse per-instance fence.

`${env:VAR}` placeholders are interpolated at load time. Any structural,
reference, or interpolation error aborts startup — the server never runs with
a half-applied policy.

---

## 3. Audit and SIEM

### Records

Every tool invocation emits one structured JSON record containing:
correlation id (per call), user, MCP client (from the `initialize`
handshake), transport, environment, tool, redacted arguments, resource
references (dataset/USS path), outcome (`success` | `error` | `blocked`),
error code, duration, result size, and a data-protection summary.

### Tamper evidence

Records are chained with SHA-256: each record hashes the previous record's
hash. Any edit, deletion, or reordering breaks the chain at that sequence
number. Verify with:

```bash
npm run verify:audit -- /var/log/mainframe-mcp/audit.ndjson
# OK — 1543 record(s), hash chain intact.
# TAMPERED — first break at record seq=912 (record hash mismatch).
```

### Sinks (all optional, composable)

| Variable | Sink |
| --- | --- |
| `SECURITY_AUDIT_FILE` | NDJSON file (for ELK/Filebeat, long-term retention). Written synchronously; parent dirs are created. |
| `SECURITY_AUDIT_SPLUNK_URL` + `SECURITY_AUDIT_SPLUNK_TOKEN` | Splunk HEC (`sourcetype: mainframe:mcp:audit`). |
| `SECURITY_AUDIT_WEBHOOK_URL` (+ `_TOKEN`) | Generic HTTP webhook — ELK ingest, syslog-over-HTTP, SIEM bridges. |
| `SECURITY_AUDIT_OTLP_URL` | OpenTelemetry collector (OTLP/JSON `/v1/logs`). |

HTTP sinks are batched (flush at 25 records or every 2 s), time-boxed (5 s),
and best-effort: a dead collector never blocks or crashes a tool call —
failures are rate-limited warnings, and the file sink keeps the authoritative
copy. `SECURITY_AUDIT_LOGGING=false` turns the stderr audit lines off
(structured sinks stay on).

---

## 4. Data protection

### Default masking

Content-returning tools (`read_dataset`, `search_dataset`, `search_members`,
`read_uss_file`, `search_files`, `get_job_output`, `get_job_jcl`,
`analyze_failure`, `investigate`, `compare_jobs`) mask by default:

| Rule | Catches |
| --- | --- |
| `ssn` | 123-45-6789 (with validity ranges). |
| `credit_card` | 13–19 digit card numbers, **Luhn-validated** to suppress false positives. |
| `email` | Email addresses. |
| `secrets` | `PASSWORD=`/`PSWD=`/`api_key:`-style assignments in JCL, USS files, and spool (key name kept, value replaced). |
| `jwt` | JSON Web Tokens. |
| `private_key` | PEM private-key blocks. |

Masked output carries a footer so agents understand what changed:

```
[data protection: 3 item(s) masked (ssn, credit_card)]
```

Mask style: `mask` (default) keeps the trailing four characters; `token`
replaces with `[REDACTED:TYPE]`. Configure with `SECURITY_REDACTION_STYLE`,
`SECURITY_REDACTION_RULES` (CSV), or the policy's `dataProtection.redaction`
block. Disable with `SECURITY_DATA_PROTECTION=false` (not recommended for
shared deployments).

### Classification rules

Policy classifications add resource-specific behavior:

```yaml
dataProtection:
  classifications:
    - name: pci-cardholder
      datasets: ["PROD.CARDS.**"]
      tools: [read_dataset, get_job_output]
      redact: [credit_card, ssn]   # overrides the default rule set
      maxLines: 200                # hard line cap
      sample: { head: 100, tail: 25 }  # head/tail sampling
      roles: [sre]                 # role gate — only these roles may read
```

- `redact` replaces the default rules for matched content (`redact: []`
  disables masking for that classification).
- `maxLines` / `sample` cap exposure of bulk reads.
- `roles` gates access to the classified resource entirely — unauthorized
  roles get a FORBIDDEN error before the read happens.
- Without a `tools` filter the classification applies to any tool touching
  the resource.

Classification + env-var + role dataset/USS restrictions all apply — the
most restrictive wins.

---

## New tools

| Tool | Purpose |
| --- | --- |
| `list_environments` | Enumerate named environments with read-only status and role restrictions. |
| `whoami` | Show the acting user, resolved role, permission summary, active environment, and data-protection status — the debugging entry point for RBAC. |

## Configuration reference (new variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECURITY_POLICY_FILE` | — | Path to the YAML policy file. |
| `ZOSMF_ENVIRONMENTS` | — | JSON array of environment definitions. |
| `ZOSMF_ENV` | — | Default environment for calls without `environment`. |
| `SECURITY_AUDIT_FILE` | — | NDJSON audit file (tamper-evident chain). |
| `SECURITY_AUDIT_SPLUNK_URL` / `_TOKEN` | — | Splunk HEC export. |
| `SECURITY_AUDIT_WEBHOOK_URL` / `_TOKEN` | — | Generic webhook export. |
| `SECURITY_AUDIT_OTLP_URL` | — | OpenTelemetry OTLP/HTTP export. |
| `SECURITY_DATA_PROTECTION` | `true` | Default masking on content tools. |
| `SECURITY_REDACTION_RULES` | all | CSV of rule ids. |
| `SECURITY_REDACTION_STYLE` | `mask` | `mask` (keep last 4) or `token`. |
