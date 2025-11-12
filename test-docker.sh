#!/bin/bash
# Docker Testing Script for Spellcheck App
# This script tests your Docker setup before production deployment

set -e  # Exit on error

echo "🐳 Docker Testing Script for Spellcheck App"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

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
    if curl -s http://localhost:5000/health > /dev/null 2>&1; then
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
    echo "Checking logs..."
    docker-compose logs --tail=50 app
    exit 1
fi
echo ""

# Step 7: Test health endpoint
echo "📋 Step 7: Testing health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:5000/health)
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    echo "Response: $HEALTH_RESPONSE"
else
    echo -e "${RED}❌ Health check failed${NC}"
    exit 1
fi
echo ""

# Step 8: Test main page
echo "📋 Step 8: Testing main page..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    echo -e "${GREEN}✅ Main page accessible (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ Main page returned HTTP $HTTP_CODE${NC}"
    exit 1
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
echo "  1. Open your browser: http://localhost:5000"
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

