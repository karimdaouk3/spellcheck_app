#!/bin/bash
# Docker Testing Script for Spellcheck App
# This script tests your Docker setup before production deployment

set -e  # Exit on error

# App port configuration (matches docker-compose.yml and Dockerfile)
APP_PORT=${APP_PORT:-8055}

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

# Step 6: Wait for app to be ready
echo "📋 Step 6: Waiting for app to be ready..."
echo "This may take 30-60 seconds for LanguageTool to start..."
sleep 5

MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s http://localhost:${APP_PORT}/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ App is healthy and responding!${NC}"
        break
    fi
    echo -n "."
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo ""
    echo -e "${RED}❌ App did not become healthy in time${NC}"
    echo ""
    echo "🔍 Diagnostic checks:"
    echo "  1. Checking if port $APP_PORT is listening..."
    if netstat -tln 2>/dev/null | grep -q ":${APP_PORT} " || ss -tln 2>/dev/null | grep -q ":${APP_PORT} "; then
        echo -e "     ${GREEN}✅ Port $APP_PORT is listening${NC}"
    else
        echo -e "     ${RED}❌ Port $APP_PORT is NOT listening${NC}"
    fi
    
    echo "  2. Checking container logs..."
    docker-compose logs --tail=50 app
    echo ""
    echo "  3. Checking port mapping..."
    docker-compose ps
    echo ""
    echo "💡 Troubleshooting tips:"
    echo "  • Verify docker-compose.yml maps port $APP_PORT:$APP_PORT"
    echo "  • Check if port $APP_PORT is in allowed range (8000-9000)"
    echo "  • Review logs above for startup errors"
    exit 1
fi
echo ""

# Step 7: Test health endpoint
echo "📋 Step 7: Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:${APP_PORT}/health)
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    echo "Response: $HEALTH_RESPONSE"
else
    echo -e "${RED}❌ Health check failed${NC}"
    echo "Response: $HEALTH_RESPONSE"
    exit 1
fi
echo ""

# Step 8: Test main page
echo "📋 Step 8: Testing main page..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${APP_PORT}/)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    echo -e "${GREEN}✅ Main page accessible (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ Main page returned HTTP $HTTP_CODE${NC}"
    exit 1
fi
echo ""

# Step 8.5: Check for reverse proxy configuration issues
echo "📋 Step 8.5: Checking for reverse proxy configuration..."
if command -v nginx >/dev/null 2>&1 || [ -f /etc/nginx/nginx.conf ] || [ -f /etc/nginx/sites-enabled/* ]; then
    echo -e "${YELLOW}⚠️  Nginx detected - checking configuration...${NC}"
    NGINX_CONFIGS=$(find /etc/nginx -name "*.conf" 2>/dev/null | head -5)
    if [ -n "$NGINX_CONFIGS" ]; then
        echo "   Found nginx config files. Checking proxy_pass configuration..."
        for config in $NGINX_CONFIGS; do
            if grep -q "proxy_pass.*5000\|proxy_pass.*8055" "$config" 2>/dev/null; then
                echo -e "   ${YELLOW}⚠️  Found proxy_pass in $config${NC}"
                grep -n "proxy_pass" "$config" 2>/dev/null | head -3 | sed 's/^/     /' || true
                echo ""
                echo -e "   ${YELLOW}💡 If you see a Bad Gateway error:${NC}"
                echo "      • Ensure nginx proxy_pass points to localhost:${APP_PORT}"
                echo "      • Not localhost:5000 (old port)"
                echo "      • Restart nginx after changes: sudo systemctl restart nginx"
            fi
        done
    fi
else
    echo -e "${GREEN}✅ No nginx detected (or not in standard location)${NC}"
fi
echo ""

# Step 9: Show container status
echo "📋 Step 9: Container status..."
docker-compose ps
echo ""

# Step 10: Show resource usage
echo "📋 Step 10: Resource usage..."
docker stats --no-stream spellcheck_app-app-1 2>/dev/null || docker stats --no-stream spellcheck-app-app-1 2>/dev/null || echo "Could not get stats"
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}🎉 All tests passed!${NC}"
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

