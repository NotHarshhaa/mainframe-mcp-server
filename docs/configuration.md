# Configuration Guide

All configuration is supplied through environment variables (loaded from a
local `.env` file in development via `dotenv`). Values are validated at startup
by a Zod schema (`src/config/schema.ts`); invalid configuration aborts startup
with a descriptive error.

## z/OSMF Connection

| Variable | Required | Default | Description |
|---|---|---|---|
| `ZOSMF_HOST` | yes | — | z/OSMF hostname or IP. |
| `ZOSMF_PORT` | no | `443` | z/OSMF HTTPS port. |
| `ZOSMF_BASE_PATH` | no | — | Optional base path / API mediation layer prefix. |

## Authentication

Provide **either** basic auth **or** a token. Startup fails if neither is set.

| Variable | Description |
|---|---|
| `ZOSMF_USER` | User id (basic auth). |
| `ZOSMF_PASSWORD` | Password (basic auth). |
| `ZOSMF_TOKEN` | Auth token (token auth). |
| `ZOSMF_TOKEN_TYPE` | Token type, e.g. `LTPA2`. Defaults to `LTPA2`. |

## TLS

| Variable | Default | Description |
|---|---|---|
| `ZOSMF_REJECT_UNAUTHORIZED` | `true` | Verify the server certificate. Set `false` only for dev/test against internal CAs. |

> Setting `ZOSMF_REJECT_UNAUTHORIZED=false` logs a warning on startup. Never
> disable verification in production.

## MCP Server

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_NAME` | `mainframe-mcp-server` | Server name advertised to clients. |
| `MCP_SERVER_VERSION` | `2.0.0` | Server version advertised to clients. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `sse`. |
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

## Enterprise (Phase 3)

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

## Example `.env`

See [`.env.example`](../.env.example) for a complete starting template.

## Integration tests (z/OSMF sandbox)

Integration tests are **skipped by default** in CI. To run against a live sandbox:

```bash
RUN_INTEGRATION=1 npm run test:integration
```

| Variable | Required | Description |
|---|---|---|
| `RUN_INTEGRATION` | yes | Set to `1` to enable integration tests. |
| `ZOSMF_HOST` | yes | Same as production config. |
| `ZOSMF_USER` / `ZOSMF_PASSWORD` | yes* | Credentials for the sandbox. |
| `ZOSMF_DATASET_PATTERN` | no | Dataset pattern for catalog tests (defaults to `<user>.*`). |
| `ZOSMF_USS_PATH` | no | USS directory for listing tests (defaults to `/u/<user>`). |
