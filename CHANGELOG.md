# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/NotHarshhaa/mainframe-mcp-server/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/NotHarshhaa/mainframe-mcp-server/releases/tag/v2.5.0
