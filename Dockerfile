# syntax=docker/dockerfile:1

FROM python:3.11-slim

# Install system deps: Java for LanguageTool, unzip
# Using openjdk-21 as openjdk-17 is not available in Debian Trixie
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jre-headless unzip && rm -rf /var/lib/apt/lists/*

# Copy and install LanguageTool server from local file
COPY LanguageTool-stable.zip /tmp/LanguageTool-stable.zip
RUN mkdir -p /opt && unzip -q /tmp/LanguageTool-stable.zip -d /opt && \
    LT_DIR=$(find /opt -maxdepth 1 -type d -name "LanguageTool*" | head -1) && \
    mv "$LT_DIR" /opt/LanguageTool && \
    rm -f /tmp/LanguageTool-stable.zip

# Create app directory
WORKDIR /app

# Install Python dependencies first (better caching)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir gunicorn

# Copy application code
COPY . .

# Copy start script
COPY scripts/start.sh /start.sh
RUN chmod +x /start.sh

# Expose Flask port
EXPOSE 5000

# Default environment
ENV PYTHONUNBUFFERED=1 \
    PORT=5000 \
    FLASK_ENV=production

# Start LanguageTool server then run the app via gunicorn
CMD ["/start.sh"]
