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
| `MCP_SERVER_VERSION` | `1.0.0` | Server version advertised to clients. |
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

## Example `.env`

See [`.env.example`](../.env.example) for a complete starting template.
