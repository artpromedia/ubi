# UBI Admin Dashboard - Production Dockerfile
# Multi-stage build. The build context is the REPOSITORY ROOT:
#
#   docker build -f apps/admin-dashboard/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
#
# infrastructure/hetzner/docker-compose.prod.yml has always referenced this
# file; until round 9 it did not exist, so `docker compose build` failed at
# admin-dashboard. Same shape as apps/web-app/Dockerfile.
#
# THE WORKSPACE CLOSURE. The app imports @ubi/api-client, @ubi/ui and
# @ubi/utils (next.config.mjs transpiles them from their built entry points,
# so each is built first); it builds against @ubi/typescript-config and
# @ubi/eslint-config. tailwind.config.ts imports @ubi/ui/tailwind.config and
# scans packages/ui/src, so both are present at `next build`.
#
# next.config.mjs does not set `output: "standalone"`, so the production
# stage runs `next start` over the builder's pruned node_modules.
# NEXT_PUBLIC_* values are inlined at BUILD time (build argument).

# ===========================================
# Build Stage
# ===========================================
FROM node:20-alpine AS builder

# pnpm, pinned to the repository's packageManager version.
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

WORKDIR /app

# Workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# The workspace manifests of the app and its whole workspace dependency
# closure (keep in step with apps/admin-dashboard/package.json).
COPY apps/admin-dashboard/package.json ./apps/admin-dashboard/
COPY packages/api/package.json ./packages/api/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/ui/package.json ./packages/ui/
COPY packages/utils/package.json ./packages/utils/

# Install the closure only (the lockfile is the whole monorepo's).
RUN pnpm install --frozen-lockfile --filter "@ubi/admin-dashboard..."

# Sources — named file by file (the repository root has no .dockerignore).
COPY packages/typescript-config/*.json ./packages/typescript-config/
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json packages/api/tsup.config.ts ./packages/api/
COPY packages/ui/src ./packages/ui/src
COPY packages/ui/tsconfig.json packages/ui/tsup.config.ts packages/ui/tailwind.config.ts ./packages/ui/
COPY packages/utils/src ./packages/utils/src
COPY packages/utils/tsconfig.json packages/utils/tsup.config.ts ./packages/utils/
COPY apps/admin-dashboard/src ./apps/admin-dashboard/src
COPY apps/admin-dashboard/next.config.mjs apps/admin-dashboard/next-env.d.ts apps/admin-dashboard/tsconfig.json apps/admin-dashboard/tailwind.config.ts ./apps/admin-dashboard/

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Build the workspace packages, then the app (`next build`), in dependency
# order.
RUN pnpm --filter "@ubi/admin-dashboard..." run build

# Unlink devDependencies (see services/notification-service/Dockerfile for
# why the purge is pre-confirmed and lifecycle scripts are skipped).
RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
      --config.confirmModulesPurge=false --filter "@ubi/admin-dashboard..."

# ===========================================
# Production Stage
# ===========================================
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

# Each runtime workspace package: its manifest, its build and its (symlinked)
# node_modules.
COPY --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --from=builder /app/packages/api/dist ./packages/api/dist
COPY --from=builder /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=builder /app/packages/ui/package.json ./packages/ui/package.json
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist
COPY --from=builder /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/utils/node_modules ./packages/utils/node_modules
COPY --from=builder /app/apps/admin-dashboard/package.json ./apps/admin-dashboard/package.json
COPY --from=builder /app/apps/admin-dashboard/next.config.mjs ./apps/admin-dashboard/next.config.mjs
COPY --from=builder /app/apps/admin-dashboard/.next ./apps/admin-dashboard/.next
COPY --from=builder /app/apps/admin-dashboard/node_modules ./apps/admin-dashboard/node_modules

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app/apps/admin-dashboard

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Health check: the login page (`/` is a redirect; there is no /api/health).
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/login" || exit 1

EXPOSE 3000

CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p \"${PORT:-3000}\""]
