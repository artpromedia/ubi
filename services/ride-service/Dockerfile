# UBI Ride Service - Production Dockerfile
# Go multi-stage build. The build context is the REPOSITORY ROOT:
#
#   docker build -f services/ride-service/Dockerfile .
#
# (infrastructure/hetzner/docker-compose.prod.yml builds it with
# `context: ../..`.) The previous version of this file assumed the service
# directory was the context (`COPY go.mod go.sum ./`, `COPY . .`), so under
# compose it could find neither, it pinned golang:1.21 while go.mod requires
# Go 1.24, and it built with CGO_ENABLED=0 although github.com/uber/h3-go
# (internal/eta, internal/surge) is a cgo binding with no pure-Go files, so
# the build stopped at "build constraints exclude all Go files". The module
# has no replace directives and no go.work, so the service directory alone is
# the whole build input.

# ===========================================
# Build Stage
# ===========================================
# The builder's Alpine release is pinned to the runtime stage's (3.22 both):
# this is a cgo binary linked against the builder's musl, and musl only
# promises that binaries built on an OLDER release run on a newer one. The
# floating golang:1.24-alpine tag moved to Alpine 3.23 while the runtime was
# alpine:3.19. Bump the two together.
FROM golang:1.24-alpine3.22 AS builder

# Install build dependencies (build-base: the C toolchain h3-go's cgo needs)
RUN apk add --no-cache git ca-certificates tzdata build-base

WORKDIR /src

# Module files first, so the download layer is cached across source edits.
COPY services/ride-service/go.mod services/ride-service/go.sum ./
RUN go mod download

# Source (schema.sql files are embedded with //go:embed and live under
# internal/, so they come with it).
COPY services/ride-service/cmd ./cmd
COPY services/ride-service/internal ./internal

# cgo on (h3-go). The binary links musl dynamically, which the alpine runtime
# stage provides. BuildKit sets TARGETARCH (amd64 for Hetzner CX/CPX, arm64
# for CAX); a cgo build runs natively for the builder's platform.
ARG TARGETARCH
RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build \
    -trimpath -ldflags="-w -s" \
    -o /out/ride-service \
    ./cmd/server

# ===========================================
# Production Stage
# ===========================================
FROM alpine:3.22 AS production

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata wget

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /out/ride-service /app/ride-service

USER appuser

# Health check: liveness on the port the service listens on (PORT, default
# 4002). /health/ready additionally answers 503 in production without the
# identity secret — the orchestrator's readiness signal, not a restart trigger.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4002}/health/live" || exit 1

EXPOSE 4002

ENTRYPOINT ["/app/ride-service"]
