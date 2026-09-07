# UBI Config Service - Production Dockerfile
# Multi-stage build, mirroring services/payment-service/Dockerfile.

# ===========================================
# Build Stage
# ===========================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Manifests for this service and everything it depends on
COPY services/config-service/package.json ./services/config-service/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --frozen-lockfile

COPY services/config-service ./services/config-service
COPY packages/contracts ./packages/contracts
COPY packages/logger ./packages/logger
COPY packages/database ./packages/database

RUN cd packages/database && pnpm prisma generate

RUN pnpm turbo run build --filter=@ubi/config-service...

# ===========================================
# Production Stage
# ===========================================
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

COPY services/config-service/package.json ./services/config-service/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/services/config-service/dist ./services/config-service/dist
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

WORKDIR /app/services/config-service

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3010/health || exit 1

EXPOSE 3010

# CONFIG_SEED_ENABLED is deliberately absent: the seed must never run here.
CMD ["node", "dist/index.js"]
