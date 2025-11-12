# 🐳 Docker Deployment Guide

This guide explains how to deploy the Spellcheck App using Docker for production.

## 📋 Prerequisites

1. **Docker** installed on your machine or server
   - [Install Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac/Windows)
   - Or install Docker Engine (Linux)

2. **Docker Compose** (included with Docker Desktop)

3. **Your credentials** - Snowflake database credentials and LiteLLM API keys

## 🚀 Quick Start

### 1. Set Up Configuration

```bash
# Copy the example config file
cp config.yaml.example config.yaml

# Edit config.yaml with your credentials
nano config.yaml  # or use your preferred editor
```

**Important:** Fill in:
- Snowflake username, password, account, warehouse, role
- Set `ENABLE_SSO: true` for production (or `false` for testing)
- Set `DEV_MODE: false` for production database

### 2. Build and Run with Docker Compose

```bash
# Build the Docker image
docker-compose build

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop the application
docker-compose down
```

The app will be available at: **http://localhost:5000**

### 3. Build and Run with Docker Only

If you don't want to use Docker Compose:

```bash
# Build the image
docker build -t spellcheck-app .

# Run the container
docker run -d \
  --name spellcheck-app \
  -p 5000:5000 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  spellcheck-app

# View logs
docker logs -f spellcheck-app

# Stop the container
docker stop spellcheck-app
docker rm spellcheck-app
```

## 🏭 Production Deployment

### Option 1: Deploy to Cloud Platform

Most cloud platforms support Docker directly:

#### **AWS Elastic Container Service (ECS)**
```bash
# 1. Push image to AWS ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ECR_URL
docker tag spellcheck-app:latest YOUR_ECR_URL/spellcheck-app:latest
docker push YOUR_ECR_URL/spellcheck-app:latest

# 2. Create ECS task definition and service (via AWS Console or CLI)
```

#### **Azure Container Instances**
```bash
# Login to Azure
az login

# Create container instance
az container create \
  --resource-group myResourceGroup \
  --name spellcheck-app \
  --image spellcheck-app:latest \
  --cpu 2 --memory 4 \
  --ports 5000 \
  --environment-variables PORT=5000
```

#### **Google Cloud Run**
```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT/spellcheck-app

# Deploy to Cloud Run
gcloud run deploy spellcheck-app \
  --image gcr.io/YOUR_PROJECT/spellcheck-app \
  --platform managed \
  --port 5000 \
  --memory 2Gi
```

### Option 2: Deploy to Your Own Server

**1. Install Docker on your server:**
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**2. Transfer files to server:**
```bash
# From your local machine
scp -r . user@your-server:/opt/spellcheck-app
```

**3. Run on server:**
```bash
# SSH into server
ssh user@your-server

# Navigate to app directory
cd /opt/spellcheck-app

# Start with docker-compose
docker-compose up -d

# Or use systemd to auto-start on boot (see below)
```

### Option 3: Use Systemd for Auto-Start

Create a systemd service file:

```bash
# Create service file
sudo nano /etc/systemd/system/spellcheck-app.service
```

**Content:**
```ini
[Unit]
Description=Spellcheck App Docker Container
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/spellcheck-app
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable spellcheck-app
sudo systemctl start spellcheck-app
sudo systemctl status spellcheck-app
```

## 🔒 Security Best Practices

### 1. **Never Commit Credentials**
```bash
# Ensure config.yaml is in .gitignore
echo "config.yaml" >> .gitignore
```

### 2. **Use Environment Variables for Production**

Instead of mounting `config.yaml`, use environment variables:

**Update docker-compose.yml:**
```yaml
environment:
  - SNOWFLAKE_USER=${SNOWFLAKE_USER}
  - SNOWFLAKE_PASSWORD=${SNOWFLAKE_PASSWORD}
  - SNOWFLAKE_ACCOUNT=${SNOWFLAKE_ACCOUNT}
  # ... etc
```

**Update app.py** to read from environment if config.yaml doesn't exist.

### 3. **Use Docker Secrets** (for Docker Swarm)
```bash
echo "my_snowflake_password" | docker secret create snowflake_password -
```

### 4. **Enable HTTPS**

Use a reverse proxy like **Nginx** or **Traefik**:

```yaml
# docker-compose.yml with Nginx
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - app
  
  app:
    # ... existing config
    expose:
      - "5000"  # Only expose to internal network
```

## 📊 Monitoring & Logs

### View Logs
```bash
# All logs
docker-compose logs -f

# Just app logs
docker-compose logs -f app

# Last 100 lines
docker-compose logs --tail=100 app
```

### Health Check
```bash
# Check if app is healthy
docker-compose ps

# Manual health check
curl http://localhost:5000/health
```

### Resource Usage
```bash
# See container resource usage
docker stats spellcheck-app
```

## 🔧 Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose logs app

# Common issues:
# 1. config.yaml missing or malformed
# 2. Port 5000 already in use
# 3. Insufficient memory
```

### Database Connection Issues
```bash
# Test Snowflake connection from inside container
docker-compose exec app python -c "
from snowflake.connector import connect
# ... test connection
"
```

### Performance Tuning

**Increase memory for LanguageTool:**
```yaml
# docker-compose.yml
environment:
  - JAVA_OPTS=-Xms512m -Xmx2g  # Increase heap size
```

**Increase Gunicorn workers:**
```yaml
environment:
  - WEB_CONCURRENCY=8  # 2-4 workers per CPU core
```

## 📦 Image Management

### Reduce Image Size
```bash
# Current image size
docker images spellcheck-app

# Clean up unused images
docker image prune -a
```

### Tag and Version
```bash
# Tag for versioning
docker tag spellcheck-app:latest spellcheck-app:v1.0.0

# Push to registry
docker push your-registry/spellcheck-app:v1.0.0
```

## 🔄 Updates & Rollbacks

### Update Application
```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose build
docker-compose up -d

# View logs to ensure success
docker-compose logs -f app
```

### Rollback
```bash
# Stop current version
docker-compose down

# Checkout previous version
git checkout v1.0.0

# Rebuild and start
docker-compose build
docker-compose up -d
```

## 📚 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Flask Deployment Best Practices](https://flask.palletsprojects.com/en/latest/deploying/)
- [Gunicorn Documentation](https://docs.gunicorn.org/)

## 💡 Tips

1. **Use Multi-Stage Builds** to reduce image size (already implemented)
2. **Pin versions** in requirements.txt for reproducibility
3. **Use .dockerignore** to exclude unnecessary files (already implemented)
4. **Monitor resource usage** - adjust memory/CPU as needed
5. **Set up automatic backups** for your Snowflake data
6. **Use load balancer** for high availability (multiple container instances)

## 🆘 Getting Help

If you encounter issues:
1. Check logs: `docker-compose logs -f app`
2. Verify config.yaml is correct
3. Test Snowflake connection separately
4. Check firewall/security group settings
5. Ensure sufficient resources (CPU, RAM, disk)

---

**Ready to deploy?** Start with the Quick Start section above! 🚀

