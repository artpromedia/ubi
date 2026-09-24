# UBI Delivery Service - Production Dockerfile
# Go multi-stage build. The build context is the REPOSITORY ROOT:
#
#   docker build -f services/delivery-service/Dockerfile .
#
# (infrastructure/hetzner/docker-compose.prod.yml builds it with
# `context: ../..`.) The previous version of this file assumed the service
# directory was the context (`COPY go.mod go.sum ./`, `COPY . .`), so under
# compose it could find neither. The module has no replace directives and no
# go.work, so the service directory alone is the whole build input.

# ===========================================
# Build Stage
# ===========================================
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

# Module files first, so the download layer is cached across source edits.
COPY services/delivery-service/go.mod services/delivery-service/go.sum ./
RUN go mod download

COPY services/delivery-service/cmd ./cmd
COPY services/delivery-service/internal ./internal

# BuildKit sets TARGETARCH (amd64 for Hetzner CX/CPX, arm64 for CAX).
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build \
    -trimpath -ldflags="-w -s" \
    -o /out/delivery-service \
    ./cmd/server

# ===========================================
# Production Stage
# ===========================================
FROM alpine:3.19 AS production

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata wget

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /out/delivery-service /app/delivery-service

USER appuser

# Health check: liveness on the port the service listens on (PORT, default
# 4005 — compose runs it on 3004). /health/ready stays 503 in production until
# the proof store and the identity secret are configured.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4005}/health/live" || exit 1

EXPOSE 4005

ENTRYPOINT ["/app/delivery-service"]
