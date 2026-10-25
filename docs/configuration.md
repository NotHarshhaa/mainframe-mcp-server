# Configuration Guide

Configuration is **not** read from a `.env` file. Values are supplied by your MCP
client (Cursor, VS Code, Claude Desktop, etc.) in the `env` block of the MCP
server entry. When you install from the MCP registry, the IDE uses `server.json`
to prompt for required settings; everything is passed to this process as
environment variables at launch.

Values are validated at startup by a Zod schema (`src/config/schema.ts`).
Invalid configuration aborts startup with a message that points you to
[config/mcp-client.example.json](../config/mcp-client.example.json).

## MCP client setup

**Minimal** — copy [config/mcp-client.example.json](../config/mcp-client.example.json)
into your IDE MCP config and fill in `ZOSMF_HOST` and credentials.

**Full optional settings** — see
[config/mcp-client.full.example.json](../config/mcp-client.full.example.json).

### Cursor

Edit `~/.cursor/mcp.json` (or project `.cursor/mcp.json`) and add the `mainframe`
server block from the example file.

### VS Code

Add the same `mcpServers` structure to your VS Code MCP configuration (location
depends on your MCP extension; often user or workspace MCP settings).

### Claude Desktop

Edit `claude_desktop_config.json` and merge the `mcpServers` entry.

### Registry install

Publishing metadata in [server.json](../server.json) lists every supported
variable so marketplace installers can collect values after install.

## z/OSMF Connection

| Variable | Required | Default | Description |
|---|---|---|---|
| `ZOSMF_HOST` | yes | — | z/OSMF hostname or IP. |
| `ZOSMF_PORT` | no | `443` | z/OSMF HTTPS port. |
| `ZOSMF_BASE_PATH` | no | — | Optional base path / API mediation layer prefix. |

## Authentication

Provide **either** token auth **or** basic auth. Startup fails if neither is set.

| Variable | Description |
|---|---|
| `ZOSMF_TOKEN` | Auth token (token auth) — recommended over basic credentials. |
| `ZOSMF_TOKEN_TYPE` | Token type, e.g. `LTPA2`. Defaults to `LTPA2`. |
| `ZOSMF_USER` | User id (basic auth). |
| `ZOSMF_PASSWORD` | Password (basic auth). |

> Source secrets (token or password) from a vault or your MCP client's secret
> storage rather than hardcoding them in checked-in files.

## Identity & enterprise auth

| Variable | Default | Description |
|---|---|---|
| `ZOSMF_CERT` | — | PEM client certificate file (mTLS). Takes precedence over token/basic. |
| `ZOSMF_CERT_KEY` | — | PEM client key file (required with `ZOSMF_CERT`). |
| `ZOSMF_TOKEN_FILE` | — | Read the token from this file at startup — lets a vault/agent inject the secret. |
| `ZOSMF_TOKEN_TYPE` | `LTPA2` | `LTPA2` (z/OSMF session token) or `JWT` / `APIML` / `BEARER` (sent as `Authorization: Bearer`). |
| `ZOSMF_USER_ID` | — | **Per-user identity:** end user the server acts as via PassTicket propagation. |
| `ZOSMF_PASSTICKET_APP` | `ZOSMF` | RACF PTKTDATA application name used for PassTicket generation. |
| `ZOWE_TEAM_CONFIG` | — | Path to a `zowe.config.json`; fills any z/OSMF setting not set via env. |
| `ZOSMF_PROFILE` | `defaults.zosmf` | Which profile to import from the team config. |

**PassTicket identity propagation.** With `ZOSMF_USER_ID` set, the server
authenticates to z/OSMF with the service credential, calls the z/OSMF
Generate PassTicket API (`POST /zosmf/restconapi/passticket`) for the end
user, and runs every z/OSMF tool call under a session authenticated as that
user — so RACF sees who asked, not "the MCP service account". PassTickets are
cached for 8 minutes and regenerated transparently. On z/OS this requires the
service account to be permitted to generate PassTickets for the target user
and the application ID to be defined in PTKTDATA (`RDEFINE PTKTDATA ZOSMF ...`).

**API Mediation Layer / SSO.** Pass an APIML JWT (`ZOSMF_TOKEN_TYPE=APIML`,
with `ZOSMF_BASE_PATH=/api/v1` or your gateway prefix) or any OIDC-issued JWT
your z/OSMF accepts (`ZOSMF_TOKEN_TYPE=JWT`). For full OIDC/SSO flows, obtain
the token from your IdP outside this process and inject it via
`ZOSMF_TOKEN_FILE` (a credential-helper agent can refresh it).

**Zowe team config.** Set `ZOWE_TEAM_CONFIG=/path/to/zowe.config.json` to
import host/port/basePath/user/password/token values from an existing Zowe
profile (`ZOSMF_PROFILE` picks one; default is `defaults.zosmf`). Values
marked `@secure` are honored when stored in the config file itself; secrets
managed by an OS-keychain credential manager are not readable by this process
and are skipped. Explicit environment variables always win over profile
values.

## TLS

| Variable | Default | Description |
|---|---|---|
| `ZOSMF_REJECT_UNAUTHORIZED` | `true` | Verify the server certificate. Set `false` only for dev/test against internal CAs. |

> Setting `ZOSMF_REJECT_UNAUTHORIZED=false` logs a warning on startup. Never
> disable verification in production.

## Governed writes

Controls that apply to `submit_jcl` and `approve_write`:

| Variable | Default | Description |
|---|---|---|
| `SECURITY_WRITE_APPROVAL` | `false` | Human-in-the-loop: `submit_jcl` validates everything, returns a one-time approval token, and does **not** touch JES until `approve_write` is called with it. |
| `SECURITY_JCL_SCAN` | `true` | Pre-flight scan before submission: blocks IDCAMS `DELETE`, IEFBR14 steps that delete datasets via `DISP=(...,DELETE)`, blocked utilities (`ADRDSSU`, `ICKDSF`, `IEHINITT` by default), and restricted job classes. |
| `SECURITY_JCL_SCAN_STRICT` | `false` | WARN-level findings (e.g. IDCAMS `ALTER`) also block submissions. |
| `SECURITY_BLOCKED_PROGRAMS` | — | Extra comma-separated EXEC program names that may never run. |
| `SECURITY_BLOCKED_JOB_CLASSES` | — | Comma-separated JES job classes that may never be used. |
| `SECURITY_CHANGE_TICKET_PATTERN` | — | When set (e.g. `CHG[0-9]{6}`), every write must carry a `changeTicket` argument matching the regex. |
| `SECURITY_WRITE_WINDOW` | — | `HH:MM-HH:MM` in 24h time (overnight ranges such as `22:00-06:00` allowed). Writes outside the window are rejected. |
| `SECURITY_WRITE_DAYS` | every day | Allowed weekdays: `0`=Sun … `6`=Sat, e.g. `1-5` or `1,3,5`. |
| `SECURITY_WRITE_WINDOW_TZ` | `UTC` | IANA timezone the window is evaluated in. |

`submit_jcl` also accepts `dryRun=true`, which runs the structure checks and
the pre-flight scan and reports what a real submission would do — without
enforcing ticket/window gates and without touching JES.

## MCP Server

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_NAME` | `mainframe-mcp-server` | Server name advertised to clients. |
| `MCP_SERVER_VERSION` | `2.8.0` | Server version advertised to clients. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `sse` (legacy HTTP+SSE network transport). |
| `MCP_SSE_PORT` | `3000` | Listen port when `MCP_TRANSPORT=sse`. |

## Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | `fatal`,`error`,`warn`,`info`,`debug`,`trace`,`silent`. |

Logs are written to **stderr** so they never corrupt the stdio MCP channel.

## Operational Limits (Safety Guards)

| Variable | Default | Description |
|---|---|---|
| `MAX_JOB_OUTPUT_LINES` | `5000` | Max lines returned from a single spool DD. |
| `MAX_DATASET_READ_LINES` | `2000` | Max lines returned from a dataset / USS file read. |
| `MAX_JES_SPOOL_FILES` | `20` | Max spool files fetched during diagnostics. |
| `MAX_AUDIT_LINES` | `500` | Max RACF audit log lines to parse per query. |

## Enterprise integrations

All enterprise variables are optional. Tools return `CONFIG_ERROR` with setup guidance when required values are missing.

### CICS (CMCI)

| Variable | Default | Description |
|---|---|---|
| `CMCI_CONTEXT` | — | CICSplex name or region APPLID (required for CICS tools). |
| `CMCI_HOST` | `ZOSMF_HOST` | CMCI hostname. |
| `CMCI_PORT` | `1490` | CMCI HTTPS port. |
| `CMCI_BASE_PATH` | `/CICSSystemManagement` | CMCI REST base path. |

### Db2 REST

| Variable | Default | Description |
|---|---|---|
| `DB2_LOCATION` | — | Db2 subsystem location name (required for Db2 tools). |
| `DB2_HOST` | `ZOSMF_HOST` | Db2 REST hostname. |
| `DB2_PORT` | `50400` | Db2 REST port. |
| `DB2_BASE_PATH` | `/dbrest` | Db2 REST base path. |

### SMF / RMF

| Variable | Default | Description |
|---|---|---|
| `RMF_METRICS_ENABLED` | `true` | Query z/OSMF RMF metrics when available. |
| `SMF_SUMMARY_DATASET` | — | Optional SMF summary dataset for offline metrics. |

### RACF audit

| Variable | Default | Description |
|---|---|---|
| `RACF_AUDIT_USS_PATH` | — | USS path to RACF audit log file. |
| `RACF_AUDIT_DATASET` | — | Sequential dataset containing audit records. |

## Enterprise security controls

| Variable | Default | Description |
|---|---|---|
| `SECURITY_READ_ONLY` | `true` | When `true`, blocks write tools like `submit_jcl`. Safe by default — set `false` only when the agent is trusted to submit jobs. |
| `SECURITY_ALLOWED_TOOLS` | — | Comma-separated allowlist of MCP tool names. |
| `SECURITY_BLOCKED_TOOLS` | — | Comma-separated blocklist of MCP tool names. |
| `SECURITY_ALLOWED_DATASET_PATTERNS` | — | Comma-separated dataset patterns (e.g. `USERDEV.*,SYS1.*`). |
| `SECURITY_ALLOWED_USS_PATHS` | — | Comma-separated USS path prefixes. |
| `SECURITY_AUDIT_LOGGING` | `true` | Log every tool invocation to stderr (SIEM-friendly JSON). |
| `SECURITY_MAX_JCL_BYTES` | `65536` | Maximum inline JCL size for `submit_jcl`. |

## Policy-as-code, multi-environment, audit & SIEM, data protection

These controls back the four enterprise features — see
[docs/enterprise.md](enterprise.md) for a full walkthrough and
[config/policy.example.yaml](../config/policy.example.yaml) for a worked
policy file.

| Variable | Default | Description |
|---|---|---|
| `SECURITY_POLICY_FILE` | — | Path to a YAML policy file: roles → tools/dataset/USS patterns, users → roles, named environments, data classifications. |
| `ZOSMF_ENVIRONMENTS` | — | JSON array of named z/OSMF endpoints, e.g. `[{"name":"prod","host":"...","token":"...","readOnly":true}]`. |
| `ZOSMF_ENV` | — | Default environment used when a tool call omits the `environment` argument. |
| `SECURITY_AUDIT_FILE` | — | NDJSON audit log file with a SHA-256 hash chain (tamper-evident; verify with `npm run verify:audit`). |
| `SECURITY_AUDIT_SPLUNK_URL` / `SECURITY_AUDIT_SPLUNK_TOKEN` | — | Splunk HEC ingest URL + token for audit export. |
| `SECURITY_AUDIT_WEBHOOK_URL` / `SECURITY_AUDIT_WEBHOOK_TOKEN` | — | Generic HTTP webhook (ELK ingest, syslog-over-HTTP, SIEM bridge). |
| `SECURITY_AUDIT_OTLP_URL` | — | OpenTelemetry collector base URL (OTLP/JSON `/v1/logs`). |
| `SECURITY_DATA_PROTECTION` | `true` | Mask PII/PCI/SSN/secrets in job output and dataset/USS reads. |
| `SECURITY_REDACTION_RULES` | all built-ins | CSV of rule ids: `ssn,credit_card,email,secrets,jwt,private_key`. |
| `SECURITY_REDACTION_STYLE` | `mask` | `mask` keeps the last 4 characters; `token` replaces with `[REDACTED:TYPE]`. |

## Local development from source

Do not create a `.env` file for this server. Either:

1. Put variables in your IDE MCP config (recommended), or
2. Export them in your shell before `npm start`, or
3. Pass them inline: `ZOSMF_HOST=host ZOSMF_USER=u ZOSMF_PASSWORD=p npm start`

## Integration tests (z/OSMF sandbox)

Integration tests are **skipped by default** in CI. To run against a live sandbox,
export the same variables in your shell (or set them in your CI job):

```bash
export RUN_INTEGRATION=1
export ZOSMF_HOST=your-sandbox
export ZOSMF_USER=your-user
export ZOSMF_PASSWORD=your-password
npm run test:integration
```

Token auth (`ZOSMF_TOKEN`) works here as well — set whichever method matches your sandbox.

| Variable | Required | Description |
|---|---|---|
| `RUN_INTEGRATION` | yes | Set to `1` to enable integration tests. |
| `ZOSMF_HOST` | yes | Same as production config. |
| `ZOSMF_USER` / `ZOSMF_PASSWORD` | yes* | Credentials for the sandbox. |
| `ZOSMF_DATASET_PATTERN` | no | Dataset pattern for catalog tests (defaults to `<user>.*`). |
| `ZOSMF_USS_PATH` | no | USS directory for listing tests (defaults to `/u/<user>`). |
