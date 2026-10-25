# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [3.0.0] — 2026-10-25

### Added

- **Official packaging with supply-chain assurance.**
  - **Signed, SBOM-attached container image**: releases publish
    `ghcr.io/notharshhaa/mainframe-mcp-server` (version/minor/SHA tags), built
    non-root with OCI labels and an SSE healthcheck, signed with **Sigstore
    keyless cosign** (sign-by-digest, verified in-workflow), with BuildKit
    provenance (`mode=max`) and SBOM attestations, plus SPDX and CycloneDX
    SBOMs attached to the GitHub release.
  - **npm provenance**: the package now publishes with `--provenance`
    (SLSA build provenance via GitHub Actions OIDC) — visible on npmjs.com
    and verifiable with `npm audit signatures`.
  - **Helm chart** (`helm/mainframe-mcp-server/`): SSE deployment hardened by
    default (non-root, read-only root filesystem, dropped capabilities, no
    service-account token), with values for the z/OSMF connection, BYO
    credentials Secret, policy-as-code ConfigMap mount, SIEM audit sinks,
    probes, ingress, and optional persistence for the file audit sink.
  - **Release assets**: npm tarball, package + image SBOMs (with cosign
    signatures), and a signed `sha256sums.txt` manifest on every GitHub
    release.
  - The Dockerfile keeps `USER node`; docker-compose now ships hardened
    defaults (`read_only`, `cap_drop: ALL`, `no-new-privileges`, tmpfs) and
    defaults to the official image; CI builds the image on every push and
    fails if it runs as root.

- **Console & JES coverage.** MVS operator commands through the z/OSMF Console
  API using a dynamically activated extended MCS console
  (`ZOSMF_CONSOLE_NAME`): `issue_console_command` (with follow-up message
  collection), `get_console_messages` (operations-log tail), `hold_job` /
  `release_job` (JES2 `$HJ`/`$OJ`), `cancel_job` (z/OSMF jobs API),
  `get_wlm_status` (`D WLM` displays), `ims_command` (IMS commands via the
  system console), `get_hsm_activity` (DFSMShsm recall/migration activity
  filtered from the operations log), and `analyze_logrec` (submits a canned
  EREP `IFCEREP` report job against LOGREC and summarizes record counts,
  abend codes, and modules). All command-issuing tools are governed writes.
- **Batch scheduler integration.** `scheduler_job_status` queries Control-M,
  CA 7, and IBM Workload Automation through their REST APIs
  (`SCHEDULER_ADAPTERS` JSON with per-scheduler host/token/path templates and
  best-effort status normalization). `job_dependencies` analyzes a job's JCL
  (inline or from spool) into dataset flows — inputs, outputs, updates per
  step plus PROC references — for predecessor/successor analysis.
- **Messaging & data coverage.** `mq_queue_status` and `mq_channel_status`
  via the IBM MQ REST admin API (`MQ_REST_HOST`/`_PORT`/`_USER`/`_PASSWORD`),
  with queue high-water warnings and non-running channel flagging.
  `get_volume_space` reads DASD volume space from the z/OSMF Storage
  Management Interface and flags volumes below `STORAGE_FREE_THRESHOLD`.
- **CICS statistics and gated actions.** `get_cics_region_stats` (CMCI
  `CICSRegion` attributes), plus governed-write `cics_newcopy` and
  `cics_disable_transaction` implemented as CMCI resource actions
  (CICS TS 5.6+ with actions enabled).
- **Dump summarization.** `summarize_dump` digests CEEDUMP / SYSMDUMP /
  SYSUDUMP output — system and user completion codes, failing module and
  offset, PSW, Language Environment conditions, section inventory, and
  suggested next steps — from spool or a dataset, without shipping raw hex.
- **Capacity and MLC cost attribution.** `get_job_capacity` parses per-step
  and total CPU from JESMSGLG (IEF374I/IEF376I) and estimates MSU consumption
  from `CAPACITY_MSU_RATING`; `estimate_mlc_cost` attributes MLC cost from
  CPU/MSU using `MLC_MSU_MONTHLY_PRICE`, with pricing assumptions surfaced in
  the output.
- **Multi-environment support.** Define named systems (DEV/TEST/UAT/PROD,
  multiple LPARs/sysplexes) in the policy file or via `ZOSMF_ENVIRONMENTS`
  (JSON); the base `ZOSMF_*` connection remains available as `default`. Every
  tool accepts an optional `environment` argument; each environment carries
  its own credentials, lazily-cached Zowe session, and policy surface —
  per-environment `readOnly` (e.g. read-only PROD), `allowedRoles`, and
  per-user environment restrictions. `ZOSMF_ENV` / `defaults.environment`
  select the default. New **`list_environments`** tool enumerates targets.
- **Policy-as-code and RBAC** (`SECURITY_POLICY_FILE`). A single YAML file
  maps roles to tool allow/deny globs, dataset/USS patterns, per-role
  read-only mode and change-ticket patterns, and read line caps (with role
  inheritance: child allow lists replace, deny lists and readOnly accumulate
  downward). `users:` maps usernames to roles per environment; unmapped users
  fall back to `defaults.role` or fail closed. `${env:VAR}` interpolation
  keeps credentials out of the file; any structural error aborts startup.
  Env-var controls continue to apply — the policy only narrows. New
  **`whoami`** tool shows the acting identity, resolved role, and effective
  policy. On SSE, the `X-MCP-User` request header supplies the acting
  identity for gateway deployments.
- **Audit & SIEM export.** One structured JSON audit record per tool call with
  correlation id, user, MCP client (from the `initialize` handshake),
  transport, environment, redacted arguments, resource references, outcome
  (`success`/`error`/`blocked`), error code, duration, and result size. Sinks:
  NDJSON file (`SECURITY_AUDIT_FILE`), Splunk HEC
  (`SECURITY_AUDIT_SPLUNK_URL`/`_TOKEN`), generic HTTP webhook
  (`SECURITY_AUDIT_WEBHOOK_URL`/`_TOKEN`), and OpenTelemetry OTLP/JSON
  (`SECURITY_AUDIT_OTLP_URL`). HTTP sinks are batched, time-boxed, and
  best-effort — a dead collector never blocks a tool call. Records are
  SHA-256 hash-chained (tamper-evident); `npm run verify:audit` (or
  `node tools/verify-audit-log.mjs`) detects any edit, deletion, or
  reordering and reports the first broken sequence number.
- **Data protection.** Built-in redaction rules (`ssn`, `credit_card` with
  Luhn validation, `email`, `secrets` such as `PASSWORD=`/`api_key:`
  assignments, `jwt`, `private_key` blocks) mask job output and dataset/USS
  reads by default (`SECURITY_DATA_PROTECTION`, style via
  `SECURITY_REDACTION_STYLE`, rule set via `SECURITY_REDACTION_RULES`);
  masked output carries an explicit `[data protection: …]` footer. Policy
  `classifications:` add per-resource behavior: rule overrides, hard line
  caps (`maxLines`), head/tail `sample` of bulk reads, and role-gated access
  to classified resources.
- Policy roles can now require (or relax) change tickets per role:
  `changeTicketPattern` on a role overrides
  `SECURITY_CHANGE_TICKET_PATTERN` for that role's `submit_jcl` calls.

## [2.8.0] — 2026-10-25

### Added

- **Per-user identity (PassTicket propagation).** Set `ZOSMF_USER_ID` and the
  server generates z/OSMF PassTickets for the end user and runs every z/OSMF
  tool call under that identity, so RACF sees who asked instead of the shared
  service account. Tickets are cached (8-minute TTL) and regenerated
  transparently.
- **mTLS client-certificate auth** via `ZOSMF_CERT` + `ZOSMF_CERT_KEY` (PEM
  paths, `cert-pem` sessions).
- **JWT / APIML token auth**: `ZOSMF_TOKEN_TYPE=JWT|APIML|BEARER` is sent as
  `Authorization: Bearer` for API Mediation Layer and OIDC-issued tokens;
  `ZOSMF_TOKEN_FILE` allows vault/agent-side token injection.
- **Zowe team config profile import**: `ZOWE_TEAM_CONFIG` (+ `ZOSMF_PROFILE`)
  fills any z/OSMF setting not provided via env, including `@secure` entries
  stored in the config file.
- **Governed writes for `submit_jcl`**:
  - JCL pre-flight scan (`SECURITY_JCL_SCAN`, default on) blocking IDCAMS
    `DELETE`, IEFBR14 `DISP=(...,DELETE)` dataset deletes, blocked utilities
    (`ADRDSSU`, `ICKDSF`, `IEHINITT` by default, extendable via
    `SECURITY_BLOCKED_PROGRAMS`), and restricted job classes; WARN findings
    (e.g. IDCAMS `ALTER`) block in strict mode (`SECURITY_JCL_SCAN_STRICT`).
  - Change-ticket requirement (`SECURITY_CHANGE_TICKET_PATTERN`).
  - Change-window enforcement (`SECURITY_WRITE_WINDOW`, `SECURITY_WRITE_DAYS`,
    `SECURITY_WRITE_WINDOW_TZ`) with overnight-window and IANA-timezone
    support.
  - `dryRun=true` on `submit_jcl` reports structure checks, scan findings, and
    the governance outcome without submitting.
  - Human-in-the-loop approval (`SECURITY_WRITE_APPROVAL=true`): validated
    submissions become pending and a new **`approve_write`** tool executes
    them with a one-time, 10-minute token after human review; the change
    window is re-checked at approval time.

### Changed

- **`SECURITY_READ_ONLY` now defaults to `true`.** Write tools (`submit_jcl`,
  `approve_write`) are blocked unless you explicitly set
  `SECURITY_READ_ONLY=false`. This is the safe default for AI-agent access.
- Boolean env fallbacks moved out of the env reader into the Zod schema so
  defaults are applied uniformly (previously inline fallbacks shadowed the
  schema).
- Documentation overhaul: z/OS prerequisites, per-tool read/write labelling,
  per-user identity & SSO, governed writes, trust & prompt-injection model,
  intelligence-tool mechanics, limits, troubleshooting/FAQ, and an honest
  comparison table.

### Commits in this release (`v2.5.0...v2.8.0`)

| Commit | Summary |
|---|---|
| `b3ed26f` | Fix trend detection, security-gate tool names, JOB-card rewrites, wait-loop resilience, USS pluralization, SSE startup errors (+ regression tests) |
| `734f542` | Documentation accuracy: Zowe attribution, token-first examples, transports, trademarks |
| `cebe728` | Website redesign: Operations Console theme, upgraded header, logo & favicon |
| `95bbcd8` | Project hygiene: CI workflow, SECURITY/CONTRIBUTING/CHANGELOG, README overhaul, read-only default, demo animation |
| `476b270` | Per-user identity (PassTicket/mTLS/JWT-APIML/team config) and governed writes (scan, tickets, windows, approval) |
| `20ca60b` | Website: enterprise identity & governed-writes sections |
| `d700aef` | Release 2.8.0: version bump across package/server/schema/docs and npm + MCP registry release workflow |

### Fixed

- `predict_batch_failures`: trend detection was dead code (always reported
  `STABLE`) and its labels were inverted. Trends are now computed by
  comparing failure counts in the newest vs oldest third of the look-back
  window.
- `summarize_abends` and `list_db2_subsystems`: the security gate and audit
  log used stale tool names (`mainframe_*`), so `SECURITY_ALLOWED_TOOLS` /
  `SECURITY_BLOCKED_TOOLS` did not match them.
- `submit_jcl`: `CLASS=`/`NOTIFY=` JOB-card overrides matched anywhere in the
  JCL and could corrupt the card when a `NOTIFY` value contained `$`.
  Overrides are now scoped to the `//name JOB` statement.
- `submit_jcl` wait mode no longer fails the whole call on a transient
  polling error after a successful submission.
- USS listings pluralized "directory" incorrectly ("1 directoryy").
- Failure analysis now recognizes the `COND CODE=nnnn` spelling of IEF142I.
- SSE transport: a port-in-use error now aborts startup with a clean fatal
  message instead of an unhandled exception.

## [2.5.0] — 2025-06

### Added

- Security posture reporting (`security_posture_summary`) with tiered
  recommendations.
- Intelligence tools: `analyze_root_cause` (correlation + confidence +
  health score) and `predict_batch_failures` (recency-weighted risk scoring
  with trend detection).
- CICS/Db2 tool filters (status, prefix, schema, type) and result capping.
- USS listing with permissions, ownership, type counts, and sorting.
- Enterprise security controls: read-only mode, tool allow/block lists,
  dataset and USS boundaries, JCL size cap, audit logging.
- MCP registry metadata (`server.json`) for IDE-driven install flows.

[Unreleased]: https://github.com/NotHarshhaa/mainframe-mcp-server/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/NotHarshhaa/mainframe-mcp-server/compare/v2.8.0...v3.0.0
[2.8.0]: https://github.com/NotHarshhaa/mainframe-mcp-server/compare/v2.5.0...v2.8.0
[2.5.0]: https://github.com/NotHarshhaa/mainframe-mcp-server/releases/tag/v2.5.0
