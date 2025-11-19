# 🔧 Docker DNS Troubleshooting Guide

If you're getting "Temporary failure resolving 'deb.debian.org'" errors during Docker build, this guide will help you fix it.

## 🚨 Common Error

```
Temporary failure resolving 'deb.debian.org'
E: Unable to locate package openjdk-17-jre-headless
```

This means Docker can't resolve DNS during the build process.

## ✅ Solutions

### Solution 1: Configure DNS in docker-compose.yml (Recommended)

Edit `docker-compose.yml` and add DNS servers to the build section:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      dns:
        - 8.8.8.8        # Google DNS
        - 8.8.4.4        # Google DNS secondary
        # Or use your corporate DNS:
        # - 10.0.0.1
    ports:
      - "5000:5000"
    dns:                 # Also add for runtime
      - 8.8.8.8
      - 8.8.4.4
```

Then rebuild:
```bash
sudo docker-compose build --no-cache
```

### Solution 2: Configure Docker Daemon DNS

Create or edit `/etc/docker/daemon.json`:

```bash
sudo nano /etc/docker/daemon.json
```

Add:
```json
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

Restart Docker:
```bash
sudo systemctl restart docker
```

Then rebuild:
```bash
sudo docker-compose build --no-cache
```

### Solution 3: Use Corporate DNS

If you're on a corporate network, find your DNS servers:

```bash
# Check current DNS settings
cat /etc/resolv.conf

# Or
nmcli dev show | grep DNS
```

Then use those DNS servers in Solution 1 or 2 above.

### Solution 4: Test DNS from Server

First, verify your server can resolve DNS:

```bash
# Test DNS resolution
nslookup deb.debian.org

# Or
dig deb.debian.org

# Test connectivity
curl -I https://deb.debian.org
```

If these fail, the issue is with your server's network, not Docker.

### Solution 5: Configure Proxy (If Behind Corporate Proxy)

If you're behind a corporate proxy, configure Docker to use it:

**For Docker daemon:**
```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo nano /etc/systemd/system/docker.service.d/http-proxy.conf
```

Add:
```ini
[Service]
Environment="HTTP_PROXY=http://proxy.company.com:8080"
Environment="HTTPS_PROXY=http://proxy.company.com:8080"
Environment="NO_PROXY=localhost,127.0.0.1"
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

**For docker-compose build:**
Edit `docker-compose.yml`:
```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        HTTP_PROXY: http://proxy.company.com:8080
        HTTPS_PROXY: http://proxy.company.com:8080
        NO_PROXY: localhost,127.0.0.1
```

And update `Dockerfile` to accept these:
```dockerfile
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

FROM python:3.11-slim
# ... rest of Dockerfile
```

## 🔍 Diagnostic Commands

```bash
# Check Docker DNS settings
sudo docker info | grep -i dns

# Test DNS from inside a container
sudo docker run --rm alpine nslookup deb.debian.org

# Test connectivity
sudo docker run --rm alpine ping -c 3 8.8.8.8

# Check Docker network
sudo docker network inspect bridge
```

## 📝 Quick Fix Script

Run this to quickly configure Google DNS:

```bash
# Backup existing daemon.json if it exists
sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.bak 2>/dev/null || true

# Create daemon.json with DNS
echo '{
  "dns": ["8.8.8.8", "8.8.4.4"]
}' | sudo tee /etc/docker/daemon.json

# Restart Docker
sudo systemctl restart docker

# Verify
sudo docker info | grep -i dns

# Try building again
sudo docker-compose build --no-cache
```

## 🆘 Still Not Working?

1. **Check firewall rules** - Corporate firewalls may block Docker's network access
2. **Check VPN** - If using VPN, ensure it allows Docker traffic
3. **Contact IT** - Your network admin may need to whitelist Docker's network ranges
4. **Try building from a different network** - Test if it's network-specific

## 💡 Alternative: Build on Different Machine

If network restrictions are too strict, you can:
1. Build the image on a machine with proper network access
2. Save the image: `docker save spellcheck-app > spellcheck-app.tar`
3. Transfer to your server: `scp spellcheck-app.tar user@server:/path/`
4. Load on server: `docker load < spellcheck-app.tar`

