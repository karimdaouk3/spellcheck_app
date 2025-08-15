# FSR Coach – Docker

Build and run locally:

```bash
# From repo root
docker build -t fsr-coach .

docker run --rm -p 5000:5000 fsr-coach
```

Then open http://localhost:5000

Environment variables (optional):
- PORT: Flask port (default 5000)
- WEB_CONCURRENCY: Gunicorn workers (default 2)
- JAVA_OPTS: JVM opts for LanguageTool (default -Xms128m -Xmx512m)
- LT_PORT: LanguageTool port (default 8081)
