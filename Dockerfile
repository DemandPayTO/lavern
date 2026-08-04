# ── Stage 1: Build frontend ──────────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /app/viz
COPY viz/package*.json ./
RUN npm ci --ignore-scripts
COPY viz/ ./
ENV VITE_BASE_PATH=/dashboard/
# Frontend error monitoring. Pass at deploy time to bake the DSN into the
# build:  fly deploy --build-arg VITE_SENTRY_DSN=https://...@sentry.io/...
# Empty (the default) leaves Sentry a no-op — main.tsx only initializes when
# the DSN is present.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build

# ── Stage 2: Build API ──────────────────────────────────────────────────
FROM node:20-slim AS api-build

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
# TypeScript type-check (non-emit — we use tsx at runtime)
# RUN npx tsc --noEmit

# ── Stage 3: Runtime ────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install better-sqlite3 build deps (needed for native module)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production deps.
# `.npmrc` carries `legacy-peer-deps=true` so the zod@^4 / openai@^4 peer
# conflict resolves cleanly inside the container (same setting as local dev).
COPY package*.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source (we run TypeScript via tsx — no compile step needed)
COPY tsconfig.json ./
COPY src/ src/
# Operational scripts (firm-user provisioning, matter-number rename) run in
# the container against the mounted volume via `fly ssh console`.
COPY scripts/ scripts/
COPY SOUL.md ./

# Copy built frontend
COPY --from=frontend-build /app/viz/dist viz/dist

# Data directory for SQLite
RUN mkdir -p /app/data /app/audit-logs

# Environment defaults
ENV NODE_ENV=production
# Cap V8's heap. Without this Node sizes its heap from the HOST's memory and
# has no idea the container is smaller, so under a heavy request (parsing an
# uploaded document) it grows past the cgroup limit and the kernel OOM-kills
# the process. That takes the whole server down mid-request and surfaces to
# every connected user as a 502. With a cap, V8 collects instead, and the
# worst case is one failed request rather than a restart.
# Sized for the 1 GB machine set in fly.toml; keep the two in step.
ENV NODE_OPTIONS=--max-old-space-size=768
ENV SHEM_HOST=0.0.0.0
ENV SHEM_PORT=3000
ENV SHEM_DB_PATH=/app/data/lavern.db
ENV SHEM_AUDIT_DIR=/app/audit-logs
ENV SHEM_CORS_ORIGINS=*

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["npx", "tsx", "src/index.ts", "--serve"]
