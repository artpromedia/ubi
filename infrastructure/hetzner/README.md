# UBI Hetzner Deployment Guide

This directory contains all the configuration files needed to deploy UBI on a Hetzner Cloud server.

## Quick Start

### 1. Server Setup

1. **Create a Hetzner Cloud Server**
   - Recommended: CX41 (8 vCPU, 16GB RAM, 160GB SSD) - €29.50/month
   - Minimum: CX31 (4 vCPU, 8GB RAM, 80GB SSD) - €13.50/month
   - OS: Ubuntu 22.04 or 24.04 LTS
   - Location: Choose based on your users (Nuremberg, Falkenstein, Helsinki, or US locations)

2. **Run the setup script**

   ```bash
   # SSH into your server
   ssh root@your-server-ip

   # Download and run setup script
   curl -sSL https://raw.githubusercontent.com/your-org/ubi/main/infrastructure/hetzner/scripts/setup-server.sh | sudo bash
   ```

3. **Clone the repository**
   ```bash
   su - ubi
   git clone https://github.com/your-org/ubi.git /opt/ubi/app
   cd /opt/ubi/app/infrastructure/hetzner
   ```

### 2. Configuration

1. **Create environment file**

   ```bash
   cp .env.example .env
   nano .env
   ```

2. **Configure required variables**
   - `DOMAIN` - Your domain (e.g., `ubi.africa`)
   - `POSTGRES_PASSWORD` - Strong database password
   - `REDIS_PASSWORD` - Strong Redis password
   - `JWT_SECRET` - Generate with `openssl rand -base64 64`
   - `JWT_REFRESH_SECRET` - Generate with `openssl rand -base64 64`
   - `MINIO_ROOT_PASSWORD` - Strong MinIO password
   - `GRAFANA_ADMIN_PASSWORD` - Grafana admin password

3. **Configure DNS**
   Point these domains to your server IP:
   - `ubi.africa` → Server IP
   - `api.ubi.africa` → Server IP
   - `admin.ubi.africa` → Server IP
   - `grafana.ubi.africa` → Server IP (optional)
   - `storage.ubi.africa` → Server IP (optional)

### 3. Deployment

```bash
# Build and deploy
./scripts/deploy.sh build
./scripts/deploy.sh deploy

# Or for a full build and deploy:
./scripts/deploy.sh build && ./scripts/deploy.sh deploy
```

### 4. Verify Deployment

```bash
# Check service status
./scripts/deploy.sh status

# View logs
./scripts/deploy.sh logs

# Test endpoints
curl https://api.ubi.africa/health
curl https://ubi.africa
```

## Directory Structure

```
hetzner/
├── docker-compose.prod.yml    # Main production compose file
├── .env.example               # Environment template
├── init-db.sql                # Database initialization
├── README.md                  # This file
├── caddy/
│   └── Caddyfile              # Reverse proxy & SSL config
├── monitoring/
│   ├── prometheus.yml         # Metrics collection
│   ├── loki-config.yml        # Log aggregation
│   ├── promtail-config.yml    # Log shipping
│   └── alerts/
│       └── ubi-alerts.yml     # Alert rules
└── scripts/
    ├── setup-server.sh        # Initial server setup
    └── deploy.sh              # Deployment tool
```

## Commands Reference

```bash
# Build images
./scripts/deploy.sh build [tag]

# Deploy (includes backup + migrate + start)
./scripts/deploy.sh deploy [tag]

# View status
./scripts/deploy.sh status

# View logs (all or specific service)
./scripts/deploy.sh logs [service-name]

# Create database backup
./scripts/deploy.sh backup [name]

# Restore from backup
./scripts/deploy.sh restore <backup-file>

# Run database migrations
./scripts/deploy.sh migrate

# Restart services
./scripts/deploy.sh restart [service-name]

# Stop all services
./scripts/deploy.sh stop

# Open shell in container
./scripts/deploy.sh shell [service-name]

# Rollback to previous version
./scripts/deploy.sh rollback [tag]
```

## Server Sizing Guide

| Instance | vCPU | RAM  | Storage | Monthly Cost | Recommended For                 |
| -------- | ---- | ---- | ------- | ------------ | ------------------------------- |
| CX21     | 2    | 4GB  | 40GB    | €6.90        | Development/Testing             |
| CX31     | 4    | 8GB  | 80GB    | €13.50       | Small Production (<1K users)    |
| CX41     | 8    | 16GB | 160GB   | €29.50       | Medium Production (1-10K users) |
| CX51     | 16   | 32GB | 320GB   | €59.20       | Large Production (10-50K users) |

## Resource Allocation

Default memory limits in docker-compose.prod.yml:

| Service               | Memory Limit | Memory Reserve |
| --------------------- | ------------ | -------------- |
| PostgreSQL            | 2GB          | 512MB          |
| Redis                 | 768MB        | 128MB          |
| API Gateway           | 512MB        | 128MB          |
| User Service          | 384MB        | 96MB           |
| Ride Service (Go)     | 256MB        | 64MB           |
| Food Service          | 384MB        | 96MB           |
| Delivery Service (Go) | 256MB        | 64MB           |
| Payment Service       | 384MB        | 96MB           |
| Notification Service  | 384MB        | 96MB           |
| Web App               | 512MB        | 128MB          |
| Admin Dashboard       | 512MB        | 128MB          |
| MinIO                 | 512MB        | 128MB          |
| Prometheus            | 512MB        | 128MB          |
| Grafana               | 256MB        | 64MB           |
| Loki                  | 256MB        | 64MB           |
| Promtail              | 128MB        | 32MB           |
| Caddy                 | 128MB        | 32MB           |

**Total: ~8GB minimum**

## Backup Strategy

### Automatic Backups

1. **Database**: Daily backup via cron

   ```bash
   # Add to crontab (crontab -e)
   0 2 * * * /opt/ubi/app/infrastructure/hetzner/scripts/deploy.sh backup daily-$(date +\%Y\%m\%d)
   ```

2. **Hetzner Volume Snapshots**: Weekly via Hetzner API or console

3. **Off-site Backup**: Sync to S3-compatible storage
   ```bash
   # Sync backups to external storage
   aws s3 sync /opt/ubi/backups s3://ubi-backups/hetzner/
   ```

### Backup Retention

- Keep last 10 daily backups (configurable in deploy.sh)
- Recommended: Also keep weekly/monthly backups off-site

## Monitoring

### Grafana Dashboards

Access at: `https://grafana.ubi.africa`

Pre-configured dashboards:

- System Overview (CPU, Memory, Disk)
- Service Health (Request rates, Latencies)
- Database (Connections, Query times)
- Redis (Memory, Connections)

### Alerting

Configure alert notifications in Grafana:

1. Go to Alerting → Contact Points
2. Add Slack/Email/PagerDuty etc.
3. Configure notification policies

## Scaling

### Vertical Scaling

Simply upgrade your Hetzner instance:

```bash
# Stop services
./scripts/deploy.sh stop

# Resize via Hetzner Console

# Start services
./scripts/deploy.sh deploy
```

### Horizontal Scaling

For larger deployments, consider:

1. Separate database server (Hetzner Managed PostgreSQL)
2. Separate Redis server (Hetzner doesn't offer managed Redis, use self-hosted)
3. Load balancer + multiple app servers
4. CDN for static assets (Cloudflare, BunnyCDN)

## Security Checklist

- [ ] Change all default passwords in `.env`
- [ ] Configure SSH key-only authentication
- [ ] Enable UFW firewall (done in setup script)
- [ ] Enable Fail2Ban (done in setup script)
- [ ] Configure Hetzner Firewall as additional layer
- [ ] Set up regular security updates
- [ ] Enable 2FA for Hetzner account
- [ ] Restrict admin dashboard access (IP allowlist or VPN)
- [ ] Review Caddy security headers
- [ ] Enable audit logging

## Troubleshooting

### Services Won't Start

```bash
# Check Docker status
systemctl status docker

# Check container logs
docker logs ubi-api-gateway

# Check for port conflicts
netstat -tulpn | grep LISTEN
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker compose -f docker-compose.prod.yml ps postgres

# Check database logs
docker logs ubi-postgres

# Test connection
docker compose -f docker-compose.prod.yml exec postgres psql -U ubi -d ubi_production
```

### SSL Certificate Issues

```bash
# Check Caddy logs
docker logs ubi-caddy

# Verify DNS
dig ubi.africa
dig api.ubi.africa

# Force certificate renewal
docker compose -f docker-compose.prod.yml restart caddy
```

### High Memory Usage

```bash
# Check memory usage
free -h
docker stats --no-stream

# Reduce memory limits in docker-compose.prod.yml
# Increase swap if needed
```

## Support

For issues with this deployment configuration:

1. Check the troubleshooting section above
2. Review Docker and service logs
3. Open an issue on the GitHub repository
