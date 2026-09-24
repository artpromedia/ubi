# UBI Realtime Gateway - Production Dockerfile
# Multi-stage build. The build context is the REPOSITORY ROOT:
#
#   docker build -f services/realtime-gateway/Dockerfile .
#
# (infrastructure/hetzner/docker-compose.prod.yml builds it with
# `context: ../..`.) Pattern: services/notification-service/Dockerfile.
#
# THE WORKSPACE CLOSURE. The gateway imports @ubi/contracts (the event
# envelope) and @ubi/outbox (subscribeOutbox), and @ubi/outbox in turn imports
# @ubi/database — so the Prisma client must be generated here too, even
# though the gateway itself never queries the database. It is an ES module
# built with plain `tsc` (not tsup). The previous version of this file copied
# only the service's own package.json against the whole-monorepo lockfile, so
# no workspace package could be linked and the image did not build.
#
# Its tsconfig extends @ubi/typescript-config, which its manifest does not
# declare: it resolves through the repository root's own devDependency, which
# a filtered install links too (pnpm always includes the root project), so it
# resolves in the image exactly as in a checkout.
#
# THE PRISMA CLIENT is generated into pnpm's virtual store, so the production
# stage takes the builder's pruned node_modules as a whole rather than
# reinstalling (a fresh `pnpm install --prod` would bring back an ungenerated
# client).

# ===========================================
# Build Stage
# ===========================================
FROM node:20-alpine AS builder

# pnpm, pinned to the repository's packageManager version.
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

WORKDIR /app

# Workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# The workspace manifests of the service and its whole workspace dependency
# closure (keep in step with services/realtime-gateway/package.json and each
# listed package's own workspace dependencies).
COPY services/realtime-gateway/package.json ./services/realtime-gateway/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/outbox/package.json ./packages/outbox/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install the closure only (the lockfile is the whole monorepo's).
RUN pnpm install --frozen-lockfile --filter "@ubi/realtime-gateway..."

# Sources — named file by file: the repository root has no .dockerignore, so
# copying a whole package directory would also copy the host's node_modules,
# dist and .turbo over the ones installed here.
COPY contracts/state-machines.json ./contracts/state-machines.json
COPY packages/typescript-config/*.json ./packages/typescript-config/
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/scripts ./packages/contracts/scripts
COPY packages/contracts/tsconfig.json packages/contracts/tsup.config.ts ./packages/contracts/
COPY packages/database/src ./packages/database/src
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/prisma.config.ts packages/database/tsconfig.json packages/database/tsup.config.ts ./packages/database/
COPY packages/outbox/src ./packages/outbox/src
COPY packages/outbox/tsconfig.json packages/outbox/tsup.config.ts ./packages/outbox/
COPY services/realtime-gateway/src ./services/realtime-gateway/src
COPY services/realtime-gateway/tsconfig.json ./services/realtime-gateway/

# Generate the Prisma client, then build every package of the closure in
# dependency order (contracts runs its codegen first).
RUN pnpm --filter @ubi/database exec prisma generate
RUN pnpm --filter "@ubi/realtime-gateway..." run build

# Unlink devDependencies from every package of the closure; the generated
# client stays (it lives in the virtual store, which this does not recreate).
# pnpm asks before recreating modules directories and, with no TTY, the
# question silently ends the step with nothing pruned — so the purge is
# pre-confirmed. Lifecycle scripts are skipped: the root `prepare` (husky)
# would fail once its devDependency is gone, and nothing needs to run again.
RUN pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
      --config.confirmModulesPurge=false --filter "@ubi/realtime-gateway..."

# ===========================================
# Production Stage
# ===========================================
FROM node:20-alpine AS production

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

# Each runtime workspace package: its manifest, its build and its (symlinked)
# node_modules.
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/packages/outbox/package.json ./packages/outbox/package.json
COPY --from=builder /app/packages/outbox/dist ./packages/outbox/dist
COPY --from=builder /app/packages/outbox/node_modules ./packages/outbox/node_modules
COPY --from=builder /app/services/realtime-gateway/package.json ./services/realtime-gateway/package.json
COPY --from=builder /app/services/realtime-gateway/dist ./services/realtime-gateway/dist
COPY --from=builder /app/services/realtime-gateway/node_modules ./services/realtime-gateway/node_modules

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app/services/realtime-gateway

ENV NODE_ENV=production

# Health check (the port the service listens on: PORT, default 4010)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4010}/health" || exit 1

EXPOSE 4010

CMD ["node", "dist/index.js"]
