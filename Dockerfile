# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
# Non-root, minimal runtime image. The node image ships the "node" user
# (uid 1000). All configuration arrives via environment variables, so the
# container can run with a read-only root filesystem — mount a writable
# volume for /tmp and for SECURITY_AUDIT_FILE when file-based audit sinks
# are enabled.
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="mainframe-mcp-server"
LABEL org.opencontainers.image.description="Enterprise MCP server for IBM z/OS — jobs, datasets, USS, CICS, Db2, console, schedulers, MQ — via Zowe SDK, with policy-as-code, RBAC, SIEM audit, and data protection."
LABEL org.opencontainers.image.source="https://github.com/NotHarshhaa/mainframe-mcp-server"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="notharshhaa"

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# SSE transport (default when containerized) serves HTTP on this port.
# stdio transport ignores it.
EXPOSE 3000

# Liveness/readiness for SSE deployments. stdio-only containers have no HTTP
# endpoint; the probe fails harmlessly and orchestrators should disable it
# (the Helm chart only renders probes for the SSE transport).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MCP_SSE_PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Never run as root: the node user owns /app.
USER node

ENTRYPOINT ["node", "dist/index.js"]
