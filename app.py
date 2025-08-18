from flask import Flask, request, jsonify, render_template, session
import language_tool_python as lt
# Add LiteLLM import
import litellm
import json
import time
import os
import snowflake.connector
import uuid

TERMS_FILE = 'terms.json'

def load_terms():
    if os.path.exists(TERMS_FILE):
        with open(TERMS_FILE, 'r') as f:
            try:
                return json.load(f)
            except Exception:
                return []
    return []

def save_terms(terms):
    with open(TERMS_FILE, 'w') as f:
        json.dump(terms, f, indent=2)

# --- Start / connect to your running LanguageTool server ---------------
# Make sure the server is already running:
#   $ java -cp "*" org.languagetool.server.HTTPServer --port 8081
tool = lt.LanguageTool('en-US', remote_server='http://localhost:8081')
# -----------------------------------------------------------------------

# --- Ruleset definitions ---
PROBLEM_STATEMENT_RULESET = {
    "rules": [
        {"name": "clearly_states_problem", "weight": 30},
        {"name": "includes_relevant_context", "weight": 25},
        {"name": "is_concise_and_specific", "weight": 25},
        {"name": "uses_professional_language", "weight": 20}
    ],
    "advice": [
        "Focus on clearly articulating the core problem or issue",
        "Include relevant technical context and background information",
        "Be specific and avoid vague language",
        "Use professional and technical terminology appropriately"
    ]
}
FSR_RULESET = {
    "rules": [
        {"name": "documents_daily_activities", "weight": 30},
        {"name": "notes_any_issues_encountered", "weight": 25},
        {"name": "lists_action_items", "weight": 25},
        {"name": "is_clear_and_complete", "weight": 20}
    ],
    "advice": [
        "Document all daily activities and tasks performed",
        "Note any issues, problems, or challenges encountered",
        "List specific action items and next steps",
        "Ensure the notes are clear, complete, and well-organized"
    ]
}
# -----------------------------------------------------------------------

app = Flask(__name__)

def get_error_type(ruleId):
    if ruleId.startswith("MORFOLOGIK"):
        return "spelling"
    elif "grammar" in ruleId.lower():
        return "grammar"
    elif "style" in ruleId.lower():
        return "style"
    else:
        return "other"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/wiki")
def wiki():
    # Deprecated: redirect to instructional video page
    return render_template("video.html")

@app.route("/video")
def video():
    return render_template("video.html")

@app.route("/check", methods=["POST"])
def check():
    data = request.get_json()
    text = data.get("text", "")
    
    if not text.strip():
        return jsonify([])
    
    try:
        matches = tool.check(text)
        
        # Load KLA term bank
        terms = []
        if os.path.exists('terms.json'):
            try:
                with open('terms.json', 'r') as f:
                    terms = json.load(f)
            except Exception:
                terms = []
        # Filter out spelling errors for words in the term bank
        response = []
        for m in matches:
            token = text[m.offset : m.offset + m.errorLength]
            error_type = get_error_type(m.ruleId)
            if error_type == 'spelling' and token in terms:
                continue  # Ignore this error
            response.append({
                "offset": m.offset,
                "length": m.errorLength,
                "message": m.message,
                "replacements": m.replacements,   # list[str]
                "ruleId": m.ruleId,
                "errorType": error_type,
            })
        return jsonify(response)
    except Exception as e:
        print(f"Error checking text: {e}")
        return jsonify([])

@app.route('/terms', methods=['GET', 'POST'])
def terms_route():
    TERMS_FILE = 'terms.json'
    import os
    import json
    if request.method == 'POST':
        data = request.get_json()
        term = data.get('term', '').strip()
        if not term:
            return jsonify({'error': 'No term provided'}), 400
        # Load terms
        if os.path.exists(TERMS_FILE):
            try:
                with open(TERMS_FILE, 'r') as f:
                    terms = json.load(f)
            except Exception:
                terms = []
        else:
            terms = []
        if term not in terms:
            terms.append(term)
            with open(TERMS_FILE, 'w') as f:
                json.dump(terms, f, indent=2)
        # Only return confirmation, not the full list
        return jsonify({'status': 'ok', 'added': term})
    else:  # GET
        if os.path.exists(TERMS_FILE):
            try:
                with open(TERMS_FILE, 'r') as f:
                    terms = json.load(f)
            except Exception:
                terms = []
        else:
            terms = []
        return jsonify({'terms': terms})

@app.route("/ruleset/<ruleset_name>", methods=["GET"])
def get_ruleset(ruleset_name):
    if ruleset_name == "fsr":
        return jsonify(FSR_RULESET)
    else:
        return jsonify(PROBLEM_STATEMENT_RULESET)

@app.route("/llm", methods=["POST"])
def llm():
    data = request.get_json()
    text = data.get("text", "")
    answers = data.get("answers")
    step = data.get("step", 1)
    ruleset_name = data.get("ruleset", "problem_statement")
    if ruleset_name == "fsr":
        RULESET = FSR_RULESET
    else:
        RULESET = PROBLEM_STATEMENT_RULESET
    if not text.strip():
        return jsonify({"result": "No text provided."})

    # Format the ruleset into a readable string
    rules = "\n".join(f"- {rule['name'].replace('_', ' ').capitalize()}" for rule in RULESET["rules"])

    if step == 1:
        # Step 1: Evaluation and questions
        user_prompt = f"""
Evaluate the following technical note against these criteria:\n{rules}\n\nFor each criterion, return a JSON object with the rule name as the key, and an object with:\n- 'passed': true or false\n- 'justification': a short explanation\n- If failed, 'question': a question that would help the user improve their input to pass this criterion\nReturn only the JSON. No extra text.\n\nTechnical Note:{{text}}
"""
        try:
            response = litellm.completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                api_base=API_BASE,
                api_key=API_KEY,
                custom_llm_provider=LLM_PROVIDER,
                temperature=0.1
            )
            llm_result_str = response["choices"][0]["message"]["content"]
            try:
                llm_result = json.loads(llm_result_str)
            except Exception as e:
                print(f"Error parsing LLM JSON: {e}\nRaw output: {llm_result_str}")
                return jsonify({"result": {}})
            # Generate a review_id and attach per-question rewrite_ids
            review_id = f"rev_{uuid.uuid4()}"
            if isinstance(llm_result, dict):
                for key, section in llm_result.items():
                    if isinstance(section, dict) and not section.get('passed') and section.get('question'):
                        section['rewrite_id'] = f"rw_{uuid.uuid4()}"
            # Optionally store in session for validation later
            session.setdefault('reviews', {})
            session['reviews'][review_id] = {k: v.get('rewrite_id') for k, v in llm_result.items() if isinstance(v, dict) and 'rewrite_id' in v}
            session.modified = True
            return jsonify({"result": {"review_id": review_id, "evaluation": llm_result}})
        except Exception as e:
            print(f"Error calling LLM: {e}")
            return jsonify({"result": f"LLM error: {e}"})
    elif step == 2:
        # Step 2: Generate rewrite using answers
        # Support answers as an array of {rewrite_id, answer} or legacy map {criteria: answer}
        answers_str = ""
        if isinstance(answers, list):
            lines = []
            for item in answers:
                if not isinstance(item, dict):
                    continue
                rid = item.get('rewrite_id', 'unknown_id')
                ans = item.get('answer', '')
                lines.append(f"- [{rid}] {ans}")
            answers_str = "\n".join(lines)
        elif isinstance(answers, dict):
            answers_str = "\n".join(f"- {k}: {v}" for k, v in answers.items())
        user_prompt = f"""
Given the original technical note and the user's answers to the following questions, generate an improved version that would pass all criteria.\n\nOriginal Note: {{text}}\nUser Answers:\n{answers_str}\n\nReturn only the improved statement as 'rewrite' in a JSON object.\nExample: {{\"rewrite\": \"...\"}}
"""
        try:
            response = litellm.completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                api_base=API_BASE,
                api_key=API_KEY,
                custom_llm_provider=LLM_PROVIDER,
                temperature=0.1
            )
            llm_result_str = response["choices"][0]["message"]["content"]
            try:
                llm_result = json.loads(llm_result_str)
            except Exception as e:
                print(f"Error parsing LLM JSON: {e}\nRaw output: {llm_result_str}")
                return jsonify({"result": {}})
            return jsonify({"result": llm_result})
        except Exception as e:
            print(f"Error calling LLM: {e}")
            return jsonify({"result": f"LLM error: {e}"})
    else:
        return jsonify({"result": "Invalid step value."})

@app.route("/speech-to-text", methods=["POST"])
def speech_to_text():
    # Accept audio file upload (simulate processing)
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file uploaded."}), 400
    audio_file = request.files['audio']
    # Simulate processing delay
    time.sleep(1)
    # In the real implementation, you would process the audio here
    return jsonify({"transcription": "Transcribed text will appear here. (Placeholder: 'This is a sample transcription.')"})

@app.route("/overall-feedback", methods=["GET", "POST"])
def overall_feedback():
    if request.method == "GET":
        return render_template("feedback.html")
    
    # Handle POST request for overall feedback form
    experience_rating = request.form.get('experience_rating')
    helpfulness_rating = request.form.get('helpfulness_rating')
    future_interest = request.form.get('future_interest')
    feedback_text = request.form.get('feedback_text', '')
    
    if not experience_rating or not helpfulness_rating or not future_interest:
        return render_template("feedback.html", 
                             message="Please fill in all required fields.", 
                             message_type="error")
    
    # Save feedback to file
    feedback_data = {
        "experience_rating": experience_rating,
        "helpfulness_rating": helpfulness_rating,
        "future_interest": future_interest,
        "feedback_text": feedback_text,
        "timestamp": time.time()
    }
    
    # Load existing feedback
    OVERALL_FEEDBACK_FILE = 'overall_feedback.json'
    if os.path.exists(OVERALL_FEEDBACK_FILE):
        with open(OVERALL_FEEDBACK_FILE, "r") as f:
            all_feedback = json.load(f)
    else:
        all_feedback = []
    
    all_feedback.append(feedback_data)
    
    with open(OVERALL_FEEDBACK_FILE, "w") as f:
        json.dump(all_feedback, f, indent=2)
    
    return render_template("feedback.html", 
                         message="Thank you for your feedback! It has been submitted successfully.", 
                         message_type="success")

@app.route("/feedback", methods=["POST"])
def feedback():
    data = request.get_json()
    # Expecting: { "criteria": ..., "text": ..., "feedback": ..., "explanation": ..., "passed": ... }
    if not data or "criteria" not in data or "text" not in data or "feedback" not in data:
        return jsonify({"status": "error", "message": "Invalid data"}), 400

    # Load existing feedback
    if os.path.exists(EVALUATION_FEEDBACK_FILE):
        with open(EVALUATION_FEEDBACK_FILE, "r") as f:
            feedback_data = json.load(f)
    else:
        feedback_data = []

    entry = {
        "criteria": data["criteria"],
        "text": data["text"],
        "feedback": data["feedback"],
        "timestamp": time.time()
    }
    if "explanation" in data:
        entry["explanation"] = data["explanation"]
    if "passed" in data:
        entry["passed"] = data["passed"]
    feedback_data.append(entry)

    with open(EVALUATION_FEEDBACK_FILE, "w") as f:
        json.dump(feedback_data, f)

    return jsonify({"status": "ok"})

REWRITE_FEEDBACK_FILE = 'rewrite_feedback.json'

@app.route("/rewrite-feedback", methods=["POST"])
def rewrite_feedback():
    """
    Repurposed to handle textual feedback on a completed rewrite only.
    Expects JSON with keys: previous_text, rewritten_text, rewrite_qas, feedback_text,
    first_name, last_name, email, employee_id.
    """
    data = request.get_json(silent=True) or {}
    required = ["previous_text", "rewritten_text", "rewrite_qas", "feedback_text"]
    if not all(k in data and str(data[k]).strip() != "" for k in required):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    # Snowflake insert matching your template style
    try:
        # Pull user attributes from session-backed user_data
        user_data = session.get('user_data', {})
        insert_query = """
            INSERT INTO SAGE.TEXTIO_SERVICES_INPUTS.LLM_REWRITE_FEEDBACK
            (text, rewritten_text, rewrite_qas, feedback_text, sentiment, timestamp, first_name, last_name, email, employeeID)
            SELECT %s, %s, PARSE_JSON(%s), %s, %s, TO_TIMESTAMP(%s), %s, %s, %s, %s
        """
        params = (
            data["previous_text"],
            data["rewritten_text"],
            json.dumps(data["rewrite_qas"]),
            data["feedback_text"],
            data.get("sentiment"),
            data.get("timestamp") or time.time(),
            user_data.get("first_name", ""),
            user_data.get("last_name", ""),
            user_data.get("email", ""),
            user_data.get("employee_id", ""),
        )

        conn = snowflake.connector.connect(
            account=os.environ.get("SNOWFLAKE_ACCOUNT"),
            user=os.environ.get("SNOWFLAKE_USER"),
            password=os.environ.get("SNOWFLAKE_PASSWORD"),
            warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE"),
            database=os.environ.get("SNOWFLAKE_DATABASE"),
            schema=os.environ.get("SNOWFLAKE_SCHEMA"),
            role=os.environ.get("SNOWFLAKE_ROLE"),
            client_session_keep_alive=True,
        )
        try:
            with conn.cursor() as cur:
                cur.execute(insert_query, params)
        finally:
            conn.close()
        return jsonify({"status": "ok"})
    except Exception as e:
        print(f"Error inserting rewrite feedback: {e}")
        return jsonify({"status": "error", "message": "Failed to log rewrite feedback"}), 500

# --- Simple user endpoint (placeholder). Replace with real auth/user source if available ---
@app.route("/user", methods=["GET"])
def get_user():
    # Try to load from environment variables as a basic example; otherwise return blanks
    return jsonify({
        "first_name": os.environ.get("USER_FIRST_NAME", ""),
        "last_name": os.environ.get("USER_LAST_NAME", ""),
        "email": os.environ.get("USER_EMAIL", ""),
        "employee_id": os.environ.get("USER_EMPLOYEE_ID", "")
    })

# --- LLM evaluation logging ---
EVALUATION_LOG_FILE = 'llm_evaluation_log.json'

@app.route("/llm-evaluation-log", methods=["POST"])
def llm_evaluation_log():
    data = request.get_json(silent=True) or {}
    required = ["text", "score", "criteria", "timestamp"]
    if not all(k in data for k in required):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    # Append to file
    existing = []
    if os.path.exists(EVALUATION_LOG_FILE):
        try:
            with open(EVALUATION_LOG_FILE, "r") as f:
                existing = json.load(f)
        except Exception:
            existing = []
    existing.append(data)
    with open(EVALUATION_LOG_FILE, "w") as f:
        json.dump(existing, f, indent=2)
    return jsonify({"status": "ok"})

# --- Rewrite evaluation logging (new endpoint for the new button) ---
REWRITE_EVALUATION_LOG_FILE = 'llm_rewrite_evaluation.json'

@app.route("/rewrite-evaluation-log", methods=["POST"])
def rewrite_evaluation_log():
    data = request.get_json(silent=True) or {}
    # Expected fields: first_name, last_name, email, employee_id, previous_text, rewritten_text, rewrite_qas, timestamp
    required = [
        "previous_text", "rewritten_text", "rewrite_qas"
    ]
    if not all(k in data for k in required):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    # Append to file for now; in production this would insert into a database/table
    existing = []
    if os.path.exists(REWRITE_EVALUATION_LOG_FILE):
        try:
            with open(REWRITE_EVALUATION_LOG_FILE, "r") as f:
                existing = json.load(f)
        except Exception:
            existing = []
    # Add server-side timestamp if not provided
    if "timestamp" not in data:
        data["timestamp"] = time.time()
    existing.append(data)
    with open(REWRITE_EVALUATION_LOG_FILE, "w") as f:
        json.dump(existing, f, indent=2)
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("Starting LanguageTool Flask App...")
    print("Make sure LanguageTool is running on http://localhost:8081")
    # tiny convenience: `python app.py` → http://localhost:5000
    app.run(debug=True)