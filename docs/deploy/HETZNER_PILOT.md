# Hetzner pilot — deployment model, runbook, failure domains

**This is the pilot deployment model.** `infrastructure/hetzner/` (single-host
Docker Compose) is what exists, is substantial, and is documented below as
the concrete path to a running pilot. It is **not** highly available, and
this document says so plainly rather than implying otherwise. See
"Reconciling the two deployment models" at the end for why the AWS/EKS
Terraform + ArgoCD tree is a separate, later track and must not be applied
against this pilot.

This closes `docs/launch/GAP_REGISTER.md` row **V01** to the extent a
runbook can: the pick of model, the concrete steps, the failure domains, and
the backup/restore procedure. It does **not** close V01's "measured
capacity" and "restore drill" requirements — those need a real server and a
real drill, which this pass could not run. Every number that is a target
rather than a measurement is labelled **estimate — pending measurement**.

## 1. What `infrastructure/hetzner/` already provides

| Path                                                                     | What it is                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.prod.yml`                                                | 17 services: Caddy, Postgres (PostGIS), Redis, 6 Node/Go backend services, web-app, admin-dashboard, MinIO, Prometheus, Grafana, Loki, Promtail. Per-service memory limits/reservations. Named volumes for every stateful service.                                   |
| `.env.example`                                                           | Every required and optional environment variable, with `CHANGE_ME_*` placeholders for secrets and empty defaults for optional provider keys.                                                                                                                         |
| `init-db.sql`                                                            | Extensions (`uuid-ossp`, `postgis`, `pg_trgm`, `btree_gist`) + grants; commented-out performance tuning and a commented-out readonly role.                                                                                                                           |
| `caddy/Caddyfile`                                                        | Automatic HTTPS (Let's Encrypt), per-host security headers, CORS preflight + rate limiting for the API host, WebSocket upgrade passthrough, health-checked reverse proxies to web-app/api-gateway/admin-dashboard/grafana/minio, per-host access logs with rotation. |
| `monitoring/{prometheus,loki,promtail}-config.yml`, `monitoring/alerts/` | Scrape/log-shipping config and alert rules, ready to load into the Prometheus/Loki/Grafana containers already in the compose file.                                                                                                                                   |
| `scripts/setup-server.sh`                                                | Fresh-Ubuntu server prep: Docker install, `ubi` user, UFW firewall (22/80/443 only), Fail2Ban, sysctl/file-descriptor tuning, 2GB swap, Docker log rotation, unattended security upgrades, `/opt/ubi/{data,backups,logs,config}` layout.                             |
| `scripts/deploy.sh`                                                      | `build`/`deploy`/`rollback`/`backup`/`restore`/`logs`/`status`/`stop`/`restart`/`migrate`/`shell` subcommands.                                                                                                                                                       |
| `README.md`                                                              | Quick start, CX-series sizing table, per-service memory allocation table, backup strategy sketch, scaling notes, security checklist, troubleshooting.                                                                                                                |

**Added this pass** (validated with `docker compose config`, not run
against a live daemon in this environment — no Docker daemon was available
here, only the CLI):

- A `migrate` one-off service (`profiles: ["tools"]`, so it never starts
  with `docker compose up -d`) that runs Prisma migrations from a full
  repository checkout instead of through `api-gateway`'s production image.
  See §4 "Migrations" for exactly why the existing `deploy.sh`
  `cmd_migrate`/`cmd_deploy` invocation is unreliable and what this replaces
  it with.

## 2. Verified issues in the existing scripts/config (found, not fixed where out of scope)

These are real, confirmed findings from reading the compose file, the
Dockerfiles it builds, and the Caddyfile together — recorded here because
an operator following the README as written would hit them:

1. **`deploy.sh`'s migration step is unreliable.** `cmd_migrate` and
   `cmd_deploy` both run
   `docker compose run --rm api-gateway sh -c "cd /app && npx prisma migrate deploy"`.
   `services/api-gateway/Dockerfile`'s production stage installs with
   `pnpm install --prod` (the `prisma` CLI is a devDependency of
   `@ubi/database`, so it is excluded from that image) and never `COPY`s
   `packages/database/prisma/**` (schema + migrations) into the image. The
   command has neither a `prisma` binary nor a schema to run against.
   `cmd_deploy` already anticipates this failing silently — its call site is
   `... || log_warn "Migration skipped or failed"` — meaning a real deploy
   following the script as-is can proceed to start services against a
   database that was never actually migrated, with only a warning logged.
   **Use the new `migrate` compose service (§4) instead.**
2. **`api-gateway`'s own Docker `HEALTHCHECK` targets the wrong port.**
   The Dockerfile's `HEALTHCHECK` hits `http://localhost:4000/health`
   (the app's hardcoded fallback port), but `docker-compose.prod.yml` sets
   `PORT: 3000` and only `expose`s `3000`. The container will report
   `unhealthy` in `docker ps` / `deploy.sh status` even when the service is
   working correctly — Caddy's own health check (`health_uri /health`
   against `api-gateway:3000`) is the one that reflects reality. **Do not
   trust `docker ps`'s health column for `api-gateway`**; use the readiness
   checks in §5 instead.
3. **Redis is not included in the automated off-host backup path.**
   `deploy.sh backup` triggers a Redis `BGSAVE` (writes the RDB snapshot
   inside the container's volume) but never copies that snapshot out of the
   `redis_data` volume or off the host. See §6.
4. **MinIO (object storage) has no backup step at all** in `deploy.sh`. See
   §6.
5. **`BACKUP_S3_BUCKET` in `.env.example` is not wired to anything.** No
   script reads it; the README's "off-site backup" section is a manual
   `aws s3 sync` command a human has to remember to run or cron themselves.
   §6 gives the concrete command.

None of 2–5 were fixed by editing the service Dockerfiles or app source
(out of this pass's writable scope: `.github/workflows/**`,
`infrastructure/**`, `k8s/**`, `docs/**`); they are worked around
operationally in this runbook (§4–§6) and should be fixed at the source
(Dockerfile / deploy.sh) as a follow-up.

## 3. Server prep

1. Provision a Hetzner Cloud server, Ubuntu 22.04/24.04 LTS. See §5 for
   sizing.
2. `ssh root@<server-ip>`, then run `infrastructure/hetzner/scripts/setup-server.sh`
   as root. This installs Docker, creates the `ubi` user (in the `docker`
   group), configures UFW (22/80/443 only) and Fail2Ban, tunes sysctl/file
   descriptor limits, adds 2GB swap, and lays out `/opt/ubi/{data,backups,logs,config}`.
3. SSH hardening (disable password auth, restrict root login) is **prepared
   but commented out** in the script — apply it manually after confirming
   key-based access works, per the script's own closing warning.
4. `su - ubi`, clone the repository to `/opt/ubi/app`.
5. Point DNS (`DOMAIN`, `api.$DOMAIN`, `admin.$DOMAIN`, and optionally
   `grafana.$DOMAIN` / `storage.$DOMAIN`) at the server's IP before bringing
   Caddy up — Caddy's automatic HTTPS needs the records to resolve to issue
   certificates.

## 4. Secrets, bring-up order, migrations

**Secret injection** is the existing `.env` mechanism — nothing new
invented: `cp .env.example .env`, fill in `POSTGRES_PASSWORD`,
`REDIS_PASSWORD`, `JWT_SECRET`/`JWT_REFRESH_SECRET` (`openssl rand -base64 64`
each), `MINIO_ROOT_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, and whichever
payment/notification provider keys the pilot city actually uses (leave the
rest blank — they default to `""` in the compose file and those integrations
simply stay off). `.env` must never be committed; it lives only on the host
at `infrastructure/hetzner/.env` (`docker compose` reads it relative to the
compose file).

**Bring-up order** (`docker compose -f docker-compose.prod.yml`, run from
`infrastructure/hetzner/`):

1. `docker compose build` (or `scripts/deploy.sh build`) — builds every
   service image from the full monorepo (`context: ../..`).
2. `docker compose up -d postgres redis minio` — bring up stateful services
   first and wait for them to report healthy (`docker compose ps`; Postgres
   and Redis both have real `healthcheck:` blocks; MinIO's hits
   `/minio/health/live`).
3. **Migrate** (see below) — before any backend service starts, not after.
4. `docker compose up -d` (remaining services; `--remove-orphans` on
   redeploys) — Caddy comes up last by nature of its `depends_on`.

**Migrations** — do **not** use `scripts/deploy.sh migrate` /
`cmd_deploy`'s built-in migration step (§2, finding 1). Use the `migrate`
compose service added this pass instead:

```
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

This mounts the full repository checkout (the same one `build` already
reads), installs the workspace with pnpm into scratch volumes
(`migrate_node_modules`, `migrate_pnpm_store` — never the host's own
`node_modules`), and runs `pnpm --filter @ubi/database exec prisma migrate deploy`
against the compose network's Postgres — the same command CI's `db-check`,
`unit-services` and `unit-go` jobs already run and verify. It is safe to
invoke on every deploy, including when there is nothing new to migrate
(`ci.yml`'s `db-check` job now proves a second, no-op invocation exits 0 —
see `docs/ops/CI_EVIDENCE.md`).

## 5. Health / readiness checks

Do not rely solely on `docker compose ps`'s health column (§2, finding 2).
Concrete checks, in bring-up order:

```
# Stateful services
docker compose exec postgres pg_isready -U ubi -d ubi_production
docker compose exec redis redis-cli -a "$REDIS_PASSWORD" ping
curl -f http://127.0.0.1:9000/minio/health/live

# Backend services (via Caddy, the way real traffic reaches them)
curl -f https://api.$DOMAIN/health
curl -f https://$DOMAIN/api/health          # web-app
curl -f https://admin.$DOMAIN/api/health    # admin-dashboard

# TLS: confirm Caddy actually issued certificates (first bring-up can take
# a minute or two per host while it talks to Let's Encrypt)
docker compose logs caddy | grep -i "certificate obtained"
```

`scripts/deploy.sh status` additionally prints `docker compose ps`,
`docker stats --no-stream`, and `docker system df` in one shot — useful for
a human glance, but the `curl` checks above are the ones that reflect
whether the pilot is actually serving traffic.

## 6. Backup and restore

**Backup** (`scripts/deploy.sh backup [name]` today covers Postgres +
triggers a Redis `BGSAVE`; extend it operationally as follows until it is
fixed at the source):

- **Postgres**: `pg_dump | gzip` to `/opt/ubi/backups/ubi-<name>.sql.gz`
  (existing, works). Schedule daily via cron, as the README already
  documents (`0 2 * * * .../deploy.sh backup daily-$(date +\%Y\%m\%d)`).
- **Redis**: the existing `BGSAVE` only writes the RDB file inside the
  `redis_data` _volume_ — copy it out and off-host too:
  `docker compose cp redis:/data/dump.rdb /opt/ubi/backups/redis-<name>.rdb`
  right after triggering `BGSAVE`.
- **MinIO**: not automated anywhere today. Use MinIO's own client
  (`mc mirror`) against the running server, or snapshot the `minio_data`
  volume directly: `docker run --rm -v hetzner_minio_data:/data -v /opt/ubi/backups:/backup alpine tar czf /backup/minio-<name>.tar.gz -C /data .`
- **Off-host, encrypted**: none of the above leaves the host by default
  (`BACKUP_S3_BUCKET` in `.env.example` is unwired — §2, finding 5). Encrypt
  and sync after each backup runs:
  ```
  gpg --symmetric --cipher-algo AES256 -o ubi-<name>.sql.gz.gpg ubi-<name>.sql.gz
  aws s3 cp ubi-<name>.sql.gz.gpg s3://$BACKUP_S3_BUCKET/postgres/
  # repeat for the redis .rdb and minio .tar.gz artifacts
  ```
  This needs an S3-compatible bucket and credentials that are **not**
  provisioned anywhere in this repo — an external dependency to set up
  before the pilot goes live with real user data.

**Restore to a clean environment** (the actual drill, not yet run):

1. Provision a clean host per §3 (or reuse a torn-down pilot host).
2. `scripts/setup-server.sh`, clone the repo, `.env` restored from the
   secrets manager (never from the encrypted backup bundle itself).
3. Fetch and decrypt the target backup set from the off-host store:
   `aws s3 cp ... | gpg --decrypt > ubi-<name>.sql.gz`.
4. `docker compose up -d postgres redis minio` and wait for healthy.
5. `gunzip -c ubi-<name>.sql.gz | docker compose exec -T postgres psql -U ubi ubi_production`
   (existing `deploy.sh restore` does this for Postgres; extend it the same
   way for the Redis RDB file — stop `redis` first, replace
   `/data/dump.rdb` in the volume, restart — and for MinIO — stop `minio`,
   restore the `minio_data` volume contents, restart).
6. `--profile tools run --rm migrate` (§4) to bring the schema to the
   checked-out code's expected version if the backup predates it.
7. Bring up the remaining services (§4 step 4) and re-run every check in
   §5 against the restored environment.
8. Record wall-clock time for steps 3–7 separately (data-transfer/decrypt
   time vs. actual restore time) — that is the RTO measurement.

**RPO / RTO: measure-and-fill, not invented.** RPO is bounded below by the
backup cadence (daily cron in the README's example ⇒ RPO ≤ 24h _if_ the cron
job is actually installed and the off-host sync in this section is actually
wired up — neither is verified running anywhere yet). RTO is whatever step
8 above measures on a real drill. **Both are blank until that drill runs
once; this document does not put a number here because no number here has
been measured.** The drill itself is the closing dependency for
`GAP_REGISTER.md` V01's "restore drill with measured RPO/RTO" clause and for
`docs/ops/RELEASE_CHECKLIST.md`'s "restore-drill output" line.

## 7. Failure-domain statement

**Single host = single point of failure. This is not a highly-available
deployment**, and the pilot should be described to participants as such
(the smallest-pilot section of `GAP_REGISTER.md` already lists "single-host
deployment (documented failure domain)" as a known limitation). The blast
radius of losing the one host: every stateful service (Postgres, Redis,
MinIO), every backend service, both web frontends, and all monitoring —
i.e. the entire pilot — goes down at once, and any data not in an off-host
backup (§6) is lost with the host. There is no failover; recovery is the
restore procedure in §6, run on a new host, bounded by whatever RPO/RTO the
drill measures.

### Named incidents and the operator action for each

| Incident                                                                     | Operator action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hetzner provider outage**                                                  | Nothing to fail over to on this model — wait for the provider, or stand up a fresh host in a different Hetzner location from the last off-host backup (§6 restore) if the outage is prolonged. This is the single-host trade-off stated above, not a bug to route around.                                                                                                                                                                                                                                                                          |
| **Redis failure/crash**                                                      | `docker compose restart redis`. `redis_data` is a durable named volume (`--appendonly yes` is set), so an in-place container crash does not lose data; only host-volume loss does. Services that depend on Redis for session/cache/rate-limit state degrade or 5xx until it's back — check `docker compose logs` for the dependent services and restart them if they didn't reconnect on their own.                                                                                                                                                |
| **A backend service (worker) crash**                                         | `restart: unless-stopped` on every service already restarts it automatically. If it crash-loops, `docker compose logs <service>` first; `docker compose exec <service> sh` (or `deploy.sh shell <service>`) to inspect. Check `mp.awards`/`mp.reservation_recovery` per `docs/marketplace/RUNBOOK.md` if the crashed service was ride-service or payment-service, since those sagas are designed to converge via their own sweeps once the service is back, not to be hand-fixed.                                                                  |
| **Host loss (disk/VM destroyed)**                                            | Full restore per §6 onto a new host. Everything not in the last off-host backup is gone — this is why §6's off-host sync is not optional for anything holding real user data.                                                                                                                                                                                                                                                                                                                                                                      |
| **Delayed/backed-up events (outbox, marketplace sweep, notification queue)** | Check the specific backlog per `docs/marketplace/RUNBOOK.md`'s health signals (`mp.awards` age in `pending`, `mp.reservation_recovery` backlog, `mp.driver_claims` in `next` past their terminal window) — these are designed to self-converge once the blocking dependency (usually payment-service or Redis) is healthy again. Do not hand-edit ledger/award state directly; use the named remedy endpoints (`/v1/finance/remedies`, the award cancel path, `/v1/admin/mp/repairs/stranded-rides`) exactly as the marketplace runbook specifies. |

## 8. Resource sizing

The existing README's CX-series table (reproduced here for one-stop
reference) is the starting point, **not a measured capacity claim**:

| Instance | vCPU | RAM  | Storage | Recommended for (README's own label)                                |
| -------- | ---- | ---- | ------- | ------------------------------------------------------------------- |
| CX21     | 2    | 4GB  | 40GB    | Development/testing                                                 |
| CX31     | 4    | 8GB  | 80GB    | Small production (< 1K users) — **estimate, pending measurement**   |
| CX41     | 8    | 16GB | 160GB   | Medium production (1–10K users) — **estimate, pending measurement** |
| CX51     | 16   | 32GB | 320GB   | Large production (10–50K users) — **estimate, pending measurement** |

The per-service memory limits in `docker-compose.prod.yml` sum to roughly
8GB at their configured ceilings (README's own total), which is why CX41
(16GB) is the practical floor for running the full stack with headroom for
the OS, Docker overhead, and burst traffic — a **sizing-table inference**,
not a load-tested number. **No load test has been run against this stack in
this environment** (that is exactly the "no measured capacity" half of
`GAP_REGISTER.md` V01, and the same load-testing gap named in
`docs/ops/CI_EVIDENCE.md`). Do not promise a specific user-capacity number
to a pilot city until a load test (`docs/ops/RELEASE_CHECKLIST.md` names
this as an owner-set target) has actually been run against a CX41 (or
whichever size is chosen) and the result recorded here.

## 9. Reconciling the two deployment models

This repository contains two, unreconciled deployment trees:

- **`infrastructure/hetzner/`** — single-node Docker Compose. **This is the
  pilot.** It exists, is documented above, and is what this runbook
  targets.
- **`infrastructure/terraform/` (AWS/EKS) + `infrastructure/argocd/` +
  `infrastructure/kubernetes/`** — a Kubernetes track. `terraform/environments/`
  has only a `dev` directory (no `staging`/`prod`, despite
  `.github/workflows/infrastructure.yml` referencing both);
  `infrastructure/kubernetes/` has cluster-wide base policies
  (network policies, RBAC, resource quotas) plus a real manifest for exactly
  one service (`api-gateway`); `k8s/` at the repo root has two more service
  manifests (`location-service`, `realtime-gateway`) that aren't wired into
  either the Terraform or ArgoCD trees; `argocd/` has an app-of-apps plus
  two application definitions. None of this has ever been applied against a
  real EKS cluster from this repository's CI (`infrastructure.yml` only
  triggers on `push`/`pull_request` to `main`, and the repository's default
  branch is `master` — the note at the top of that workflow file already
  records that it has therefore never run). There is **no K3s anywhere** in
  the repository, despite that being referenced elsewhere as a candidate.

**Do not apply the AWS/EKS track against the pilot, and do not treat the
Hetzner Compose stack as a template for a Kubernetes rollout.** They are
separate, non-overlapping tracks: Hetzner Compose is the pilot's deployment
target now; AWS/EKS + ArgoCD is a later, separate scale-out track to pick up
if/when the pilot outgrows a single host, and it needs its own
staging/prod Terraform environments, a real cluster, and its own capacity
and failure-domain analysis before anyone points user traffic at it.
