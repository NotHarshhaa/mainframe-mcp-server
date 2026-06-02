# Publishing Guide

This project is set up to publish to **npm** (the installable package) and the
**MCP Registry** (discovery metadata that points at the npm package).

| Artifact | Identifier |
|---|---|
| npm package | `@notharshhaa/mainframe-mcp-server` |
| MCP Registry server | `io.github.NotHarshhaa/mainframe-mcp-server` |

The `mcpName` field in `package.json` **must** match the `name` in `server.json`.
Both must match your GitHub username when using `mcp-publisher login github`.

---

## Prerequisites

- [npm](https://www.npmjs.com) account: **notharshhaa**
- [GitHub](https://github.com) account: **NotHarshhaa** (owner of this repo)
- `npm run build`, `npm test`, and `npm run lint` all pass locally

---

## 1. Publish to npm

```bash
# Authenticate (once per machine)
npm login
# Username: notharshhaa

# Dry-run: see what would be published
npm publish --dry-run

# Publish (prepublishOnly runs `npm run build` automatically)
npm publish
```

Verify: https://www.npmjs.com/package/@notharshhaa/mainframe-mcp-server

### After the first publish

Bump **both** versions together before the next release:

1. `package.json` → `"version"`
2. `server.json` → `"version"` and `packages[0].version`

---

## 2. Publish to the MCP Registry

Install the official publisher CLI:

```bash
# macOS / Linux
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

Validate without publishing:

```bash
mcp-publisher publish --dry-run
```

Authenticate and publish (npm package must already be live):

```bash
mcp-publisher login github
mcp-publisher publish
```

Verify:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.NotHarshhaa/mainframe-mcp-server"
```

### Common errors

| Message | Fix |
|---|---|
| Registry validation failed for package | Ensure npm publish succeeded and `mcpName` in `package.json` matches `server.json` `name`. |
| You do not have permission to publish this server | Log in with the GitHub account that owns `NotHarshhaa`; server name must be `io.github.NotHarshhaa/...`. |
| Invalid or expired Registry JWT token | Run `mcp-publisher login github` again. |

---

## 3. End-user installation (after publish)

### Cursor / Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "mainframe": {
      "command": "npx",
      "args": ["-y", "@notharshhaa/mainframe-mcp-server"],
      "env": {
        "ZOSMF_HOST": "your-zosmf-host.internal",
        "ZOSMF_PORT": "443",
        "ZOSMF_USER": "your-username",
        "ZOSMF_PASSWORD": "your-password",
        "ZOSMF_REJECT_UNAUTHORIZED": "true"
      }
    }
  }
}
```

Users still need network access to z/OSMF and valid z/OS credentials. The
registry and npm only distribute the server binary — not mainframe access.

---

## Optional: CI with GitHub Actions

See the [MCP Registry GitHub Actions guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.md) to automate `mcp-publisher publish` on release tags.
