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

## Error Codes

| Code | Meaning |
|---|---|
| `CONFIG_ERROR` | Configuration missing or invalid. |
| `CONNECTION_ERROR` | z/OSMF connection or auth failure. |
| `NOT_FOUND` | The requested job/dataset/file was not found. |
| `VALIDATION_ERROR` | Tool input failed validation. |
| `LIMIT_EXCEEDED` | A safety limit was exceeded. |
| `UNEXPECTED_ERROR` | An unclassified error. |
