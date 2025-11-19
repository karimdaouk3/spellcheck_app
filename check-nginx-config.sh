#!/bin/bash
# Nginx Configuration Checker for Spellcheck App
# This script validates nginx configuration for the Docker container setup

set +e  # Don't exit on error - we want to test everything

echo "🔍 Nginx Configuration Checker"
echo "==============================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Track results
ISSUES_FOUND=0
WARNINGS=0

# Function to print test result
print_test() {
    local status=$1
    local message=$2
    if [ "$status" = "pass" ]; then
        echo -e "${GREEN}✅ $message${NC}"
    elif [ "$status" = "warn" ]; then
        echo -e "${YELLOW}⚠️  $message${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${RED}❌ $message${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
}

# Detect if we need sudo for nginx commands
NGINX_CMD="nginx"
if ! nginx -t &> /dev/null 2>&1; then
    if sudo nginx -t &> /dev/null 2>&1; then
        NGINX_CMD="sudo nginx"
        SUDO_PREFIX="sudo "
    fi
fi

echo -e "${CYAN}📋 Step 1: Finding Nginx Configuration Files${NC}"
echo "----------------------------------------"

# Common nginx config locations
NGINX_CONFIG_LOCATIONS=(
    "/etc/nginx/nginx.conf"
    "/etc/nginx/conf.d/*.conf"
    "/etc/nginx/sites-enabled/*"
    "/etc/nginx/sites-available/*"
    "/usr/local/nginx/conf/nginx.conf"
    "/opt/nginx/conf/nginx.conf"
)

CONFIG_FILES=()

# Find all nginx config files
for pattern in "${NGINX_CONFIG_LOCATIONS[@]}"; do
    # Expand glob patterns
    for file in $pattern; do
        if [ -f "$file" ] && [ -r "$file" ]; then
            CONFIG_FILES+=("$file")
        fi
    done
done

# Also check includes
if [ -f "/etc/nginx/nginx.conf" ]; then
    INCLUDES=$(grep -E "^\s*include\s+" /etc/nginx/nginx.conf 2>/dev/null | sed 's/.*include\s*//;s/;//' | tr -d ' ' || echo "")
    for include in $INCLUDES; do
        # Expand relative paths
        if [[ "$include" != /* ]]; then
            include="/etc/nginx/$include"
        fi
        # Expand globs
        for file in $include; do
            if [ -f "$file" ] && [ -r "$file" ]; then
                CONFIG_FILES+=("$file")
            fi
        done
    done
fi

# Remove duplicates
CONFIG_FILES=($(printf "%s\n" "${CONFIG_FILES[@]}" | sort -u))

if [ ${#CONFIG_FILES[@]} -eq 0 ]; then
    print_test "fail" "No nginx configuration files found"
    echo "   Searched in: ${NGINX_CONFIG_LOCATIONS[*]}"
else
    print_test "pass" "Found ${#CONFIG_FILES[@]} nginx configuration file(s)"
    echo "   Files:"
    for file in "${CONFIG_FILES[@]}"; do
        echo "     - $file"
    done
fi
echo ""

echo -e "${CYAN}📋 Step 2: Nginx Configuration Syntax Check${NC}"
echo "----------------------------------------"
if command -v nginx &> /dev/null; then
    if $NGINX_CMD -t 2>&1 | grep -q "successful"; then
        print_test "pass" "Nginx configuration syntax is valid"
        $NGINX_CMD -t 2>&1 | grep -v "^$" | sed 's/^/   /'
    else
        print_test "fail" "Nginx configuration has syntax errors"
        echo "   Errors:"
        $NGINX_CMD -t 2>&1 | grep -i "error\|failed" | sed 's/^/   /'
    fi
else
    print_test "warn" "nginx command not found (cannot test syntax)"
fi
echo ""

echo -e "${CYAN}📋 Step 3: Checking for Flask App Proxy Configuration${NC}"
echo "----------------------------------------"

PROXY_FOUND=false
PROXY_TO_5000=false
FSRCOACH_DOMAIN=false

for config_file in "${CONFIG_FILES[@]}"; do
    echo "Checking: $config_file"
    
    # Check for proxy_pass
    if grep -q "proxy_pass" "$config_file" 2>/dev/null; then
        PROXY_FOUND=true
        print_test "pass" "Found proxy_pass directive in $config_file"
        
        # Check if it proxies to port 5000
        if grep -E "proxy_pass.*:5000|proxy_pass.*localhost:5000|proxy_pass.*127\.0\.0\.1:5000" "$config_file" 2>/dev/null; then
            PROXY_TO_5000=true
            print_test "pass" "Configured to proxy to port 5000"
            echo "   Relevant lines:"
            grep -n "proxy_pass.*5000" "$config_file" 2>/dev/null | head -3 | sed 's/^/     /'
        else
            print_test "warn" "proxy_pass found but not pointing to port 5000"
            echo "   Current proxy_pass:"
            grep -n "proxy_pass" "$config_file" 2>/dev/null | head -3 | sed 's/^/     /'
        fi
    fi
    
    # Check for fsrcoach-dev.kla.com domain
    if grep -q "fsrcoach-dev\.kla\.com\|server_name.*fsrcoach" "$config_file" 2>/dev/null; then
        FSRCOACH_DOMAIN=true
        print_test "pass" "Found fsrcoach-dev.kla.com domain configuration"
        echo "   Server block:"
        # Extract server block
        awk '/server\s*\{/,/^}/' "$config_file" 2>/dev/null | grep -A 20 "fsrcoach" | head -15 | sed 's/^/     /' || true
    fi
    
    # Check for required headers for SSO
    REQUIRED_HEADERS=("X-Forwarded-Host" "X-Forwarded-Proto" "X-Real-IP" "X-Forwarded-For")
    HEADERS_FOUND=0
    
    for header in "${REQUIRED_HEADERS[@]}"; do
        if grep -q "proxy_set_header.*$header\|X-Forwarded" "$config_file" 2>/dev/null; then
            HEADERS_FOUND=$((HEADERS_FOUND + 1))
        fi
    done
    
    if [ $HEADERS_FOUND -ge 3 ]; then
        print_test "pass" "Required proxy headers found ($HEADERS_FOUND/4)"
    elif [ $HEADERS_FOUND -gt 0 ]; then
        print_test "warn" "Some proxy headers missing ($HEADERS_FOUND/4 found)"
        echo "   Missing headers may cause SSO issues"
    else
        print_test "warn" "No proxy headers configured"
        echo "   SSO may not work correctly without X-Forwarded-Host and X-Forwarded-Proto"
    fi
    
    echo ""
done

if [ "$PROXY_FOUND" = false ]; then
    print_test "fail" "No proxy_pass directive found in any nginx config"
    echo "   Nginx is not configured to proxy requests to the Flask app"
fi

if [ "$PROXY_TO_5000" = false ] && [ "$PROXY_FOUND" = true ]; then
    print_test "fail" "proxy_pass is not configured to point to localhost:5000"
    echo "   The Flask app runs on port 5000 inside the Docker container"
fi

if [ "$FSRCOACH_DOMAIN" = false ]; then
    print_test "warn" "fsrcoach-dev.kla.com domain not found in config"
    echo "   SSO redirects to this domain, so it must be configured"
fi
echo ""

echo -e "${CYAN}📋 Step 4: Nginx Service Status${NC}"
echo "----------------------------------------"
if systemctl is-active --quiet nginx 2>/dev/null || sudo systemctl is-active --quiet nginx 2>/dev/null; then
    print_test "pass" "Nginx service is running"
    
    # Check nginx process
    NGINX_PIDS=$(pgrep -f nginx | wc -l)
    if [ "$NGINX_PIDS" -gt 0 ]; then
        print_test "pass" "Nginx processes running ($NGINX_PIDS process(es))"
    fi
else
    print_test "fail" "Nginx service is not running"
    echo "   Start with: sudo systemctl start nginx"
fi

# Check if nginx is listening on port 80/443
if command -v ss &> /dev/null; then
    if ss -tln 2>/dev/null | grep -q ":80 "; then
        print_test "pass" "Nginx is listening on port 80"
    fi
    if ss -tln 2>/dev/null | grep -q ":443 "; then
        print_test "pass" "Nginx is listening on port 443"
    fi
elif command -v netstat &> /dev/null; then
    if netstat -tln 2>/dev/null | grep -q ":80 "; then
        print_test "pass" "Nginx is listening on port 80"
    fi
    if netstat -tln 2>/dev/null | grep -q ":443 "; then
        print_test "pass" "Nginx is listening on port 443"
    fi
fi
echo ""

echo -e "${CYAN}📋 Step 5: Testing Proxy Connection${NC}"
echo "----------------------------------------"

# Test if Flask app is accessible directly
if curl -s --connect-timeout 2 http://localhost:5000/health > /dev/null 2>&1; then
    print_test "pass" "Flask app is accessible on localhost:5000"
    HEALTH_RESPONSE=$(curl -s http://localhost:5000/health 2>/dev/null)
    echo "   Health check response: $HEALTH_RESPONSE"
else
    print_test "fail" "Flask app is NOT accessible on localhost:5000"
    echo "   This means nginx cannot proxy to the backend"
    echo "   Check: sudo docker-compose ps"
    echo "   Check: sudo docker-compose logs app"
fi

# Test through nginx (if domain is configured)
if [ "$FSRCOACH_DOMAIN" = true ]; then
    echo "Testing proxy through nginx..."
    
    # Try HTTP
    if curl -s --connect-timeout 2 -H "Host: fsrcoach-dev.kla.com" http://localhost/health > /dev/null 2>&1; then
        print_test "pass" "Nginx proxy is working (HTTP)"
        PROXY_RESPONSE=$(curl -s -H "Host: fsrcoach-dev.kla.com" http://localhost/health 2>/dev/null)
        echo "   Proxy response: $PROXY_RESPONSE"
    else
        print_test "warn" "Could not test nginx proxy (may need to test from external host)"
        echo "   Try: curl -H 'Host: fsrcoach-dev.kla.com' http://your-server-ip/health"
    fi
fi
echo ""

echo -e "${CYAN}📋 Step 6: Checking Nginx Error Logs${NC}"
echo "----------------------------------------"

NGINX_ERROR_LOGS=(
    "/var/log/nginx/error.log"
    "/usr/local/nginx/logs/error.log"
    "/opt/nginx/logs/error.log"
)

ERROR_LOG_FOUND=false
for log in "${NGINX_ERROR_LOGS[@]}"; do
    if [ -f "$log" ]; then
        if sudo test -r "$log" 2>/dev/null || [ -r "$log" ]; then
            ERROR_LOG_FOUND=true
            print_test "pass" "Found nginx error log: $log"
            
            # Check for recent 502 errors
            RECENT_502=$(sudo tail -50 "$log" 2>/dev/null | grep -i "502\|bad gateway" | wc -l || echo "0")
            if [ "$RECENT_502" -gt 0 ]; then
                print_test "warn" "Found $RECENT_502 recent 502 errors in error log"
                echo "   Recent 502 errors:"
                sudo tail -50 "$log" 2>/dev/null | grep -i "502\|bad gateway" | tail -3 | sed 's/^/     /'
            else
                print_test "pass" "No recent 502 errors in error log"
            fi
            
            # Check for connection refused errors
            CONN_REFUSED=$(sudo tail -50 "$log" 2>/dev/null | grep -i "connection refused\|connect\(\) failed" | wc -l || echo "0")
            if [ "$CONN_REFUSED" -gt 0 ]; then
                print_test "warn" "Found $CONN_REFUSED connection refused errors"
                echo "   This may indicate the Flask app is not running"
                sudo tail -50 "$log" 2>/dev/null | grep -i "connection refused\|connect\(\) failed" | tail -3 | sed 's/^/     /'
            fi
            break
        fi
    fi
done

if [ "$ERROR_LOG_FOUND" = false ]; then
    print_test "warn" "Could not access nginx error log (may need sudo)"
fi
echo ""

echo -e "${CYAN}📋 Step 7: Docker Container Status${NC}"
echo "----------------------------------------"

# Check if Docker container is running
if command -v docker-compose &> /dev/null || command -v docker &> /dev/null; then
    DOCKER_CMD="docker"
    COMPOSE_CMD="docker-compose"
    if ! docker ps &> /dev/null; then
        if sudo docker ps &> /dev/null; then
            DOCKER_CMD="sudo docker"
            COMPOSE_CMD="sudo docker-compose"
        fi
    fi
    
    CONTAINER_NAME=$($COMPOSE_CMD ps -q app 2>/dev/null || echo "")
    if [ -n "$CONTAINER_NAME" ]; then
        CONTAINER_STATUS=$($DOCKER_CMD inspect --format='{{.State.Status}}' $CONTAINER_NAME 2>/dev/null)
        if [ "$CONTAINER_STATUS" = "running" ]; then
            print_test "pass" "Docker container is running"
            
            # Check if port 5000 is mapped
            PORT_MAPPING=$($DOCKER_CMD port $CONTAINER_NAME 2>/dev/null | grep "5000" || echo "")
            if [ -n "$PORT_MAPPING" ]; then
                print_test "pass" "Port 5000 is mapped: $PORT_MAPPING"
            else
                print_test "warn" "Port 5000 mapping not found"
            fi
        else
            print_test "fail" "Docker container status: $CONTAINER_STATUS"
        fi
    else
        print_test "warn" "Docker container not found"
        echo "   Start with: $COMPOSE_CMD up -d"
    fi
else
    print_test "warn" "Docker commands not available"
fi
echo ""

# Summary
echo "====================================="
echo -e "${CYAN}📊 Summary${NC}"
echo "====================================="
echo -e "${GREEN}✅ Issues found: $ISSUES_FOUND${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo ""

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}🎉 Nginx configuration looks good!${NC}"
    echo ""
    echo "If you're still experiencing issues:"
    echo "  1. Restart nginx: sudo systemctl restart nginx"
    echo "  2. Check nginx logs: sudo tail -f /var/log/nginx/error.log"
    echo "  3. Test from browser: http://fsrcoach-dev.kla.com"
else
    echo -e "${RED}❌ Found $ISSUES_FOUND issue(s) that need to be fixed${NC}"
    echo ""
    echo "🔧 Recommended actions:"
    echo ""
    
    if [ "$PROXY_TO_5000" = false ]; then
        echo "  1. Configure proxy_pass to point to localhost:5000"
        echo "     Add to your nginx config:"
        echo "       location / {"
        echo "         proxy_pass http://localhost:5000;"
        echo "         proxy_set_header Host \$host;"
        echo "         proxy_set_header X-Forwarded-Host \$host;"
        echo "         proxy_set_header X-Forwarded-Proto \$scheme;"
        echo "       }"
        echo ""
    fi
    
    if [ "$FSRCOACH_DOMAIN" = false ]; then
        echo "  2. Add server block for fsrcoach-dev.kla.com"
        echo "     See nginx.conf.example for reference"
        echo ""
    fi
    
    if ! systemctl is-active --quiet nginx 2>/dev/null && ! sudo systemctl is-active --quiet nginx 2>/dev/null; then
        echo "  3. Start nginx: sudo systemctl start nginx"
        echo ""
    fi
fi

echo "📝 Useful commands:"
echo "  • Test nginx config: sudo nginx -t"
echo "  • Reload nginx: sudo systemctl reload nginx"
echo "  • Restart nginx: sudo systemctl restart nginx"
echo "  • View nginx logs: sudo tail -f /var/log/nginx/error.log"
echo "  • Check container: sudo docker-compose ps"
echo "  • View container logs: sudo docker-compose logs -f app"
echo ""

