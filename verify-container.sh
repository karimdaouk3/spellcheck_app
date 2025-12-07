#!/bin/bash
# Post-Build Container Verification Script
# Run this after: docker-compose build && docker-compose up -d
# This script verifies all components are working correctly

set +e  # Don't exit on error - we want to see all diagnostics

# Configuration
APP_PORT=${APP_PORT:-8055}
LT_PORT=${LT_PORT:-8081}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "🔍 Post-Build Container Verification"
echo "======================================"
echo ""
echo "📌 Checking container on port: $APP_PORT"
echo ""

# Check if container is running
echo "📋 Step 1: Checking container status..."
CONTAINER_NAME=$(docker-compose ps -q app 2>/dev/null | head -1)
if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ Container is not running!${NC}"
    echo "   Run: docker-compose up -d"
    exit 1
fi
echo -e "${GREEN}✅ Container is running: $CONTAINER_NAME${NC}"
docker-compose ps app
echo ""

# Wait a moment for services to start
echo "📋 Step 2: Waiting for services to initialize (10 seconds)..."
sleep 10
echo ""

# Check LanguageTool
echo "📋 Step 3: Checking LanguageTool (port $LT_PORT)..."
LT_READY=false

# Method 1: Try HTTP endpoint
( docker-compose exec -T app curl -s --connect-timeout 2 --max-time 2 http://localhost:${LT_PORT}/v2/languages > /tmp/lt_check.txt 2>&1 ) &
CURL_PID=$!
sleep 2
if ! kill -0 $CURL_PID 2>/dev/null; then
    wait $CURL_PID 2>/dev/null
    if [ -f /tmp/lt_check.txt ] && [ -s /tmp/lt_check.txt ]; then
        if grep -q "languages\|LanguageTool" /tmp/lt_check.txt 2>/dev/null; then
            echo -e "   ${GREEN}✅ LanguageTool HTTP endpoint accessible${NC}"
            LT_READY=true
        fi
    fi
    rm -f /tmp/lt_check.txt 2>/dev/null
else
    kill $CURL_PID 2>/dev/null
    wait $CURL_PID 2>/dev/null
fi

# Method 2: Check port
if [ "$LT_READY" = false ]; then
    if docker-compose exec -T app sh -c "timeout 1 nc -z localhost $LT_PORT 2>/dev/null" > /dev/null 2>&1; then
        echo -e "   ${YELLOW}⚠️  LanguageTool port is listening but HTTP check failed${NC}"
        echo "   LanguageTool may still be initializing"
        LT_READY=true
    else
        echo -e "   ${RED}❌ LanguageTool port $LT_PORT is NOT accessible${NC}"
        echo "   Check logs: docker-compose logs app | grep -i languagetool"
    fi
fi
echo ""

# Check Flask app health endpoint
echo "📋 Step 4: Checking Flask app health endpoint..."
( docker-compose exec -T app curl -s --connect-timeout 2 --max-time 2 http://localhost:${APP_PORT}/health 2>/tmp/health_stderr.txt > /tmp/health_check.txt ) &
CURL_PID=$!
sleep 2
if kill -0 $CURL_PID 2>/dev/null; then
    kill $CURL_PID 2>/dev/null
    wait $CURL_PID 2>/dev/null
    echo -e "   ${RED}❌ Health endpoint timed out${NC}"
else
    wait $CURL_PID 2>/dev/null
    if [ -f /tmp/health_check.txt ] && [ -s /tmp/health_check.txt ]; then
        HEALTH_RESPONSE=$(cat /tmp/health_check.txt | grep -v "WARN\|version.*obsolete\|docker-compose")
        if echo "$HEALTH_RESPONSE" | grep -q "\"status\".*\"healthy\"\|healthy"; then
            echo -e "   ${GREEN}✅ Health endpoint responding correctly${NC}"
            echo "   Response: $HEALTH_RESPONSE"
        else
            echo -e "   ${YELLOW}⚠️  Health endpoint responded but format unexpected${NC}"
            echo "   Response: $HEALTH_RESPONSE"
        fi
    else
        echo -e "   ${RED}❌ Health endpoint not responding${NC}"
    fi
    rm -f /tmp/health_check.txt /tmp/health_stderr.txt 2>/dev/null
fi
echo ""

# Check database connection (with timeout)
echo "📋 Step 5: Checking Snowflake database connection..."
echo "   (This may take a few seconds...)"

# Run the database test with timeout protection - pass Python code via stdin
DB_TEST_RESULT=$(timeout 15 docker-compose exec -T app python3 << 'PYEOF' 2>&1
import yaml
import sys
import signal
import os

def timeout_handler(signum, frame):
    print('ERROR: Database connection test timed out after 10 seconds')
    sys.exit(1)

# Set timeout
signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(10)  # 10 second timeout

try:
    from snowflakeconnection import snowflake_query
    
    with open('/app/config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    # Determine which payload to use (exactly as app.py does - lines 395-401)
    dev_mode = config.get('AppConfig', {}).get('DEV_MODE', False)
    
    # Get CONNECTION_PAYLOAD (Engineering_SAGE_SVC) - same as app.py line 385
    connection_payload = config.get('Engineering_SAGE_SVC', {})
    prod_payload = config.get('Production_SAGE_SVC', {})
    
    if dev_mode:
        payload = connection_payload
        source = 'Engineering_SAGE_SVC (DEV_MODE=True)'
    else:
        payload = prod_payload
        source = 'Production_SAGE_SVC (DEV_MODE=False)'
    
    if not payload:
        print('ERROR: No database credentials found in config.yaml')
        signal.alarm(0)  # Cancel timeout
        sys.exit(1)
    
    # Test connection with a simple query
    try:
        result = snowflake_query('SELECT CURRENT_DATABASE() as DB, CURRENT_SCHEMA() as SCHEMA', payload)
        signal.alarm(0)  # Cancel timeout on success
        if result is not None and not result.empty:
            db = result.iloc[0]['DB']
            schema = result.iloc[0]['SCHEMA']
            print(f'SUCCESS: Connected to {db}.{schema} using {source}')
            sys.exit(0)
        else:
            print('ERROR: Query returned no results')
            signal.alarm(0)
            sys.exit(1)
    except Exception as e:
        signal.alarm(0)  # Cancel timeout
        print(f'ERROR: {str(e)}')
        sys.exit(1)
except FileNotFoundError:
    signal.alarm(0)
    print('ERROR: config.yaml not found')
    sys.exit(1)
except Exception as e:
    signal.alarm(0)
    print(f'ERROR: {str(e)}')
    sys.exit(1)
PYEOF
)

if echo "$DB_TEST_RESULT" | grep -q "SUCCESS"; then
    echo -e "   ${GREEN}✅ Database connection successful${NC}"
    echo "$DB_TEST_RESULT" | grep "SUCCESS" | sed 's/^/   /'
else
    echo -e "   ${RED}❌ Database connection failed or timed out${NC}"
    echo "$DB_TEST_RESULT" | sed 's/^/   /'
    echo ""
    echo -e "   ${YELLOW}💡 Troubleshooting:${NC}"
    echo "   The connection works outside Docker but not inside - this suggests:"
    echo "   • Network/firewall rules blocking Docker container access"
    echo "   • DNS resolution issues inside container"
    echo "   • Different network interface being used"
    echo ""
    echo "   ${CYAN}Quick network diagnostics:${NC}"
    
    # Try to extract Snowflake account from config to test DNS
    SNOWFLAKE_ACCOUNT=$(docker-compose exec -T app python3 -c "
import yaml
try:
    with open('/app/config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    dev_mode = config.get('AppConfig', {}).get('DEV_MODE', False)
    if dev_mode:
        payload = config.get('Engineering_SAGE_SVC', {})
    else:
        payload = config.get('Production_SAGE_SVC', {})
    if payload and 'account' in payload:
        print(payload['account'])
except:
    pass
" 2>/dev/null | head -1)
    
    if [ -n "$SNOWFLAKE_ACCOUNT" ]; then
        echo "   • Testing DNS resolution for Snowflake account: $SNOWFLAKE_ACCOUNT"
        DNS_TEST=$(timeout 3 docker-compose exec -T app nslookup ${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com 2>&1 | head -5)
        if echo "$DNS_TEST" | grep -q "Name:"; then
            echo -e "     ${GREEN}✅ DNS resolution works${NC}"
        else
            echo -e "     ${RED}❌ DNS resolution failed${NC}"
            echo "     This is likely the issue!"
        fi
        
        echo "   • Testing network connectivity to Snowflake..."
        PING_TEST=$(timeout 3 docker-compose exec -T app ping -c 1 ${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com 2>&1 | head -3)
        if echo "$PING_TEST" | grep -q "1 received\|1 packets received"; then
            echo -e "     ${GREEN}✅ Network connectivity works${NC}"
        else
            echo -e "     ${RED}❌ Network connectivity failed${NC}"
            echo "     Firewall may be blocking Docker containers"
        fi
    fi
    
    echo ""
    echo "   ${CYAN}Configuration checks:${NC}"
    echo "   • Compare config.yaml: docker-compose exec app cat /app/config.yaml"
    echo "   • Check DEV_MODE setting matches your environment"
    echo "   • Verify credentials are correct"
    echo ""
    echo "   ${CYAN}Docker network fixes:${NC}"
    echo "   • Check Docker network: docker network inspect dev_spellcheck_app_default"
    echo "   • Try host network mode (temporary test): Add 'network_mode: host' to docker-compose.yml"
    echo "   • Check firewall rules: sudo iptables -L -n | grep DOCKER"
    echo "   • Check DNS in container: docker-compose exec app cat /etc/resolv.conf"
fi
echo ""

# Check port accessibility from host
echo "📋 Step 6: Checking port accessibility from host..."
if netstat -tln 2>/dev/null | grep -q ":${APP_PORT} " || ss -tln 2>/dev/null | grep -q ":${APP_PORT} "; then
    echo -e "   ${GREEN}✅ Port $APP_PORT is listening on host${NC}"
    # Test from host
    ( curl -s --connect-timeout 2 --max-time 2 http://localhost:${APP_PORT}/health > /tmp/host_health.txt 2>&1 ) &
    CURL_PID=$!
    sleep 2
    if ! kill -0 $CURL_PID 2>/dev/null; then
        wait $CURL_PID 2>/dev/null
        if [ -f /tmp/host_health.txt ] && grep -q "healthy" /tmp/host_health.txt 2>/dev/null; then
            echo -e "   ${GREEN}✅ App accessible from host on port $APP_PORT${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Port is listening but health check failed${NC}"
        fi
        rm -f /tmp/host_health.txt 2>/dev/null
    else
        kill $CURL_PID 2>/dev/null
        wait $CURL_PID 2>/dev/null
        echo -e "   ${YELLOW}⚠️  Health check from host timed out${NC}"
    fi
else
    echo -e "   ${RED}❌ Port $APP_PORT is NOT listening on host${NC}"
    echo "   Check docker-compose.yml port mapping"
fi
echo ""

# Check memory usage
echo "📋 Step 7: Checking container resource usage..."
if [ -n "$CONTAINER_NAME" ]; then
    MEM_STATS=$(docker stats --no-stream --format "{{.MemUsage}}" "$CONTAINER_NAME" 2>/dev/null)
    CPU_STATS=$(docker stats --no-stream --format "{{.CPUPerc}}" "$CONTAINER_NAME" 2>/dev/null)
    if [ -n "$MEM_STATS" ]; then
        echo "   Memory: $MEM_STATS"
        echo "   CPU: $CPU_STATS"
        
        # Check for OOM
        OOM_KILLED=$(docker inspect "$CONTAINER_NAME" --format='{{.State.OOMKilled}}' 2>/dev/null)
        if [ "$OOM_KILLED" = "true" ]; then
            echo -e "   ${RED}❌ Container was OOM killed!${NC}"
        else
            echo -e "   ${GREEN}✅ Memory usage normal${NC}"
        fi
    fi
fi
echo ""

# Check for errors in logs
echo "📋 Step 8: Checking for errors in recent logs..."
RECENT_ERRORS=$(docker-compose logs --tail=50 app 2>/dev/null | grep -i "error\|exception\|traceback\|failed\|fatal" | grep -v "WARN\|version.*obsolete" | tail -10)
if [ -n "$RECENT_ERRORS" ]; then
    echo -e "   ${YELLOW}⚠️  Found errors in recent logs:${NC}"
    echo "$RECENT_ERRORS" | sed 's/^/   /'
else
    echo -e "   ${GREEN}✅ No critical errors in recent logs${NC}"
fi
echo ""

# Check nginx configuration (if nginx is installed)
echo "📋 Step 9: Checking Nginx configuration (if present)..."
if command -v nginx >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx 2>/dev/null || pgrep -x nginx >/dev/null 2>&1; then
        echo -e "   ${GREEN}✅ Nginx is running${NC}"
        
        # Check for proxy_pass configuration
        NGINX_CONFIGS=$(find /etc/nginx -name "*.conf" 2>/dev/null | head -5)
        PROXY_FOUND=false
        for config in $NGINX_CONFIGS; do
            if [ -f "$config" ] && grep -q "proxy_pass.*${APP_PORT}\|proxy_pass.*5000" "$config" 2>/dev/null; then
                PROXY_FOUND=true
                PROXY_LINE=$(grep "proxy_pass" "$config" | grep -v "^#" | head -1)
                if echo "$PROXY_LINE" | grep -q ":${APP_PORT}"; then
                    echo -e "   ${GREEN}✅ Nginx proxy_pass correctly configured for port $APP_PORT${NC}"
                    echo "   Found in: $config"
                elif echo "$PROXY_LINE" | grep -q ":5000"; then
                    echo -e "   ${RED}❌ Nginx proxy_pass misconfigured: pointing to port 5000 (should be $APP_PORT)${NC}"
                    echo "   Found in: $config"
                    echo "   Fix: Change proxy_pass to http://localhost:${APP_PORT};"
                fi
                break
            fi
        done
        
        if [ "$PROXY_FOUND" = false ]; then
            echo -e "   ${YELLOW}⚠️  No proxy_pass configuration found for this app${NC}"
        fi
    else
        echo -e "   ${YELLOW}⚠️  Nginx is installed but not running${NC}"
    fi
else
    echo -e "   ${GREEN}✅ Nginx not detected (not required)${NC}"
fi
echo ""

# Summary
echo "======================================"
echo "📊 Verification Summary"
echo "======================================"
echo ""

# Count successes and failures
PASSED=0
FAILED=0
WARNINGS=0

# Check each component
if [ -n "$CONTAINER_NAME" ]; then
    echo -e "${GREEN}✅ Container is running${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ Container not running${NC}"
    ((FAILED++))
fi

if [ "$LT_READY" = true ]; then
    echo -e "${GREEN}✅ LanguageTool is accessible${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ LanguageTool not accessible${NC}"
    ((FAILED++))
fi

if echo "$DB_TEST_RESULT" | grep -q "SUCCESS"; then
    echo -e "${GREEN}✅ Database connection working${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ Database connection failed${NC}"
    ((FAILED++))
fi

if netstat -tln 2>/dev/null | grep -q ":${APP_PORT} " || ss -tln 2>/dev/null | grep -q ":${APP_PORT} "; then
    echo -e "${GREEN}✅ Port $APP_PORT accessible from host${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ Port $APP_PORT not accessible${NC}"
    ((FAILED++))
fi

if [ -z "$RECENT_ERRORS" ]; then
    echo -e "${GREEN}✅ No critical errors in logs${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠️  Errors found in logs${NC}"
    ((WARNINGS++))
fi

echo ""
echo "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$WARNINGS warnings${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All critical checks passed!${NC}"
    echo ""
    echo "📝 Next steps:"
    echo "   • Access the app: http://localhost:${APP_PORT}"
    echo "   • Monitor logs: docker-compose logs -f app"
    exit 0
else
    echo -e "${RED}❌ Some checks failed - review the output above${NC}"
    echo ""
    echo "📝 Troubleshooting:"
    echo "   • Check logs: docker-compose logs app"
    echo "   • Restart container: docker-compose restart app"
    echo "   • Rebuild if needed: docker-compose up -d --build"
    exit 1
fi

