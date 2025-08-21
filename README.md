# FSR Coach

A web application for evaluating and improving problem statements and FSR notes using AI-powered analysis.

## Quick Start

### Prerequisites
- Python 3.7 or higher
- Java 8 or higher (for LanguageTool)
- pip (Python package installer)

### Installation & Setup

1. **Install Python Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Download LanguageTool**:
   - Download LanguageTool from [https://languagetool.org/download/](https://languagetool.org/download/)
   - Extract the downloaded file to a directory of your choice

3. **Start LanguageTool Server**:
   ```bash
   # Navigate to your LanguageTool directory
   cd /path/to/languagetool-standalone
   
   # Start the LanguageTool server on port 8081
   java -cp "*" org.languagetool.server.HTTPServer --port 8081
   ```

4. **Run the Application** (in a new terminal):
   ```bash
   python app.py
   ```

5. **Add Instructional Video** (optional):
   - Place your `instructional.mp4` file in the `static/video/` folder
   - The video will be available at `/video` endpoint

6. **Access the App**:
   Open your browser and go to `http://localhost:8055`

## Features

- **Problem Statement Evaluation**: AI-powered analysis of problem statements
- **FSR Notes Evaluation**: Evaluation of daily FSR notes
- **Text Rewriting**: AI-assisted text improvement suggestions
- **History Tracking**: Save and restore previous evaluations
- **Instructional Video**: Built-in tutorial system

## API Endpoints

- **POST** `/api/score` - Score problem statements or FSRs with custom criteria
- **POST** `/llm` - Main LLM evaluation endpoint
- **POST** `/llm-evaluation-log` - Log evaluation results
- **POST** `/overall-feedback` - Submit overall feedback

## Technical Details

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **LanguageTool**: Grammar and style checking
- **LLM Integration**: AI-powered text evaluation
- **Database**: Snowflake for data storage

## Docker Alternative

If you prefer using Docker:

```bash
# Build and run with Docker
docker build -t fsr-coach .
docker run --rm -p 5000:5000 fsr-coach
```

Then open http://localhost:5000

### Docker Environment Variables (optional):
- PORT: Flask port (default 5000)
- WEB_CONCURRENCY: Gunicorn workers (default 2)
- JAVA_OPTS: JVM opts for LanguageTool (default -Xms128m -Xmx512m)
- LT_PORT: LanguageTool port (default 8081)
