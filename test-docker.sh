#!/bin/bash
# Docker Testing Script for Spellcheck App
# This script tests your Docker setup before production deployment

# Don't exit on error - we want to gather diagnostics
set +e

# App port configuration (matches docker-compose.yml and Dockerfile)
APP_PORT=${APP_PORT:-8055}
LT_PORT=${LT_PORT:-8081}

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🐳 Docker Testing Script for Spellcheck App"
echo "=========================================="
echo ""
echo "📌 Testing on port: $APP_PORT"
echo ""

# Step 1: Check Docker is running
echo "📋 Step 1: Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Step 2: Check config.yaml exists
echo "📋 Step 2: Checking config.yaml..."
if [ ! -f "config.yaml" ]; then
    echo -e "${YELLOW}⚠️  config.yaml not found!${NC}"
    echo "Creating from template..."
    cp config.yaml.example config.yaml
    echo -e "${YELLOW}⚠️  Please edit config.yaml with your credentials before continuing${NC}"
    echo "Run: nano config.yaml"
    exit 1
fi
echo -e "${GREEN}✅ config.yaml exists${NC}"
echo ""

# Step 3: Stop any existing containers
echo "📋 Step 3: Cleaning up old containers..."
docker-compose down > /dev/null 2>&1 || true
echo -e "${GREEN}✅ Cleaned up${NC}"
echo ""

# Step 4: Build the Docker image
echo "📋 Step 4: Building Docker image..."
echo "This may take 2-5 minutes on first run..."
if docker-compose build; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
    echo -e "${RED}❌ Failed to build Docker image${NC}"
    exit 1
fi
echo ""

# Step 5: Start the container
echo "📋 Step 5: Starting container..."
if docker-compose up -d; then
    echo -e "${GREEN}✅ Container started${NC}"
else
    echo -e "${RED}❌ Failed to start container${NC}"
    exit 1
fi
echo ""

# Step 6: Wait for LanguageTool to be ready
echo "📋 Step 6: Waiting for LanguageTool to be ready..."
echo "This may take 30-60 seconds..."
sleep 5

MAX_ATTEMPTS=40
ATTEMPT=0
LT_READY=false

echo "   Checking LanguageTool on port $LT_PORT inside container..."
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    # Check LanguageTool directly inside container
    if docker-compose exec -T app curl -s --connect-timeout 2 http://localhost:${LT_PORT} > /dev/null 2>&1 || \
       docker-compose exec -T app curl -s --connect-timeout 2 http://localhost:${LT_PORT}/v2/languages > /dev/null 2>&1; then
        echo -e "   ${GREEN}✅ LanguageTool is ready!${NC}"
        LT_READY=true
        break
    fi
    # Also check if port is listening inside container
    if docker-compose exec -T app sh -c "nc -z localhost $LT_PORT 2>/dev/null" > /dev/null 2>&1; then
        echo -e "   ${GREEN}✅ LanguageTool port is listening!${NC}"
        sleep 2  # Give it a moment to fully initialize
        LT_READY=true
        break
    fi
    if [ $((ATTEMPT % 5)) -eq 0 ] && [ $ATTEMPT -gt 0 ]; then
        echo "   Still waiting for LanguageTool... (${ATTEMPT}s/${MAX_ATTEMPTS}s)"
        # Show recent logs
        echo "   Recent LanguageTool logs:"
        docker-compose logs --tail=5 app | grep -i "languagetool\|LanguageTool" || echo "   (no LanguageTool logs found)"
    fi
    echo -n "."
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
done

if [ "$LT_READY" = false ]; then
    echo ""
    echo -e "${YELLOW}⚠️  LanguageTool did not become ready in time, but continuing...${NC}"
    echo "   (The app might still work if LanguageTool starts shortly)"
fi
echo ""

# Step 6.5: Check Flask app readiness (quick check, don't wait long)
echo "📋 Step 6.5: Checking Flask app readiness..."
APP_READY=false

# Single quick check - run in background and kill if it takes too long
( curl -s --connect-timeout 1 --max-time 1 http://localhost:${APP_PORT}/health > /dev/null 2>&1 ) &
CURL_PID=$!
sleep 1
if kill -0 $CURL_PID 2>/dev/null; then
    # curl is still running, kill it and move on
    kill $CURL_PID 2>/dev/null
    wait $CURL_PID 2>/dev/null
    echo -e "${YELLOW}⚠️  Health check timed out - continuing to diagnostics${NC}"
else
    # curl finished quickly, check result
    wait $CURL_PID 2>/dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Flask app is responding!${NC}"
        APP_READY=true
    else
        echo -e "${YELLOW}⚠️  Flask app not responding - continuing to diagnostics${NC}"
    fi
fi
echo ""

# Always run diagnostics if app isn't ready, or if we want to check status
if [ "$APP_READY" = false ]; then
    echo ""
    echo -e "${RED}❌ Flask app did not become healthy in time${NC}"
    echo ""
    echo "🔍 Running comprehensive diagnostics..."
    echo ""
    
    # Check if ports are listening
    echo "  1. Checking if port $APP_PORT is listening on host..."
    if netstat -tln 2>/dev/null | grep -q ":${APP_PORT} " || ss -tln 2>/dev/null | grep -q ":${APP_PORT} "; then
        echo -e "     ${GREEN}✅ Port $APP_PORT is listening on host${NC}"
        netstat -tln 2>/dev/null | grep ":${APP_PORT} " | head -1 | sed 's/^/     /' || \
        ss -tln 2>/dev/null | grep ":${APP_PORT} " | head -1 | sed 's/^/     /' || true
    else
        echo -e "     ${RED}❌ Port $APP_PORT is NOT listening on host${NC}"
    fi
    
    echo ""
    echo "  2. Checking if port $LT_PORT is listening inside container..."
    if docker-compose exec -T app sh -c "nc -z localhost $LT_PORT 2>/dev/null" > /dev/null 2>&1; then
        echo -e "     ${GREEN}✅ LanguageTool port $LT_PORT is listening inside container${NC}"
    else
        echo -e "     ${RED}❌ LanguageTool port $LT_PORT is NOT listening inside container${NC}"
    fi
    
    echo ""
    echo "  3. Testing direct connection to Flask app from inside container..."
    if docker-compose exec -T app curl -s --connect-timeout 2 http://localhost:${APP_PORT}/health > /dev/null 2>&1; then
        echo -e "     ${GREEN}✅ Flask app responds from inside container${NC}"
        HEALTH_RESPONSE=$(docker-compose exec -T app curl -s http://localhost:${APP_PORT}/health 2>/dev/null)
        echo "     Response: $HEALTH_RESPONSE"
    else
        echo -e "     ${RED}❌ Flask app does NOT respond from inside container${NC}"
    fi
    
    echo ""
    echo "  4. Checking container memory usage..."
    CONTAINER_NAME=$(docker-compose ps -q app 2>/dev/null | head -1)
    if [ -n "$CONTAINER_NAME" ]; then
        echo "     Container: $CONTAINER_NAME"
        # Get memory stats
        MEM_STATS=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" "$CONTAINER_NAME" 2>/dev/null)
        if [ -n "$MEM_STATS" ]; then
            echo "$MEM_STATS" | sed 's/^/     /'
        fi
        
        # Get detailed memory info
        echo ""
        echo "     Detailed memory information:"
        MEM_INFO=$(docker inspect "$CONTAINER_NAME" --format='{{.HostConfig.Memory}}' 2>/dev/null)
        if [ -n "$MEM_INFO" ] && [ "$MEM_INFO" != "<no value>" ] && [ "$MEM_INFO" != "0" ]; then
            MEM_LIMIT_MB=$((MEM_INFO / 1024 / 1024))
            echo "     Memory limit: ${MEM_LIMIT_MB}MB"
        else
            echo "     Memory limit: Not set (using Docker default)"
        fi
        
        # Check if container is OOM killed
        if docker inspect "$CONTAINER_NAME" --format='{{.State.OOMKilled}}' 2>/dev/null | grep -q "true"; then
            echo -e "     ${RED}❌ Container was killed due to Out Of Memory (OOM)!${NC}"
            echo "     This is likely why the app isn't starting."
        fi
        
        # Check current memory usage from /proc
        if docker exec "$CONTAINER_NAME" test -f /proc/meminfo 2>/dev/null; then
            echo ""
            echo "     Memory usage inside container:"
            docker exec "$CONTAINER_NAME" cat /proc/meminfo 2>/dev/null | grep -E "MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree" | sed 's/^/       /' || true
        fi
    else
        echo "     Could not find container"
    fi
    echo ""
    
    echo "  5. Checking system memory..."
    if command -v free >/dev/null 2>&1; then
        free -h | sed 's/^/     /'
    elif [ "$(uname)" = "Darwin" ]; then
        # macOS
        TOTAL_MEM=$(sysctl -n hw.memsize 2>/dev/null)
        if [ -n "$TOTAL_MEM" ]; then
            TOTAL_MEM_GB=$((TOTAL_MEM / 1024 / 1024 / 1024))
            echo "     Total system memory: ${TOTAL_MEM_GB}GB"
        fi
        vm_stat | head -10 | sed 's/^/     /'
    fi
    echo ""
    
    echo "  6. Checking container status..."
    docker-compose ps
    echo ""
    
    echo "  7. Recent container logs (last 50 lines)..."
    docker-compose logs --tail=50 app
    echo ""
    
    echo "  8. Checking for database connection errors in logs..."
    DB_ERRORS=$(docker-compose logs app 2>/dev/null | grep -i "snowflake\|database.*fail\|connection.*fail\|could not connect" | tail -10)
    if [ -n "$DB_ERRORS" ]; then
        echo -e "     ${RED}❌ Found database connection errors:${NC}"
        echo "$DB_ERRORS" | sed 's/^/       /'
        echo ""
        echo -e "     ${YELLOW}💡 Database connection troubleshooting:${NC}"
        echo "       • Check config.yaml has correct Snowflake credentials"
        echo "       • Verify network connectivity to Snowflake"
        echo "       • Check if credentials are valid and account is accessible"
        echo "       • Review full error in logs: docker-compose logs app | grep -i snowflake"
    else
        echo "     No obvious database connection errors found"
    fi
    echo ""
    
    echo "  9. Checking for OOM (Out of Memory) errors in logs..."
    OOM_ERRORS=$(docker-compose logs app 2>/dev/null | grep -i "oom\|out of memory\|killed\|memory" | tail -10)
    if [ -n "$OOM_ERRORS" ]; then
        echo -e "     ${RED}⚠️  Found memory-related errors in logs:${NC}"
        echo "$OOM_ERRORS" | sed 's/^/       /'
    else
        echo "     No obvious memory errors found in recent logs"
    fi
    echo ""
    
    echo "  10. Checking port mapping in docker-compose..."
    docker-compose config | grep -A 5 "ports:" || echo "     (could not read docker-compose config)"
    echo ""
    
    echo "💡 Troubleshooting tips:"
    echo "  • Verify docker-compose.yml maps port $APP_PORT:$APP_PORT"
    echo "  • Check if port $APP_PORT is in allowed range (8000-9000)"
    echo "  • Review logs above for startup errors"
    echo "  • LanguageTool might need more time - check logs for 'LanguageTool is ready'"
    echo ""
    echo "  ${YELLOW}If database connection is failing:${NC}"
    echo "  • Check config.yaml Snowflake credentials are correct"
    echo "  • Verify network/firewall allows connection to Snowflake"
    echo "  • Test credentials manually: docker-compose exec app python -c 'from snowflakeconnection import *; print(\"Test connection\")'"
    echo "  • Check if using correct DEV_MODE setting in config.yaml"
    echo ""
    echo "  ${YELLOW}Memory-related fixes:${NC}"
    echo "  • If memory is low, reduce JAVA_OPTS in docker-compose.yml:"
    echo "    Change: JAVA_OPTS=-Xms256m -Xmx1g"
    echo "    To:     JAVA_OPTS=-Xms128m -Xmx512m"
    echo "  • Reduce Gunicorn workers:"
    echo "    Change: WEB_CONCURRENCY=4"
    echo "    To:     WEB_CONCURRENCY=2"
    echo "  • Add memory limit to docker-compose.yml:"
    echo "    deploy:"
    echo "      resources:"
    echo "        limits:"
    echo "          memory: 2G"
    echo "  • Check Docker Desktop memory allocation (Settings → Resources)"
    echo "  • Try: docker-compose logs -f app (to watch logs in real-time)"
    echo ""
    echo "   Continuing with remaining tests to gather more info..."
    echo ""
fi

# Always check for database errors even if app seems ready
echo "📋 Step 6.6: Checking for database connection issues..."
DB_ERRORS=$(docker-compose logs app 2>/dev/null | grep -i "snowflake.*fail\|database.*fail\|could not connect.*snowflake\|connection test failed" | tail -5)
if [ -n "$DB_ERRORS" ]; then
    echo -e "${YELLOW}⚠️  Database connection errors detected:${NC}"
    echo "$DB_ERRORS" | sed 's/^/   /'
    echo ""
    echo -e "   ${YELLOW}💡 Even if the HTTP server is running, database issues may prevent full functionality${NC}"
    echo "   Check config.yaml Snowflake credentials and network connectivity"
else
    echo -e "${GREEN}✅ No obvious database connection errors in recent logs${NC}"
fi
echo ""

# Step 7: Test health endpoint
echo "📋 Step 7: Testing health endpoint..."
if [ "$APP_READY" = true ]; then
    HEALTH_RESPONSE=$(curl -s http://localhost:${APP_PORT}/health)
    if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
        echo -e "${GREEN}✅ Health check passed${NC}"
        echo "Response: $HEALTH_RESPONSE"
    else
        echo -e "${YELLOW}⚠️  Health check returned unexpected response${NC}"
        echo "Response: $HEALTH_RESPONSE"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping health check (app not ready)${NC}"
fi
echo ""

# Step 8: Test main page
echo "📋 Step 8: Testing main page..."
if [ "$APP_READY" = true ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${APP_PORT}/)
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
        echo -e "${GREEN}✅ Main page accessible (HTTP $HTTP_CODE)${NC}"
    else
        echo -e "${YELLOW}⚠️  Main page returned HTTP $HTTP_CODE${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping main page test (app not ready)${NC}"
fi
echo ""

# Step 8.5: Comprehensive nginx diagnostics
echo "📋 Step 8.5: Comprehensive Nginx Diagnostics..."
echo ""

# Check if nginx is installed
if command -v nginx >/dev/null 2>&1; then
    NGINX_VERSION=$(nginx -v 2>&1 | head -1)
    echo -e "${GREEN}✅ Nginx is installed: $NGINX_VERSION${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx command not found in PATH${NC}"
fi

# Check if nginx is running
if systemctl is-active --quiet nginx 2>/dev/null || pgrep -x nginx >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Nginx is running${NC}"
    NGINX_RUNNING=true
else
    echo -e "${YELLOW}⚠️  Nginx does not appear to be running${NC}"
    NGINX_RUNNING=false
fi

# Find nginx config files
echo ""
echo "   Searching for nginx configuration files..."
NGINX_CONFIGS=""
if [ -f /etc/nginx/nginx.conf ]; then
    NGINX_CONFIGS="$NGINX_CONFIGS /etc/nginx/nginx.conf"
fi
if [ -d /etc/nginx/sites-enabled ]; then
    NGINX_CONFIGS="$NGINX_CONFIGS $(find /etc/nginx/sites-enabled -name "*.conf" 2>/dev/null)"
fi
if [ -d /etc/nginx/conf.d ]; then
    NGINX_CONFIGS="$NGINX_CONFIGS $(find /etc/nginx/conf.d -name "*.conf" 2>/dev/null)"
fi

if [ -n "$NGINX_CONFIGS" ]; then
    echo -e "   ${GREEN}✅ Found nginx config files${NC}"
    echo ""
    
    # Check each config file
    for config in $NGINX_CONFIGS; do
        if [ -f "$config" ]; then
            echo "   📄 Analyzing: $config"
            
            # Check for proxy_pass
            PROXY_PASS_LINES=$(grep -n "proxy_pass" "$config" 2>/dev/null || true)
            if [ -n "$PROXY_PASS_LINES" ]; then
                echo "      Found proxy_pass configuration:"
                echo "$PROXY_PASS_LINES" | sed 's/^/        /'
                
                # Check what port it's proxying to
                if echo "$PROXY_PASS_LINES" | grep -q "localhost:${APP_PORT}\|127.0.0.1:${APP_PORT}"; then
                    echo -e "        ${GREEN}✅ Correctly configured to proxy to port ${APP_PORT}${NC}"
                elif echo "$PROXY_PASS_LINES" | grep -q "localhost:5000\|127.0.0.1:5000"; then
                    echo -e "        ${RED}❌ MISCONFIGURED: Proxying to port 5000 (should be ${APP_PORT})${NC}"
                    echo "        This is likely causing your Bad Gateway error!"
                else
                    PORT_IN_CONFIG=$(echo "$PROXY_PASS_LINES" | grep -oE "localhost:[0-9]+|127\.0\.0\.1:[0-9]+" | head -1 | cut -d: -f2)
                    if [ -n "$PORT_IN_CONFIG" ]; then
                        echo -e "        ${YELLOW}⚠️  Proxying to port $PORT_IN_CONFIG (expected ${APP_PORT})${NC}"
                    fi
                fi
            else
                echo "      No proxy_pass found in this file"
            fi
            
            # Check for server_name
            SERVER_NAMES=$(grep -n "server_name" "$config" 2>/dev/null | grep -v "^#" || true)
            if [ -n "$SERVER_NAMES" ]; then
                echo "      Server names:"
                echo "$SERVER_NAMES" | sed 's/^/        /'
            fi
            
            # Check for listen ports
            LISTEN_PORTS=$(grep -n "listen" "$config" 2>/dev/null | grep -v "^#" || true)
            if [ -n "$LISTEN_PORTS" ]; then
                echo "      Listening on:"
                echo "$LISTEN_PORTS" | sed 's/^/        /'
            fi
            echo ""
        fi
    done
    
    # Test nginx config syntax
    if [ "$NGINX_RUNNING" = true ] && command -v nginx >/dev/null 2>&1; then
        echo "   Testing nginx configuration syntax..."
        if sudo nginx -t 2>&1; then
            echo -e "   ${GREEN}✅ Nginx configuration syntax is valid${NC}"
        else
            echo -e "   ${RED}❌ Nginx configuration has syntax errors${NC}"
        fi
        echo ""
    fi
    
    # Check nginx error logs
    echo "   Checking nginx error logs (last 10 lines)..."
    NGINX_ERROR_LOG=""
    if [ -f /var/log/nginx/error.log ]; then
        NGINX_ERROR_LOG="/var/log/nginx/error.log"
    elif [ -f /usr/local/var/log/nginx/error.log ]; then
        NGINX_ERROR_LOG="/usr/local/var/log/nginx/error.log"
    fi
    
    if [ -n "$NGINX_ERROR_LOG" ] && [ -r "$NGINX_ERROR_LOG" ]; then
        echo "   Recent errors from $NGINX_ERROR_LOG:"
        sudo tail -10 "$NGINX_ERROR_LOG" 2>/dev/null | sed 's/^/     /' || echo "     (could not read log file)"
    else
        echo "   (nginx error log not found or not readable)"
    fi
    echo ""
    
    # Check if nginx can reach the app
    if [ "$NGINX_RUNNING" = true ]; then
        echo "   Testing if nginx can reach Flask app on port ${APP_PORT}..."
        if curl -s --connect-timeout 2 http://localhost:${APP_PORT}/health > /dev/null 2>&1; then
            echo -e "   ${GREEN}✅ Flask app is accessible on localhost:${APP_PORT}${NC}"
            HEALTH_RESPONSE=$(curl -s http://localhost:${APP_PORT}/health 2>/dev/null)
            echo "   Health check response: $HEALTH_RESPONSE"
        else
            echo -e "   ${RED}❌ Flask app is NOT accessible on localhost:${APP_PORT}${NC}"
            echo "   This explains the Bad Gateway error!"
        fi
        echo ""
    fi
    
    echo "   💡 Nginx Troubleshooting Commands:"
    echo "      • Test config:        sudo nginx -t"
    echo "      • Reload nginx:       sudo systemctl reload nginx"
    echo "      • Restart nginx:      sudo systemctl restart nginx"
    echo "      • View error logs:    sudo tail -f /var/log/nginx/error.log"
    echo "      • View access logs:  sudo tail -f /var/log/nginx/access.log"
    echo "      • Check nginx status: sudo systemctl status nginx"
    echo ""
else
    echo -e "   ${YELLOW}⚠️  No nginx configuration files found in standard locations${NC}"
    echo "   (This is OK if you're not using nginx as a reverse proxy)"
    echo ""
fi

# Step 9: Show container status
echo "📋 Step 9: Container status..."
docker-compose ps
echo ""

# Step 10: Show resource usage
echo "📋 Step 10: Resource usage..."
CONTAINER_NAME=$(docker-compose ps -q app 2>/dev/null | head -1)
if [ -n "$CONTAINER_NAME" ]; then
    echo "Container: $CONTAINER_NAME"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" "$CONTAINER_NAME" 2>/dev/null || echo "Could not get stats"
    
    echo ""
    echo "Memory details:"
    # Check memory limit
    MEM_LIMIT=$(docker inspect "$CONTAINER_NAME" --format='{{.HostConfig.Memory}}' 2>/dev/null)
    if [ -n "$MEM_LIMIT" ] && [ "$MEM_LIMIT" != "<no value>" ] && [ "$MEM_LIMIT" != "0" ]; then
        MEM_LIMIT_MB=$((MEM_LIMIT / 1024 / 1024))
        echo "  Memory limit: ${MEM_LIMIT_MB}MB"
    else
        echo "  Memory limit: Not set (using Docker default)"
    fi
    
    # Check if OOM killed
    if docker inspect "$CONTAINER_NAME" --format='{{.State.OOMKilled}}' 2>/dev/null | grep -q "true"; then
        echo -e "  ${RED}❌ Container was OOM killed!${NC}"
    fi
    
    # Show memory inside container if available
    if docker exec "$CONTAINER_NAME" test -f /proc/meminfo 2>/dev/null; then
        echo ""
        echo "  Memory inside container:"
        docker exec "$CONTAINER_NAME" cat /proc/meminfo 2>/dev/null | grep -E "MemTotal|MemAvailable|MemFree" | sed 's/^/    /' || true
    fi
else
    docker stats --no-stream spellcheck_app-app-1 2>/dev/null || docker stats --no-stream spellcheck-app-app-1 2>/dev/null || echo "Could not get stats"
fi
echo ""

# Summary
echo "=========================================="
if [ "$APP_READY" = true ] && [ "$LT_READY" = true ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
elif [ "$APP_READY" = true ]; then
    echo -e "${YELLOW}⚠️  App is running but LanguageTool check had issues${NC}"
elif [ "$LT_READY" = true ]; then
    echo -e "${YELLOW}⚠️  LanguageTool is ready but Flask app had issues${NC}"
else
    echo -e "${RED}❌ Some tests failed - see diagnostics above${NC}"
fi
echo ""
echo "📝 Next steps:"
echo "  1. Open your browser: http://localhost:${APP_PORT}"
echo "  2. Test the app functionality"
echo "  3. Check logs: docker-compose logs -f app"
echo "  4. When done: docker-compose down"
echo ""
echo "📊 Useful commands:"
echo "  • View logs:        docker-compose logs -f app"
echo "  • Stop app:         docker-compose down"
echo "  • Restart app:      docker-compose restart"
echo "  • Rebuild & start:  docker-compose up -d --build"
echo ""
echo "🔧 Troubleshooting Bad Gateway Errors:"
echo "  If you see a Bad Gateway (502) error when accessing via reverse proxy:"
echo "  1. Check reverse proxy (nginx) config:"
echo "     • Should proxy to: http://localhost:${APP_PORT}"
echo "     • NOT: http://localhost:5000 (old port)"
echo "  2. Verify port ${APP_PORT} is in allowed range (8000-9000)"
echo "  3. Check docker-compose.yml port mapping: ${APP_PORT}:${APP_PORT}"
echo "  4. Test direct access: curl http://localhost:${APP_PORT}/health"
echo "  5. Restart reverse proxy after config changes"
echo ""
echo "💾 Memory Troubleshooting Commands:"
echo "  • Check container memory: docker stats $(docker-compose ps -q app 2>/dev/null | head -1)"
echo "  • Check if OOM killed: docker inspect $(docker-compose ps -q app 2>/dev/null | head -1) --format='{{.State.OOMKilled}}'"
echo "  • View memory inside container: docker exec $(docker-compose ps -q app 2>/dev/null | head -1) cat /proc/meminfo"
echo "  • Check system memory: free -h (Linux) or vm_stat (macOS)"
echo "  • Reduce memory usage: Edit docker-compose.yml JAVA_OPTS and WEB_CONCURRENCY"
echo ""

