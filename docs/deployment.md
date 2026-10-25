# Deployment

`mainframe-mcp-server` supports two transports: **stdio** (default, ideal for
desktop MCP clients) and **HTTP+SSE** (for networked / containerized deployments).

> Note: HTTP+SSE is the legacy MCP network transport. The MCP spec has moved to
> Streamable HTTP, which this server does not implement yet — clients that only
> speak Streamable HTTP should launch the server over stdio.

The examples below show token auth (`ZOSMF_TOKEN`). Basic auth
(`ZOSMF_USER` / `ZOSMF_PASSWORD`) works the same way; source either from a
vault or secrets manager in production.

---

## Option 1 — npm package (stdio)

Published as `@notharshhaa/mainframe-mcp-server`. The MCP client launches the
server via `npx` and communicates over stdin/stdout.

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

## Option 2 — Local from source (stdio)

```bash
npm install
npm run build
```

Configure credentials in your IDE MCP `env` block (see
[config/mcp-client.example.json](../config/mcp-client.example.json)), then start via
the IDE or `npm start` with the same variables exported in your shell.

### Claude Desktop / Cursor (local build)

```json
{
  "mcpServers": {
    "mainframe": {
      "command": "node",
      "args": ["/absolute/path/to/mainframe-mcp-server/dist/index.js"],
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

> With stdio, **all logging goes to stderr** so it never interferes with the
> JSON-RPC stream on stdout.

---

## Option 3 — Container (HTTP+SSE)

For shared/internal deployments, run the server as a long-lived process exposing
the HTTP+SSE transport.

### Build & run with Docker

```bash
docker build -t mainframe-mcp-server .
docker run --rm -p 3000:3000 \
  -e ZOSMF_HOST=your-zosmf-host.internal \
  -e ZOSMF_TOKEN=your-zosmf-token \
  -e MCP_TRANSPORT=sse -e MCP_SSE_PORT=3000 \
  mainframe-mcp-server
```

### docker-compose

```bash
export ZOSMF_HOST=your-zosmf-host.internal
export ZOSMF_TOKEN=your-zosmf-token
docker compose up --build
```

The compose file reads the same variable names as the MCP client `env` block (no
`.env` file). It defaults `MCP_TRANSPORT` to `sse` and publishes `MCP_SSE_PORT`.

### HTTP+SSE endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sse` | Open the SSE event stream (establishes a session). |
| `POST` | `/messages?sessionId=...` | Send a client message to an open session. |
| `GET` | `/health` | Liveness probe (`{"status":"ok"}`). |

---

## Option 4 — Kubernetes (Helm chart)

The chart at `helm/mainframe-mcp-server/` deploys the server with the SSE transport,
hardened by default: non-root, read-only root filesystem, dropped capabilities,
no privilege escalation, and no service-account token mounted.

```bash
helm install mainframe-mcp helm/mainframe-mcp-server \n  --set zosmf.host=zosmf.example.com \n  --set zosmf.token="$ZOSMF_TOKEN" \n  --set policy.existingConfigMap=mcp-policy \n  --set security.auditOtlpUrl=http://otel-collector.observability:4318
```

Key values (full reference in [helm/mainframe-mcp-server/README.md](../helm/mainframe-mcp-server/README.md)):

| Value | Purpose |
|---|---|
| `zosmf.*` | Connection + auth (bring your own secret via `credentials.existingSecret`) |
| `security.readOnly` | `true` by default — write tools blocked until explicitly enabled |
| `policy.existingConfigMap` / `policy.inline` | Policy-as-code file mounted at `/etc/mainframe-mcp/policy.yaml` |
| `security.auditSplunkUrl/auditOtlpUrl/auditWebhookUrl` | SIEM sinks (preferred over the file sink in Kubernetes) |
| `persistence.enabled` | Only needed for the file-based audit sink |

The chart creates the secret when `credentials.create=true` (default), or references
an existing one — secrets never need to live in values files.

---

## Option 5 — Internal service

Run under a process manager (systemd, pm2) on an internal host with network
access to z/OSMF. Supply configuration via your secrets manager or MCP-style `env` variables — not
a checked-in `.env` file. Use a dedicated, least-privilege service account for z/OS
access.

### Example systemd unit

```ini
[Unit]
Description=mainframe-mcp-server
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/mainframe-mcp-server
EnvironmentFile=/etc/mainframe-mcp-server/env
ExecStart=/usr/bin/node /opt/mainframe-mcp-server/dist/index.js
Restart=on-failure
User=mfmcp

[Install]
WantedBy=multi-user.target
```

---

## Supply-chain assurance

Security teams can verify every artifact before trusting it:

### Official container image

Releases publish `ghcr.io/notharshhaa/mainframe-mcp-server` with tags for the
exact version (`3.0.0`), minor line (`2.8`), and the git SHA. The image is
non-root, and the compose file/Helm chart run it read-only with all
capabilities dropped.

### Signature verification (Sigstore keyless)

Every image is signed in CI with cosign (keyless, Workload Identity):

```bash
cosign verify ghcr.io/notharshhaa/mainframe-mcp-server:3.0.0 \n  --certificate-identity-regexp 'https://github.com/NotHarshhaa/mainframe-mcp-server/.github/workflows/release.yml/tags/v' \n  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Release SBOMs and checksum files are signed the same way (`cosign sign-blob`);
verify with `cosign verify-blob --signature sha256sums.txt.sig --certificate-identity ...
sha256sums.txt`.

### SBOMs

Each release ships four SBOMs as GitHub release assets — SPDX and CycloneDX for
both the npm package and the container image. Ingest them into your SCAM/SCA
tooling (Grype, Trivy, Dependency-Track, …). BuildKit also attaches in-toto
attestations (provenance `mode=max` + SBOM) to the image itself:

```bash
docker buildx imagetools inspect ghcr.io/notharshhaa/mainframe-mcp-server:3.0.0
```

### npm provenance

The npm package is published with `--provenance` (SLSA build provenance from
GitHub Actions OIDC). Check the "Provenance" side-bar entry on
[npmjs.com](https://www.npmjs.com/package//mainframe-mcp-server),
or verify locally:

```bash
npm audit signatures
```

### Policy-as-code gate for the supply chain

Combine the above with admission control: gate Kubernetes deployments on the
cosign signature and on a vulnerability/license scan of the SBOM
(e.g. Kyverno `verifyImages`, Connaisseur, or your registry's policy engine).

---

## Health & Observability

- Set `LOG_LEVEL=debug` to trace each tool invocation and Zowe SDK activity.
- In SSE mode, poll `GET /health` for liveness.
- Logs are structured JSON (pino) on stderr — ship them to your log platform.
