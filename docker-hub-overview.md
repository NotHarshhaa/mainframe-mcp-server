# mainframe-mcp-server

An enterprise-grade **Model Context Protocol (MCP) server for IBM z/OS**. It bridges MCP-compatible AI agents (Cursor, VS Code, Claude Desktop, …) with mainframe resources over **z/OSMF REST via the Zowe SDK** (Open Mainframe Project).

## What it covers

- **Jobs & JES** — list/status/spool, governed `submit_jcl` (pre-flight scan, change ticket, change window, human approval), hold/release/cancel, per-step CPU (IEF374I/IEF376I)
- **Datasets & USS** — read/search/list, PDS members, info, governed writes
- **Console & JES ops** — MVS operator commands (`D A,L`, `D GRS`), WLM displays, IMS commands, operations-log tail, HSM activity, LOGREC (EREP) analysis — all gated writes
- **CICS & Db2** — regions, transactions, statistics, gated NEWCOPY / transaction disable (CMCI); Db2 REST catalog search
- **Schedulers** — Control-M, CA 7, IBM Workload Automation job status (REST adapters) and JCL-based job dependency analysis
- **Messaging & storage** — IBM MQ queue depths and channel status (MQ REST), DASD volume space via z/OSMF SMI with low-space alerts
- **Dumps** — CEEDUMP / SYSMDUMP / SYSUDUMP summarization (codes, failing module, LE conditions)
- **Cost** — MLC cost attribution from CPU/MSU with explicit assumptions
- **Enterprise controls** — read-only by default, policy-as-code & RBAC (single YAML), multi-environment (DEV/TEST/UAT/PROD with per-env policy), SIEM audit with tamper-evident hash chains, PII/PCI/SSN/secret masking in output

## Supported tags

| Tag | Description |
|---|---|
| `latest` | Most recent release |
| `3.0.0` | Exact release version |
| `2.8`, `2.8.0`, … | Minor-line and historical versions |

## Quick start (HTTP+SSE)

```bash
docker run -d --name mainframe-mcp \
  -p 3000:3000 \
  -e ZOSMF_HOST=your-zosmf-host.internal \
  -e ZOSMF_TOKEN=your-zosmf-token \
  -e MCP_TRANSPORT=sse -e MCP_SSE_PORT=3000 \
  harshhaareddy/mainframe-mcp-server:latest
```

Then point your MCP client at `http://localhost:3000/sse`. Endpoints: `GET /sse`, `POST /messages?sessionId=…`, `GET /health`.

For IDE-local use, prefer the **stdio** transport via the npm package (`npx -y @notharshhaa/mainframe-mcp-server`) — containers run SSE.

## Key environment variables

| Variable | Required | Description |
|---|---|---|
| `ZOSMF_HOST` | yes | z/OSMF hostname or IP |
| `ZOSMF_TOKEN` (or `ZOSMF_USER` + `ZOSMF_PASSWORD`) | yes | Auth — token recommended |
| `ZOSMF_PORT` / `ZOSMF_BASE_PATH` | no | Port (443) / gateway prefix |
| `ZOSMF_USER_ID` | no | End-user PassTicket identity — RACF sees who asked |
| `SECURITY_READ_ONLY` | no | `true` (default) blocks all write tools |
| `SECURITY_POLICY_FILE` | no | Policy-as-code YAML: roles, RBAC, environments, data classifications |
| `SECURITY_AUDIT_FILE` / `_SPLUNK_URL` / `_OTLP_URL` / `_WEBHOOK_URL` | no | SIEM audit sinks |
| `MCP_TRANSPORT` / `MCP_SSE_PORT` | no | `sse` (default here) / `3000` |

Full reference: [docs/configuration.md](https://github.com/NotHarshhaa/mainframe-mcp-server/blob/main/docs/configuration.md).

## Hardening & supply chain

- Runs as **non-root** (uid 1000); designed for read-only root filesystems with dropped capabilities (see the repo's hardened `docker-compose.yml` and Helm chart).
- Prefer the **GHCR mirror** (`ghcr.io/notharshhaa/mainframe-mcp-server`) when you need **Sigstore/cosign signature verification** and BuildKit SBOM/provenance attestations; this Docker Hub image mirrors the same build.
- SPDX + CycloneDX SBOMs ship with every GitHub release.

## Links

- GitHub: https://github.com/NotHarshhaa/mainframe-mcp-server
- Docs: [deployment](https://github.com/NotHarshhaa/mainframe-mcp-server/blob/main/docs/deployment.md) · [enterprise features](https://github.com/NotHarshhaa/mainframe-mcp-server/blob/main/docs/enterprise.md) · [tools reference](https://github.com/NotHarshhaa/mainframe-mcp-server/blob/main/docs/tools-reference.md)
- npm: `@notharshhaa/mainframe-mcp-server`

## License

MIT. Not affiliated with IBM or the Open Mainframe Project. IBM, z/OS, CICS, Db2, and RACF are trademarks of IBM.
