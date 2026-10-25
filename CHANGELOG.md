# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **`SECURITY_READ_ONLY` now defaults to `true`.** Write tools (currently
  `submit_jcl`) are blocked unless you explicitly set
  `SECURITY_READ_ONLY=false`. This is the safe default for AI-agent access.
- Documentation overhaul: z/OS prerequisites, per-tool read/write labelling,
  trust & prompt-injection model, intelligence-tool mechanics, limits,
  troubleshooting/FAQ, and an honest comparison table.

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
