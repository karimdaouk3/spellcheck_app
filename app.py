from flask import Flask, request, jsonify, render_template
import language_tool_python as lt
# Add LiteLLM import
import litellm
import json
import time

# --- Start / connect to your running LanguageTool server ---------------
# Make sure the server is already running:
#   $ java -cp "*" org.languagetool.server.HTTPServer --port 8081
tool = lt.LanguageTool('en-US', remote_server='http://localhost:8081')
# -----------------------------------------------------------------------

app = Flask(__name__)

def filter_acronym_matches(text, matches):
    """Drop spelling-only alerts when the token is an ALL-CAPS acronym."""
    filtered = []
    for m in matches:
        token = text[m.offset : m.offset + m.errorLength]
        # LanguageTool marks pure spelling errors with ruleId starting with 'MORFOLOGIK'
        if m.ruleId.startswith("MORFOLOGIK") and token.isupper() and len(token) > 1:
            continue  # ignore acronym
        filtered.append(m)
    return filtered

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

@app.route("/check", methods=["POST"])
def check():
    data = request.get_json()
    text = data.get("text", "")
    
    if not text.strip():
        return jsonify([])
    
    try:
        matches = filter_acronym_matches(text, tool.check(text))
        
        # Send compact data back to the browser
        response = [
            {
                "offset": m.offset,
                "length": m.errorLength,
                "message": m.message,
                "replacements": m.replacements,   # list[str]
                "ruleId": m.ruleId,
                "errorType": get_error_type(m.ruleId),
            }
            for m in matches
        ]
        return jsonify(response)
    except Exception as e:
        print(f"Error checking text: {e}")
        return jsonify([])

@app.route("/llm", methods=["POST"])
def llm():
    data = request.get_json()
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"result": "No text provided."})

    # Format the ruleset into a readable string
    rules = "\n".join(f"- {rule.replace('_', ' ').capitalize()}" for rule in RULESET["common_characteristics"])

    user_prompt = f"""
Evaluate the following technical note against these criteria:\n{rules}\n\nFor each criterion, return a JSON object with the rule name as the key, and an object with:\n- 'passed': true or false\n- 'justification': a short explanation\nReturn only the JSON. No extra text.\n\nTechnical Note:{{text}}
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
            # Backend offset calculation for suggestions (nth occurrence logic)
            if isinstance(llm_result, dict) and 'suggestions' in llm_result and isinstance(llm_result['suggestions'], list):
                used_indices = []
                for s in llm_result['suggestions']:
                    original = s.get('original', '')
                    if not original:
                        s['start'] = None
                        s['end'] = None
                        continue
                    # Find the nth occurrence of original, where n = number of times we've already used it
                    n = used_indices.count(original)
                    start = nth_index(text, original, n)
                    if start == -1:
                        s['start'] = None
                        s['end'] = None
                        continue
                    end = start + len(original)
                    s['start'] = start
                    s['end'] = end
                    used_indices.append(original)
        except Exception as e:
            print(f"Error parsing LLM JSON: {e}\nRaw output: {llm_result_str}")
            return jsonify({"result": {}})
        return jsonify({"result": llm_result})
    except Exception as e:
        print(f"Error calling LLM: {e}")
        return jsonify({"result": f"LLM error: {e}"})

def nth_index(haystack, needle, n):
    # Return the start index of the nth occurrence of needle in haystack
    if not needle:
        return -1
    start = -1
    for _ in range(n+1):
        start = haystack.find(needle, start + 1)
        if start == -1:
            return -1
    return start

@app.route("/llm-realign", methods=["POST"])
def llm_realign():
    data = request.get_json()
    text = data.get("text", "")
    suggestions = data.get("suggestions", [])
    if not text.strip() or not isinstance(suggestions, list):
        return jsonify([])
    used_indices = []
    new_suggestions = []
    for s in suggestions:
        original = s.get("original", "")
        if not original:
            continue
        n = used_indices.count(original)
        start = nth_index(text, original, n)
        if start == -1:
            continue  # skip if not found
        end = start + len(original)
        s["start"] = start
        s["end"] = end
        used_indices.append(original)
        new_suggestions.append(s)
    return jsonify(new_suggestions)

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

if __name__ == "__main__":
    print("Starting LanguageTool Flask App...")
    print("Make sure LanguageTool is running on http://localhost:8081")
    # tiny convenience: `python app.py` → http://localhost:5000
    app.run(debug=True)