# mainframe-mcp-server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP-SDK-purple)](https://github.com/modelcontextprotocol/typescript-sdk)
[![Zowe SDK](https://img.shields.io/badge/Zowe-SDK-green)](https://github.com/zowe/zowe-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-prototype-orange)]()

> **An enterprise-grade Model Context Protocol (MCP) server for IBM z/OS environments.**  
> Bridges MCP-compatible AI agents with mainframe resources — jobs, datasets, USS, and operational diagnostics — using IBM Zowe SDK as the connectivity layer.

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Available MCP Tools](#available-mcp-tools)
- [Usage Examples](#usage-examples)
- [Development](#development)
- [Publishing](#publishing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Why This Exists

The MCP ecosystem has strong coverage for cloud-native tooling — Kubernetes, GitHub, AWS, Terraform, Docker. There is almost nothing mature for IBM Z.

`mainframe-mcp-server` fills that gap. It exposes z/OS capabilities as MCP tools so AI agents like Claude, Copilot, or any MCP-compatible client can interact with mainframe systems using natural language workflows.

**What this is NOT:**
- A replacement for Zowe CLI or IBM Z Open Editor
- A reimplementation of z/OS connectivity logic (that's Zowe's job)
- A copy of IBM code

**What this IS:**
- An MCP layer on top of the Zowe SDK
- A collection of operational tools shaped around real zDevOps workflows
- An AI-friendly interface to z/OS jobs, datasets, USS, and diagnostics

---

## Architecture

```
AI Agent (Claude / Copilot / Cursor / any MCP client)
        │
        ▼
┌─────────────────────────────────────────────┐
│            mainframe-mcp-server             │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   Jobs   │  │ Datasets │  │   USS    │  │
│  │  Tools   │  │  Tools   │  │  Tools   │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │        Operations / Diagnostics      │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │          Auth / Config Layer         │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│         IBM Zowe SDK / z/OSMF REST          │
│  (@zowe/zos-jobs  @zowe/zos-files  etc.)    │
└─────────────────────────────────────────────┘
        │
        ▼
            IBM z/OS
```

The MCP server owns the **tool definitions, prompt shaping, error handling, and operational intelligence**.  
The Zowe SDK owns the **z/OS connectivity**. This keeps the codebase clean and maintainable — when IBM ships SDK updates, you just bump the dependency version.

---

## Prerequisites

- **Node.js** >= 18.x
- **npm** >= 9.x  
- Access to an **IBM z/OSMF** endpoint (v2.4+)
- Valid **z/OS credentials** with appropriate permissions
- An MCP-compatible client (Claude Desktop, Cursor, Copilot, etc.)

---

## Installation

### Option A — npm (recommended for MCP clients)

After the package is published:

```bash
npx -y @notharshhaa/mainframe-mcp-server
```

Wire it in your MCP client (Cursor, Claude Desktop, etc.):

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

You still need a reachable z/OSMF endpoint and valid z/OS credentials.

### Option B — Clone and build from source

#### 1. Clone the repository

```bash
git clone https://github.com/NotHarshhaa/mainframe-mcp-server.git
cd mainframe-mcp-server
```

#### 2. Install dependencies

```bash
npm install
```

#### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your z/OSMF connection details
```

#### 4. Build

```bash
npm run build
```

#### 5. Run

```bash
npm start
```

---

## Configuration

All configuration is driven by environment variables. Copy `.env.example` to `.env` and fill in your values.

```env
# z/OSMF Connection
ZOSMF_HOST=your-zosmf-host.internal
ZOSMF_PORT=443
ZOSMF_BASE_PATH=/zosmf/restjobs/jobs

# Authentication
ZOSMF_USER=your-username
ZOSMF_PASSWORD=your-password
# Or use token-based auth:
# ZOSMF_TOKEN=your-token
# ZOSMF_TOKEN_TYPE=LTPA2

# TLS
ZOSMF_REJECT_UNAUTHORIZED=true
# For internal CAs, set to false only in dev/test
# ZOSMF_REJECT_UNAUTHORIZED=false

# MCP Server
MCP_SERVER_NAME=mainframe-mcp-server
MCP_SERVER_VERSION=0.1.0
MCP_TRANSPORT=stdio
# MCP_TRANSPORT=sse
# MCP_SSE_PORT=3000

# Logging
LOG_LEVEL=info
# LOG_LEVEL=debug for verbose Zowe SDK output

# Operational Limits (safety guards)
MAX_JOB_OUTPUT_LINES=5000
MAX_DATASET_READ_LINES=2000
MAX_JES_SPOOL_FILES=20
```

> **Note:** Never commit credentials to version control. Use your organization's secret management solution for production deployments.

---

## Available MCP Tools

### Job Tools

| Tool | Description | Key Inputs |
|---|---|---|
| `list_jobs` | List jobs filtered by owner, prefix, or status | `owner`, `prefix`, `status` |
| `get_job_status` | Get current status and return code of a job | `jobId`, `jobName` |
| `get_job_output` | Retrieve spool output for a job | `jobId`, `ddName` (optional) |
| `submit_jcl` | Submit inline JCL for execution | `jcl` (string) |
| `analyze_job_failure` | Analyze a failed job and summarize root cause | `jobId` |

### Dataset Tools

| Tool | Description | Key Inputs |
|---|---|---|
| `list_datasets` | List datasets matching an HLQ pattern | `hlq`, `pattern` |
| `read_dataset` | Read content of a sequential dataset or PDS member | `dsn`, `member` (optional) |
| `search_dataset` | Search for datasets by pattern | `pattern` |
| `search_members` | Search for members in a PDS | `dsn`, `pattern` |

### USS Tools

| Tool | Description | Key Inputs |
|---|---|---|
| `list_uss_directory` | List contents of a USS directory | `path` |
| `read_uss_file` | Read a USS file | `path` |
| `search_uss_files` | Search for files in a USS path | `path`, `pattern` |

### Operations Tools

| Tool | Description | Key Inputs |
|---|---|---|
| `find_failed_jobs` | Find all failed jobs in a time window | `hours` (default: 24) |
| `summarize_abends` | Aggregate abend codes across recent jobs | `hours`, `owner` |
| `system_health_summary` | High-level operational health snapshot | — |
| `investigate_incident` | Full investigation bundle for a job incident | `jobId` |

---

## Usage Examples

### Example 1 — Why did a job fail?

**User prompt to AI agent:**
```
Why did PAYJOB01 fail?
```

**Agent calls:**
```
analyze_job_failure({ jobId: "JOB01234" })
```

**Response:**
```
Job:     PAYJOB01 (JOB01234)
Status:  ABEND S806
Step:    STEP030 - LOADPGM
Reason:  Program load failure — module PAYRPTX not found in any concatenated JOBLIB/STEPLIB
Spool:   IEF450I PAYJOB01 STEP030 - ABEND S806 U0000
Fix:     Verify PAYRPTX is compiled and linked into the correct load library for this environment.
```

---

### Example 2 — Show all failed jobs in last 24 hours

**User prompt:**
```
Show me all failed jobs from the last 24 hours
```

**Agent calls:**
```
find_failed_jobs({ hours: 24 })
```

**Response:**
```
Failed Jobs — Last 24 Hours (4 found)

┌─────────────┬──────────┬────────────┬──────────────┐
│ Job Name    │ Job ID   │ Abend Code │ Failed Step  │
├─────────────┼──────────┼────────────┼──────────────┤
│ PAYJOB01    │ JOB01234 │ S806       │ STEP030      │
│ RPTJOB03    │ JOB01456 │ S0C7       │ STEP010      │
│ BATCHRUN    │ JOB01789 │ U0100      │ STEP002      │
│ NIGHTLY04   │ JOB01902 │ S222       │ STEP001      │
└─────────────┴──────────┴────────────┴──────────────┘
```

---

### Example 3 — Read a dataset member

**User prompt:**
```
Show me the contents of SYS1.PROCLIB(IKJEFT01)
```

**Agent calls:**
```
read_dataset({ dsn: "SYS1.PROCLIB", member: "IKJEFT01" })
```

---

## Development

### Run in development mode

```bash
npm run dev
```

### Run tests

```bash
# Unit tests
npm run test

# Unit tests with coverage
npm run test:coverage

# Integration tests (requires live z/OSMF)
npm run test:integration
```

### Lint and format

```bash
npm run lint
npm run format
```

### Key npm scripts

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn src/index.ts",
    "test": "jest --testPathPattern=tests/unit",
    "test:coverage": "jest --coverage --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src/**/*.ts"
  }
}
```

### Key dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "@zowe/zos-jobs-for-zowe-sdk": "^8.x",
    "@zowe/zos-files-for-zowe-sdk": "^8.x",
    "@zowe/zosmf-for-zowe-sdk": "^8.x",
    "@zowe/core-for-zowe-sdk": "^8.x",
    "zod": "^3.x",
    "pino": "^9.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "ts-node-dev": "^2.x",
    "@types/node": "^20.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "eslint": "^8.x",
    "prettier": "^3.x"
  }
}
```

---

## Publishing

Maintainers can publish this server to npm and the [MCP Registry](https://registry.modelcontextprotocol.io).

| Target | Identifier |
|---|---|
| npm | `@notharshhaa/mainframe-mcp-server` |
| MCP Registry | `io.github.NotHarshhaa/mainframe-mcp-server` |

**npm (first):**

```bash
npm login          # account: notharshhaa
npm publish        # runs build via prepublishOnly
```

**MCP Registry (after npm is live):**

```bash
mcp-publisher login github
mcp-publisher publish --dry-run
mcp-publisher publish
```

`package.json` includes `mcpName` (must match `server.json` → `name`). Bump
`version` in both files for each release.

Full steps, troubleshooting, and client examples: [docs/publishing.md](./docs/publishing.md).

---

## Roadmap

### Phase 1 — MVP (Current)
- [x] Project scaffold and Zowe session factory
- [x] Job tools: `list_jobs`, `get_job_status`, `get_job_output`, `submit_jcl`
- [x] Job diagnostics: `analyze_job_failure`
- [x] Dataset tools: `list_datasets`, `read_dataset`, `search_members`
- [x] Operations: `find_failed_jobs`, `summarize_abends`
- [x] Unit tests for all tools
- [x] Docker support

### Phase 2 — Operational Intelligence
- [ ] USS file tools
- [ ] `investigate_incident` — full job incident bundle
- [ ] `system_health_summary`
- [ ] Abend code lookup table (S0C7, S806, S222, S0C4, etc.)
- [ ] Structured AI-friendly response formatting
- [ ] Integration tests against z/OSMF sandbox

### Phase 3 — Enterprise Features
- [ ] CICS region tools
- [ ] DB2 catalog tools
- [ ] SMF metrics exposure
- [ ] RACF audit integration
- [ ] AI-assisted root cause analysis
- [ ] Predictive batch failure detection

---

## Contributing

1. Fork the repository
2. Create a feature branch — `git checkout -b feat/add-cics-tools`
3. Make your changes with tests
4. Run `npm run lint && npm run test` — both must pass
5. Open a Merge Request with a clear description

See [docs/contributing.md](./docs/contributing.md) for full guidelines.

---

## Security

- Do **not** commit credentials, hostnames, or internal system names to this repository
- Use `.env` locally; use your organization's vault/secrets manager in production
- All z/OS access follows least-privilege principles — use a dedicated service account
- TLS verification (`ZOSMF_REJECT_UNAUTHORIZED`) must be `true` in non-development environments
- Report security concerns directly to the team lead — do not open public issues

---

## License

MIT — see [LICENSE](./LICENSE)

---

> Built for the IBM Z community. Powered by [Zowe SDK](https://github.com/zowe/zowe-cli) and [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
