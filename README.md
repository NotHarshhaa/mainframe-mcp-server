<h1 align="center">
  <strong>mainframe-mcp-server</strong>
</h1>

<p align="center">
  MCP Server for IBM z/OS using Zowe APIs
</p>

<p align="center">
  <a href="https://github.com/NotHarshhaa/mainframe-mcp-server/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/NotHarshhaa/mainframe-mcp-server/ci.yml?branch=master&label=CI&style=for-the-badge" alt="CI status" />
  </a>
  <a href="https://www.npmjs.com/package/@notharshhaa/mainframe-mcp-server">
    <img src="https://img.shields.io/npm/v/@notharshhaa/mainframe-mcp-server?style=for-the-badge&color=FBBF24" alt="npm version" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  </a>
  <img src="https://img.shields.io/badge/Node-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 18+" />
  <a href="https://github.com/modelcontextprotocol/typescript-sdk">
    <img src="https://img.shields.io/badge/MCP-SDK-8B5CF6?style=for-the-badge" alt="MCP SDK" />
  </a>
  <a href="https://github.com/zowe/zowe-cli">
    <img src="https://img.shields.io/badge/Zowe-SDK-22C55E?style=for-the-badge" alt="Zowe SDK" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-FBBF24?style=for-the-badge" alt="MIT License" />
  </a>
  <img src="https://img.shields.io/badge/Status-Stable-22C55E?style=for-the-badge" alt="Status: Stable" />
</p>

> **An enterprise-grade Model Context Protocol (MCP) server for IBM z/OS environments.**
> Bridges MCP-compatible AI agents with mainframe resources — jobs, datasets, USS, and operational diagnostics — using the Zowe SDK (Open Mainframe Project) as the connectivity layer.

<p align="center">
  <img src="./public/banner.png" alt="mainframe-mcp-server — Bridge AI agents with IBM z/OS via MCP and Zowe SDK" width="100%" />
</p>

---

## Contents

- [What it does](#what-it-does)
- [How it's different](#how-its-different)
- [z/OS prerequisites](#zos-prerequisites)
- [Tools](#tools)
- [Enterprise security](#enterprise-security)
  - [Enterprise features](#enterprise-features)
- [Per-user identity & SSO](#per-user-identity--sso)
- [Governed writes](#governed-writes)
- [Trust model & prompt injection](#trust-model--prompt-injection)
- [How the intelligence tools work](#how-the-intelligence-tools-work)
- [Quick start](#quick-start)
- [Transports](#transports)
- [Limits & timeouts](#limits--timeouts)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Examples](#examples)
- [Project & community](#project--community)
- [License](#license)
- [Trademarks](#trademarks)

---

## What it does

`mainframe-mcp-server` exposes z/OS capabilities as [Model Context Protocol](https://modelcontextprotocol.io/) tools. An AI agent can list jobs, read datasets, inspect USS paths, submit JCL, and run operational diagnostics — without you writing Zowe CLI commands by hand.

Connectivity is handled by the [Zowe SDK](https://github.com/zowe/zowe-cli) (Open Mainframe Project) over z/OSMF REST. This project adds the MCP tool layer, input validation, safety limits, and AI-friendly response formatting on top.

<p align="center">
  <img src="./docs/assets/demo.gif" alt="Demo: an agent analyzing a failed job and predicting batch failure risk" width="640" />
</p>

---

## How it's different

| | **mainframe-mcp-server** | **Zowe CLI + scripts** | **Host IDE tooling** (IDz, Z Open Editor) | **Other z/OS MCP bridges** |
|---|---|---|---|---|
| **Interface** | MCP tools for AI agents | Terminal commands, shell scripts | Eclipse/VS Code GUIs | MCP tools for AI agents |
| **Output** | Structured sections & tables tuned for LLM reasoning | Raw terminal text you must parse yourself | IDE views | Varies by project |
| **Guardrails** | Read-only by default, tool allow/block lists, dataset & USS boundaries, audit logging, JCL size cap | None built in — you script them | Client-side only | Varies by project |
| **Failure knowledge** | Curated abend-code reference, failing-step heuristics, risk scoring | Manual message lookup | Interactive debugging | Rare |
| **Install** | `npx` — no server-side footprint beyond z/OSMF access | Node + Zowe CLI + your scripts | Full IDE estate | Often heavier runtimes |
| **Coverage** | Jobs, datasets, USS, CICS, Db2, SMF/RMF, RACF audit (30+ tools) | Full Zowe command set | Edit, debug, compile | Varies |

Honest positioning: the z/OS MCP ecosystem is early. IBM and community authors publish their own MCP bridges — evaluate them against your requirements. This project's differentiators are **zero-dependency npm install**, **guardrails enforced at the server layer**, and **output shaped for LLM consumption** rather than human eyes. It is **not** a replacement for Zowe CLI or IBM Z Open Editor — it is an MCP bridge over the same z/OSMF APIs.

---

## z/OS prerequisites

The server is a pure client — nothing is installed on z/OS. It requires REST services that are enabled in standard z/OSMF estates.

### z/OSMF (required — all core tools)

| z/OSMF REST service | Used by | Notes |
|---|---|---|
| **Jobs REST** (`/zosmf/restjobs/jobs`) | `list_jobs`, `get_job_status`, `get_job_output`, `get_job_jcl`, `submit_jcl`, all operations & intelligence tools | List, query, spool content, JES submit |
| **Files REST — datasets** (`/zosmf/restfiles/ds`) | `list_datasets`, `search_dataset`, `read_dataset`, `search_members`, `get_dataset_info` | Catalog list, members, content read |
| **Files REST — USS** (`/zosmf/restfiles/fs`) | `list_uss_directory`, `read_uss_file`, `search_uss_files`, RACF audit source | Directory list, file read |
| **z/OSMF info** (`/info`) | `verify_zosmf_connection` | Optional; version read-out only |
| **RMF REST** (`/rmf/mvs/GPO/`) | `get_smf_metrics` | Optional; disabled with `RMF_METRICS_ENABLED=false` |

**Baseline:** z/OS 2.4 LTS or later with APAR-current z/OSMF — the target the Zowe SDK (v8) is built against. Core job/dataset/USS tools are expected to work on z/OSMF levels from z/OS 2.3 onward; if you run an older or unusual level, [open an issue](https://github.com/NotHarshhaa/mainframe-mcp-server/issues) with your results so the matrix can be updated.

### CICS via CMCI (optional — `list_cics_regions`, `get_cics_region_status`, `list_cics_transactions`)

- CICS TS 5.4 or later with **CMCI** active (a CICSPlex SM WUI region, or a single-region CMCI setup).
- Set `CMCI_CONTEXT` (CICSplex name or region APPLID); optionally `CMCI_HOST`, `CMCI_PORT` (default `1490`), `CMCI_BASE_PATH` (default `/CICSSystemManagement`).
- The service account needs RACF/SAF authority to the CMCI data sets (`XCSDATA`/`CICSPLEX` resource classes as configured at your site).

### Db2 REST (optional — `list_db2_subsystems`, `search_db2_catalog`)

- Db2 12 for z/OS or later with the **Db2 REST services** capability exposed at `DB2_HOST`:`DB2_PORT` (default `50400`, base path `/dbrest`) — direct DDF-served REST or fronted by your API mediation layer.
- Set `DB2_LOCATION` (the subsystem location name). Tools run **read-only catalog SQL** against `SYSIBM.SYSTABLES` with literal-escaped, size-capped input.

### RACF audit source (optional — `query_racf_audit`)

- An existing audit extract the service account can read: a USS log file (`RACF_AUDIT_USS_PATH`) or a sequential dataset (`RACF_AUDIT_DATASET`), e.g. ADUINFOS/IRRADU00 output written to file. The server parses the text; it does not run IRRADU00 for you.

### Service account

Use a dedicated z/OS user with least-privilege RACF profiles (job list/read authority, submit authority only if `SECURITY_READ_ONLY=false`).

---

## Tools

**Type legend:** **READ** — reads z/OS state, never modifies anything · **WRITE** — submits work to JES · **OFFLINE** — no mainframe I/O at all.

### Jobs

| Tool | Type | Description |
|---|---|---|
| `list_jobs` | READ | List jobs by owner, prefix, or status |
| `get_job_status` | READ | Status and return code for a job |
| `get_job_output` | READ | Spool inventory or DD content |
| `submit_jcl` | **WRITE** | Submit inline JCL — governed by pre-flight scan, change ticket, change window, and optional human approval |
| `approve_write` | **WRITE** | Execute a pending JCL submission after human review (requires `SECURITY_WRITE_APPROVAL=true`) |
| `analyze_job_failure` | READ | Abend code, failing step, and suggested fix |
| `get_job_jcl` | READ | Retrieve submitted JCL from job spool |

### Datasets

| Tool | Type | Description |
|---|---|---|
| `list_datasets` | READ | List datasets matching an HLQ pattern |
| `read_dataset` | READ | Read a sequential dataset or PDS member |
| `search_dataset` | READ | Search datasets by pattern |
| `search_members` | READ | Search or list PDS members |
| `get_dataset_info` | READ | Catalog attributes without reading content |

### USS

| Tool | Type | Description |
|---|---|---|
| `list_uss_directory` | READ | List a USS directory |
| `read_uss_file` | READ | Read a USS file |
| `search_uss_files` | READ | Search files under a USS path |

### Operations

| Tool | Type | Description |
|---|---|---|
| `find_failed_jobs` | READ | Failed jobs in a time window |
| `summarize_abends` | READ | Abend code breakdown across recent jobs |
| `system_health_summary` | READ | Active, queued, and failed job snapshot |
| `investigate_incident` | READ | Full incident bundle for a job |
| `lookup_abend_code` | OFFLINE | Abend reference lookup (S0C7, S806, S222, S0C4, …) |
| `verify_zosmf_connection` | READ | Test z/OSMF connectivity and auth |
| `compare_jobs` | READ | Side-by-side comparison of two jobs |
| `get_user_jobs_summary` | READ | Job counts by status for an owner |

### CICS

Requires optional CMCI configuration — see [z/OS prerequisites](#zos-prerequisites).

| Tool | Type | Description |
|---|---|---|
| `list_cics_regions` | READ | List CICS regions via CMCI REST |
| `get_cics_region_status` | READ | Status and attributes of a CICS region |
| `list_cics_transactions` | READ | Transaction definitions in a region |
| `get_cics_region_stats` | READ | Region statistics/attributes from the CMCI `CICSRegion` resource |
| `cics_newcopy` | WRITE | NEWCOPY a program via CMCI action (CICS TS 5.6+) |
| `cics_disable_transaction` | WRITE | Disable/enable a local transaction via CMCI SET action |

### Db2

Requires optional Db2 REST configuration — see [z/OS prerequisites](#zos-prerequisites).

| Tool | Type | Description |
|---|---|---|
| `list_db2_subsystems` | READ | List Db2 locations via Db2 REST |
| `search_db2_catalog` | READ | Read-only catalog search (tables, views, aliases) |

### Console & JES

Operator commands run through an extended MCS console (`ZOSMF_CONSOLE_NAME`);
command tools are gated writes subject to read-only mode, policy roles,
change tickets, and change windows.

| Tool | Type | Description |
|---|---|---|
| `issue_console_command` | WRITE | MVS commands (`D A,L`, `D GRS,RES=…`) with follow-up message collection |
| `get_console_messages` | READ | Operations-log tail (SYSLOG-style console feed) |
| `hold_job` / `release_job` | WRITE | JES2 `$HJ` / `$OJ` job hold and release |
| `cancel_job` | WRITE | Cancel a job via the z/OSMF jobs API |
| `get_wlm_status` | WRITE | `D WLM` display (service policy / resources) |
| `ims_command` | WRITE | IMS commands via the system console (`/DIS ACTIVE`, `/DIS TRAN …`) |
| `get_hsm_activity` | READ | DFSMShsm recall/migration activity from the operations log |
| `analyze_logrec` | WRITE | Submit an EREP report against LOGREC and summarize error records |

### Schedulers

| Tool | Type | Description |
|---|---|---|
| `scheduler_job_status` | READ | Control-M / CA 7 / IBM WLS job status via their REST APIs (`SCHEDULER_ADAPTERS`) |
| `job_dependencies` | READ | JCL dataset-flow analysis — inputs, outputs, updates, PROCs (predecessor/successor material) |

### Messaging (IBM MQ)

Requires `MQ_REST_HOST` (mqweb server) and optional `MQ_REST_PORT`/`_USER`/`_PASSWORD`.

| Tool | Type | Description |
|---|---|---|
| `mq_queue_status` | READ | Queue curdepth vs maxdepth with high-water warnings |
| `mq_channel_status` | READ | Channel status (RUNNING/RETRYING/STOPPED) and connection counts |

### Storage & Capacity

| Tool | Type | Description |
|---|---|---|
| `get_volume_space` | READ | DASD volume space via z/OSMF SMI, with low-space alerts (`STORAGE_FREE_THRESHOLD`) |
| `get_job_capacity` | READ | Per-step and total CPU from JESMSGLG (IEF374I/IEF376I) + MSU estimate (`CAPACITY_MSU_RATING`) |
| `estimate_mlc_cost` | OFFLINE | MLC cost attribution from CPU/MSU (`MLC_MSU_MONTHLY_PRICE`) |

### Dumps

| Tool | Type | Description |
|---|---|---|
| `summarize_dump` | READ | CEEDUMP / SYSMDUMP / SYSUDUMP digest — completion codes, failing module, LE conditions |

### SMF / Security

| Tool | Type | Description |
|---|---|---|
| `get_smf_metrics` | READ | SMF/RMF performance metrics snapshot |
| `query_racf_audit` | READ | Query RACF audit records from a log source |
| `security_posture_summary` | OFFLINE | Report active security controls and recommendations |

### Intelligence

Built in — see [How the intelligence tools work](#how-the-intelligence-tools-work).

| Tool | Type | Description |
|---|---|---|
| `analyze_root_cause` | READ | Deep root-cause analysis with correlation and action items |
| `predict_batch_failures` | READ | Predictive risk scoring for recurring batch failures |

### Governance

| Tool | Type | Description |
|---|---|---|
| `list_environments` | OFFLINE | Named z/OS environments (DEV/TEST/UAT/PROD, LPARs) with per-environment read-only and role policy |
| `whoami` | OFFLINE | Acting identity, resolved role, permission summary, active environment, data-protection status |

See [docs/tools-reference.md](./docs/tools-reference.md) for full input/output details.

---

## Packaging & supply chain

Everything a security team asks for on day one is built into the release pipeline
(see [docs/deployment.md — Supply-chain assurance](./docs/deployment.md#supply-chain-assurance)):

| Artifact | Where | Assurance |
|---|---|---|
| npm package | `@notharshhaa/mainframe-mcp-server` | Published **with SLSA provenance** (GitHub Actions OIDC) — `npm audit signatures` |
| Official image | `ghcr.io/notharshhaa/mainframe-mcp-server` (version / minor / SHA tags) | **Non-root**, signed with **Sigstore keyless cosign**, BuildKit provenance `mode=max` + SBOM attestations |
| SBOMs | GitHub release assets | SPDX **and** CycloneDX for both the package and the image |
| Checksums | `sha256sums.txt` on the release | Signed with cosign (`sha256sums.txt.sig`) |
| Helm chart | [`helm/mainframe-mcp-server/`](./helm/mainframe-mcp-server/README.md) | Non-root + read-only rootfs + dropped caps by default; policy file and SIEM sinks wired via values |

Verify the image before you run it:

```bash
cosign verify ghcr.io/notharshhaa/mainframe-mcp-server:2.8.0 \
  --certificate-identity-regexp 'https://github.com/NotHarshhaa/mainframe-mcp-server/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The docker-compose file and the Helm chart ship hardened defaults
(`read_only`, `cap_drop: ALL`, `no-new-privileges`, seccomp `RuntimeDefault`,
non-root uid 1000).

---

## Enterprise security

Security is enforced at the **MCP server layer**, in addition to RACF/z/OSMF permissions on the mainframe itself. Every control below is enabled through environment variables:

| Control | Env variable | Purpose |
|---|---|---|
| Read-only mode | `SECURITY_READ_ONLY` | **Default `true`**: `submit_jcl`, `approve_write`, and write operations are blocked unless you explicitly opt in |
| Tool allowlist | `SECURITY_ALLOWED_TOOLS` | Only permit specific tools (least privilege) |
| Tool blocklist | `SECURITY_BLOCKED_TOOLS` | Explicitly deny dangerous tools |
| Dataset boundaries | `SECURITY_ALLOWED_DATASET_PATTERNS` | Restrict dataset access by HLQ pattern |
| USS boundaries | `SECURITY_ALLOWED_USS_PATHS` | Restrict USS paths by prefix |
| Audit logging | `SECURITY_AUDIT_LOGGING=true` | Log every tool call (credentials redacted) |
| JCL size limit | `SECURITY_MAX_JCL_BYTES` | Cap inline JCL submit size |
| TLS verification | `ZOSMF_REJECT_UNAUTHORIZED=true` | Enforce certificate validation (default `true`) |

### Enterprise features

Four scale-up capabilities build on these controls — see
[docs/enterprise.md](./docs/enterprise.md) for the full guide and
[config/policy.example.yaml](./config/policy.example.yaml) for a worked policy:

- **Multi-environment support** — name several systems (DEV/TEST/UAT/PROD,
  multiple LPARs) via a policy file or `ZOSMF_ENVIRONMENTS`; every tool takes
  an `environment` argument; each environment carries its own credentials and
  policy, e.g. `readOnly: true` on PROD.
- **Policy-as-code & RBAC** — one YAML file (`SECURITY_POLICY_FILE`) maps
  roles to tool allow/deny lists, dataset/USS globs, change-ticket rules, and
  users to roles per environment; `${env:VAR}` keeps credentials out of the
  file; unknown users fail closed.
- **Audit & SIEM** — structured JSON audit records with correlation ids (user,
  MCP client, tool, redacted arguments, outcome, duration, result size),
  exported to a file, Splunk HEC, any HTTP webhook (ELK/syslog bridges), or
  OpenTelemetry. Records are SHA-256 hash-chained (tamper-evident); verify
  with `npm run verify:audit`.
- **Data protection** — PII, credit-card numbers (Luhn-validated), SSNs,
  embedded secrets, JWTs, and private keys are masked in job output and
  dataset/USS reads by default; policy classifications add per-resource
  redaction rules, line caps, head/tail sampling, and role-gated access.

---

## Per-user identity & SSO

By default the server authenticates to z/OSMF with one configured credential.
Enterprise deployments usually need RACF to see **who asked**, not "the MCP
service account". Four mechanisms are built in:

**PassTicket identity propagation** — the strongest fit for shared deployments:

```bash
ZOSMF_USER_ID=PAYUSR            # the end user RACF should see
ZOSMF_PASSTICKET_APP=ZOSMF      # PTKTDATA application (RDEFINE PTKTDATA ZOSMF ...)
```

The server authenticates with the service credential, calls the z/OSMF
Generate PassTicket API for `PAYUSR`, and issues every z/OSMF call under a
PassTicket-authenticated session **as that user**. PassTickets are cached for
8 minutes and regenerated transparently; CICS/Db2 REST calls keep the service
identity. Requires the service account to be permitted to generate
PassTickets for the target user.

**mTLS client certificates:**

```bash
ZOSMF_CERT=/pki/client.pem
ZOSMF_CERT_KEY=/pki/client.key
```

Certificate authentication takes precedence over token/basic. Combine with a
RACF IDID mapping (certificate → user) for certificate-based identity.

**JWT / APIML tokens (SSO):**

```bash
ZOSMF_TOKEN=$JWT
ZOSMF_TOKEN_TYPE=APIML     # or JWT — both travel as Authorization: Bearer
ZOSMF_BASE_PATH=/api/v1    # APIML gateway prefix
```

`ZOSMF_TOKEN_TYPE=LTPA2` (default) keeps classic z/OSMF session-token
behavior. Full OIDC/SSO flows run in your IdP/gateway — inject the issued JWT
via `ZOSMF_TOKEN_FILE` so a vault or credential-helper agent can refresh it
without touching the config file.

**Zowe team config import** — reuse existing Zowe connection settings:

```bash
ZOWE_TEAM_CONFIG=/root/.zowe/zowe.config.json
ZOSMF_PROFILE=lpar1.zosmf    # default: defaults.zosmf
```

Any z/OSMF setting (host, port, base path, credentials, `rejectUnauthorized`)
not set via environment variables is filled from the profile. Values marked
`@secure` are honored when stored in the config file itself; secrets held by
an OS-keychain credential manager are not readable by this process and are
skipped. Environment variables always win.

---

## Governed writes

`submit_jcl` is the only way an agent can mutate anything on z/OS — so it runs
through a governance pipeline before JES ever sees the job. Every layer is
independent; enable what your change process requires.

| Gate | Env variable | Default |
|---|---|---|
| Pre-flight JCL scan | `SECURITY_JCL_SCAN` | on |
| Strict scan mode (WARN blocks) | `SECURITY_JCL_SCAN_STRICT` | off |
| Blocked utilities | `SECURITY_BLOCKED_PROGRAMS` | `ADRDSSU, ICKDSF, IEHINITT` |
| Restricted job classes | `SECURITY_BLOCKED_JOB_CLASSES` | none |
| Change-ticket requirement | `SECURITY_CHANGE_TICKET_PATTERN` | off |
| Change window | `SECURITY_WRITE_WINDOW` / `SECURITY_WRITE_DAYS` / `SECURITY_WRITE_WINDOW_TZ` | off / every day / UTC |
| Human-in-the-loop approval | `SECURITY_WRITE_APPROVAL` | off |

**The pre-flight scan blocks**, with rule name and JCL line number:

- `IDCAMS DELETE` in SYSIN instream data (`IDCAMS ALTER` is a WARN; blocks in strict mode)
- `IEFBR14` steps that delete datasets via `DISP=(,DELETE)` / `DISP=(MOD,DELETE)`
- Blocked utilities — destructive storage programs by default (`ADRDSSU`, `ICKDSF`, `IEHINITT`), extendable with `SECURITY_BLOCKED_PROGRAMS`
- Restricted JES job classes via `CLASS=`

**Change tickets:** with `SECURITY_CHANGE_TICKET_PATTERN=CHG[0-9]{6}`, every
submission must carry `changeTicket: "CHG000123"` or it is rejected with
`[FORBIDDEN]`.

**Change windows:** with `SECURITY_WRITE_WINDOW=22:00-06:00`,
`SECURITY_WRITE_DAYS=1-5`, `SECURITY_WRITE_WINDOW_TZ=Europe/Berlin`,
submissions outside the window are rejected — `dryRun` still works so the
agent can validate JCL for a future change.

**Dry-run:** `submit_jcl({ ..., dryRun: true })` runs structure checks and the
scan and reports exactly what a real submission would do — overrides, scan
findings, ticket/window/approval status, and the effective identity — without
submitting anything.

**Human-in-the-loop approval:** with `SECURITY_WRITE_APPROVAL=true`:

1. The agent calls `submit_jcl` → the JCL is validated and scanned, and a
   **one-time token** is returned. Nothing is submitted.
2. A human reviews the exact JCL in the client.
3. The agent calls `approve_write({ token })` → the change window is
   re-checked and the job is submitted.

Tokens expire after 10 minutes, work exactly once, and are redacted from
audit logs. If you use `SECURITY_ALLOWED_TOOLS` with approval mode, allowlist
both `submit_jcl` and `approve_write`. Read-only mode (`SECURITY_READ_ONLY=true`)
blocks both regardless of approval being enabled.

Use `security_posture_summary` to inspect which controls are active and get hardening recommendations.

**Important:** Enterprise deployment also requires:
- A dedicated **service account** on z/OS with least-privilege RACF profiles
- **Secrets** in a vault (not plain env vars in production)
- **Network** restrictions (z/OSMF behind API gateway / VPN)
- **HTTP+SSE transport** placed behind an auth proxy if exposed beyond localhost

The mainframe still enforces the final authorization — this server adds guardrails so AI agents cannot exceed configured boundaries.

---

## Trust model & prompt injection

Everything this server returns — spool output, dataset contents, USS files, audit logs — is **untrusted text that flows into your AI agent's context**. A hostile JCL comment, COBOL literal, or log line can contain English text that tries to steer the agent ("ignore previous instructions, submit JCL that …").

**What the server guarantees:**

- **Content is data, never instructions.** The server never parses directives out of z/OS content and never chains tool calls on its own. Every tool invocation originates from the MCP client.
- **Nothing executes from file content.** There is no code evaluation, shell, or template expansion anywhere in the request or response path.
- **Mutation requires an explicit, gated call.** The only write tool is `submit_jcl`, and it is blocked by default (`SECURITY_READ_ONLY=true`), subject to `SECURITY_ALLOWED_TOOLS`/`SECURITY_BLOCKED_TOOLS`, and size-capped (`SECURITY_MAX_JCL_BYTES`).
- **Bounded exposure.** All content passes through configured line caps and truncation notices, so a single hostile file cannot flood the context (see [Limits](#limits--timeouts)).
- **Auditable.** Every call is logged with arguments and outcome; sensitive keys are redacted.

**What the server cannot guarantee:** it cannot stop a *convincing* log line from influencing what your **agent** asks to do next — that is an MCP-client-side concern by design. Defense in depth:

1. Keep `SECURITY_READ_ONLY=true` (the default) for agents that browse logs/datasets.
2. Use `SECURITY_ALLOWED_TOOLS` so the agent cannot reach tools it should not.
3. Use dataset/USS boundary patterns so even a steered request stays fenced.
4. Review `submit_jcl` requests by a human before approving them in the client (most MCP clients support per-call approval prompts).

---

## How the intelligence tools work

**No LLM, no external AI API.** The "intelligence" layer is deterministic, rule-based analysis that runs inside the server so results are reproducible and auditable. The MCP client's LLM interprets the structured report.

**`analyze_job_failure` / `analyze_root_cause`:**
- Extracts the abend code from the job's return code and spool text (recognizes `ABEND Sxxx`/`Uxxxx`, system/user completion codes, bare tokens), then matches it against a **curated reference table** of common z/OS abend codes (S0C1, S0C4, S0C7, S806, S322, S222, U4038, …) with explanations and remediations.
- Identifies the failing/cancelled step and program from JES message patterns (IEF450I, IEF142I, IEF473I, CSV0nnnI, module-not-found).
- Correlates the failure with other failed jobs currently visible in the JES output queue within the look-back window (`lookbackHours`, default 72, max 720).
- **Confidence** means exactly: `HIGH` = abend code + failing step + spool evidence all found; `MEDIUM` = abend code or failing step found; `LOW` = neither — treat the report as a starting point.
- **Health score** (0–100) = 100 − 8 × similar incidents (max −40) − 5 × correlated abend types (max −30), with a confidence-based floor. It is a trend indicator, not an SLA metric.

**`predict_batch_failures`:**
- Groups recent failed jobs by job name and scores each with a **recency-weighted count**: every failure contributes 3 if it happened in the newest quarter of the window, 2 in the newest half, 1 otherwise; +10 when a known abend code is involved; scaled and capped at 100.
- Risk levels: `CRITICAL ≥ 75`, `HIGH ≥ 50`, `MEDIUM ≥ 25`, else `LOW`.
- **Trend** compares failure counts in the newest vs oldest third of the window (INCREASING / STABLE / DECREASING).

**Known limitation (important for reviewers):** JES only exposes jobs still in the system. "History" means *failures currently listed in the OUTPUT queue* (capped at `MAX_FAILED_JOB_RESULTS`), not a query of SMF archives. For long-horizon analytics, feed SMF data into a real analytics platform — this tool answers "what is failing *right now*, repeatedly?"

---

## Quick start

**Requirements:** Node.js 18+, a reachable z/OSMF endpoint, and valid z/OS credentials (see [z/OS prerequisites](#zos-prerequisites)).

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

### Tested clients

Any MCP client that launches **stdio** servers works. Known-good setups:

| Client | Config location |
|---|---|
| Claude Desktop | `claude_desktop_config.json` → `mcpServers` |
| Cursor | `~/.cursor/mcp.json` (or project `.cursor/mcp.json`) |
| VS Code (Copilot / MCP) | user or workspace MCP settings |
| Claude Code / other CLIs | standard `mcpServers` block |

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

## Limits & timeouts

Output is **truncated, never paginated** — every cap emits an explicit `[truncated N of M lines]` notice plus guidance to narrow filters.

| Limit | Env variable | Default | Applies to |
|---|---|---|---|
| Spool DD lines | `MAX_JOB_OUTPUT_LINES` | 5000 | One spool DD (`get_job_output`, JCL) |
| File lines | `MAX_DATASET_READ_LINES` | 2000 | One dataset / PDS member / USS file read |
| Diagnostic DDs | `MAX_JES_SPOOL_FILES` | 20 | Spool files fetched per failure analysis |
| Audit lines | `MAX_AUDIT_LINES` | 500 | RACF audit text parsed per query |
| Job list results | `MAX_JOB_LIST_RESULTS` | 500 | `list_jobs` before agent-side filters |
| Failed-job results | `MAX_FAILED_JOB_RESULTS` | 100 | `find_failed_jobs`, intelligence correlation |
| JCL payload | `SECURITY_MAX_JCL_BYTES` | 65536 | `submit_jcl` input size |

**Timeouts & concurrency:**

- `submit_jcl wait=true` polls JES every 2 s for up to `timeout` seconds (default 30, max 300).
- REST calls use the Zowe SDK / Node defaults — there is no client-side retry loop; transient failures surface as `[CONNECTION_ERROR]` results the agent can retry.
- One shared z/OSMF session; requests are executed as the MCP client dispatches them, with no client-side rate limiter. z/OSMF's own server-side concurrency limits apply — heavy parallel tool use should be throttled by the client or the gateway.

---

## Troubleshooting & FAQ

All tool errors come back as `[ERROR_CODE]: message` — codes are stable and listed in [docs/tools-reference.md](./docs/tools-reference.md).

**`[CONNECTION_ERROR]` — z/OSMF authentication failed (401/403)**
Credentials rejected by z/OSMF. Check: user/password or token validity; `ZOSMF_TOKEN_TYPE` matches how the token was issued (`LTPA2` vs JWT); the account is not revoked. An **expired TSO password** also surfaces here — log on via TSO once to reset it, then retry.

**`[CONNECTION_ERROR]` — certificate / TLS errors**
Self-signed or private-CA z/OSMF certificate. Preferred fix: trust the CA chain, e.g. `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. For throwaway dev only: `ZOSMF_REJECT_UNAUTHORIZED=false` (logs a warning; never in production).

**`[CONNECTION_ERROR]` — unable to reach z/OSMF (ENOTFOUND / ECONNREFUSED / ETIMEDOUT)**
Host/port wrong, VPN not connected, or you are behind an API mediation layer — set `ZOSMF_BASE_PATH` to your gateway prefix.

**`[CONFIG_ERROR]` — CICS/Db2/RACF tools refuse to run**
Those tools need optional setup: `CMCI_CONTEXT`, `DB2_LOCATION`, or `RACF_AUDIT_USS_PATH`/`RACF_AUDIT_DATASET`. See [z/OS prerequisites](#zos-prerequisites). The error message names the exact variable.

**`[NOT_FOUND]` — job/dataset not found**
Job ids are JES-qualified (`JOB01234`, `STC00012`, `TSU00123`) and jobs vanish when purged from the OUTPUT queue. For datasets, check the HLQ and that the name is cataloged (migrated/HSM datasets may still resolve but show `MIGRATED`).

**`[FORBIDDEN]` — tool blocked or write rejected**
Read-only mode (the default) blocks `submit_jcl` and `approve_write`; an allowlist/blocklist rule matched; the pre-flight scan found a destructive construct; the change ticket was missing or malformed; or the submission is outside the change window. The error message names the specific gate — each one is an operator decision (env variables), not something the agent can turn off.

**The client doesn't show any tools**
Check stderr for the startup log (`mainframe-mcp-server connected over stdio`). Invalid config aborts with a variable-by-variable message. Set `LOG_LEVEL=debug` for per-call tracing. Requires Node 18+.

**HTTP+SSE returns `400 Unknown or missing sessionId`**
The SSE session was restarted; reconnect `GET /sse` and use the fresh `sessionId`.

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

## Project & community

- **[Website (GitHub Pages)](https://notharshhaa.github.io/mainframe-mcp-server/)** — overview, tools, setup, enterprise guide
- [Configuration](./docs/configuration.md) — all environment variables
- [Enterprise features](./docs/enterprise.md) — multi-environment, policy-as-code & RBAC, audit & SIEM, data protection
- [Tools reference](./docs/tools-reference.md) — inputs, outputs, and error codes
- [Deployment](./docs/deployment.md) — transports (stdio, HTTP+SSE), Docker, systemd
- [Contributing](./CONTRIBUTING.md) — workflow, project layout, how to add a tool
- [Security policy](./SECURITY.md) — supported versions and how to report vulnerabilities
- [Changelog](./CHANGELOG.md) — release history

---

## License

MIT — see [LICENSE](./LICENSE)

---

## Trademarks

Not affiliated with IBM or the Open Mainframe Project. IBM, z/OS, CICS, Db2 and RACF are trademarks of IBM.
