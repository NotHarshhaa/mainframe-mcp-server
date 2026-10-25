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


### `get_cics_region_stats`

Region attributes and statistics from the CMCI `CICSRegion` resource (uptime,
status, and other region-level fields your CMCI release provides).

| Input | Type | Required | Description |
|---|---|---|---|
| `region` | string | yes | CICS region APPLID. |
| `context` | string | no | CMCI context. |

### `cics_newcopy`

NEWCOPY a CICS program via a CMCI resource action — **gated write**. Requires
CMCI with actions enabled (CICS TS 5.6+).

| Input | Type | Required | Description |
|---|---|---|---|
| `region` | string | yes | CICS region APPLID. |
| `program` | string | yes | Program name (1–8 chars). |
| `context` | string | no | CMCI context. |

### `cics_disable_transaction`

Disable (or re-enable with `enable: true`) a CICS local transaction via a CMCI
SET action — **gated write**. New attaches are refused; in-flight tasks finish.

| Input | Type | Required | Description |
|---|---|---|---|
| `region` | string | yes | CICS region APPLID. |
| `transaction` | string | yes | Transaction id (1–4 chars). |
| `enable` | boolean | no | `true` = enable instead of disable (default false). |
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

---

---

## Console & JES Tools

Operator commands run through the z/OSMF Console API using a dynamically
activated extended MCS console (`ZOSMF_CONSOLE_NAME`, default `MCPDYN01`;
requires CONSOLE authority for the z/OSMF identity). Every command-issuing
tool is a **gated write** — blocked by `SECURITY_READ_ONLY`, subject to policy
role gates, change tickets, and change windows.

### `issue_console_command`

| Input | Type | Required | Description |
|---|---|---|---|
| `command` | string | yes | MVS command, e.g. `D A,L`, `D GRS,RES=(*,SYS1.PROCLIB)`. |
| `consoleName` | string | no | Console name (default `ZOSMF_CONSOLE_NAME`). |
| `collectKey` | string | no | Response key from a previous call — collects follow-up messages. |

### `get_console_messages`

Operations-log tail (unsolicited console messages — SYSLOG-style feed).

| Input | Type | Required | Description |
|---|---|---|---|
| `consoleName` | string | no | Console name. |
| `maxLines` | integer | no | Line cap (default 200). |

### `hold_job` / `release_job`

JES2 `$HJ` / `$OJ` commands via the console (gated writes).

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id, e.g. `JOB01234`. |
| `consoleName` | string | no | Console name. |

### `cancel_job`

Cancels a job via the z/OSMF jobs API (gated write).

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id. |

### `get_wlm_status`

WLM display via `D WLM` (gated write — a console command is issued).

| Input | Type | Required | Description |
|---|---|---|---|
| `command` | string | no | WLM display command (default `D WLM`), e.g. `D WLM,SYSTEMS`. |
| `consoleName` | string | no | Console name. |

### `ims_command`

IMS commands via the z/OS system console (gated write) — commands are prefixed
with `/`, e.g. `/DIS ACTIVE`, `/DIS TRAN TRAN1`.

| Input | Type | Required | Description |
|---|---|---|---|
| `command` | string | yes | IMS command (leading `/` added if missing). |
| `consoleName` | string | no | Console name. |
| `collectKey` | string | no | Collects follow-up messages. |

### `get_hsm_activity`

Recent DFSMShsm activity (recalls, migrations, backups) filtered from the
operations-log tail. This reflects console traffic only — for full queue state
use `HSEND` from TSO.

| Input | Type | Required | Description |
|---|---|---|---|
| `consoleName` | string | no | Console name. |
| `maxLines` | integer | no | Cap (default 50). |

### `analyze_logrec`

Submits a canned EREP (`IFCEREP`) report job against the LOGREC dataset, waits
for completion, and summarizes the record-count table, abend codes, and
modules (gated write: submits a batch job).

| Input | Type | Required | Description |
|---|---|---|---|
| `logrecDataset` | string | no | Default `LOGREC_DATASET` (typically `SYS1.LOGREC`). |
| `report` | enum | no | `SUMMARY` (default) or `HISTORY`. |
| `waitSeconds` | integer | no | How long to wait for the EREP job (default 60). |

---

## Scheduler Tools

### `scheduler_job_status`

Queries external batch schedulers (Control-M, CA 7, IBM Workload Automation)
via their REST APIs. Configure endpoints with `SCHEDULER_ADAPTERS` (JSON):
`[{"name":"controlm","type":"controlm","host":"https://ctm.example.com:8443","token":"..."}]`.
Default path templates per type (override `jobStatusPath` for your version):
controlm → `/config/jobs?jobName={jobName}`, ca7 → `/ca7/api/v2/jobs?jobName={jobName}`,
iws → `/twsz/plan/current/jobs?jobName={jobName}`. Responses are passed
through with a best-effort normalized status.

| Input | Type | Required | Description |
|---|---|---|---|
| `scheduler` | string | no | Scheduler name from `SCHEDULER_ADAPTERS` (required when several are configured). |
| `jobName` | string | yes | Scheduler job name. |

### `job_dependencies`

Analyzes a job's JCL for batch dependencies: dataset inputs (`DISP=SHR`),
updates (`DISP=OLD`), outputs (`NEW`/`MOD`) per step, and PROCs invoked —
the raw material for predecessor/successor analysis. PROCs are not expanded.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | one of | JES job id — JCL is pulled from spool. |
| `jcl` | string | one of | Inline JCL text. |

---

## MQ Tools (MQ REST)

Requires `MQ_REST_HOST` (mqweb server) and optionally `MQ_REST_PORT` (default
9443), `MQ_REST_USER`, `MQ_REST_PASSWORD`.

### `mq_queue_status`

| Input | Type | Required | Description |
|---|---|---|---|
| `qmgr` | string | yes | Queue manager name. |
| `queues` | string | yes | Comma-separated queue names. |

**Output:** curdepth/maxdepth and percent-full per queue, with a warning at ≥80%.

### `mq_channel_status`

| Input | Type | Required | Description |
|---|---|---|---|
| `qmgr` | string | yes | Queue manager name. |
| `channel` | string | no | Channel name filter (default: all channels). |

**Output:** channel status (RUNNING/RETRYING/STOPPED), type, transmission queue, connection count.

---

## Storage Tools

### `get_volume_space`

DASD volume space inventory via the z/OSMF Storage Management Interface
(z/OSMF 2.4+). Volumes below `STORAGE_FREE_THRESHOLD` (percent free, default
10) are flagged as alerts.

| Input | Type | Required | Description |
|---|---|---|---|
| `volser` | string | no | Volume serial (default: all volumes). |

---

## Capacity & Cost Tools

### `get_job_capacity`

Per-step and job-total CPU parsed from the job's JESMSGLG (IEF374I/IEF376I),
with an MSU estimate when `CAPACITY_MSU_RATING` (LPAR MSU/hour) is configured.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | yes | JES job id. |

### `estimate_mlc_cost`

MLC cost attribution: MSU ≈ CPU hours × LPAR capacity; cost = MSU ×
(`MLC_MSU_MONTHLY_PRICE` converted to a per-MSU-hour rate). Assumptions are
listed in the output — peak/4HRA contracts price differently.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | one of | JES job id — CPU read from JESMSGLG. |
| `cpuSeconds` | number | one of | Explicit CPU seconds (needs `CAPACITY_MSU_RATING`). |
| `msuConsumed` | number | one of | Explicit MSU (no capacity needed). |

---

## Dump Tools

### `summarize_dump`

Summarizes CEEDUMP / SYSMDUMP / SYSUDUMP output: system and user completion
codes, failing module and offset, PSW, Language Environment conditions, and
the section inventory — from spool or a dataset. For SVC dumps (binary),
use IPCS; text dumps only.

| Input | Type | Required | Description |
|---|---|---|---|
| `jobId` | string | one of | JES job id when the dump is in spool. |
| `ddName` | string | no | Spool DD (default: first of SYSUDUMP/SYSMDUMP/CEEDUMP/SYSABEND). |
| `dsn` | string | one of | Dataset containing the dump. |
| `member` | string | no | PDS member when `dsn` is a library. |

---

## Governance Tools

These tools expose the enterprise control plane (multi-environment,
policy-as-code, audit, data protection — see
[docs/enterprise.md](enterprise.md)). Like every other tool, they accept an
optional `environment` argument.

### `list_environments`

No inputs.

**Output:** table of named z/OS environments with description, z/OSMF
endpoint, read-only status, auth method, and allowed roles. The default
environment is marked with `*`. When no environments are configured, the
output explains how to enable multi-environment support
(`SECURITY_POLICY_FILE` or `ZOSMF_ENVIRONMENTS`).

### `whoami`

No inputs.

**Output:** structured report of the acting session:

1. **Identity** — user, resolved role, policy source.
2. **Environment** — active and available environments, write status.
3. **Permissions** — write operations, tool allow/deny lists, dataset and USS
   patterns, change-ticket requirement, read line cap.
4. **Data protection** — masking status, active rules, style, classification
   count.

Use it to verify RBAC wiring before granting broader access.

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
