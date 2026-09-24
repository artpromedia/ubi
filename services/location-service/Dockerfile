# UBI Location Service - Dockerfile
# Go multi-stage build. The build context is the REPOSITORY ROOT, like every
# other service image (infrastructure/scripts/check-dockerfiles.mjs):
#
#   docker build -f services/location-service/Dockerfile .
#
# NOT part of the Hetzner pilot stack: location-service exposes an entirely
# unauthenticated internal API (docs/security/INTERNAL_IDENTITY.md) and
# docker-compose.prod.yml does not run it. The previous version of this file
# assumed the service directory was the context, built with cgo off although
# github.com/uber/h3-go is a cgo-only binding, and installed the binary in
# /root/, which the non-root user it then switched to cannot read.

# ===========================================
# Build Stage
# ===========================================
# Builder and runtime on the same Alpine release (3.22): a cgo binary links
# the builder's musl, which must not be newer than the runtime's.
FROM golang:1.23-alpine3.22 AS builder

# build-base: the C toolchain h3-go's cgo needs.
RUN apk add --no-cache git ca-certificates build-base

WORKDIR /src

COPY services/location-service/go.mod services/location-service/go.sum ./
RUN go mod download

COPY services/location-service/cmd ./cmd

# cgo on (h3-go); the binary links musl, which the alpine runtime provides.
ARG TARGETARCH
RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build \
    -trimpath -ldflags="-w -s" \
    -o /out/location-service \
    ./cmd/server

# ===========================================
# Production Stage
# ===========================================
FROM alpine:3.22 AS production

RUN apk add --no-cache ca-certificates wget

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /out/location-service /app/location-service

USER appuser

# Health check (the port the service listens on: PORT, default 4011)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-4011}/health" || exit 1

EXPOSE 4011

ENTRYPOINT ["/app/location-service"]
