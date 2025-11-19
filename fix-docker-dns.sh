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

# Backup existing daemon.json if it exists
if [ -f /etc/docker/daemon.json ]; then
    echo "📋 Backing up existing /etc/docker/daemon.json..."
    cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✅ Backup created${NC}"
fi

# Create or update daemon.json
echo ""
echo "📋 Configuring Docker daemon DNS..."
cat > /etc/docker/daemon.json << 'EOF'
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
EOF

echo -e "${GREEN}✅ DNS configured in /etc/docker/daemon.json${NC}"
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
echo "💡 If you need to use corporate DNS instead of Google DNS,"
echo "   edit /etc/docker/daemon.json and replace 8.8.8.8/8.8.4.4"
echo "   with your DNS servers, then restart Docker again."
echo ""

