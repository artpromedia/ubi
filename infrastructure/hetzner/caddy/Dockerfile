# UBI edge proxy: Caddy with the rate-limit plugin.
#
# caddy/Caddyfile rate-limits the API host with `rate_limit`, a directive
# stock Caddy does not have (`caddy:2-alpine` refuses the file: "unrecognized
# directive: rate_limit"), so the pilot's ingress never came up. This image is
# stock Caddy 2.8.4 plus github.com/mholt/caddy-ratelimit v0.1.0 — the exact
# pair the Caddyfile is validated against (`caddy validate`, see
# docs/ops/PILOT_RUNBOOK_DELTAS.md). Bump both together, and re-validate.

FROM caddy:2.8.4-builder-alpine AS builder

RUN xcaddy build v2.8.4 \
    --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2.8.4-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
