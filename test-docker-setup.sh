#!/bin/bash
# Docker Setup Test Script for Rocky Linux / Linux Servers
# This script tests if Docker is properly installed and configured

set +e  # Don't exit on error - we want to test everything

echo "🐳 Docker Setup Test Script"
echo "============================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track if we need sudo
NEED_SUDO=false
DOCKER_CMD="docker"
COMPOSE_CMD="docker-compose"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test result
print_test() {
    local status=$1
    local message=$2
    if [ "$status" = "pass" ]; then
        echo -e "${GREEN}✅ $message${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    elif [ "$status" = "warn" ]; then
        echo -e "${YELLOW}⚠️  $message${NC}"
    else
        echo -e "${RED}❌ $message${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Step 1: Check if Docker is installed
echo "📋 Step 1: Checking if Docker is installed..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version 2>&1)
    print_test "pass" "Docker is installed: $DOCKER_VERSION"
else
    print_test "fail" "Docker is not installed"
    echo "   Install with: sudo dnf install -y docker"
    echo ""
fi

# Step 2: Check if Docker Compose is installed
echo "📋 Step 2: Checking if Docker Compose is installed..."
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose --version 2>&1)
    print_test "pass" "Docker Compose is installed: $COMPOSE_VERSION"
elif docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version 2>&1)
    COMPOSE_CMD="docker compose"
    print_test "pass" "Docker Compose (plugin) is installed: $COMPOSE_VERSION"
else
    print_test "fail" "Docker Compose is not installed"
    echo "   Install with: sudo dnf install -y docker-compose"
    echo "   Or download from: https://github.com/docker/compose/releases"
    echo ""
fi

# Step 3: Check Docker service status
echo "📋 Step 3: Checking Docker service status..."
if systemctl is-active --quiet docker 2>/dev/null; then
    print_test "pass" "Docker service is running"
elif sudo systemctl is-active --quiet docker 2>/dev/null; then
    print_test "pass" "Docker service is running (checked with sudo)"
else
    print_test "fail" "Docker service is not running"
    echo "   Start with: sudo systemctl start docker"
    echo "   Enable with: sudo systemctl enable docker"
    echo ""
fi

# Step 4: Check Docker socket permissions
echo "📋 Step 4: Checking Docker socket permissions..."
if [ -S /var/run/docker.sock ]; then
    SOCKET_PERMS=$(ls -l /var/run/docker.sock | awk '{print $1, $3, $4}')
    print_test "pass" "Docker socket exists: $SOCKET_PERMS"
else
    print_test "fail" "Docker socket not found at /var/run/docker.sock"
    echo ""
fi

# Step 5: Test Docker permissions (without sudo)
echo "📋 Step 5: Testing Docker permissions..."
if docker ps &> /dev/null; then
    print_test "pass" "Docker commands work without sudo"
    NEED_SUDO=false
elif sudo docker ps &> /dev/null; then
    print_test "warn" "Docker commands require sudo"
    echo "   To fix: sudo usermod -aG docker \$USER"
    echo "   Then run: newgrp docker (or log out and back in)"
    NEED_SUDO=true
    DOCKER_CMD="sudo docker"
    COMPOSE_CMD="sudo docker-compose"
else
    print_test "fail" "Cannot connect to Docker daemon"
    echo "   Check: sudo systemctl status docker"
    echo ""
fi

# Step 6: Test Docker info and check DNS configuration
echo "📋 Step 6: Testing Docker info and DNS configuration..."
if $DOCKER_CMD info &> /dev/null; then
    DOCKER_INFO=$($DOCKER_CMD info 2>&1 | head -n 5)
    print_test "pass" "Docker daemon is accessible"
    echo "   $DOCKER_INFO" | head -n 3 | sed 's/^/   /'
    
    # Check if DNS is configured in Docker
    DOCKER_DNS=$($DOCKER_CMD info 2>&1 | grep -i "DNS" || true)
    if [ -n "$DOCKER_DNS" ]; then
        echo "   Docker DNS: $DOCKER_DNS" | sed 's/^/   /'
    else
        echo "   Note: No custom DNS configured (using system default)"
    fi
else
    print_test "fail" "Cannot get Docker info"
    echo ""
fi

# Step 7: Test Docker Compose
echo "📋 Step 7: Testing Docker Compose..."
if $COMPOSE_CMD version &> /dev/null; then
    print_test "pass" "Docker Compose is working"
else
    print_test "fail" "Docker Compose is not working"
    echo ""
fi

# Step 8: Check if user is in docker group
echo "📋 Step 8: Checking user groups..."
CURRENT_USER=$(whoami)
# Use id command instead of groups to avoid hanging - it's faster and more reliable
if id -nG 2>/dev/null | grep -q docker || id -Gn 2>/dev/null | grep -q docker; then
    print_test "pass" "User '$CURRENT_USER' is in docker group"
elif getent group docker 2>/dev/null | grep -q "$CURRENT_USER"; then
    print_test "pass" "User '$CURRENT_USER' is in docker group (checked via getent)"
else
    print_test "warn" "User '$CURRENT_USER' is NOT in docker group"
    echo "   Add with: sudo usermod -aG docker $CURRENT_USER"
    echo "   Then run: newgrp docker (or log out and back in)"
    echo ""
fi

# Step 9: Check docker-compose.yml exists and DNS configuration
echo "📋 Step 9: Checking project files and DNS configuration..."
if [ -f "docker-compose.yml" ]; then
    print_test "pass" "docker-compose.yml exists"
    
    # Check if DNS is configured in docker-compose.yml
    if grep -q "^\s*dns:" docker-compose.yml 2>/dev/null || grep -q "^\s*-\s*8.8.8.8" docker-compose.yml 2>/dev/null; then
        echo "   ✓ DNS is configured in docker-compose.yml"
    else
        echo "   ⚠ DNS not configured in docker-compose.yml"
        echo "   If you have DNS issues, uncomment DNS settings in docker-compose.yml"
    fi
else
    print_test "fail" "docker-compose.yml not found in current directory"
    echo "   Make sure you're in the project root directory"
    echo ""
fi

if [ -f "Dockerfile" ]; then
    print_test "pass" "Dockerfile exists"
else
    print_test "fail" "Dockerfile not found"
    echo ""
fi

# Step 10: Test DNS resolution from host
echo "📋 Step 10: Testing DNS resolution from host..."
if command -v nslookup &> /dev/null; then
    if nslookup deb.debian.org &> /dev/null; then
        print_test "pass" "Host can resolve deb.debian.org (needed for Docker build)"
    else
        print_test "fail" "Host cannot resolve deb.debian.org"
        echo "   This will cause Docker build to fail"
        echo "   Check your DNS settings: cat /etc/resolv.conf"
        echo ""
    fi
elif command -v dig &> /dev/null; then
    if dig +short deb.debian.org &> /dev/null; then
        print_test "pass" "Host can resolve deb.debian.org (needed for Docker build)"
    else
        print_test "fail" "Host cannot resolve deb.debian.org"
        echo "   This will cause Docker build to fail"
        echo "   Check your DNS settings: cat /etc/resolv.conf"
        echo ""
    fi
else
    print_test "warn" "Cannot test DNS (nslookup/dig not available)"
    echo ""
fi

# Step 11: Test DNS resolution from Docker container
echo "📋 Step 11: Testing DNS resolution from Docker container..."
if $DOCKER_CMD run --rm --dns 8.8.8.8 alpine nslookup deb.debian.org &> /dev/null; then
    print_test "pass" "Docker can resolve DNS (with Google DNS)"
elif $DOCKER_CMD run --rm alpine nslookup deb.debian.org &> /dev/null; then
    print_test "pass" "Docker can resolve DNS (with default DNS)"
else
    print_test "fail" "Docker cannot resolve DNS"
    echo "   This will cause 'Temporary failure resolving' errors during build"
    echo "   Fix: Add DNS to docker-compose.yml or /etc/docker/daemon.json"
    echo "   See: DOCKER_DNS_TROUBLESHOOTING.md"
    echo ""
fi

# Step 12: Test Docker pull (network connectivity)
echo "📋 Step 12: Testing Docker pull (network connectivity)..."
if $DOCKER_CMD pull hello-world &> /dev/null; then
    print_test "pass" "Can pull Docker images (network connectivity OK)"
    # Clean up
    $DOCKER_CMD rmi hello-world &> /dev/null || true
else
    print_test "warn" "Cannot pull Docker images (may be network/DNS issue)"
    echo "   This might indicate DNS or network connectivity problems"
    echo ""
fi

# Step 13: Check config.yaml
echo "📋 Step 13: Checking configuration..."
if [ -f "config.yaml" ]; then
    print_test "pass" "config.yaml exists"
elif [ -f "config.yaml.example" ]; then
    print_test "warn" "config.yaml not found, but config.yaml.example exists"
    echo "   Create with: cp config.yaml.example config.yaml"
    echo "   Then edit with your credentials"
else
    print_test "warn" "No config.yaml or config.yaml.example found"
    echo ""
fi

# Summary
echo ""
echo "============================"
echo "📊 Test Summary"
echo "============================"
echo -e "${GREEN}✅ Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All critical tests passed!${NC}"
    echo ""
    echo "📝 You can now try to build and run:"
    if [ "$NEED_SUDO" = "true" ]; then
        echo "   sudo docker-compose build"
        echo "   sudo docker-compose up -d"
    else
        echo "   docker-compose build"
        echo "   docker-compose up -d"
    fi
else
    echo -e "${YELLOW}⚠️  Some tests failed. Please fix the issues above.${NC}"
    echo ""
    echo "🔧 Common fixes:"
    echo "   1. Install Docker: sudo dnf install -y docker docker-compose"
    echo "   2. Start Docker: sudo systemctl start docker && sudo systemctl enable docker"
    echo "   3. Add user to docker group: sudo usermod -aG docker \$USER"
    echo "   4. Apply group: newgrp docker (or log out and back in)"
fi

echo ""
echo "📚 For more help, see: ROCKY_LINUX_DEPLOYMENT.md"
echo ""

