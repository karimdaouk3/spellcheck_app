# 🧪 Docker Testing Guide

Complete guide to test your Docker setup before production deployment.

## 🚀 Quick Test (Automated)

Run the automated test script:

```bash
./test-docker.sh
```

This will:
- ✅ Check Docker is running
- ✅ Verify config.yaml exists
- ✅ Build the Docker image
- ✅ Start the container
- ✅ Test health endpoints
- ✅ Verify app is responding
- ✅ Show container status

---

## 🔧 Manual Testing Steps

If you prefer to test manually:

### 1. Verify Prerequisites

```bash
# Check Docker is installed and running
docker --version
docker-compose --version
docker info
```

**Expected:** Version numbers displayed, no errors.

### 2. Create Configuration

```bash
# Copy example config
cp config.yaml.example config.yaml

# Edit with your credentials
nano config.yaml
```

**Required settings:**
- Snowflake credentials (user, password, account, warehouse, role)
- `ENABLE_SSO: false` (for local testing)
- `DEV_MODE: true` (to use dev database)

### 3. Build the Docker Image

```bash
# Build the image
docker-compose build

# This takes 2-5 minutes on first run
# Downloads Python, Java, LanguageTool, installs dependencies
```

**Expected:** "Successfully built" message.

**If build fails:**
```bash
# Check for errors
docker-compose build --no-cache

# Common issues:
# - No internet connection
# - Docker out of disk space (run: docker system prune)
```

### 4. Start the Container

```bash
# Start in detached mode
docker-compose up -d

# View logs in real-time
docker-compose logs -f app
```

**Expected logs:**
```
LanguageTool started on port 8081
Starting gunicorn
Booting worker with pid: ...
```

**Wait 30-60 seconds** for LanguageTool to fully start.

### 5. Test Health Endpoint

```bash
# Test health check
curl http://localhost:5000/health

# Should return:
# {"status":"healthy","service":"spellcheck-app","timestamp":"..."}
```

**Expected:** `"status":"healthy"` in response.

### 6. Test Main Application

```bash
# Test main page
curl -I http://localhost:5000/

# Should return HTTP 200 or 302
```

**Open in browser:**
```bash
open http://localhost:5000
# or visit: http://localhost:5000
```

**Test checklist:**
- [ ] Page loads without errors
- [ ] Can log in (or see create case prompt if not SSO)
- [ ] Can create a new case
- [ ] Can enter text in editors
- [ ] Submit for review works
- [ ] Rewrite functionality works

### 7. Check Container Status

```bash
# View running containers
docker-compose ps

# Should show:
# NAME                STATUS              PORTS
# spellcheck-app-app-1   Up X minutes   0.0.0.0:5000->5000/tcp
```

**Expected:** Status = "Up"

### 8. Monitor Resource Usage

```bash
# Check CPU and memory usage
docker stats spellcheck-app-app-1

# Watch for:
# - High memory usage (>2GB may indicate memory leak)
# - High CPU (>80% sustained may indicate issues)
```

**Typical usage:**
- Memory: 500MB - 1GB
- CPU: 5-20% (spikes during LLM calls)

### 9. Test Database Connection

```bash
# Check logs for database errors
docker-compose logs app | grep -i error
docker-compose logs app | grep -i snowflake

# Should see successful connections:
# "Successfully connected to Snowflake"
```

### 10. Test Under Load (Optional)

```bash
# Make multiple concurrent requests
for i in {1..10}; do
  curl -s http://localhost:5000/health &
done
wait

# All should return healthy
```

---

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker-compose logs app

# Common issues:
# 1. Port 5000 already in use
#    Solution: Stop other services or change port in docker-compose.yml
# 2. config.yaml missing
#    Solution: cp config.yaml.example config.yaml
# 3. Invalid config.yaml syntax
#    Solution: Check YAML formatting (use yamllint)
```

### Health Check Fails

```bash
# Check if container is running
docker-compose ps

# Check logs
docker-compose logs --tail=100 app

# Common issues:
# 1. LanguageTool didn't start
#    Look for: "LanguageTool started on port 8081"
# 2. Gunicorn didn't start
#    Look for: "Booting worker with pid"
# 3. Python errors
#    Look for: "Traceback" or "Error"
```

### Database Connection Issues

```bash
# Test connection from inside container
docker-compose exec app python -c "
from snowflake.connector import connect
import yaml

with open('/app/config.yaml', 'r') as f:
    config = yaml.safe_load(f)
    
conn_payload = config.get('Engineering_SAGE_SVC', {})
conn = connect(**conn_payload)
print('✅ Snowflake connection successful')
conn.close()
"
```

### App is Slow

```bash
# Check resource usage
docker stats spellcheck-app-app-1

# If memory is high, increase in docker-compose.yml:
# deploy:
#   resources:
#     limits:
#       memory: 4G

# Restart with new limits
docker-compose down
docker-compose up -d
```

### Cannot Access from Browser

1. **Check if running:**
   ```bash
   docker-compose ps
   ```

2. **Check port mapping:**
   ```bash
   docker port spellcheck-app-app-1
   # Should show: 5000/tcp -> 0.0.0.0:5000
   ```

3. **Test from command line:**
   ```bash
   curl http://localhost:5000/health
   ```

4. **Check firewall:**
   - macOS: System Preferences → Security & Privacy → Firewall
   - Allow Docker to accept incoming connections

---

## 📊 Performance Benchmarks

**Expected performance on standard hardware:**

| Metric | Expected | Concerning |
|--------|----------|------------|
| Startup time | 30-60s | >2 minutes |
| Memory usage | 500MB-1GB | >2GB |
| CPU (idle) | 5-10% | >20% |
| Health check | <100ms | >1s |
| Page load | <2s | >5s |
| LLM call (submit) | 5-10s | >20s |
| LLM call (rewrite) | 2-5s | >10s |

---

## 🧹 Cleanup After Testing

```bash
# Stop containers
docker-compose down

# Remove containers and volumes
docker-compose down -v

# Remove images (to free space)
docker rmi spellcheck-app

# Clean up all Docker resources
docker system prune -a
```

---

## ✅ Pre-Production Checklist

Before deploying to production, verify:

- [ ] **Local Docker tests pass** (all steps above)
- [ ] **Config is correct**
  - [ ] `ENABLE_SSO: true` for production
  - [ ] `DEV_MODE: false` for production
  - [ ] Production Snowflake credentials
- [ ] **Security**
  - [ ] config.yaml not committed to git
  - [ ] Using strong passwords
  - [ ] SSL/TLS configured (via reverse proxy)
- [ ] **Performance**
  - [ ] Health checks respond quickly (<1s)
  - [ ] No memory leaks (stable usage over time)
  - [ ] CPU usage reasonable
- [ ] **Functionality**
  - [ ] Can create cases
  - [ ] Can submit for review
  - [ ] Can rewrite text
  - [ ] Database queries work
  - [ ] CRM integration works
- [ ] **Monitoring**
  - [ ] Logs are being collected
  - [ ] Alerts configured
  - [ ] Health checks set up

---

## 📈 Load Testing (Advanced)

For production readiness, test with realistic load:

```bash
# Install Apache Bench (if not installed)
# macOS: brew install httpd
# Linux: sudo apt-get install apache2-utils

# Test health endpoint with 1000 requests, 10 concurrent
ab -n 1000 -c 10 http://localhost:5000/health

# Test main page with 100 requests, 5 concurrent
ab -n 100 -c 5 http://localhost:5000/

# Monitor during test
docker stats spellcheck-app-app-1
```

**Good results:**
- All requests succeed (no failures)
- Average response time <500ms
- Memory usage stable
- No crashes

---

## 🎓 Learning More

**Useful Docker commands:**

```bash
# View all containers
docker ps -a

# View all images
docker images

# Enter container shell (for debugging)
docker-compose exec app bash

# View container resource limits
docker inspect spellcheck-app-app-1 | grep -A 10 "Memory"

# Copy files from container
docker cp spellcheck-app-app-1:/app/logs ./local-logs

# View Docker disk usage
docker system df
```

---

## 🆘 Getting Help

If tests fail:

1. **Check logs first:**
   ```bash
   docker-compose logs -f app
   ```

2. **Verify configuration:**
   ```bash
   cat config.yaml
   # Make sure credentials are correct
   ```

3. **Test components separately:**
   - Test Snowflake connection from local Python
   - Test LanguageTool directly (port 8081)
   - Test LiteLLM API key

4. **Clean rebuild:**
   ```bash
   docker-compose down -v
   docker-compose build --no-cache
   docker-compose up -d
   ```

5. **Check Docker resources:**
   - Docker Desktop → Settings → Resources
   - Increase Memory (4GB recommended)
   - Increase CPUs (2+ recommended)

---

## 🎯 Success Criteria

Your Docker setup is ready for production when:

✅ **Automated test script passes completely**  
✅ **All manual tests pass**  
✅ **App runs stable for 24+ hours**  
✅ **No memory leaks observed**  
✅ **Health checks consistently respond**  
✅ **All functionality works as expected**  
✅ **Performance meets benchmarks**  

**Ready to deploy?** See `DOCKER_DEPLOYMENT.md` for production deployment! 🚀

