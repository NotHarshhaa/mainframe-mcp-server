# Tools Reference

Full input/output reference for every MCP tool exposed by `mainframe-mcp-server`.
All tools return a single text content block. Errors are returned as a text
result with `isError: true` in the form `Error [CODE]: message`.

---

## Job Tools

### `list_jobs`

List z/OS batch jobs filtered by owner, name prefix, or status.

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `owner` | string | no | `*` | Owner (user id) filter. `*` for all. |
| `prefix` | string | no | `*` | Job name prefix (wildcards allowed). |
| `status` | enum(`INPUT`,`ACTIVE`,`OUTPUT`) | no | — | Post-retrieval status filter. |

**Output:** a table of `Job Name`, `Job ID`, `Owner`, `Status`, `Return Code`.

---

### `get_job_status`

Get the current status and return code of a single job.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id, e.g. `JOB01234`. |
| `jobName` | string | no | Optional job name for disambiguation. |

**Output:** an aligned key/value block (name, owner, status, return code, class…).

---

### `get_job_output`

Retrieve spool output. With no `ddName`, lists the spool inventory; with a
`ddName`, returns that DD's content (capped by `MAX_JOB_OUTPUT_LINES`).

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id. |
| `ddName` | string | no | DD name, e.g. `JESMSGLG`. Omit to list spool files. |

---

### `submit_jcl`

Submit inline JCL to JES.

| Input | Type | Required | Description |
|---|---|---|---|
| `jcl` | string | yes | Complete inline JCL (must start with `//`). |

**Output:** confirmation plus the new job's status block.

---

### `analyze_job_failure`

Analyze a failed job and summarize the root cause.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id of the failed job. |

**Output:** `Job / Status / Step / Reason / Spool / Fix` block (see README Example 1).

---

## Dataset Tools

### `list_datasets`

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `hlq` | string | yes | — | High-level qualifier, e.g. `SYS1`. |
| `pattern` | string | no | `*` | Lower-qualifier pattern appended to the HLQ. |

### `read_dataset`

| Input | Type | Required | Description |
|---|---|---|---|
| `dsn` | string | yes | Dataset name, e.g. `SYS1.PROCLIB`. |
| `member` | string | no | PDS member name. Omit for sequential. |

Output is capped by `MAX_DATASET_READ_LINES`.

### `search_dataset`

| Input | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | yes | Dataset name pattern with wildcards. |

### `search_members`

| Input | Type | Required | Description |
|---|---|---|---|
| `dsn` | string | yes | PDS dataset name. |
| `pattern` | string | no | Member name glob (`*`, `?`). Omit to list all. |

---

## USS Tools

### `list_uss_directory`

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Absolute USS directory path. |

### `read_uss_file`

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Absolute USS file path. |

### `search_uss_files`

| Input | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Absolute USS directory to search. |
| `pattern` | string | yes | File name glob (`*`, `?`). |

---

## Operations Tools

### `find_failed_jobs`

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `hours` | integer | no | 24 | Look-back window in hours. |
| `owner` | string | no | `*` | Owner filter. |

**Output:** a table of `Job Name`, `Job ID`, `Abend Code`, `Failed Step`.

### `summarize_abends`

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `hours` | integer | no | 24 | Look-back window. |
| `owner` | string | no | `*` | Owner filter. |

**Output:** a table of `Abend Code`, `Count`, `Description`.

### `system_health_summary`

No inputs. Returns an overall status (`HEALTHY` / `DEGRADED` / `CRITICAL`),
counts of active/queued/failed jobs, and the top abend codes.

### `investigate_incident`

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id to investigate. |

**Output:** a numbered multi-section bundle — status, root-cause analysis, spool
inventory, and a diagnostic spool excerpt.

### `lookup_abend_code`

Look up abend codes from the built-in reference table (no z/OSMF call required).

| Input | Type | Required | Description |
|---|---|---|---|
| `code` | string | no | Code to look up, e.g. `S806`, `0C7`, `U0100`. |
| `search` | string | no | Filter the catalog by code, title, or explanation. |

**Output:** detailed reference entry for a single code, or a catalog table when
`code` is omitted. Includes explanation, common causes, and suggested fix.

Known codes include **S0C1**, **S0C4**, **S0C7**, **S806**, **S222**, **S322**,
**S913**, **U0100**, **U4038**, and others — see `lookup_abend_code` with no
inputs for the full list.

---

## CICS Tools (CMCI)

Requires `CMCI_CONTEXT` (CICSplex name or region APPLID). Optionally set `CMCI_HOST` and `CMCI_PORT` (default `1490`).

### `list_cics_regions`

| Input | Type | Required | Description |
|---|---|---|---|
| `context` | string | no | CMCI context. Defaults to `CMCI_CONTEXT`. |

**Output:** table of APPLID, status, CICSPlex, SYSID.

### `get_cics_region_status`

| Input | Type | Required | Description |
|---|---|---|---|
| `region` | string | yes | CICS region APPLID. |
| `context` | string | no | CMCI context. |

### `list_cics_transactions`

| Input | Type | Required | Description |
|---|---|---|---|
| `region` | string | yes | CICS region APPLID. |
| `context` | string | no | CMCI context. |

---

## Db2 Tools (Db2 REST)

Requires `DB2_LOCATION`. Optionally set `DB2_HOST` and `DB2_PORT` (default `50400`).

### `list_db2_subsystems`

No inputs. Lists Db2 locations available via Db2 REST.

### `search_db2_catalog`

| Input | Type | Required | Description |
|---|---|---|---|
| `pattern` | string | yes | Table/view name pattern (`*`, `?`). |
| `schema` | string | no | Creator/schema filter. |

---

## SMF Tools

### `get_smf_metrics`

No inputs. Requires `RMF_METRICS_ENABLED=true` (default) and/or `SMF_SUMMARY_DATASET`.

**Output:** structured performance snapshot from z/OSMF RMF and/or SMF summary dataset.

---

## Security Tools

### `query_racf_audit`

Requires `RACF_AUDIT_USS_PATH` or `RACF_AUDIT_DATASET`.

| Input | Type | Required | Description |
|---|---|---|---|
| `user` | string | no | Filter by user id (substring). |
| `resource` | string | no | Filter by resource name (substring). |
| `hours` | integer | no | Look-back window (best-effort). |

---

## Intelligence Tools

### `analyze_root_cause`

AI-assisted deep analysis (structured for LLM consumption; no external AI API).

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `jobId` | string | yes | — | Failed job to analyze. |
| `lookbackHours` | integer | no | 72 | Correlation window. |

**Output:** summary with confidence, failure analysis, similar incidents, correlated abends, and action items.

### `predict_batch_failures`

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `hours` | integer | no | 168 | Historical look-back window. |

**Output:** risk-ranked jobs with scores, abend patterns, trends, and recommendations.

---

## Error Codes

| Code | Meaning |
|---|---|
| `CONFIG_ERROR` | Configuration missing or invalid. |
| `CONNECTION_ERROR` | z/OSMF connection or auth failure. |
| `NOT_FOUND` | The requested job/dataset/file was not found. |
| `VALIDATION_ERROR` | Tool input failed validation. |
| `LIMIT_EXCEEDED` | A safety limit was exceeded. |
| `FORBIDDEN` | Blocked by enterprise security policy (allowlist, read-only, resource boundary). |
| `UNEXPECTED_ERROR` | An unclassified error. |
