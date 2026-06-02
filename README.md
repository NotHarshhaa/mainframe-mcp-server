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
> Bridges MCP-compatible AI agents with mainframe resources — jobs, datasets, USS, and operational diagnostics — using IBM Zowe SDK as the connectivity layer.

<p align="center">
  <img src="./public/banner.png" alt="mainframe-mcp-server — Bridge AI agents with IBM z/OS via MCP and Zowe SDK" width="100%" />
</p>

---

## What it does

`mainframe-mcp-server` exposes z/OS capabilities as [Model Context Protocol](https://modelcontextprotocol.io/) tools. An AI agent can list jobs, read datasets, inspect USS paths, submit JCL, and run operational diagnostics — without you writing Zowe CLI commands by hand.

Connectivity is handled by the [IBM Zowe SDK](https://github.com/zowe/zowe-cli) over z/OSMF REST. This project adds the MCP tool layer, input validation, safety limits, and AI-friendly response formatting on top.

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

### Datasets

| Tool | Description |
|---|---|
| `list_datasets` | List datasets matching an HLQ pattern |
| `read_dataset` | Read a sequential dataset or PDS member |
| `search_dataset` | Search datasets by pattern |
| `search_members` | Search or list PDS members |

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

### CICS

| Tool | Description |
|---|---|
| `list_cics_regions` | List CICS regions via CMCI REST |
| `get_cics_region_status` | Status and attributes of a CICS region |
| `list_cics_transactions` | Transaction definitions in a region |

### Db2

| Tool | Description |
|---|---|
| `list_db2_subsystems` | List Db2 locations via Db2 REST |
| `search_db2_catalog` | Search catalog tables and views |

### SMF / Security

| Tool | Description |
|---|---|
| `get_smf_metrics` | SMF/RMF performance metrics snapshot |
| `query_racf_audit` | Query RACF audit records from a log source |

### Intelligence

| Tool | Description |
|---|---|
| `analyze_root_cause` | Deep root-cause analysis with correlation and action items |
| `predict_batch_failures` | Predictive risk scoring for recurring batch failures |

See [docs/tools-reference.md](./docs/tools-reference.md) for full input/output details.

---

## Enterprise features

Phase 3 capabilities (require optional enterprise configuration):

- **CICS region tools** — CMCI REST integration (`CMCI_CONTEXT`, `CMCI_HOST`, `CMCI_PORT`)
- **Db2 catalog tools** — Db2 REST SQL queries (`DB2_LOCATION`, `DB2_HOST`, `DB2_PORT`)
- **SMF metrics exposure** — z/OSMF RMF and/or `SMF_SUMMARY_DATASET`
- **RACF audit integration** — parse audit logs from `RACF_AUDIT_USS_PATH` or `RACF_AUDIT_DATASET`
- **AI-assisted root cause analysis** — `analyze_root_cause` with confidence scoring and correlated incidents
- **Predictive batch failure detection** — `predict_batch_failures` with risk levels and trends

---

## Operational intelligence

Phase 2 capabilities built into the server:

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

Add to your MCP client config (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "mainframe": {
      "command": "npx",
      "args": ["-y", "@notharshhaa/mainframe-mcp-server"],
      "env": {
        "ZOSMF_HOST": "your-zosmf-host.internal",
        "ZOSMF_PORT": "443",
        "ZOSMF_USER": "your-username",
        "ZOSMF_PASSWORD": "your-password"
      }
    }
  }
}
```

### Run from source

```bash
git clone https://github.com/NotHarshhaa/mainframe-mcp-server.git
cd mainframe-mcp-server
npm install
cp .env.example .env   # fill in your z/OSMF credentials
npm run build
npm start
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ZOSMF_HOST` | yes | z/OSMF hostname |
| `ZOSMF_USER` / `ZOSMF_PASSWORD` | yes* | Basic auth credentials |
| `ZOSMF_TOKEN` | yes* | Token auth (alternative to user/password) |
| `ZOSMF_PORT` | no | HTTPS port (default `443`) |
| `ZOSMF_REJECT_UNAUTHORIZED` | no | TLS verification (default `true`) |

\* Provide either user/password **or** a token.

Full configuration reference: [docs/configuration.md](./docs/configuration.md)

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

- [Configuration](./docs/configuration.md) — all environment variables
- [Tools reference](./docs/tools-reference.md) — inputs, outputs, and error codes
- [Deployment](./docs/deployment.md) — stdio vs SSE transport

---

## License

MIT — see [LICENSE](./LICENSE)
