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

## Option 4 — Internal service

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

## Health & Observability

- Set `LOG_LEVEL=debug` to trace each tool invocation and Zowe SDK activity.
- In SSE mode, poll `GET /health` for liveness.
- Logs are structured JSON (pino) on stderr — ship them to your log platform.
