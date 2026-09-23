# UBI Notification Service - Production Dockerfile
# Multi-stage build. The build context is the REPOSITORY ROOT:
#
#   docker build -f services/notification-service/Dockerfile .
#
# (infrastructure/hetzner/docker-compose.prod.yml builds it with
# `context: ../..`.)
#
# THE WORKSPACE CLOSURE. The service imports workspace packages at runtime —
# @ubi/contracts (the event envelope, flags), @ubi/outbox (the durable outbox
# consumer every push / trip-link SMS consumer is built on), @ubi/database,
# @ubi/logger, @ubi/utils — and builds against @ubi/typescript-config (every
# tsconfig extends it) and @ubi/eslint-config (a workspace devDependency the
# install must be able to link). The previous version of this file copied
# neither packages/contracts nor packages/outbox (nor the two config
# packages), so the workspace install could not link them and the image did
# not build. @ubi/contracts generates its state machines from the repository's
# contracts/state-machines.json at build time, so that file is copied too.
#
# THE PRISMA CLIENT is generated into pnpm's virtual store
# (node_modules/.pnpm/@prisma+client@…/node_modules/.prisma), not into a root
# node_modules/.prisma, so the production stage takes the builder's pruned
# node_modules as a whole rather than reinstalling (a fresh `pnpm install
# --prod` would bring back an ungenerated client).

# ===========================================
# Build Stage
# ===========================================
FROM node:20-alpine AS builder

# Prisma's query engine needs OpenSSL 3; node:20-alpine already ships libssl3,
# which Prisma detects (it generates the linux-musl-openssl-3.0.x engine).

# pnpm, pinned to the repository's packageManager version.
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

WORKDIR /app

# Workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# The workspace manifests of the service and its whole workspace dependency
# closure (keep in step with services/notification-service/package.json and
# each listed package's own workspace dependencies).
COPY services/notification-service/package.json ./services/notification-service/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/logger/package.json ./packages/logger/
COPY packages/outbox/package.json ./packages/outbox/
COPY packages/utils/package.json ./packages/utils/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install the closure only (the lockfile is the whole monorepo's).
RUN pnpm install --frozen-lockfile --filter "@ubi/notification-service..."

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
COPY packages/logger/src ./packages/logger/src
COPY packages/logger/tsconfig.json packages/logger/tsup.config.ts ./packages/logger/
COPY packages/outbox/src ./packages/outbox/src
COPY packages/outbox/tsconfig.json packages/outbox/tsup.config.ts ./packages/outbox/
COPY packages/utils/src ./packages/utils/src
COPY packages/utils/tsconfig.json packages/utils/tsup.config.ts ./packages/utils/
COPY services/notification-service/src ./services/notification-service/src
COPY services/notification-service/tsconfig.json ./services/notification-service/

# Generate the Prisma client, then build every package of the closure in
# dependency order (contracts runs its codegen first).
RUN pnpm --filter @ubi/database exec prisma generate
RUN pnpm --filter "@ubi/notification-service..." run build

# Drop devDependencies from the installed tree; the generated client stays.
RUN pnpm install --prod --frozen-lockfile --offline --filter "@ubi/notification-service..."

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
COPY --from=builder /app/packages/logger/package.json ./packages/logger/package.json
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/packages/logger/node_modules ./packages/logger/node_modules
COPY --from=builder /app/packages/outbox/package.json ./packages/outbox/package.json
COPY --from=builder /app/packages/outbox/dist ./packages/outbox/dist
COPY --from=builder /app/packages/outbox/node_modules ./packages/outbox/node_modules
COPY --from=builder /app/packages/utils/package.json ./packages/utils/package.json
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/utils/node_modules ./packages/utils/node_modules
COPY --from=builder /app/services/notification-service/package.json ./services/notification-service/package.json
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist
COPY --from=builder /app/services/notification-service/node_modules ./services/notification-service/node_modules

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app/services/notification-service

ENV NODE_ENV=production

# Health check (the port the service listens on: PORT, default 4006)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4006}/health" || exit 1

EXPOSE 4006

CMD ["node", "dist/index.js"]
