# syntax=docker/dockerfile:1

FROM python:3.11-slim

# Install system deps: Java for LanguageTool, curl, unzip
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless curl unzip && rm -rf /var/lib/apt/lists/*

# Download and install LanguageTool server
ENV LT_VERSION=6.4
RUN mkdir -p /opt && curl -fsSL -o /tmp/LanguageTool-${LT_VERSION}.zip https://languagetool.org/download/LanguageTool-${LT_VERSION}.zip && unzip -q /tmp/LanguageTool-${LT_VERSION}.zip -d /opt && mv /opt/LanguageTool-${LT_VERSION} /opt/LanguageTool && rm -f /tmp/LanguageTool-${LT_VERSION}.zip

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
