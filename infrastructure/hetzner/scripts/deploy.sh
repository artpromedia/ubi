#!/bin/bash
# UBI Deployment Script for Hetzner
# Handles building, deploying, and managing the UBI stack
#
# Usage:
#   ./deploy.sh [command] [options]
#
# Commands:
#   build      - Build all Docker images
#   deploy     - Deploy/update the stack
#   rollback   - Rollback to previous version
#   backup     - Create database backup
#   restore    - Restore from backup
#   logs       - View service logs
#   status     - Show stack status
#   stop       - Stop all services
#   restart    - Restart all services

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

# Load environment
load_env() {
    if [ -f "$SCRIPT_DIR/../.env" ]; then
        export $(grep -v '^#' "$SCRIPT_DIR/../.env" | xargs)
        log_info "Environment loaded from .env"
    else
        log_error ".env file not found. Copy .env.example to .env and configure."
        exit 1
    fi
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
    docker compose -f "$COMPOSE_FILE" build --parallel \
        api-gateway \
        user-service \
        ride-service \
        food-service \
        delivery-service \
        payment-service \
        notification-service \
        web-app \
        admin-dashboard
    
    log_info "Build complete with tag: $tag"
}

# =============================================================================
# DEPLOY COMMAND
# =============================================================================

cmd_deploy() {
    load_env
    
    local tag="${1:-latest}"
    export IMAGE_TAG="$tag"
    
    log_step "Starting deployment..."
    
    # Create backup before deploy
    log_info "Creating pre-deployment backup..."
    cmd_backup "pre-deploy-$(date +%Y%m%d-%H%M%S)" || true
    
    # Pull latest images (if using registry)
    # docker compose -f "$COMPOSE_FILE" pull
    
    # Run database migrations
    log_step "Running database migrations..."
    docker compose -f "$COMPOSE_FILE" run --rm api-gateway \
        sh -c "cd /app && npx prisma migrate deploy" || log_warn "Migration skipped or failed"
    
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
    docker compose -f "$COMPOSE_FILE" stop api-gateway user-service ride-service food-service delivery-service payment-service notification-service
    
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
    
    docker compose -f "$COMPOSE_FILE" run --rm api-gateway \
        sh -c "cd /app && npx prisma migrate deploy"
    
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
