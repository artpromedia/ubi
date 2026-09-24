#!/bin/bash
# UBI Deployment Script for Hetzner
# Handles building, deploying, and managing the UBI stack
#
# Usage:
#   ./deploy.sh [command] [options]
#
# Commands:
#   build      - Build all Docker images
#   preflight  - Check .env and the compose file before a deploy
#   deploy     - Deploy/update the stack
#   rollback   - Rollback to previous version
#   backup     - Create database backup
#   restore    - Restore from backup
#   logs       - View service logs
#   status     - Show stack status
#   stop       - Stop all services
#   restart    - Restart all services
#   migrate    - Run database migrations (the `migrate` compose service)

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="/opt/ubi"
COMPOSE_FILE="$SCRIPT_DIR/../docker-compose.prod.yml"
BACKUP_DIR="$DEPLOY_DIR/backups"
MAX_BACKUPS=10

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }

ENV_FILE="$SCRIPT_DIR/../.env"

# Every backend service the compose file builds (keep in step with
# docker-compose.prod.yml; `preflight` fails when the two disagree).
BUILD_SERVICES=(
    caddy
    api-gateway
    user-service
    ride-service
    food-service
    delivery-service
    payment-service
    notification-service
    config-service
    ask-service
    travel-service
    fleet-service
    growth-service
    support-service
    realtime-gateway
    web-app
    admin-dashboard
)

# Services that hold database connections (stopped around a restore).
DB_SERVICES=(
    api-gateway
    user-service
    ride-service
    food-service
    delivery-service
    payment-service
    notification-service
    config-service
    ask-service
    travel-service
    fleet-service
    growth-service
    support-service
)

# Read one variable from .env without evaluating the file: values such as a
# Firebase service-account JSON contain quotes and spaces that `export $(...
# | xargs)` used to mangle. docker compose reads .env itself; the script only
# needs the few values it uses directly.
#
# A key that is absent reads as empty. It must never fail: under `set -e
# -o pipefail` a grep that matches nothing would otherwise end the whole
# script silently at the assignment (e.g. a valid .env that leaves
# POSTGRES_USER to its compose default). One pair of surrounding quotes is
# removed, as docker compose does when it reads .env.
env_value() {
    local key="$1" value
    value="$( { grep -E "^${key}=" "$ENV_FILE" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-)"
    case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    printf '%s' "$value"
}

# Load environment
load_env() {
    if [ -f "$ENV_FILE" ]; then
        POSTGRES_USER="$(env_value POSTGRES_USER)"
        POSTGRES_DB="$(env_value POSTGRES_DB)"
        REDIS_PASSWORD="$(env_value REDIS_PASSWORD)"
        export POSTGRES_USER POSTGRES_DB REDIS_PASSWORD
        log_info "Environment loaded from .env"
    else
        log_error ".env file not found. Copy .env.example to .env and configure."
        exit 1
    fi
}

# =============================================================================
# PREFLIGHT COMMAND
# =============================================================================
# Refuses a deploy that would boot on placeholders. Checks, without a running
# stack: the compose file interpolates (every `${VAR:?}` is set), no value
# still reads CHANGE_ME, every required secret is at least 32 characters, the
# trust-boundary secrets are pairwise distinct, and BUILD_SERVICES matches the
# compose file. See docs/ops/DEPLOY_ENV_MATRIX.md.

REQUIRED_SECRETS=(
    JWT_SECRET
    JWT_REFRESH_SECRET
    UBI_IDENTITY_SECRET
    RIDE_INTERNAL_CONTEXT_SECRET
    INTERNAL_SERVICE_KEY
    RIDE_QUOTE_SIGNING_SECRET
    RIDE_PIN_VAULT_SECRET
    DRIVER_PROFILE_RIDE_SERVICE_KEY
    AI_GRANTS_SERVICE_KEY
    TRAVEL_ASK_SERVICE_KEY
    FLEET_SERVICE_KEY
    FLEET_RIDE_SERVICE_KEY
    FLEET_PAYMENT_SERVICE_KEY
)

cmd_preflight() {
    local failed=0

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found. Copy .env.example to .env and configure."
        exit 1
    fi

    log_step "Checking the compose file interpolates with .env..."
    if ! docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --quiet; then
        log_error "docker compose config failed (a required variable is unset?)"
        failed=1
    fi

    log_step "Checking .env for placeholders and weak secrets..."
    if grep -nE '^[A-Z0-9_]+=.*CHANGE_ME' "$ENV_FILE"; then
        log_error "the lines above still carry a CHANGE_ME placeholder"
        failed=1
    fi
    local name value
    for name in "${REQUIRED_SECRETS[@]}"; do
        value="$(env_value "$name")"
        if [ "${#value}" -lt 32 ]; then
            log_error "$name must be set to at least 32 characters (openssl rand -base64 48)"
            failed=1
        fi
    done
    local a b
    for a in JWT_SECRET UBI_IDENTITY_SECRET RIDE_INTERNAL_CONTEXT_SECRET INTERNAL_SERVICE_KEY RIDE_PIN_VAULT_SECRET; do
        for b in JWT_SECRET UBI_IDENTITY_SECRET RIDE_INTERNAL_CONTEXT_SECRET INTERNAL_SERVICE_KEY RIDE_PIN_VAULT_SECRET; do
            if [ "$a" \< "$b" ] && [ -n "$(env_value "$a")" ] && [ "$(env_value "$a")" = "$(env_value "$b")" ]; then
                log_error "$a and $b must not share a value"
                failed=1
            fi
        done
    done
    if [ -z "$(env_value PROOF_STORAGE_ACCESS_KEY)" ]; then
        log_warn "PROOF_STORAGE_ACCESS_KEY is empty: delivery custody proofs are refused and delivery-service stays not-ready (fine only while marketplace delivery is unused)"
    fi

    log_step "Checking the build list against the compose file..."
    local built
    built="$( { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config --format json 2>/dev/null || true; } \
        | { grep -o '"dockerfile": *"[^"]*"' || true; } | wc -l | tr -d ' ')"
    if [ "$built" != "${#BUILD_SERVICES[@]}" ]; then
        log_error "compose builds $built images but BUILD_SERVICES lists ${#BUILD_SERVICES[@]}"
        failed=1
    fi

    if [ "$failed" -ne 0 ]; then
        log_error "Preflight failed: fix .env before deploying"
        exit 1
    fi
    log_info "Preflight passed"
}

# =============================================================================
# BUILD COMMAND
# =============================================================================

cmd_build() {
    log_step "Building Docker images..."
    
    local tag="${1:-latest}"
    export IMAGE_TAG="$tag"
    
    cd "$PROJECT_ROOT"
    
    # Build all services
    docker compose -f "$COMPOSE_FILE" build --parallel "${BUILD_SERVICES[@]}"

    log_info "Build complete with tag: $tag"
}

# =============================================================================
# DEPLOY COMMAND
# =============================================================================

cmd_deploy() {
    load_env

    local tag="${1:-latest}"
    export IMAGE_TAG="$tag"

    # Refuse to deploy on placeholders or an incomplete .env.
    cmd_preflight

    log_step "Starting deployment..."

    # Create backup before deploy
    log_info "Creating pre-deployment backup..."
    cmd_backup "pre-deploy-$(date +%Y%m%d-%H%M%S)" || true

    # Pull latest images (if using registry)
    # docker compose -f "$COMPOSE_FILE" pull

    # Run database migrations. A failed migration STOPS the deploy: services
    # must never start against a schema they were not built for. (This used
    # to run prisma inside the api-gateway image, which carries neither the
    # prisma CLI nor the migrations, and only warned when that failed.)
    log_step "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" up -d postgres
    docker compose -f "$COMPOSE_FILE" --profile tools run --rm migrate

    # Deploy with zero-downtime
    log_step "Deploying services..."
    docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
    
    # Wait for health checks
    log_step "Waiting for services to be healthy..."
    sleep 30
    
    # Verify deployment
    cmd_status
    
    # Cleanup old images
    log_info "Cleaning up old images..."
    docker image prune -f --filter "until=24h"
    
    log_info "Deployment complete!"
}

# =============================================================================
# ROLLBACK COMMAND
# =============================================================================

cmd_rollback() {
    load_env
    
    local tag="${1:-previous}"
    
    log_step "Rolling back to: $tag"
    
    if [ "$tag" == "previous" ]; then
        # Find previous backup
        local latest_backup=$(ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1)
        if [ -z "$latest_backup" ]; then
            log_error "No backup found for rollback"
            exit 1
        fi
        log_info "Found backup: $latest_backup"
    fi
    
    export IMAGE_TAG="$tag"
    docker compose -f "$COMPOSE_FILE" up -d
    
    log_info "Rollback complete"
}

# =============================================================================
# BACKUP COMMAND
# =============================================================================

cmd_backup() {
    load_env
    
    local backup_name="${1:-$(date +%Y%m%d-%H%M%S)}"
    local backup_file="$BACKUP_DIR/ubi-$backup_name.sql.gz"
    
    mkdir -p "$BACKUP_DIR"
    
    log_step "Creating database backup: $backup_file"
    
    # PostgreSQL backup
    docker compose -f "$COMPOSE_FILE" exec -T postgres \
        pg_dump -U "${POSTGRES_USER:-ubi}" "${POSTGRES_DB:-ubi_production}" \
        | gzip > "$backup_file"
    
    # Get backup size
    local size=$(du -h "$backup_file" | cut -f1)
    log_info "Backup created: $backup_file ($size)"
    
    # Cleanup old backups
    log_info "Cleaning up old backups (keeping last $MAX_BACKUPS)..."
    ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
    
    # Also backup Redis (optional)
    log_info "Triggering Redis save..."
    docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli -a "${REDIS_PASSWORD}" BGSAVE || true
}

# =============================================================================
# RESTORE COMMAND
# =============================================================================

cmd_restore() {
    load_env
    
    local backup_file="${1:-}"
    
    if [ -z "$backup_file" ]; then
        log_info "Available backups:"
        ls -la "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "No backups found"
        log_error "Usage: ./deploy.sh restore <backup-file>"
        exit 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        # Try with backup dir prefix
        backup_file="$BACKUP_DIR/$backup_file"
        if [ ! -f "$backup_file" ]; then
            log_error "Backup file not found: $backup_file"
            exit 1
        fi
    fi
    
    log_warn "This will overwrite the current database. Continue? (y/N)"
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    log_step "Restoring from: $backup_file"
    
    # Stop services that use the database
    docker compose -f "$COMPOSE_FILE" stop "${DB_SERVICES[@]}"
    
    # Restore
    gunzip -c "$backup_file" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
        psql -U "${POSTGRES_USER:-ubi}" "${POSTGRES_DB:-ubi_production}"
    
    # Restart services
    docker compose -f "$COMPOSE_FILE" up -d
    
    log_info "Restore complete"
}

# =============================================================================
# LOGS COMMAND
# =============================================================================

cmd_logs() {
    local service="${1:-}"
    
    if [ -z "$service" ]; then
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100
    else
        docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
    fi
}

# =============================================================================
# STATUS COMMAND
# =============================================================================

cmd_status() {
    echo ""
    echo "=============================================="
    echo "           UBI Stack Status"
    echo "=============================================="
    echo ""
    
    docker compose -f "$COMPOSE_FILE" ps
    
    echo ""
    echo "=============================================="
    echo "           Resource Usage"
    echo "=============================================="
    echo ""
    
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    
    echo ""
    echo "=============================================="
    echo "           Disk Usage"
    echo "=============================================="
    echo ""
    
    docker system df
}

# =============================================================================
# STOP COMMAND
# =============================================================================

cmd_stop() {
    log_step "Stopping all services..."
    docker compose -f "$COMPOSE_FILE" stop
    log_info "All services stopped"
}

# =============================================================================
# RESTART COMMAND
# =============================================================================

cmd_restart() {
    local service="${1:-}"
    
    if [ -z "$service" ]; then
        log_step "Restarting all services..."
        docker compose -f "$COMPOSE_FILE" restart
    else
        log_step "Restarting $service..."
        docker compose -f "$COMPOSE_FILE" restart "$service"
    fi
    
    log_info "Restart complete"
}

# =============================================================================
# MIGRATE COMMAND
# =============================================================================

cmd_migrate() {
    load_env
    
    log_step "Running database migrations..."

    # The one-off `migrate` service runs prisma from the repository checkout
    # (docker-compose.prod.yml, profile "tools").
    docker compose -f "$COMPOSE_FILE" --profile tools run --rm migrate

    log_info "Migrations complete"
}

# =============================================================================
# SHELL COMMAND
# =============================================================================

cmd_shell() {
    local service="${1:-api-gateway}"
    
    log_info "Opening shell in $service..."
    docker compose -f "$COMPOSE_FILE" exec "$service" sh
}

# =============================================================================
# MAIN
# =============================================================================

show_help() {
    echo "UBI Deployment Tool"
    echo ""
    echo "Usage: ./deploy.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  build [tag]       Build Docker images"
    echo "  preflight         Check .env and the compose file (no stack needed)"
    echo "  deploy [tag]      Deploy/update the stack"
    echo "  rollback [tag]    Rollback to previous version"
    echo "  backup [name]     Create database backup"
    echo "  restore <file>    Restore from backup"
    echo "  logs [service]    View service logs"
    echo "  status            Show stack status"
    echo "  stop              Stop all services"
    echo "  restart [service] Restart services"
    echo "  migrate           Run database migrations"
    echo "  shell [service]   Open shell in container"
    echo ""
}

main() {
    local command="${1:-help}"
    shift || true
    
    case "$command" in
        build)    cmd_build "$@" ;;
        preflight) cmd_preflight "$@" ;;
        deploy)   cmd_deploy "$@" ;;
        rollback) cmd_rollback "$@" ;;
        backup)   cmd_backup "$@" ;;
        restore)  cmd_restore "$@" ;;
        logs)     cmd_logs "$@" ;;
        status)   cmd_status "$@" ;;
        stop)     cmd_stop "$@" ;;
        restart)  cmd_restart "$@" ;;
        migrate)  cmd_migrate "$@" ;;
        shell)    cmd_shell "$@" ;;
        help|--help|-h) show_help ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
