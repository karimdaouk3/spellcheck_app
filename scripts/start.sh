#!/usr/bin/env bash
set -euo pipefail

# Start LanguageTool server in background
JAVA_OPTS=${JAVA_OPTS:-"-Xms128m -Xmx512m"}
LT_PORT=${LT_PORT:-8081}
LT_DIR=/opt/LanguageTool

java $JAVA_OPTS -cp "$LT_DIR/*" org.languagetool.server.HTTPServer --port $LT_PORT &
LT_PID=$!

echo "LanguageTool started on port $LT_PORT (pid $LT_PID)"

# Export URL so app.py can read it if needed
export LT_URL="http://localhost:${LT_PORT}"

# Start gunicorn for Flask app
exec gunicorn -w ${WEB_CONCURRENCY:-2} -b 0.0.0.0:${PORT:-5000} app:app
