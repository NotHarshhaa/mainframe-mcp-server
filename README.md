<h1 align="center">
  <strong>mainframe-mcp-server</strong>
</h1>

<p align="center">
  MCP Server for IBM z/OS using Zowe APIs
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  </a>
  <a href="https://github.com/modelcontextprotocol/typescript-sdk">
    <img src="https://img.shields.io/badge/MCP-SDK-8B5CF6?style=for-the-badge" />
  </a>
  <a href="https://github.com/zowe/zowe-cli">
    <img src="https://img.shields.io/badge/Zowe-SDK-22C55E?style=for-the-badge" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-FBBF24?style=for-the-badge" />
  </a>
  <img src="https://img.shields.io/badge/Status-Stable-22C55E?style=for-the-badge" />
</p>

> **An enterprise-grade Model Context Protocol (MCP) server for IBM z/OS environments.**  
> Bridges MCP-compatible AI agents with mainframe resources — jobs, datasets, USS, and operational diagnostics — using the Zowe SDK (Open Mainframe Project) as the connectivity layer.

<p align="center">
  <img src="./public/banner.png" alt="mainframe-mcp-server — Bridge AI agents with IBM z/OS via MCP and Zowe SDK" width="100%" />
</p>

---

## What it does

`mainframe-mcp-server` exposes z/OS capabilities as [Model Context Protocol](https://modelcontextprotocol.io/) tools. An AI agent can list jobs, read datasets, inspect USS paths, submit JCL, and run operational diagnostics — without you writing Zowe CLI commands by hand.

Connectivity is handled by the [Zowe SDK](https://github.com/zowe/zowe-cli) (Open Mainframe Project) over z/OSMF REST. This project adds the MCP tool layer, input validation, safety limits, and AI-friendly response formatting on top.

---

## How it's different

| | **mainframe-mcp-server** | **Zowe CLI** | **Cloud MCP tools** (K8s, AWS, GitHub…) |
|---|---|---|---|
| **Interface** | MCP tools for AI agents | Terminal commands | MCP tools for cloud-native stacks |
| **z/OS coverage** | Jobs, datasets, USS, diagnostics | Full Zowe command set | None |
| **Workflow** | Natural-language ops ("why did PAYJOB01 fail?") | Manual CLI scripting | N/A for mainframe |
| **Output** | Structured text tuned for LLM reasoning | Raw terminal output | N/A |

This is **not** a replacement for Zowe CLI or IBM Z Open Editor — it is an MCP bridge so AI assistants can drive those same z/OSMF APIs.

---

## Tools

### Jobs

| Tool | Description |
|---|---|
| `list_jobs` | List jobs by owner, prefix, or status |
| `get_job_status` | Status and return code for a job |
| `get_job_output` | Spool inventory or DD content |
| `submit_jcl` | Submit inline JCL |
| `analyze_job_failure` | Abend code, failing step, and suggested fix |
| `get_job_jcl` | Retrieve submitted JCL from job spool |

### Datasets

| Tool | Description |
|---|---|
| `list_datasets` | List datasets matching an HLQ pattern |
| `read_dataset` | Read a sequential dataset or PDS member |
| `search_dataset` | Search datasets by pattern |
| `search_members` | Search or list PDS members |
| `get_dataset_info` | Catalog attributes without reading content |

### USS

| Tool | Description |
|---|---|
| `list_uss_directory` | List a USS directory |
| `read_uss_file` | Read a USS file |
| `search_uss_files` | Search files under a USS path |

### Operations

| Tool | Description |
|---|---|
| `find_failed_jobs` | Failed jobs in a time window |
| `summarize_abends` | Abend code breakdown across recent jobs |
| `system_health_summary` | Active, queued, and failed job snapshot |
| `investigate_incident` | Full incident bundle for a job |
| `lookup_abend_code` | Abend reference lookup (S0C7, S806, S222, S0C4, …) |
| `verify_zosmf_connection` | Test z/OSMF connectivity and auth |
| `compare_jobs` | Side-by-side comparison of two jobs |
| `get_user_jobs_summary` | Job counts by status for an owner |

### CICS

| Tool | Description |
|---|---|
| `list_cics_regions` | List CICS regions via CMCI REST |
| `get_cics_region_status` | Status and attributes of a CICS region |
| `list_cics_transactions` | Transaction definitions in a region |

Requires optional CMCI REST configuration: `CMCI_CONTEXT` (CICSplex name or region APPLID), plus `CMCI_HOST` / `CMCI_PORT` if CMCI is not fronted by z/OSMF. Tools return `CONFIG_ERROR` with setup guidance when these are missing.

### Db2

| Tool | Description |
|---|---|
| `list_db2_subsystems` | List Db2 locations via Db2 REST |
| `search_db2_catalog` | Search catalog tables and views |

Requires optional Db2 REST configuration: `DB2_LOCATION` (subsystem location name), plus `DB2_HOST` / `DB2_PORT` if the Db2 REST service is not fronted by z/OSMF.

### SMF / Security

| Tool | Description |
|---|---|
| `get_smf_metrics` | SMF/RMF performance metrics snapshot |
| `query_racf_audit` | Query RACF audit records from a log source |
| `security_posture_summary` | Report active security controls and recommendations |

Optional configuration: SMF metrics are read from z/OSMF RMF (`RMF_METRICS_ENABLED`, default `true`) and/or `SMF_SUMMARY_DATASET`; RACF audit records are parsed from `RACF_AUDIT_USS_PATH` or `RACF_AUDIT_DATASET`. `security_posture_summary` always works and reports which controls are active.

### Intelligence

| Tool | Description |
|---|---|
| `analyze_root_cause` | Deep root-cause analysis with correlation and action items |
| `predict_batch_failures` | Predictive risk scoring for recurring batch failures |

Built in — no external AI API is called; the agent interprets the report. Correlation and risk scoring run against the failures currently visible in the JES output queue.

See [docs/tools-reference.md](./docs/tools-reference.md) for full input/output details.

---

## Enterprise security

Security is enforced at the **MCP server layer**, in addition to RACF/z/OSMF permissions on the mainframe itself. Every control below is enabled through environment variables:

| Control | Env variable | Purpose |
|---|---|---|
| Read-only mode | `SECURITY_READ_ONLY=true` | Blocks `submit_jcl` and other write tools |
| Tool allowlist | `SECURITY_ALLOWED_TOOLS` | Only permit specific tools (least privilege) |
| Tool blocklist | `SECURITY_BLOCKED_TOOLS` | Explicitly deny dangerous tools |
| Dataset boundaries | `SECURITY_ALLOWED_DATASET_PATTERNS` | Restrict dataset access by HLQ pattern |
| USS boundaries | `SECURITY_ALLOWED_USS_PATHS` | Restrict USS paths by prefix |
| Audit logging | `SECURITY_AUDIT_LOGGING=true` | Log every tool call (credentials redacted) |
| JCL size limit | `SECURITY_MAX_JCL_BYTES` | Cap inline JCL submit size |
| TLS verification | `ZOSMF_REJECT_UNAUTHORIZED=true` | Enforce certificate validation |

Use `security_posture_summary` to inspect which controls are active and get hardening recommendations.

**Important:** Enterprise deployment also requires:
- A dedicated **service account** on z/OS with least-privilege RACF profiles
- **Secrets** in a vault (not plain env vars in production)
- **Network** restrictions (z/OSMF behind API gateway / VPN)
- **HTTP+SSE transport** placed behind an auth proxy if exposed beyond localhost

The mainframe still enforces the final authorization — this server adds guardrails so AI agents cannot exceed configured boundaries.

---

## Operational intelligence

Capabilities built into the server:

- **USS tools** — list, read, and search USS paths
- **`investigate_incident`** — status, root-cause analysis, spool inventory, and diagnostic excerpt in one call
- **`system_health_summary`** — HEALTHY / DEGRADED / CRITICAL snapshot with top abend codes
- **Abend code lookup** — curated reference for common system and user abends via `lookup_abend_code`
- **Structured responses** — numbered sections and tables designed for AI agent parsing
- **Integration tests** — optional sandbox suite (`RUN_INTEGRATION=1 npm run test:integration`)

---

## Quick start

**Requirements:** Node.js 18+, a reachable z/OSMF endpoint, and valid z/OS credentials.

### Install via npm

```bash
npx -y @notharshhaa/mainframe-mcp-server
```

When you add this server in your IDE (Cursor, VS Code, Claude Desktop, etc.), the
installer prompts for connection settings (driven by `server.json`). Those values
are stored in your MCP config file — not in a `.env` file.

Example MCP config — token auth, the recommended setup. Source the token from your vault or the IDE's secret storage rather than hardcoding it (see also [config/mcp-client.example.json](./config/mcp-client.example.json)):

```json
{
  "mcpServers": {
    "mainframe": {
      "command": "npx",
      "args": ["-y", "@notharshhaa/mainframe-mcp-server"],
      "env": {
        "ZOSMF_HOST": "your-zosmf-host.internal",
        "ZOSMF_PORT": "443",
        "ZOSMF_TOKEN": "your-zosmf-token",
        "ZOSMF_TOKEN_TYPE": "LTPA2"
      }
    }
  }
}
```

Basic auth (`ZOSMF_USER` + `ZOSMF_PASSWORD`) is also supported — if you use it, inject the values from a vault or secret manager instead of pasting them into the config file.

### Run from source

```bash
git clone https://github.com/NotHarshhaa/mainframe-mcp-server.git
cd mainframe-mcp-server
npm install
npm run build
```

Point your IDE at `dist/index.js` and set `env` in MCP config (copy from
`config/mcp-client.example.json`), or export variables in your shell before `npm start`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ZOSMF_HOST` | yes | z/OSMF hostname |
| `ZOSMF_TOKEN` | yes* | Token auth — recommended over basic credentials |
| `ZOSMF_TOKEN_TYPE` | no | Token type (default `LTPA2`) |
| `ZOSMF_USER` / `ZOSMF_PASSWORD` | yes* | Basic auth — alternative to token auth |
| `ZOSMF_PORT` | no | HTTPS port (default `443`) |
| `ZOSMF_REJECT_UNAUTHORIZED` | no | TLS verification (default `true`) |

\* Provide either a token **or** user/password.

Full configuration reference: [docs/configuration.md](./docs/configuration.md)

---

## Transports

Two MCP transports are supported, selected with `MCP_TRANSPORT`:

| Transport | How to enable | Use when |
|---|---|---|
| **stdio** (default) | Omit `MCP_TRANSPORT` | IDE / desktop MCP clients (Cursor, VS Code, Claude Desktop). Logs go to stderr only. |
| **HTTP+SSE** | `MCP_TRANSPORT=sse` | Containerized or shared deployments. Endpoints: `GET /sse` (open stream), `POST /messages?sessionId=…`, `GET /health`. Place it behind an auth proxy if exposed beyond localhost. |

> **Streamable HTTP is not supported yet.** The MCP spec has moved from HTTP+SSE to
> Streamable HTTP, and this server still implements the legacy HTTP+SSE transport.
> Clients that only speak Streamable HTTP should launch the server over stdio (or front
> it with a transport shim). See [docs/deployment.md](./docs/deployment.md).

---

## Examples

**Why did a job fail?**

```
User:  Why did PAYJOB01 fail?
Agent: analyze_job_failure({ jobId: "JOB01234" })
```

```
Job:     PAYJOB01 (JOB01234)
Status:  ABEND S806
Step:    STEP030 - LOADPGM
Reason:  Program load failure — module PAYRPTX not found
Fix:     Verify PAYRPTX is compiled and linked into the correct load library.
```

**Failed jobs in the last 24 hours**

```
User:  Show me all failed jobs from the last 24 hours
Agent: find_failed_jobs({ hours: 24 })
```

**Read a dataset member**

```
User:  Show me SYS1.PROCLIB(IKJEFT01)
Agent: read_dataset({ dsn: "SYS1.PROCLIB", member: "IKJEFT01" })
```

**What does abend S0C7 mean?**

```
User:  What is abend S0C7?
Agent: lookup_abend_code({ code: "S0C7" })
```

**Predict which batch jobs might fail next**

```
User:  Which batch jobs are at risk of failing?
Agent: predict_batch_failures({ hours: 168 })
```

---

## Documentation

- **[Website (GitHub Pages)](https://notharshhaa.github.io/mainframe-mcp-server/)** — overview, tools, setup, enterprise guide
- [Configuration](./docs/configuration.md) — all environment variables
- [Tools reference](./docs/tools-reference.md) — inputs, outputs, and error codes
- [Deployment](./docs/deployment.md) — transports (stdio, HTTP+SSE), Docker, systemd

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Trademarks

Not affiliated with IBM or the Open Mainframe Project. IBM, z/OS, CICS, Db2 and RACF are trademarks of IBM.
