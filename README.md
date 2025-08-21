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

## API Endpoint

### POST `/api/score`

Score problem statements or FSRs with custom criteria.

#### Authentication
Include the API key in the request header:
```
X-API-Key: SAGE-access
```

#### Request Body
```json
{
  "input_type": "problem_statement" | "fsr",
  "text": "Your text to evaluate",
  "criteria": [
    {
      "name": "Custom Criteria Name",
      "weight": 30
    }
  ]
}
```

**Parameters:**
- `input_type` (required): Either `"problem_statement"` or `"fsr"`
- `text` (required): The text to evaluate
- `criteria` (optional): Custom criteria with weights (will use default criteria if not provided)

#### Response
```json
{
  "score": 75,
  "evaluation": {
    "Criteria Name": {
      "passed": true,
      "score": 14.3
    }
  },
  "input_type": "problem_statement",
  "total_criteria": 7,
  "passed_criteria": 5
}
```

#### Example Usage
```bash
curl -X POST http://localhost:8055/api/score \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SAGE-access" \
  -d '{
    "input_type": "problem_statement",
    "text": "The wafer transfer system is experiencing intermittent failures during high-volume production runs."
  }'
```

## Technical Details

- **Backend**: Flask (Python)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **LanguageTool**: Grammar and style checking
- **LLM Integration**: AI-powered text evaluation
- **Database**: Snowflake for data storage


