# 🐧 Rocky Linux Deployment Guide

Quick guide to deploy the Spellcheck App on Rocky Linux servers.

## 🚀 Quick Start

### Step 1: Install Docker (if not already installed)

```bash
# Install Docker and Docker Compose
sudo dnf install -y docker docker-compose

# If docker-compose is not in dnf, install manually:
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Start and enable Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Verify Docker is running
sudo docker ps
```

### Step 2: Fix Permission Issues

**If you get "permission denied" errors:**

```bash
# Add your user to docker group
sudo usermod -aG docker $USER

# Apply group changes without logging out
newgrp docker

# Verify it works (should work without sudo now)
docker ps
```

**If you still get errors, use sudo temporarily:**
```bash
sudo docker-compose build
sudo docker-compose up -d
```

### Step 3: Set Up Configuration

```bash
# Navigate to your app directory
cd /path/to/spellcheck_app

# Copy example config
cp config.yaml.example config.yaml

# Edit with your credentials
nano config.yaml
# or
vi config.yaml
```

**Required settings in config.yaml:**
- Snowflake credentials (user, password, account, warehouse, role)
- `ENABLE_SSO: true` or `false` (depending on your setup)
- `DEV_MODE: false` for production

### Step 4: Build and Run

```bash
# Build the Docker image
docker-compose build
# OR if you need sudo:
sudo docker-compose build

# Start the application
docker-compose up -d
# OR if you need sudo:
sudo docker-compose up -d

# View logs
docker-compose logs -f app
# OR:
sudo docker-compose logs -f app
```

### Step 5: Verify It's Running

```bash
# Check container status
docker-compose ps
# OR:
sudo docker-compose ps

# Test health endpoint
curl http://localhost:5000/health

# Should return: {"status":"healthy",...}
```

## 🔧 Common Issues

### Issue 1: Permission Denied

**Error:** `permission denied while trying to connect to the Docker daemon socket`

**Fix:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply changes
newgrp docker

# Or use sudo for all commands
sudo docker-compose build
```

### Issue 2: Docker Service Not Running

**Error:** `Cannot connect to the Docker daemon`

**Fix:**
```bash
# Check status
sudo systemctl status docker

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker
```

### Issue 3: Port Already in Use

**Error:** `port is already allocated`

**Fix:**
```bash
# Find what's using port 5000
sudo netstat -tulpn | grep 5000
# OR
sudo ss -tulpn | grep 5000

# Stop existing container
docker-compose down
# OR
sudo docker-compose down

# Or change port in docker-compose.yml
```

### Issue 4: config.yaml Missing

**Error:** Container starts but app fails

**Fix:**
```bash
# Make sure config.yaml exists
ls -la config.yaml

# If missing, create from example
cp config.yaml.example config.yaml
nano config.yaml  # Edit with your credentials
```

## 📋 Useful Commands

```bash
# View logs
docker-compose logs -f app

# Stop application
docker-compose down

# Restart application
docker-compose restart

# Rebuild after code changes
docker-compose build --no-cache
docker-compose up -d

# Check resource usage
docker stats

# Remove everything (containers, images, volumes)
docker-compose down -v
docker system prune -a
```

## 🔄 Auto-Start on Boot

To make the app start automatically when the server reboots:

```bash
# Create systemd service
sudo nano /etc/systemd/system/spellcheck-app.service
```

**Add this content:**
```ini
[Unit]
Description=Spellcheck App Docker Container
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/spellcheck_app
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
# Replace /path/to/spellcheck_app with your actual path
sudo systemctl daemon-reload
sudo systemctl enable spellcheck-app
sudo systemctl start spellcheck-app
sudo systemctl status spellcheck-app
```

## 📝 Notes

- **Always use `newgrp docker`** after adding yourself to the docker group, or log out and back in
- **If you use sudo**, you may need to use it for all docker commands
- **Check logs** if something doesn't work: `docker-compose logs -f app`
- **Wait 30-60 seconds** after starting for LanguageTool to fully initialize

## 🆘 Still Having Issues?

1. Check Docker is running: `sudo systemctl status docker`
2. Check you're in docker group: `groups` (should show "docker")
3. Check logs: `docker-compose logs app`
4. Verify config.yaml exists and is valid
5. Check port 5000 is not in use: `sudo ss -tulpn | grep 5000`

