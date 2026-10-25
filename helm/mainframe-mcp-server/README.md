# Helm chart — mainframe-mcp-server

Kubernetes deployment for `mainframe-mcp-server` (SSE transport), hardened by
default: non-root, read-only root filesystem, dropped capabilities, no
privilege escalation, and no service-account token mounted.

## Install

```bash
helm install mainframe-mcp ./helm/mainframe-mcp-server \
  --set zosmf.host=zosmf.example.com \
  --set zosmf.token="$ZOSMF_TOKEN" \
  --set security.readOnly=true \
  --set security.auditOtlpUrl=http://otel-collector.observability:4318
```

The chart deploys with `SECURITY_READ_ONLY=true` — write tools stay blocked
until you explicitly set `security.readOnly=false` (or a policy role grants
them).

## Policy file (RBAC / environments / classifications)

Provide the policy as a ConfigMap you manage:

```bash
kubectl create configmap mcp-policy --from-file=policy.yaml=config/policy.example.yaml
helm install mainframe-mcp ./helm/mainframe-mcp-server \
  --set zosmf.host=zosmf.example.com \
  --set zosmf.token="$ZOSMF_TOKEN" \
  --set policy.existingConfigMap=mcp-policy
```

…or inline in values (`policy.inline: |`), which the chart renders into a
ConfigMap and mounts at `/etc/mainframe-mcp/policy.yaml`
(`SECURITY_POLICY_FILE` is set automatically).

## Credentials

Secrets are never stored in values when you bring your own:

```bash
kubectl create secret generic mainframe-mcp-credentials \
  --from-literal=ZOSMF_HOST=zosmf.example.com \
  --from-literal=ZOSMF_TOKEN="$ZOSMF_TOKEN"
helm install mainframe-mcp ./helm/mainframe-mcp-server \
  --set credentials.create=false \
  --set credentials.existingSecret=mainframe-mcp-credentials
```

## Audit / SIEM

Prefer remote sinks in Kubernetes (`security.auditSplunkUrl` +
`security.auditSplunkToken`, `security.auditOtlpUrl`,
`security.auditWebhookUrl`). The file sink needs
`persistence.enabled=true` and `security.auditFile=/data/audit/audit.ndjson`.

## Verify the image signature

```bash
cosign verify ghcr.io/notharshhaa/mainframe-mcp-server:<tag> \
  --certificate-identity-regexp 'https://github.com/NotHarshhaa/mainframe-mcp-server/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Values

| Key | Default | Purpose |
|---|---|---|
| `zosmf.host` / `port` / `basePath` | — / 443 / — | z/OSMF connection |
| `zosmf.token` / `user` / `password` | — | Auth (token recommended) |
| `zosmf.userId` / `passticketApp` | — / ZOSMF | Per-user PassTicket identity |
| `security.readOnly` | `true` | Block write tools |
| `security.policyFile` / `policy.*` | — | Policy-as-code wiring |
| `security.audit*` | — | SIEM sinks |
| `credentials.create` / `existingSecret` | `true` / — | Secret management |
| `mcp.ssePort` / `logLevel` | 3000 / info | Server basics |
| `service.*` / `ingress.*` | ClusterIP / disabled | Exposure |
| `resources` | 100m/256Mi → 500m/512Mi | Workload sizing |
| `persistence.*` | disabled | File audit sink volume |
