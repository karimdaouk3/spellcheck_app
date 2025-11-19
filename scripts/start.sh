#!/usr/bin/env bash
set -euo pipefail

# Start LanguageTool server in background
JAVA_OPTS=${JAVA_OPTS:-"-Xms128m -Xmx512m"}
LT_PORT=${LT_PORT:-8081}
LT_DIR=/opt/LanguageTool

echo "Starting LanguageTool server on port $LT_PORT..."
java $JAVA_OPTS -cp "$LT_DIR/*" org.languagetool.server.HTTPServer --port $LT_PORT > /tmp/languagetool.log 2>&1 &
LT_PID=$!

echo "LanguageTool started (pid $LT_PID), waiting for it to be ready..."

# Wait for LanguageTool to be ready (max 60 seconds)
MAX_WAIT=60
WAIT_COUNT=0
LT_URL="http://localhost:${LT_PORT}"

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    # Check if LanguageTool is responding (try simple HTTP check or check if port is listening)
    if command -v curl > /dev/null 2>&1; then
        # Try to check if LanguageTool HTTP server is responding
        if curl -s --connect-timeout 2 "$LT_URL" > /dev/null 2>&1 || \
           curl -s --connect-timeout 2 "$LT_URL/v2/languages" > /dev/null 2>&1; then
            echo "✅ LanguageTool is ready!"
            break
        fi
    else
        # Fallback: check if port is listening using netcat or /proc
        if command -v nc > /dev/null 2>&1; then
            if nc -z localhost $LT_PORT 2>/dev/null; then
                echo "✅ LanguageTool port is listening!"
                sleep 2  # Give it a moment to fully initialize
                break
            fi
        elif [ -f /proc/net/tcp ]; then
            # Check if port is in listening state (hex format)
            PORT_HEX=$(printf "%04X" $LT_PORT)
            if grep -q ":$PORT_HEX " /proc/net/tcp 2>/dev/null; then
                echo "✅ LanguageTool port is listening!"
                sleep 2  # Give it a moment to fully initialize
                break
            fi
        fi
    fi
    
    # Check if LanguageTool process is still running
    if ! kill -0 $LT_PID 2>/dev/null; then
        echo "❌ LanguageTool process died. Checking logs:"
        tail -20 /tmp/languagetool.log || true
        exit 1
    fi
    
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $((WAIT_COUNT % 5)) -eq 0 ]; then
        echo "   Still waiting for LanguageTool... (${WAIT_COUNT}s/${MAX_WAIT}s)"
    fi
    sleep 1
done

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    echo "❌ LanguageTool failed to start within ${MAX_WAIT} seconds"
    echo "LanguageTool logs:"
    tail -30 /tmp/languagetool.log || true
    exit 1
fi

# Export URL so app.py can read it if needed
export LT_URL="$LT_URL"

# Start gunicorn for Flask app with increased timeouts
echo "Starting Gunicorn with ${WEB_CONCURRENCY:-2} workers..."
exec gunicorn \
    -w ${WEB_CONCURRENCY:-2} \
    -b 0.0.0.0:${PORT:-5000} \
    --timeout 120 \
    --graceful-timeout 30 \
    --keep-alive 5 \
    --max-requests 1000 \
    --max-requests-jitter 50 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    app:app
