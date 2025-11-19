#!/bin/bash
# Quick script to fix Docker DNS issues
# This configures Docker daemon to use Google DNS for build-time resolution

set -e

echo "🔧 Fixing Docker DNS Configuration"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}⚠️  This script needs sudo privileges${NC}"
    echo "Running with sudo..."
    exec sudo bash "$0" "$@"
fi

# Detect system DNS servers
echo "📋 Detecting system DNS servers..."
SYSTEM_DNS=""
if [ -f /etc/resolv.conf ]; then
    SYSTEM_DNS=$(grep "^nameserver" /etc/resolv.conf | awk '{print $2}' | tr '\n' ' ' | sed 's/ $//')
fi

if [ -z "$SYSTEM_DNS" ] && command -v nmcli &> /dev/null; then
    SYSTEM_DNS=$(nmcli dev show 2>/dev/null | grep "IP4.DNS" | awk '{print $2}' | tr '\n' ' ' | sed 's/ $//')
fi

# Determine which DNS to use
USE_SYSTEM_DNS=false
if [ -n "$SYSTEM_DNS" ]; then
    echo "   Detected system DNS: $SYSTEM_DNS"
    echo ""
    echo "Choose DNS configuration:"
    echo "  1) Use system DNS (corporate DNS): $SYSTEM_DNS"
    echo "  2) Use Google DNS: 8.8.8.8, 8.8.4.4"
    echo ""
    read -p "Enter choice [1 or 2, default: 1]: " DNS_CHOICE
    DNS_CHOICE=${DNS_CHOICE:-1}
    
    if [ "$DNS_CHOICE" = "1" ]; then
        USE_SYSTEM_DNS=true
        DNS1=$(echo $SYSTEM_DNS | awk '{print $1}')
        DNS2=$(echo $SYSTEM_DNS | awk '{print $2}')
        # If only one DNS, use Google as secondary
        if [ -z "$DNS2" ]; then
            DNS2="8.8.4.4"
        fi
    else
        DNS1="8.8.8.8"
        DNS2="8.8.4.4"
    fi
else
    echo "   No system DNS detected, using Google DNS"
    DNS1="8.8.8.8"
    DNS2="8.8.4.4"
fi

# Backup existing daemon.json if it exists
if [ -f /etc/docker/daemon.json ]; then
    echo ""
    echo "📋 Backing up existing /etc/docker/daemon.json..."
    cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✅ Backup created${NC}"
fi

# Create or update daemon.json
echo ""
echo "📋 Configuring Docker daemon DNS..."
cat > /etc/docker/daemon.json << EOF
{
  "dns": ["$DNS1", "$DNS2"]
}
EOF

echo -e "${GREEN}✅ DNS configured: $DNS1, $DNS2${NC}"
echo ""

# Restart Docker
echo "🔄 Restarting Docker service..."
systemctl restart docker

# Wait a moment for Docker to start
sleep 2

# Verify Docker is running
if systemctl is-active --quiet docker; then
    echo -e "${GREEN}✅ Docker service restarted successfully${NC}"
else
    echo -e "${RED}❌ Docker service failed to start${NC}"
    echo "Check logs: journalctl -u docker.service"
    exit 1
fi

echo ""
echo "===================================="
echo -e "${GREEN}✅ DNS configuration complete!${NC}"
echo ""
echo "📝 Next steps:"
echo "   1. Pull the latest changes: git pull"
echo "   2. Test DNS: ./test-docker-setup.sh"
echo "   3. Build: sudo docker-compose build"
echo ""
echo "💡 To change DNS later, edit /etc/docker/daemon.json"
echo "   and restart Docker: sudo systemctl restart docker"
echo ""

