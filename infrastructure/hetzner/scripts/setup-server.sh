#!/bin/bash
# UBI Hetzner Server Setup Script
# Run this script on a fresh Hetzner Cloud server (Ubuntu 22.04 or 24.04)
#
# Usage:
#   chmod +x setup-server.sh
#   sudo ./setup-server.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root"
   exit 1
fi

log_info "Starting UBI Hetzner server setup..."

# =============================================================================
# SYSTEM UPDATE & ESSENTIALS
# =============================================================================

log_info "Updating system packages..."
apt-get update && apt-get upgrade -y

log_info "Installing essential packages..."
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    htop \
    vim \
    git \
    unzip \
    wget \
    fail2ban \
    ufw \
    logrotate

# =============================================================================
# DOCKER INSTALLATION
# =============================================================================

log_info "Installing Docker..."

# Remove old Docker versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

log_info "Docker installed: $(docker --version)"

# =============================================================================
# CREATE UBI USER
# =============================================================================

log_info "Creating ubi user..."

if ! id "ubi" &>/dev/null; then
    useradd -m -s /bin/bash ubi
    usermod -aG docker ubi
    log_info "User 'ubi' created and added to docker group"
else
    log_warn "User 'ubi' already exists"
fi

# =============================================================================
# FIREWALL CONFIGURATION
# =============================================================================

log_info "Configuring firewall (UFW)..."

ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp comment 'SSH'

# HTTP/HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# Enable UFW
echo "y" | ufw enable

log_info "Firewall configured"

# =============================================================================
# FAIL2BAN CONFIGURATION
# =============================================================================

log_info "Configuring Fail2Ban..."

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
EOF

systemctl enable fail2ban
systemctl restart fail2ban

log_info "Fail2Ban configured"

# =============================================================================
# SYSCTL OPTIMIZATIONS
# =============================================================================

log_info "Applying system optimizations..."

cat > /etc/sysctl.d/99-ubi.conf << 'EOF'
# Network optimizations
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_keepalive_intvl = 15

# Memory optimizations
vm.swappiness = 10
vm.dirty_ratio = 60
vm.dirty_background_ratio = 2

# File system optimizations
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF

sysctl -p /etc/sysctl.d/99-ubi.conf

# Increase file descriptor limits
cat > /etc/security/limits.d/99-ubi.conf << 'EOF'
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

log_info "System optimizations applied"

# =============================================================================
# CREATE DIRECTORY STRUCTURE
# =============================================================================

log_info "Creating UBI directory structure..."

mkdir -p /opt/ubi/{data,backups,logs,config}
mkdir -p /opt/ubi/data/{postgres,redis,minio}
mkdir -p /opt/ubi/logs/{caddy,services}
mkdir -p /opt/ubi/config/{caddy,monitoring}

chown -R ubi:ubi /opt/ubi

log_info "Directory structure created at /opt/ubi"

# =============================================================================
# SWAP CONFIGURATION (for smaller instances)
# =============================================================================

log_info "Configuring swap..."

# Check if swap already exists
if [ ! -f /swapfile ]; then
    # Create 2GB swap
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log_info "2GB swap created"
else
    log_warn "Swap already exists"
fi

# =============================================================================
# LOGROTATE FOR DOCKER
# =============================================================================

log_info "Configuring Docker log rotation..."

cat > /etc/docker/daemon.json << 'EOF'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "50m",
        "max-file": "3"
    },
    "storage-driver": "overlay2",
    "live-restore": true
}
EOF

systemctl restart docker

# =============================================================================
# AUTOMATIC SECURITY UPDATES
# =============================================================================

log_info "Enabling automatic security updates..."

apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# =============================================================================
# SSH HARDENING
# =============================================================================

log_info "Hardening SSH configuration..."

# Backup original config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Apply hardening (uncomment to enable)
# sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
# sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config
# systemctl restart sshd

log_warn "SSH hardening prepared but not applied. Review and apply manually."

# =============================================================================
# CLEANUP
# =============================================================================

log_info "Cleaning up..."
apt-get autoremove -y
apt-get clean

# =============================================================================
# SUMMARY
# =============================================================================

echo ""
echo "=============================================="
log_info "UBI Hetzner Server Setup Complete!"
echo "=============================================="
echo ""
echo "Next steps:"
echo "1. Clone the UBI repository to /opt/ubi"
echo "2. Copy .env.example to .env and configure"
echo "3. Run: docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "Useful commands:"
echo "  - Check Docker: docker ps"
echo "  - View logs: docker compose logs -f"
echo "  - System stats: htop"
echo ""
log_warn "Don't forget to:"
echo "  - Configure SSH keys for secure access"
echo "  - Set up regular backups"
echo "  - Configure DNS for your domains"
echo ""
