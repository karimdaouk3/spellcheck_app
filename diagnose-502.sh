#!/bin/bash
# 502 Bad Gateway Diagnostic Script
# This script diagnoses common causes of 502 Bad Gateway errors
# when running the spellcheck app behind nginx on a remote server

set +e  # Don't exit on error - we want to test everything

echo "🔍 502 Bad Gateway Diagnostic Script"
echo "====================================="
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

# Detect if we need sudo for docker commands
DOCKER_CMD="docker"
COMPOSE_CMD="docker-compose"
if ! docker ps &> /dev/null; then
    if sudo docker ps &> /dev/null; then
        DOCKER_CMD="sudo docker"
        COMPOSE_CMD="sudo docker-compose"
    fi
fi

# Get container name
CONTAINER_NAME=$($COMPOSE_CMD ps -q app 2>/dev/null || echo "")
if [ -z "$CONTAINER_NAME" ]; then
    # Try alternative naming
    CONTAINER_NAME=$($DOCKER_CMD ps -q -f "name=spellcheck" 2>/dev/null | head -1 || echo "")
fi

echo -e "${CYAN}📋 Step 1: Docker Container Status${NC}"
echo "----------------------------------------"
if [ -n "$CONTAINER_NAME" ]; then
    print_test "pass" "Container found: $CONTAINER_NAME"
    
    # Check container status
    CONTAINER_STATUS=$($DOCKER_CMD inspect --format='{{.State.Status}}' $CONTAINER_NAME 2>/dev/null)
    if [ "$CONTAINER_STATUS" = "running" ]; then
        print_test "pass" "Container is running"
    else
        print_test "fail" "Container status: $CONTAINER_STATUS"
        echo "   Start with: $COMPOSE_CMD up -d"
    fi
    
    # Check if container is restarting
    RESTART_COUNT=$($DOCKER_CMD inspect --format='{{.RestartCount}}' $CONTAINER_NAME 2>/dev/null)
    if [ "$RESTART_COUNT" -gt 5 ]; then
        print_test "fail" "Container has restarted $RESTART_COUNT times (likely crashing)"
    elif [ "$RESTART_COUNT" -gt 0 ]; then
        print_test "warn" "Container has restarted $RESTART_COUNT times"
    else
        print_test "pass" "Container has not restarted"
    fi
else
    print_test "fail" "Container not found"
    echo "   Start with: $COMPOSE_CMD up -d"
fi
echo ""

echo -e "${CYAN}📋 Step 2: Container Logs (Recent Errors)${NC}"
echo "----------------------------------------"
if [ -n "$CONTAINER_NAME" ]; then
    echo "Last 30 lines of logs:"
    $DOCKER_CMD logs --tail=30 $CONTAINER_NAME 2>&1 | head -30
    echo ""
    
    # Check for common errors
    ERROR_COUNT=$($DOCKER_CMD logs $CONTAINER_NAME 2>&1 | grep -i "error\|exception\|traceback\|failed" | wc -l)
    if [ "$ERROR_COUNT" -gt 0 ]; then
        print_test "warn" "Found $ERROR_COUNT error messages in logs"
        echo "   Recent errors:"
        $DOCKER_CMD logs --tail=50 $CONTAINER_NAME 2>&1 | grep -i "error\|exception\|traceback\|failed" | tail -5 | sed 's/^/   /'
    else
        print_test "pass" "No obvious errors in recent logs"
    fi
else
    print_test "warn" "Cannot check logs (container not found)"
fi
echo ""

echo -e "${CYAN}📋 Step 3: Port Binding and Accessibility${NC}"
echo "----------------------------------------"
# Check if port 5000 is listening
if command -v netstat &> /dev/null; then
    PORT_CHECK=$(netstat -tln 2>/dev/null | grep ":5000 " || echo "")
elif command -v ss &> /dev/null; then
    PORT_CHECK=$(ss -tln 2>/dev/null | grep ":5000 " || echo "")
else
    PORT_CHECK=""
fi

if [ -n "$PORT_CHECK" ]; then
    print_test "pass" "Port 5000 is listening"
    echo "   $PORT_CHECK" | sed 's/^/   /'
else
    print_test "fail" "Port 5000 is not listening"
    echo "   The Flask app may not be running or bound to the wrong port"
fi

# Check if port is accessible from host
if curl -s --connect-timeout 2 http://localhost:5000/health > /dev/null 2>&1; then
    print_test "pass" "Health endpoint accessible from host (localhost:5000)"
    HEALTH_RESPONSE=$(curl -s http://localhost:5000/health)
    echo "   Response: $HEALTH_RESPONSE"
elif curl -s --connect-timeout 2 http://127.0.0.1:5000/health > /dev/null 2>&1; then
    print_test "pass" "Health endpoint accessible from host (127.0.0.1:5000)"
else
    print_test "fail" "Health endpoint NOT accessible from host"
    echo "   This is likely the root cause of 502 Bad Gateway"
    echo "   Nginx cannot reach the backend service"
fi

# Check from inside container
if [ -n "$CONTAINER_NAME" ]; then
    if $DOCKER_CMD exec $CONTAINER_NAME curl -s --connect-timeout 2 http://localhost:5000/health > /dev/null 2>&1; then
        print_test "pass" "Health endpoint accessible from inside container"
    else
        print_test "fail" "Health endpoint NOT accessible from inside container"
        echo "   The Flask app is not responding inside the container"
    fi
fi
echo ""

echo -e "${CYAN}📋 Step 4: Process Status Inside Container${NC}"
echo "----------------------------------------"
if [ -n "$CONTAINER_NAME" ]; then
    # Check if gunicorn is running
    GUNICORN_PROCESS=$($DOCKER_CMD exec $CONTAINER_NAME ps aux 2>/dev/null | grep -i gunicorn | grep -v grep || echo "")
    if [ -n "$GUNICORN_PROCESS" ]; then
        print_test "pass" "Gunicorn process is running"
        echo "$GUNICORN_PROCESS" | head -1 | sed 's/^/   /'
    else
        print_test "fail" "Gunicorn process NOT found"
        echo "   The Flask app may have crashed"
    fi
    
    # Check if LanguageTool Java process is running
    JAVA_PROCESS=$($DOCKER_CMD exec $CONTAINER_NAME ps aux 2>/dev/null | grep -i java | grep -v grep || echo "")
    if [ -n "$JAVA_PROCESS" ]; then
        print_test "pass" "LanguageTool Java process is running"
    else
        print_test "warn" "LanguageTool Java process NOT found"
        echo "   LanguageTool may not have started"
    fi
    
    # Check Python processes
    PYTHON_PROCESSES=$($DOCKER_CMD exec $CONTAINER_NAME ps aux 2>/dev/null | grep -i python | grep -v grep | wc -l)
    if [ "$PYTHON_PROCESSES" -gt 0 ]; then
        print_test "pass" "Found $PYTHON_PROCESSES Python process(es)"
    else
        print_test "fail" "No Python processes found"
    fi
else
    print_test "warn" "Cannot check processes (container not found)"
fi
echo ""

echo -e "${CYAN}📋 Step 5: Network Configuration${NC}"
echo "----------------------------------------"
# Check docker network
if [ -n "$CONTAINER_NAME" ]; then
    NETWORK_MODE=$($DOCKER_CMD inspect --format='{{.HostConfig.NetworkMode}}' $CONTAINER_NAME 2>/dev/null)
    print_test "pass" "Container network mode: $NETWORK_MODE"
    
    # Check if container can reach itself
    if $DOCKER_CMD exec $CONTAINER_NAME ping -c 1 localhost > /dev/null 2>&1; then
        print_test "pass" "Container network connectivity OK"
    else
        print_test "fail" "Container network connectivity issues"
    fi
fi

# Check if port 5000 is in use by another process
if command -v lsof &> /dev/null; then
    PORT_USERS=$(sudo lsof -i :5000 2>/dev/null | grep -v COMMAND || echo "")
    if [ -n "$PORT_USERS" ]; then
        print_test "warn" "Port 5000 is in use by:"
        echo "$PORT_USERS" | sed 's/^/   /'
    else
        print_test "pass" "Port 5000 is not in use by other processes"
    fi
fi
echo ""

echo -e "${CYAN}📋 Step 6: Nginx Configuration Check${NC}"
echo "----------------------------------------"
# Try to find nginx config
NGINX_CONFIGS=(
    "/etc/nginx/sites-available/default"
    "/etc/nginx/sites-enabled/default"
    "/etc/nginx/nginx.conf"
    "/etc/nginx/conf.d/default.conf"
)

NGINX_FOUND=false
for config in "${NGINX_CONFIGS[@]}"; do
    if [ -f "$config" ]; then
        NGINX_FOUND=true
        print_test "pass" "Found nginx config: $config"
        
        # Check if it's configured to proxy to localhost:5000
        if grep -q "localhost:5000\|127.0.0.1:5000\|proxy_pass.*5000" "$config" 2>/dev/null; then
            print_test "pass" "Nginx is configured to proxy to port 5000"
            echo "   Relevant lines:"
            grep -n "proxy_pass\|localhost:5000\|127.0.0.1:5000" "$config" 2>/dev/null | head -3 | sed 's/^/   /'
        else
            print_test "warn" "Nginx config doesn't show proxy_pass to port 5000"
        fi
        
        # Check for upstream configuration
        if grep -q "upstream\|backend" "$config" 2>/dev/null; then
            echo "   Upstream configuration found:"
            grep -A 5 "upstream\|backend" "$config" 2>/dev/null | head -10 | sed 's/^/   /'
        fi
        break
    fi
done

if [ "$NGINX_FOUND" = false ]; then
    print_test "warn" "Could not find nginx configuration files"
    echo "   Nginx may be configured elsewhere or not installed"
fi

# Check nginx status
if systemctl is-active --quiet nginx 2>/dev/null || sudo systemctl is-active --quiet nginx 2>/dev/null; then
    print_test "pass" "Nginx service is running"
    
    # Check nginx error log for 502 errors
    NGINX_ERROR_LOG=""
    for log in "/var/log/nginx/error.log" "/usr/local/nginx/logs/error.log"; do
        if [ -f "$log" ] && sudo test -r "$log" 2>/dev/null; then
            NGINX_ERROR_LOG="$log"
            break
        fi
    done
    
    if [ -n "$NGINX_ERROR_LOG" ]; then
        RECENT_502=$(sudo tail -50 "$NGINX_ERROR_LOG" 2>/dev/null | grep -i "502\|bad gateway" | wc -l)
        if [ "$RECENT_502" -gt 0 ]; then
            print_test "warn" "Found $RECENT_502 recent 502 errors in nginx error log"
            echo "   Recent 502 errors:"
            sudo tail -50 "$NGINX_ERROR_LOG" 2>/dev/null | grep -i "502\|bad gateway" | tail -3 | sed 's/^/   /'
        else
            print_test "pass" "No recent 502 errors in nginx error log"
        fi
    fi
else
    print_test "warn" "Nginx service status unknown (may need sudo to check)"
fi
echo ""

echo -e "${CYAN}📋 Step 7: Configuration Files${NC}"
echo "----------------------------------------"
# Check config.yaml
if [ -f "config.yaml" ]; then
    print_test "pass" "config.yaml exists"
    
    # Check if it's readable
    if [ -r "config.yaml" ]; then
        print_test "pass" "config.yaml is readable"
        
        # Check for ENABLE_SSO
        if grep -q "ENABLE_SSO" config.yaml; then
            print_test "pass" "ENABLE_SSO found in config.yaml"
        else
            print_test "warn" "ENABLE_SSO not found in config.yaml"
        fi
    else
        print_test "fail" "config.yaml is not readable"
    fi
else
    print_test "fail" "config.yaml not found"
    echo "   Create from: cp config.yaml.example config.yaml"
fi

# Check docker-compose.yml
if [ -f "docker-compose.yml" ]; then
    print_test "pass" "docker-compose.yml exists"
    
    # Check port mapping
    if grep -q "5000:5000" docker-compose.yml; then
        print_test "pass" "Port mapping 5000:5000 found in docker-compose.yml"
    else
        print_test "warn" "Port mapping may be incorrect in docker-compose.yml"
    fi
else
    print_test "fail" "docker-compose.yml not found"
fi
echo ""

echo -e "${CYAN}📋 Step 8: Environment Variables${NC}"
echo "----------------------------------------"
if [ -n "$CONTAINER_NAME" ]; then
    # Check critical environment variables
    PORT_VAR=$($DOCKER_CMD exec $CONTAINER_NAME printenv PORT 2>/dev/null || echo "")
    if [ -n "$PORT_VAR" ]; then
        print_test "pass" "PORT environment variable: $PORT_VAR"
    else
        print_test "warn" "PORT environment variable not set (defaults to 5000)"
    fi
    
    FLASK_ENV=$($DOCKER_CMD exec $CONTAINER_NAME printenv FLASK_ENV 2>/dev/null || echo "")
    if [ -n "$FLASK_ENV" ]; then
        print_test "pass" "FLASK_ENV: $FLASK_ENV"
    fi
    
    WEB_CONCURRENCY=$($DOCKER_CMD exec $CONTAINER_NAME printenv WEB_CONCURRENCY 2>/dev/null || echo "")
    if [ -n "$WEB_CONCURRENCY" ]; then
        print_test "pass" "WEB_CONCURRENCY: $WEB_CONCURRENCY"
    fi
else
    print_test "warn" "Cannot check environment variables (container not found)"
fi
echo ""

echo -e "${CYAN}📋 Step 9: Firewall and Security${NC}"
echo "----------------------------------------"
# Check firewall status
if command -v firewall-cmd &> /dev/null; then
    if sudo firewall-cmd --state &> /dev/null 2>&1; then
        FIREWALL_STATUS=$(sudo firewall-cmd --state 2>/dev/null)
        print_test "warn" "Firewall is $FIREWALL_STATUS"
        echo "   Check if port 5000 is allowed: sudo firewall-cmd --list-ports"
    fi
elif command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
    print_test "warn" "UFW status: $UFW_STATUS"
fi

# Check SELinux if on RHEL/CentOS
if command -v getenforce &> /dev/null; then
    SELINUX_STATUS=$(getenforce 2>/dev/null)
    if [ "$SELINUX_STATUS" = "Enforcing" ]; then
        print_test "warn" "SELinux is Enforcing (may block connections)"
        echo "   Check: sudo ausearch -m avc -ts recent"
    fi
fi
echo ""

echo -e "${CYAN}📋 Step 10: Direct Connection Test${NC}"
echo "----------------------------------------"
# Test direct connection to the app
echo "Testing direct connection to Flask app..."
if curl -v --connect-timeout 5 http://localhost:5000/health 2>&1 | grep -q "HTTP/1.1 200\|HTTP/1.0 200"; then
    print_test "pass" "Direct connection to Flask app successful"
elif curl -v --connect-timeout 5 http://127.0.0.1:5000/health 2>&1 | grep -q "HTTP/1.1 200\|HTTP/1.0 200"; then
    print_test "pass" "Direct connection to Flask app successful (127.0.0.1)"
else
    print_test "fail" "Direct connection to Flask app FAILED"
    echo "   This confirms the backend is not accessible"
    echo "   Full curl output:"
    curl -v --connect-timeout 5 http://localhost:5000/health 2>&1 | tail -10 | sed 's/^/   /'
fi
echo ""

# Summary and recommendations
echo "====================================="
echo -e "${CYAN}📊 Diagnostic Summary${NC}"
echo "====================================="
echo -e "${GREEN}✅ Issues found: $ISSUES_FOUND${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo ""

if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}🎉 No critical issues found!${NC}"
    echo ""
    echo "If you're still getting 502 errors, check:"
    echo "  1. Nginx configuration and restart: sudo systemctl restart nginx"
    echo "  2. Nginx error logs: sudo tail -f /var/log/nginx/error.log"
    echo "  3. Container logs: $COMPOSE_CMD logs -f app"
else
    echo -e "${RED}❌ Found $ISSUES_FOUND critical issue(s)${NC}"
    echo ""
    echo "🔧 Recommended fixes:"
    echo ""
    
    if [ -z "$CONTAINER_NAME" ]; then
        echo "  1. Start the container:"
        echo "     $COMPOSE_CMD up -d"
        echo ""
    fi
    
    if ! curl -s --connect-timeout 2 http://localhost:5000/health > /dev/null 2>&1; then
        echo "  2. If container is running but not responding:"
        echo "     - Check logs: $COMPOSE_CMD logs -f app"
        echo "     - Restart container: $COMPOSE_CMD restart app"
        echo "     - Rebuild if needed: $COMPOSE_CMD up -d --build"
        echo ""
    fi
    
    echo "  3. Verify nginx can reach the backend:"
    echo "     - Test from server: curl http://localhost:5000/health"
    echo "     - Check nginx config points to localhost:5000"
    echo "     - Restart nginx: sudo systemctl restart nginx"
    echo ""
    
    echo "  4. Check firewall rules:"
    echo "     - Allow localhost connections (should be default)"
    echo "     - Check: sudo iptables -L -n"
    echo ""
fi

echo "📝 Useful commands:"
echo "  • View container logs:     $COMPOSE_CMD logs -f app"
echo "  • Restart container:       $COMPOSE_CMD restart app"
echo "  • Rebuild and restart:     $COMPOSE_CMD up -d --build"
echo "  • Check nginx logs:        sudo tail -f /var/log/nginx/error.log"
echo "  • Test health endpoint:    curl http://localhost:5000/health"
echo "  • Check container status:  $COMPOSE_CMD ps"
echo ""

