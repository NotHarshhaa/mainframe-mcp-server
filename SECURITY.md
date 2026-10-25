# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 2.5.x | ✅ |
| < 2.5 | ❌ — please upgrade |

## Reporting a vulnerability

Do **not** open a public GitHub issue for security problems.

Use GitHub's private vulnerability reporting:
**https://github.com/NotHarshhaa/mainframe-mcp-server/security/advisories/new**

Include what you found, how to reproduce it, and the impact you see.
You will get an acknowledgement within 5 business days and a fix or a
mitigation plan for anything confirmed.

## Scope and design assumptions

This server is a bridge between an MCP client and z/OSMF REST. The mainframe
always enforces the final authorization (RACF / SAF, z/OSMF roles). This
project adds guardrails **at the MCP server layer** and assumes:

- Credentials are supplied by the operator through the MCP client `env` block
  (ideally sourced from a vault), not committed to disk in this repository.
- The z/OSMF endpoint is reachable over TLS with certificate verification
  enabled (`ZOSMF_REJECT_UNAUTHORIZED=true`, the default).

### Out of scope

- Vulnerabilities in z/OSMF, CICS, Db2, or the Zowe SDK — report those to IBM
  or the Open Mainframe Project respectively.
- Compromised MCP client hosts: if the host running this server is compromised,
  its credentials are too.

## Hardening checklist

For production/enterprise use, see the Enterprise security section of the
README, and in particular:

- `SECURITY_READ_ONLY=true` (the default) unless writes are explicitly needed
- `SECURITY_ALLOWED_TOOLS` allowlist for least-privilege tool access
- `SECURITY_ALLOWED_DATASET_PATTERNS` / `SECURITY_ALLOWED_USS_PATHS` boundaries
- `SECURITY_AUDIT_LOGGING=true` (default) — JSON audit line per tool call on stderr
- Token auth (`ZOSMF_TOKEN`) over basic auth
- SSE transport (if used) behind an authenticated proxy
