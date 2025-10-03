from functools import wraps
from flask import Flask, request, jsonify, render_template,redirect, session, url_for
from xml.etree import ElementTree as ET
import language_tool_python as lt
import litellm
import json
import time
import uuid
import os
import base64
import requests
from openai import OpenAI
import tempfile
import pandas as pd
from datetime import datetime
from pydub import AudioSegment
import subprocess
from pathlib import Path
 
from onelogin.saml2.auth import OneLogin_Saml2_Auth
from onelogin.saml2.settings import OneLogin_Saml2_Settings
from utils import (
    SYSTEM_PROMPT,
    ACTIVE_MODEL_CONFIG,
    CONNECTION_PAYLOAD
)
from snowflakeconnection import snowflake_query
import yaml
from werkzeug.middleware.proxy_fix import ProxyFix
# --- Start / connect to your running LanguageTool server ---------------
# Make sure the server is already running:
#   $ java -cp "*" org.languagetool.server.HTTPServer --port 8081
tool = lt.LanguageTool('en-US', remote_server='http://localhost:8081')
# -----------------------------------------------------------------------

app = Flask(__name__)
app.secret_key = 'placeholder_key'
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
 
 
openai_api_key = "EMPTY"
openai_api_base = "http://ca1pgpu02:8081/v1"
 
client = OpenAI(
    api_key=openai_api_key,
    base_url=openai_api_base,
)
 
# settings = OneLogin_Saml2_Settings(settings=None, custom_base_path=os.path.join(os.getcwd(), 'saml'))
# print("SAML security at runtime", settings.get_security_data())
 
def init_saml_auth(req):
    return OneLogin_Saml2_Auth(req, custom_base_path=os.path.join(os.getcwd(), 'saml'))
 
 
def prepare_flask_request(request):
    return {
        'https': 'on' if request.scheme == 'https' else 'off',
        'http_host': request.host,
        'script_name': request.path,
        'server_port': request.environ.get('SERVER_PORT'),
        'get_data': request.args.copy(),
        'post_data': request.form.copy()
    }
 
@app.route('/login')
def login():
    if not app.config['ENABLE_SSO']:
        # Simulate login for development or non-SSO mode
        session["user_data"] = {
            "username": "dev_user",
            "email": "dev@example.com",
            "first_name": "Dev",
            "last_name": "User",
            "employee_id": "0000",
            "user_id": 0
        }
        print("[DBG] Login: SSO disabled, using mock user_data")
        return redirect(url_for('index'))

    req = prepare_flask_request(request)
    auth = init_saml_auth(req)
    return redirect(auth.login(return_to='https://fsrcoach/api/sso_login'))

  
@app.route('/api/sso_login', methods=['POST'])
def acs():
    post_data = request.form.copy()
    saml_response = post_data.get('SAMLResponse')
 
    if saml_response:
        decode_response = base64.b64decode(saml_response)
        root = ET.fromstring(decode_response)
 
        attributes = {}
        for attribute_element in root.iter('{urn:oasis:names:tc:SAML:2.0:assertion}Attribute'):
            attribute_name = attribute_element.get('Name')
            attribute_values = [value.text for value in attribute_element.iter('{urn:oasis:names:tc:SAML:2.0:assertion}AttributeValue')]
            attributes[attribute_name] = attribute_values
 
        username = "{}".format(*attributes['username'])
        email = "{}".format(*attributes['email'])
        first_name = "{}".format(*attributes['firstname'])
        last_name = "{}".format(*attributes['lastname'])
        employee_id = "{}".format(*attributes['employeeID'])
 
        user_info = {
            "username": username,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "employee_id": employee_id
        }
 
        # Check if user already exists
        check_query = f"SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.USER_INFORMATION WHERE EMPLOYEEID = %s"
        check_params = (employee_id,)
        result_df = snowflake_query(check_query, CONNECTION_PAYLOAD, check_params)
 
        # If user doesn't exist, insert them
        if result_df.iloc[0, 0] == 0:
            insert_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.USER_INFORMATION (FIRST_NAME, LAST_NAME, EMAIL, EMPLOYEEID)
            VALUES (%s, %s, %s, %s)
            """
            insert_params = (first_name, last_name, email, employee_id)
            snowflake_query(insert_query, CONNECTION_PAYLOAD, insert_params, return_df=False)
 
        # Get user ID from USER_INFORMATION
        get_id_query = f"SELECT ID FROM {DATABASE}.{SCHEMA}.USER_INFORMATION WHERE EMPLOYEEID = %s"
        get_id_params = (employee_id,)
        id_df = snowflake_query(get_id_query, CONNECTION_PAYLOAD, get_id_params)
        user_id = int(id_df.iloc[0]["ID"])  # Convert to regular Python int
        print(f"[DBG] Login: Retrieved user_id={user_id} for employee_id={employee_id}")
 
        # Add user_id to session data
        user_info["user_id"] = user_id
        session["user_data"] = user_info
        print(f"[DBG] Login: Set session user_data={user_info}")
        print(f"[DBG] Login: Session keys after setting={list(session.keys())}")
 
        return redirect(url_for('index'))
 
    return "No response"
 
 
@app.route('/')
def index():
    user_data = session.get('user_data')
    if not user_data:
        return redirect(url_for('login'))
    return render_template("index.html")
 
@app.route('/user', methods=['GET'])
def current_user():
    """Return session-backed user information for frontend debugging and logging."""
    info = session.get('user_data')
    if not info:
        return jsonify({"status": "no_session"}), 404
    return jsonify({
        "status": "ok",
        "user_id": info.get("user_id"),
        "first_name": info.get("first_name"),
        "last_name": info.get("last_name"),
        "email": info.get("email"),
        "employee_id": info.get("employee_id")
    })

# ==================== MOCK CASE MANAGEMENT ENDPOINTS ====================
# These are temporary mock endpoints that return hardcoded data
# TODO: Replace with actual database queries when ready

# Mock data for valid case numbers (hardcoded)
MOCK_VALID_CASES = [
    "CASE-2024-001",
    "CASE-2024-002",
    "CASE-2024-003",
    "CASE-2024-100",
    "CASE-2024-101",
    "CASE-2024-999",
    "12345",
    "67890",
    "TEST-001"
]

# Mock data for closed cases (hardcoded)
MOCK_CLOSED_CASES = [
    "CASE-2024-002",  # This case is closed
    "67890"           # This case is also closed
]

# Mock in-memory storage for user case data
# Structure: { user_id: { case_number: { problemStatement, fsrNotes, updatedAt } } }
MOCK_USER_CASE_DATA = {
    # Example: Pre-populated data for testing (user_id = 0)
    "0": {
        "CASE-2024-001": {
            "caseNumber": "CASE-2024-001",
            "problemStatement": "Customer experiencing slow response times during peak hours.",
            "fsrNotes": "Initial analysis shows database query optimization needed. Customer has 500+ concurrent users.",
            "updatedAt": "2024-01-15T10:30:00Z"
        },
        "CASE-2024-003": {
            "caseNumber": "CASE-2024-003",
            "problemStatement": "Authentication failures for external users accessing the portal.",
            "fsrNotes": "SSO configuration issue identified. Working with IT security team to resolve.",
            "updatedAt": "2024-01-14T15:45:00Z"
        }
    }
}

@app.route('/api/cases/validate/<case_number>', methods=['GET'])
def validate_case_number(case_number):
    """
    Mock endpoint to validate if a case number exists in the system.
    Returns whether the case is valid and if it's open or closed.
    
    TODO: Replace with actual database query
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    # Mock validation logic
    is_valid = case_number in MOCK_VALID_CASES
    is_closed = case_number in MOCK_CLOSED_CASES
    
    if not is_valid:
        return jsonify({
            "valid": False,
            "message": f"Case number '{case_number}' does not exist in the system."
        }), 404
    
    return jsonify({
        "valid": True,
        "case_number": case_number,
        "is_closed": is_closed,
        "status": "closed" if is_closed else "open"
    })

@app.route('/api/cases/user-cases', methods=['GET'])
def get_user_cases():
    """
    Mock endpoint to get all open cases for the current user.
    Returns list of case numbers that are open and belong to the user.
    
    TODO: Replace with actual database query filtering by user_id and status
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Mock: Return all valid cases that are not closed
    # In real implementation, this would filter by user_id from database
    open_cases = [case for case in MOCK_VALID_CASES if case not in MOCK_CLOSED_CASES]
    
    return jsonify({
        "user_id": user_id,
        "cases": open_cases,
        "count": len(open_cases)
    })

@app.route('/api/cases/status', methods=['POST'])
def check_cases_status():
    """
    Mock endpoint to check status of multiple cases at once.
    Accepts a list of case numbers and returns their status.
    
    TODO: Replace with actual database query
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_numbers = data.get('case_numbers', [])
    
    results = []
    for case_number in case_numbers:
        is_valid = case_number in MOCK_VALID_CASES
        is_closed = case_number in MOCK_CLOSED_CASES
        
        results.append({
            "case_number": case_number,
            "valid": is_valid,
            "is_closed": is_closed,
            "status": "closed" if is_closed else ("open" if is_valid else "invalid")
        })
    
    return jsonify({
        "results": results
    })

@app.route('/api/cases/data', methods=['GET'])
def get_user_case_data():
    """
    Mock endpoint to get all case data for the current user.
    Returns all cases with their problem statements and FSR notes.
    
    TODO: Replace with actual database query
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Get user's case data from mock storage
    user_cases = MOCK_USER_CASE_DATA.get(user_id, {})
    
    # Filter out closed cases
    open_cases = {}
    for case_number, case_data in user_cases.items():
        if case_number not in MOCK_CLOSED_CASES:
            open_cases[case_number] = case_data
    
    return jsonify({
        "user_id": user_id,
        "cases": open_cases,
        "count": len(open_cases)
    })

@app.route('/api/cases/data/<case_number>', methods=['GET'])
def get_case_data(case_number):
    """
    Mock endpoint to get data for a specific case.
    
    TODO: Replace with actual database query
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Check if user has this case
    user_cases = MOCK_USER_CASE_DATA.get(user_id, {})
    case_data = user_cases.get(case_number)
    
    if not case_data:
        return jsonify({
            "found": False,
            "message": "No saved data for this case"
        }), 404
    
    return jsonify({
        "found": True,
        "data": case_data
    })

@app.route('/api/cases/data/<case_number>', methods=['PUT'])
def save_case_data(case_number):
    """
    Mock endpoint to save case data for a user.
    Accepts problemStatement and fsrNotes.
    
    TODO: Replace with actual database insert/update
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Validate case number exists and is open
    if case_number not in MOCK_VALID_CASES:
        return jsonify({"error": "Invalid case number"}), 400
    
    if case_number in MOCK_CLOSED_CASES:
        return jsonify({"error": "Cannot save data for closed case"}), 400
    
    data = request.get_json()
    problem_statement = data.get('problemStatement', '')
    fsr_notes = data.get('fsrNotes', '')
    
    # Initialize user's cases dict if doesn't exist
    if user_id not in MOCK_USER_CASE_DATA:
        MOCK_USER_CASE_DATA[user_id] = {}
    
    # Save the case data
    MOCK_USER_CASE_DATA[user_id][case_number] = {
        "caseNumber": case_number,
        "problemStatement": problem_statement,
        "fsrNotes": fsr_notes,
        "updatedAt": datetime.utcnow().isoformat() + 'Z'
    }
    
    return jsonify({
        "success": True,
        "message": "Case data saved successfully",
        "case_number": case_number,
        "updated_at": MOCK_USER_CASE_DATA[user_id][case_number]["updatedAt"]
    })

@app.route('/api/cases/data', methods=['POST'])
def save_multiple_cases():
    """
    Mock endpoint to save multiple cases at once.
    Accepts array of case objects with caseNumber, problemStatement, fsrNotes.
    
    TODO: Replace with actual database batch insert/update
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    data = request.get_json()
    cases = data.get('cases', [])
    
    # Initialize user's cases dict if doesn't exist
    if user_id not in MOCK_USER_CASE_DATA:
        MOCK_USER_CASE_DATA[user_id] = {}
    
    saved_count = 0
    errors = []
    
    for case_data in cases:
        case_number = case_data.get('caseNumber')
        
        # Validate
        if case_number not in MOCK_VALID_CASES:
            errors.append(f"Invalid case: {case_number}")
            continue
        
        if case_number in MOCK_CLOSED_CASES:
            errors.append(f"Case is closed: {case_number}")
            continue
        
        # Save
        MOCK_USER_CASE_DATA[user_id][case_number] = {
            "caseNumber": case_number,
            "problemStatement": case_data.get('problemStatement', ''),
            "fsrNotes": case_data.get('fsrNotes', ''),
            "updatedAt": datetime.utcnow().isoformat() + 'Z'
        }
        saved_count += 1
    
    return jsonify({
        "success": True,
        "saved_count": saved_count,
        "errors": errors
    })

# ==================== END MOCK ENDPOINTS ====================

@app.before_request
def _dbg_before_request():
    try:
        path = request.path
        meth = request.method
        host = request.host
        ua = request.headers.get('User-Agent', '')
        sess_keys = list((session or {}).keys())
        print(f"[DBG] BEFORE {meth} {path} host={host} ua={ua[:60]}... session_keys={sess_keys}")
    except Exception as e:
        print(f"[DBG] BEFORE error: {e}")

@app.after_request
def _dbg_after_request(resp):
    try:
        resp.headers['X-Endpoint'] = str(getattr(request, 'endpoint', None))
        print(f"[DBG] AFTER {request.method} {request.path} status={resp.status_code} endpoint={request.endpoint}")
    except Exception as e:
        print(f"[DBG] AFTER error: {e}")
    return resp

@app.errorhandler(404)
def _dbg_404(err):
    try:
        rules = [str(r) for r in app.url_map.iter_rules()]
        print(f"[DBG] 404 path={request.path} method={request.method} known_routes={rules}")
    except Exception as e:
        print(f"[DBG] 404 logging error: {e}")
    return err, 404

@app.route('/routes', methods=['GET'])
def list_routes():
    routes = []
    for r in app.url_map.iter_rules():
        routes.append({
            'rule': str(r),
            'endpoint': r.endpoint,
            'methods': sorted(list(r.methods or []))
        })
    return jsonify({'routes': routes})

# Removed /api/user; use only /user

@app.route("/video")
def video():
    return render_template("video.html")
 
@app.route("/overall-feedback", methods=["GET", "POST"])
def overall_feedback():
    if request.method == "GET":
        return render_template("feedback.html")
 
    # Handle POST request for overall feedback form
    experience_rating = request.form.get('experience_rating')
    helpfulness_rating = request.form.get('helpfulness_rating')
    future_interest = request.form.get('future_interest')
    feedback_text = request.form.get('feedback_text', '')
    timestamp = time.time()
 
    if not experience_rating or not helpfulness_rating or not future_interest:
        return render_template("feedback.html", 
                               message="Please fill in all required fields.", 
                               message_type="error")
 
    # Get user info from session
    user_data = session.get("user_data", {})
    print(f"[DBG] /overall-feedback user_data: {user_data}")
    print(f"[DBG] /overall-feedback user_data keys: {list(user_data.keys()) if user_data else 'None'}")
    
    # If user_id is missing but we have employee_id, try to get it from database
    if not user_data.get("user_id") and user_data.get("employee_id"):
        try:
            print(f"[DBG] /overall-feedback: Attempting to retrieve user_id for employee_id={user_data.get('employee_id')}")
            get_id_query = f"SELECT ID FROM {DATABASE}.{SCHEMA}.USER_INFORMATION WHERE EMPLOYEEID = %s"
            get_id_params = (user_data.get("employee_id"),)
            id_df = snowflake_query(get_id_query, CONNECTION_PAYLOAD, get_id_params)
            if id_df is not None and not id_df.empty:
                user_id = int(id_df.iloc[0]["ID"])  # Convert to regular Python int
                user_data["user_id"] = user_id
                session["user_data"] = user_data
                print(f"[DBG] /overall-feedback: Retrieved and set user_id={user_id}")
            else:
                print(f"[DBG] /overall-feedback: No user found for employee_id={user_data.get('employee_id')}")
        except Exception as e:
            print(f"[DBG] /overall-feedback: Error retrieving user_id: {e}")
    
    required_fields = ["user_id", "first_name", "last_name", "email", "employee_id"]
    missing_fields = [field for field in required_fields if not user_data.get(field)]
 
    if missing_fields:
        print(f"[DBG] /overall-feedback missing fields: {missing_fields}")
        return render_template("feedback.html", 
                               message=f"Missing user attributes: {', '.join(missing_fields)}", 
                               message_type="error")
 
    # Insert into OVERALL_FEEDBACK using user_id
    insert_query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.OVERALL_FEEDBACK
        (USER_ID, EXPERIENCE_RATING, HELPFULNESS_RATING, FUTURE_INTEREST, FEEDBACK_TEXT, TIMESTAMP)
        VALUES (%s, %s, %s, %s, %s, TO_TIMESTAMP_NTZ(%s))
    """
    params = (
        user_data["user_id"],
        experience_rating,
        helpfulness_rating,
        future_interest,
        feedback_text,
        timestamp
    )
 
    try:
        snowflake_query(insert_query, CONNECTION_PAYLOAD, params=params, return_df=False)
        return render_template("feedback.html", 
                               message="Thank you for your feedback! It has been submitted successfully.", 
                               message_type="success")
    except Exception as e:
        print(f"Error inserting overall feedback: {e}")
        return render_template("feedback.html", 
                               message="An error occurred while submitting your feedback.", 
                               message_type="error")
 
@app.route("/feedback", methods=["POST"])
def feedback():
    data = request.get_json()
    if not data or "criteria" not in data or "text" not in data or "feedback" not in data:
        return jsonify({"status": "error", "message": "Invalid data"}), 400
 
    user_data = session.get("user_data", {})
    required_fields = ["first_name", "last_name", "email", "employee_id"]
    missing_fields = [field for field in required_fields if not user_data.get(field)]
 
    if missing_fields:
        return jsonify({
            "status": "error",
            "message": f"Missing user attributes: {', '.join(missing_fields)}"
        }), 400
 
    entry = {
        "feedback": data.get("feedback", ""),
        "timestamp": time.time(),
        "explanation": data.get("explanation", ""),
        "passed": data.get("passed", False),
        "rewrite_id": data.get("rewrite_id"),
        "user_input_id": data.get("user_input_id"),
    }
 
    # Insert only required fields
    query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.EVALUATION_FEEDBACK 
        (rewrite_id, user_input_id, feedback, timestamp, explanation, passed)
        VALUES (%s, %s, %s, TO_TIMESTAMP(%s), %s, %s)
    """
 
    params = (
        entry["rewrite_id"],
        entry["user_input_id"],
        entry["feedback"],
        entry["timestamp"],
        entry["explanation"],
        entry["passed"],
    )
 
    snowflake_query(query, CONNECTION_PAYLOAD, params)
    return jsonify({"status": "ok"})
 
 
@app.route("/llm-evaluation-log", methods=["POST"])
def llm_evaluation_log():
    data = request.get_json()
    print(f"[DBG] /llm-evaluation-log received data: {data}")
    if not data or "text" not in data or "score" not in data or "criteria" not in data or "timestamp" not in data:
        missing = []
        if not data:
            missing.append("no data")
        else:
            if "text" not in data: missing.append("text")
            if "score" not in data: missing.append("score")
            if "criteria" not in data: missing.append("criteria")
            if "timestamp" not in data: missing.append("timestamp")
        print(f"[DBG] /llm-evaluation-log missing fields: {missing}")
        return jsonify({"status": "error data"}), 400
 
    user_data = session.get("user_data", {})
    print(f"[DBG] /llm-evaluation-log session exists: {bool(session)}")
    print(f"[DBG] /llm-evaluation-log user_data: {user_data}")
    print(f"[DBG] /llm-evaluation-log user_data keys: {list(user_data.keys()) if user_data else 'None'}")
    required_fields = ["first_name", "last_name", "email", "employee_id"]
    missing_fields = [field for field in required_fields if not user_data.get(field)]
 
    if missing_fields:
        print(f"[DBG] /llm-evaluation-log missing fields: {missing_fields}")
        return jsonify({
            "status": "error",
            "message": f"Missing user attributes: {', '.join(missing_fields)}"
        }), 400
 
    try:
        # Validate foreign key relationships
        user_input_id = data.get("user_input_id")
        rewrite_uuid = data.get("rewrite_uuid")
        
        # Check if user_input_id exists in USER_SESSION_INPUTS
        if user_input_id:
            user_check = snowflake_query(
                f"""
                SELECT ID FROM {DATABASE}.{SCHEMA}.USER_SESSION_INPUTS
                WHERE ID = %s
                """,
                CONNECTION_PAYLOAD,
                params=(user_input_id,)
            )
            if user_check is None or user_check.empty:
                print(f"[DBG] /llm-evaluation-log: user_input_id {user_input_id} not found in USER_SESSION_INPUTS")
                return jsonify({"status": "error", "message": "Invalid user_input_id"}), 400
        
        # Check if rewrite_uuid exists in LLM_REWRITE_PROMPTS
        # Note: rewrite_uuid is optional and may not exist when restoring from history
        # Only validate if rewrite_uuid is provided and we're not in a history restoration scenario
        if rewrite_uuid:
            rewrite_check = snowflake_query(
                f"""
                SELECT REWRITE_UUID FROM {DATABASE}.{SCHEMA}.LLM_REWRITE_PROMPTS
                WHERE REWRITE_UUID = %s
                """,
                CONNECTION_PAYLOAD,
                params=(rewrite_uuid,)
            )
            if rewrite_check is None or rewrite_check.empty:
                print(f"[DBG] /llm-evaluation-log: rewrite_uuid {rewrite_uuid} not found in LLM_REWRITE_PROMPTS - setting to null")
                rewrite_uuid = None  # Set to null instead of failing
        
        insert_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.LLM_EVALUATION 
            (USER_INPUT_ID, ORIGINAL_TEXT, REWRITTEN_TEXT, SCORE, REWRITE_UUID, TIMESTAMP)
            VALUES (%s, %s, %s, %s, %s, TO_TIMESTAMP(%s))
        """

        params = (
            user_input_id,
            data["text"],
            data.get("rewritten_text", data["text"]),
            data["score"],
            rewrite_uuid,
            data["timestamp"]
        )

        snowflake_query(insert_query, CONNECTION_PAYLOAD, params=params, return_df=False)
        print(f"[DBG] Successfully inserted LLM evaluation log with user_input_id={user_input_id}, rewrite_uuid={rewrite_uuid}")
        return jsonify({"status": "ok"})
    except Exception as e:
        print(f"Error inserting evaluation log: {e}")
        return jsonify({"status": "error", "message": "Failed to log evaluation"}), 500
 
 
@app.route("/rewrite-feedback", methods=["POST"])
def rewrite_feedback():
    """
    Handles rewrite evaluation thumbs (up/down) and optional text.
    Expects JSON with keys: user_input_id, rewrite_uuid, feedback_text, sentiment, timestamp.
    """
    data = request.get_json(silent=True) or {}
    required = ["user_input_id", "rewrite_uuid", "sentiment"]
    if not all(k in data for k in required):
        return jsonify({"status": "error", "message": "Missing required fields"}), 400

    insert_query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.REWRITE_EVALUATION
        (user_input_id, rewrite_uuid, feedback_text, sentiment, timestamp)
        VALUES (%s, %s, %s, %s, TO_TIMESTAMP(%s))
    """
    params = (
        data.get("user_input_id"),
        data.get("rewrite_uuid"),
        data.get("feedback_text", ""),
        data.get("sentiment"),
        data.get("timestamp") or time.time(),
    )
    try:
        snowflake_query(insert_query, CONNECTION_PAYLOAD, params=params, return_df=False)
        return jsonify({"status": "ok"})
    except Exception as e:
        print(f"Error inserting rewrite feedback: {e}")
        return jsonify({"status": "error", "message": "Failed to log rewrite feedback"}), 500
 
 
 
 
@app.route('/terms', methods=['GET', 'POST'])
def terms_route():
    if request.method == 'POST':
        data = request.get_json()
        term = data.get('term', '').strip()
 
        if not term:
            return jsonify({'error': 'No term provided'}), 400
 
        try:
            # Check if term already exists (case-insensitive)
            query = f"""
                SELECT term FROM {DATABASE}.{SCHEMA}.KLA_GLOSSARY
                WHERE LOWER(term) = LOWER(%s)
            """
            result = snowflake_query(query, CONNECTION_PAYLOAD, params=(term,))
            termthere = result["TERM"].values.tolist()
        except Exception as e:
            return jsonify({'error': 'Could not connect to KLA Dictionary'}), 500
 
        if not termthere:
            try:
                insert_query = f"""
                    INSERT INTO {DATABASE}.{SCHEMA}.KLA_GLOSSARY (term, def)
                    VALUES (%s, '')
                """
                snowflake_query(insert_query, CONNECTION_PAYLOAD, params=(term,), return_df=False)
            except Exception as e:
                return jsonify({'error': 'Failed to insert new term'}), 500
 
        return jsonify({'status': 'ok', 'added': term})
 
    else:  # GET request
        try:
            result = snowflake_query(
                f"SELECT term FROM {DATABASE}.{SCHEMA}.KLA_GLOSSARY",
                CONNECTION_PAYLOAD
            )
            terms = result["TERM"].values.tolist()
        except Exception as e:
            return jsonify({'error': 'Could not connect to KLA Dictionary'}), 500
 
        return jsonify({'terms': terms})

def get_error_type(ruleId):
    if ruleId.startswith("MORFOLOGIK"):
        return "spelling"
    elif "grammar" in ruleId.lower():
        return "grammar"
    elif "style" in ruleId.lower():
        return "style"
    else:
        return "other"

# @app.route("/")
# def index():
#     return render_template("index.html")

@app.route("/check", methods=["POST"])
def check():
    data = request.get_json()
    text = data.get("text", "")
    
    if not text.strip():
        return jsonify([])
    
    try:
        matches = tool.check(text)
        
        # Load KLA term bank
        try:
            result = snowflake_query(
                f"SELECT term FROM {DATABASE}.{SCHEMA}.KLA_GLOSSARY",
                CONNECTION_PAYLOAD
            )
            terms = result["TERM"].values
        except Exception as e:
            return jsonify({'error': 'Could not connect to KLA Dictionary'}), 500
 
        response = []
        for m in matches:
            token = text[m.offset : m.offset + m.errorLength]
            error_type = get_error_type(m.ruleId)
 
            # Skip spelling errors if token is in the glossary
            if error_type == 'spelling' and token in terms:
                continue
 
            response.append({
                "offset": m.offset,
                "length": m.errorLength,
                "message": m.message,
                "replacements": m.replacements,
                "ruleId": m.ruleId,
                "errorType": error_type,
            })
        return jsonify(response)
    except Exception as e:
        print(f"Error checking text: {e}")
        return jsonify([])

import re

def _normalize_criteria_name(name: str) -> str:
    try:
        s = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip()).lower()
        return s.strip("_") or "rule"
    except Exception:
        return "rule"

def load_ruleset_from_db(input_field_type: str, group_name: str = "DEFAULT"):
    query = f"""
        SELECT c.id AS CRITERIA_ID,
               c.criteria AS CRITERIA_NAME,
               c.weight AS WEIGHT,
               c.criteria_description AS DESCRIPTION
        FROM {DATABASE}.{SCHEMA}.CRITERIA c
        JOIN {DATABASE}.{SCHEMA}.CRITERIA_GROUPS g
          ON g.criteria_id = c.id
        WHERE g.input_field_type = %s
          AND g."GROUP" = %s
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY c.id
          ORDER BY g.group_version DESC, c.criteria_version DESC, g.date_added DESC
        ) = 1
        ORDER BY c.id
    """
    try:
        df = snowflake_query(query, CONNECTION_PAYLOAD, params=(input_field_type, group_name))
        rules = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                # Convert criteria_name to a human-readable display name
                criteria_name = str(row["CRITERIA_NAME"])
                display_name = criteria_name.replace("_", " ").title()
                
                rules.append({
                    "id": int(row["CRITERIA_ID"]),
                    "name": criteria_name,
                    "display_name": display_name,
                    "weight": float(row["WEIGHT"]) if row["WEIGHT"] is not None else 0,
                    "description": row.get("DESCRIPTION")
                })
        print(f"[DBG] Loaded {len(rules)} criteria for {input_field_type}/{group_name}")
        return {"rules": rules}
    except Exception as e:
        print(f"Failed to load ruleset from DB: {e}")
        return {"rules": []}

@app.route("/ruleset/<ruleset_name>", methods=["GET"])
def get_ruleset(ruleset_name):
    if ruleset_name == "fsr":
        return jsonify(load_ruleset_from_db("FSR_DAILY_NOTE", "DEFAULT"))
    else:
        return jsonify(load_ruleset_from_db("PROBLEM_STATEMENT", "DEFAULT"))

@app.route("/llm", methods=["POST"])
def llm():
    data = request.get_json() or {}
    text = data.get("text", "")
    answers = data.get("answers", {})
    try:
        step = int(data.get("step", 1))
    except Exception:
        step = 1
    ruleset_name = data.get("ruleset", "problem_statement")

    print(f"[DBG] /llm start data_keys={list(data.keys())} step={step} ruleset={ruleset_name}")

    # Load rules dynamically from DB
    if ruleset_name == "fsr":
        rules_payload = load_ruleset_from_db("FSR_DAILY_NOTE", "DEFAULT")
    else:
        rules_payload = load_ruleset_from_db("PROBLEM_STATEMENT", "DEFAULT")
    # Advice list
    if ruleset_name == "fsr":
        advice_list = []
    else:
        advice_list = [
            "Focus on observable facts",
            "Experience-based and Process/System-based knowledge is valuable to the process for external information",
            "Minimize/remove unsubstantiated/emotional content"
        ]

    if not text.strip():
        print("[DBG] /llm abort empty text")
        return jsonify({"result": "No text provided."})

    # Shared model config
    model_kwargs = {
        "model": ACTIVE_MODEL_CONFIG["model"],
        "api_base": ACTIVE_MODEL_CONFIG["api_base"],
        "custom_llm_provider": ACTIVE_MODEL_CONFIG["provider"],
        "temperature": 0.1,
    }
    if ACTIVE_MODEL_CONFIG["use_token_provider"]:
        model_kwargs["azure_ad_token_provider"] = ACTIVE_MODEL_CONFIG["token_provider"]
        model_kwargs["api_version"] = ACTIVE_MODEL_CONFIG["api_version"]
    else:
        model_kwargs["api_key"] = ACTIVE_MODEL_CONFIG["api_key"]

    # Build prompt
    if step == 1:
        rules_list = [r['name'] for r in (rules_payload.get('rules') or [])]
        print(f"[DBG] /llm rules loaded count={len(rules_list)} rules={rules_list}")
        rules_lines = "\n".join(f"- {n}" for n in rules_list)
        advice = "\n".join(f"- {tip}" for tip in advice_list)
        rewrite_uuid = str(uuid.uuid4())
        user_prompt = (
            "Criteria to evaluate (use EXACTLY these names as keys; do NOT invent or add any others):\n"
            f"{rules_lines}\n\n"
            "General advice for the user (DO NOT treat these as criteria keys):\n"
            f"{advice}\n\n"
            "Here is the text to review:\n"
            f"\"\"\"\n{text}\n\"\"\"\n\n"
            "Instructions:\n"
            f"- You must return a JSON with this exact structure and keys ONLY from this list: {json.dumps(rules_list)}\n"
            "- For each criterion, include: passed (boolean), justification (string), and if not passed, a question (string).\n"
            "- Do NOT add any keys not present in the criteria list. Do NOT use advice items as keys.\n"
            "- Do NOT use Markdown formatting (no ```json or ``` markers)\n"
            "- Return ONLY raw JSON without any formatting or code blocks\n\n"
            "Return your response as JSON like:\n"
            "{\n"
            "  \"evaluation\": {\n"
            "    \"<criterion_name>\": {\n"
            "      \"passed\": true/false,\n"
            "      \"justification\": \"...\",\n"
            "      \"question\": \"...\"\n"
            "    }\n"
            "  }\n"
            "}\n"
            "- Only return the JSON object; no extra commentary, no Markdown formatting."
        )
    else:
        answers_str = json.dumps(answers, indent=2)
        if ruleset_name == "problem_statement":
            example_line = (
                '{"rewrite": "<Rewritten problem statement>\\n\\n'
                '[AFFECTED]: <How many are affected or how widespread?>\\n'
                '[SIZE]: <Size or extent of the issue?>\\n'
                '[TIMEFRAME]: <When it happened or how long it lasted?>\\n'
                '[FREQUENCY]: <How often or regular is the issue?>"}'
            )
        elif ruleset_name == "fsr":
            example_line = (
                '{"rewrite": "<Rewritten FSR notes>\\n\\n'
                '[PART_NUMBERS]: <Part numbers included?>\\n'
                '[DIAGNOSTICS]: <Diagnostic test results included?>"}'
            )

        user_prompt = f"""
            Given the original technical note and the user's answers to the following questions, generate an improved version that would pass more criteria. Rewrite the problem statement clearly, incorporating any relevant information from the answers. Then, list each satisfied criterion as a tag in the format [CRITERIA]: value, including answers from the original problem statement if applicable.

            EXTREMELY IMPORTANT: Never change the spelling of words that you do not recognize. Some of these are technical words, and they may already be spelled correctly even if you cannot recognize them.

            Original Note: {text}
            User Answers: {answers_str}

            CRITICAL: You must return ONLY a valid JSON object with this exact structure:
            {{"rewrite": "Your improved statement here"}}

            IMPORTANT RULES:
            - Use double quotes for JSON keys and string values
            - Escape any internal double quotes with backslash: \\" 
            - Use \\n for line breaks within the rewrite text
            - Do not include any text before or after the JSON object
            - Never add or make up information that is not present
            - If an answer is empty, don't use that question/information to improve the note
            - DO NOT summarize or repeat the user answers in your response
            - DO NOT include "User Answers Summary" or similar text
            - Focus ONLY on generating the improved technical note
            - DO NOT use Markdown formatting (no ```json or ``` markers)
            - Return ONLY raw JSON without any formatting or code blocks
     
            Example format:
            {example_line}
        """


    # Call LLM (for both steps)
    print(f"[DBG] /llm calling LLM with model_kwargs: {model_kwargs}")
    print(f"[DBG] /llm prompt length: {len(user_prompt)}")
    try:
        # Add timeout and retry logic
        max_retries = 2
        for attempt in range(max_retries):
            try:
                response = litellm.completion(
                    messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_prompt}],
                    **model_kwargs
                )
                break  # Success, exit retry loop
            except Exception as retry_error:
                print(f"[DBG] /llm attempt {attempt + 1} failed: {retry_error}")
                if attempt == max_retries - 1:  # Last attempt
                    raise retry_error
                time.sleep(1)  # Wait before retry
        
        # Check if response is valid
        if not response or "choices" not in response or not response["choices"]:
            print(f"[DBG] /llm invalid response structure: {response}")
            raise Exception("Invalid LLM response structure")
            
        llm_result_str = response["choices"][0]["message"]["content"]
        
        # Check if response content is empty or whitespace
        if not llm_result_str or not llm_result_str.strip():
            print(f"[DBG] /llm empty response content: '{llm_result_str}'")
            raise Exception("LLM returned empty response")
        try:
            # First, try to parse the raw response as JSON
            llm_result = json.loads(llm_result_str)
        except Exception as e:
            print(f"[DBG] /llm JSON parse error: {e}")
            print(f"[DBG] /llm RAW response (first 800 chars): {llm_result_str[:800]}")
            print(f"[DBG] /llm RAW response length: {len(llm_result_str)}")
            
            # Try to extract JSON from Markdown code blocks
            try:
                # Look for JSON code blocks (```json ... ```)
                if "```json" in llm_result_str:
                    print(f"[DBG] /llm detected Markdown JSON code block, attempting extraction")
                    start_marker = "```json"
                    end_marker = "```"
                    
                    start_idx = llm_result_str.find(start_marker) + len(start_marker)
                    end_idx = llm_result_str.find(end_marker, start_idx)
                    
                    if start_idx != -1 and end_idx != -1:
                        json_content = llm_result_str[start_idx:end_idx].strip()
                        print(f"[DBG] /llm extracted JSON content: {json_content}")
                        llm_result = json.loads(json_content)
                        print(f"[DBG] /llm successfully parsed JSON from Markdown code block")
                    else:
                        print(f"[DBG] /llm could not find complete Markdown code block markers")
                        raise Exception("Incomplete Markdown code block")
                else:
                    print(f"[DBG] /llm no Markdown code block detected")
                    raise Exception("No Markdown code block found")
            except Exception as markdown_error:
                print(f"[DBG] /llm Markdown extraction failed: {markdown_error}")
                # Print the full response for debugging
                print(f"[DBG] /llm FULL RAW RESPONSE:")
                print(f"'{llm_result_str}'")
                raise e  # Re-raise the original JSON parse error
            
            # Try to extract rewrite content from malformed JSON for step 2
            if step == 2:
                try:
                    # Look for rewrite content in the malformed response
                    if '"rewrite"' in llm_result_str:
                        # Extract content between "rewrite": and the next quote or brace
                        start_idx = llm_result_str.find('"rewrite"') + 9  # Skip "rewrite":
                        # Find the opening quote after "rewrite":
                        quote_start = llm_result_str.find('"', start_idx)
                        if quote_start != -1:
                            # Find the closing quote, handling escaped quotes
                            content_start = quote_start + 1
                            content_end = content_start
                            while True:
                                next_quote = llm_result_str.find('"', content_end)
                                if next_quote == -1:
                                    break
                                # Check if this quote is escaped
                                if next_quote > 0 and llm_result_str[next_quote - 1] != '\\':
                                    content_end = next_quote
                                    break
                                content_end = next_quote + 1
                            
                            if content_end > content_start:
                                rewrite_content = llm_result_str[content_start:content_end]
                                # Unescape common escape sequences
                                rewrite_content = rewrite_content.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
                                print(f"[DBG] /llm extracted rewrite content: {rewrite_content[:100]}...")
                                llm_result = {"rewrite": rewrite_content}
                            else:
                                llm_result = {"rewrite": "Error: Could not extract rewrite content"}
                        else:
                            llm_result = {"rewrite": "Error: Could not find rewrite content"}
                    else:
                        # If no rewrite field found, check if the response contains the user answers summary
                        if "User Answers Summary" in llm_result_str or "rewrite_id" in llm_result_str:
                            print(f"[DBG] /llm detected user answers summary in response, LLM failed to generate proper rewrite")
                            llm_result = {"rewrite": "Error: LLM failed to generate proper rewrite - please try again"}
                        else:
                            llm_result = {"rewrite": "Error: No rewrite field found in response"}
                except Exception as extract_error:
                    print(f"[DBG] /llm rewrite extraction failed: {extract_error}")
                    llm_result = {"rewrite": "Error: Failed to parse LLM response"}
            else:
                # For step 1, if JSON parsing fails, return error structure instead of empty result
                if step == 1:
                    print(f"[DBG] /llm step 1 JSON parse failed, returning error structure")
                    llm_result = {
                        "evaluation": {},
                        "error": "LLM evaluation failed due to malformed response. Please try again."
                    }
                else:
                    llm_result = {}
    except Exception as e:
        print(f"[DBG] /llm LLM call error: {e}")
        # Return a more user-friendly error structure
        if step == 1:
            return jsonify({
                "result": {
                    "evaluation": {},
                    "error": f"LLM service error: {str(e)}. Please try again in a moment."
                }
            })
        else:
            return jsonify({
                "result": {
                    "rewrite": f"LLM service error: {str(e)}. Please try again in a moment."
                }
            })

    print(f"[DBG] /llm parsed OK; type={type(llm_result)} keys={list(llm_result.keys()) if isinstance(llm_result, dict) else None}")
    timestamp = time.time()

    if step == 1:
        evaluation = llm_result.get("evaluation", {}) if isinstance(llm_result, dict) else {}
        
        # Create a mapping of criteria names to display names
        criteria_display_map = {}
        for rule in rules_payload.get('rules', []):
            criteria_display_map[rule['name']] = rule.get('display_name', rule['name'])
        
        # Add display names to evaluation results
        for criteria_name, criteria_data in evaluation.items():
            if isinstance(criteria_data, dict):
                criteria_data['display_name'] = criteria_display_map.get(criteria_name, criteria_name.replace('_', ' ').title())
        
        # Debug: compare evaluation keys with criteria list
        try:
            eval_keys = list(evaluation.keys()) if isinstance(evaluation, dict) else []
            rules_list = [r['name'] for r in (rules_payload.get('rules') or [])]
            missing = [k for k in rules_list if k not in eval_keys]
            extra = [k for k in eval_keys if k not in rules_list]
            print(f"[DBG] /llm eval keys count={len(eval_keys)} missing={missing} extra={extra}")
        except Exception as e:
            print(f"[DBG] /llm eval keys debug error: {e}")
        user_data = session.get("user_data", {})
        user_id = user_data.get("user_id")
        app_session_id = data.get("app_session_id", f"sess_{uuid.uuid4()}")
        case_id = data.get("case_id", "unknown_case")
        line_item_id = data.get("line_item_id", "unknown_line")
        input_field = data.get("input_field", ruleset_name)
        input_text = text

        print(f"[DBG] /llm step1 side-effects uid={user_id} app_session_id={app_session_id} input_field={input_field}")

        # USER_SESSION_INPUTS
        try:
            snowflake_query(
                f"""
                INSERT INTO {DATABASE}.{SCHEMA}.USER_SESSION_INPUTS
                (USER_ID, APP_SESSION_ID, CASE_ID, LINE_ITEM_ID, INPUT_FIELD_TYPE, INPUT_TEXT, TIMESTAMP)
                VALUES (%s, %s, %s, %s, %s, %s, TO_TIMESTAMP_NTZ(%s))
                """,
                CONNECTION_PAYLOAD,
                (user_id, app_session_id, case_id, line_item_id, input_field, input_text, timestamp),
                return_df=False,
            )
            df_id = snowflake_query(
                f"""
                SELECT ID FROM {DATABASE}.{SCHEMA}.USER_SESSION_INPUTS
                WHERE APP_SESSION_ID = %s
                ORDER BY TIMESTAMP DESC
                LIMIT 1
                """,
                CONNECTION_PAYLOAD,
                params=(app_session_id,),
            )
            user_input_id = int(df_id.iloc[0]["ID"]) if df_id is not None and not df_id.empty else None
        except Exception as e:
            print(f"[DBG] /llm USER_SESSION_INPUTS error: {e}")
            user_input_id = None

        # Prompts
        name_to_id = {r["name"]: int(r["id"]) for r in (rules_payload.get("rules") or [])}
        try:
            for idx, (rule_name, section) in enumerate(evaluation.items()):
                q = section.get("question")
                if not q:
                    continue
                crit_id = name_to_id.get(rule_name, idx + 1)
                snowflake_query(
                    f"""
                    INSERT INTO {DATABASE}.{SCHEMA}.LLM_REWRITE_PROMPTS
                    (REWRITE_UUID, CRITERIA_ID, CRITERIA_SCORE, REWRITE_QUESTION, TIMESTAMP)
                    VALUES (%s, %s, %s, %s, TO_TIMESTAMP_NTZ(%s))
                    """,
                    CONNECTION_PAYLOAD,
                    (rewrite_uuid, crit_id, 0, q, timestamp),
                    return_df=False,
                )
                df_prompt = snowflake_query(
                    f"""
                    SELECT ID FROM {DATABASE}.{SCHEMA}.LLM_REWRITE_PROMPTS
                    WHERE REWRITE_UUID = %s AND REWRITE_QUESTION = %s
                    ORDER BY TIMESTAMP DESC
                    LIMIT 1
                    """,
                    CONNECTION_PAYLOAD,
                    params=(rewrite_uuid, q),
                )
                if df_prompt is not None and not df_prompt.empty:
                    section["rewrite_id"] = int(df_prompt.iloc[0]["ID"])
        except Exception as e:
            print(f"[DBG] /llm LLM_REWRITE_PROMPTS error: {e}")

        # LLM_EVALUATION (step1 minimal)
        try:
            total = len(evaluation) if isinstance(evaluation, dict) else 0
            passed = sum(1 for v in evaluation.values() if v.get("passed")) if total else 0
            score_num = (passed / total) * 100 if total else 0
            snowflake_query(
                f"""
                INSERT INTO {DATABASE}.{SCHEMA}.LLM_EVALUATION
                (USER_INPUT_ID, ORIGINAL_TEXT, REWRITTEN_TEXT, SCORE, REWRITE_UUID, TIMESTAMP)
                VALUES (%s, %s, %s, %s, %s, TO_TIMESTAMP_NTZ(%s))
                """,
                CONNECTION_PAYLOAD,
                (user_input_id, input_text, input_text, score_num, None, timestamp),
                return_df=False,
            )
        except Exception as e:
            print(f"[DBG] /llm LLM_EVALUATION step1 error: {e}")

        llm_result["rewrite_uuid"] = rewrite_uuid
        if 'user_input_id' not in llm_result and 'evaluation' in llm_result:
            llm_result["user_input_id"] = user_input_id
        print(f"[DBG] /llm returning step1 result uid={user_input_id} batch={rewrite_uuid}")
        return jsonify({"result": llm_result})

    elif step == 2:
        print(f"[DBG] /llm step2 answers_type={type(answers)} len={len(answers) if isinstance(answers, list) else 'n/a'}")
        # USER_REWRITE_INPUTS
        try:
            if isinstance(answers, list):
                for item in answers:
                    pid = item.get("rewrite_id")
                    ans = (item.get("answer") or "").strip()
                    if not pid or not ans:
                        continue
                    snowflake_query(
                        f"""
                        INSERT INTO {DATABASE}.{SCHEMA}.USER_REWRITE_INPUTS
                        (REWRITE_ID, USER_REWRITE_INPUT, TIMESTAMP)
                        VALUES (%s, %s, TO_TIMESTAMP_NTZ(%s))
                        """,
                        CONNECTION_PAYLOAD,
                        (pid, ans, timestamp),
                        return_df=False,
                    )
        except Exception as e:
            print(f"[DBG] /llm USER_REWRITE_INPUTS error: {e}")

        # LLM_EVALUATION (step2)
        try:
            rewritten = llm_result.get("rewrite") if isinstance(llm_result, dict) else None
            snowflake_query(
                f"""
                INSERT INTO {DATABASE}.{SCHEMA}.LLM_EVALUATION
                (USER_INPUT_ID, ORIGINAL_TEXT, REWRITTEN_TEXT, SCORE, REWRITE_UUID, TIMESTAMP)
                VALUES (%s, %s, %s, %s, %s, TO_TIMESTAMP_NTZ(%s))
                """,
                CONNECTION_PAYLOAD,
                (
                    data.get("user_input_id"),
                    text,
                    rewritten or text,
                    None,
                    data.get("rewrite_uuid"),
                    timestamp,
                ),
                return_df=False,
            )
        except Exception as e:
            print(f"[DBG] /llm LLM_EVALUATION step2 error: {e}")

        print(f"[DBG] /llm returning step2 result has_rewrite={bool(llm_result.get('rewrite'))}")
        return jsonify({"result": llm_result})

    else:
        print(f"[DBG] /llm unexpected step={step}")
        return jsonify({"result": {"echo": True, "step": step}})

# API keys for the scoring endpoint
API_KEYS = ["SAGE-access"]

@app.route("/api/score", methods=["POST"])
def score_text():
    """
    API endpoint to score problem statements or FSRs.
    Input: {"input_type": "problem_statement" or "fsr", "text": "text to evaluate"}
    Output: {"score": percentage, "evaluation": {criteria_results}}
    """
    # Check API key authentication
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        return jsonify({"error": "API key required. Please include X-API-Key header."}), 401
    
    if api_key not in API_KEYS:
        return jsonify({"error": "Invalid API key. Please check your credentials."}), 401
    
    try:
        data = request.get_json()
        
        # Validate input
        if not data or "input_type" not in data or "text" not in data:
            return jsonify({"error": "Missing required fields: input_type and text"}), 400
        
        input_type = data["input_type"].lower()
        text = data["text"].strip()
        
        if not text:
            return jsonify({"error": "Text cannot be empty"}), 400
        
        if input_type not in ["problem_statement", "fsr"]:
            return jsonify({"error": "input_type must be 'problem_statement' or 'fsr'"}), 400
        
        # Check for custom criteria override
        custom_criteria = data.get("criteria")
        
        if custom_criteria:
            # Validate custom criteria format
            if not isinstance(custom_criteria, list):
                return jsonify({"error": "criteria must be a list of objects"}), 400
            
            for i, criterion in enumerate(custom_criteria):
                if not isinstance(criterion, dict):
                    return jsonify({"error": f"criterion {i} must be an object"}), 400
                
                if "name" not in criterion:
                    return jsonify({"error": f"criterion {i} missing required 'name' field"}), 400
                
                if "weight" not in criterion:
                    return jsonify({"error": f"criterion {i} missing required 'weight' field"}), 400
                
                if not isinstance(criterion["weight"], (int, float)) or criterion["weight"] <= 0:
                    return jsonify({"error": f"criterion {i} weight must be a positive number"}), 400
            
            # Use custom criteria
            rules_list = [criterion["name"] for criterion in custom_criteria]
            total_weight = sum(criterion["weight"] for criterion in custom_criteria)
            
            # Normalize weights to sum to 100
            if total_weight != 100:
                for criterion in custom_criteria:
                    criterion["normalized_weight"] = round((criterion["weight"] / total_weight) * 100, 1)
            else:
                for criterion in custom_criteria:
                    criterion["normalized_weight"] = criterion["weight"]
        else:
            # Use default criteria from database
            if input_type == "fsr":
                ruleset_name = "fsr"
                input_field_type = "FSR_DAILY_NOTE"
            else:
                ruleset_name = "problem_statement"
                input_field_type = "PROBLEM_STATEMENT"
            
            # Load rules and advice
            rules_payload = load_ruleset_from_db(input_field_type, "DEFAULT")
            if not rules_payload or not rules_payload.get('rules'):
                return jsonify({"error": "Failed to load evaluation criteria"}), 500
            
            rules_list = [r['name'] for r in (rules_payload.get('rules') or [])]
            # Equal weighting for default criteria
            custom_criteria = [{"name": rule, "normalized_weight": round(100 / len(rules_list), 1)} for rule in rules_list]
        
        # Ensure rules_payload is defined for custom criteria case
        if custom_criteria and not 'rules_payload' in locals():
            rules_payload = {"rules": [{"name": criterion["name"]} for criterion in custom_criteria]}
        
        advice_list = [
            "Be specific and concrete in your descriptions",
            "Use clear, technical language",
            "Focus on the problem, not the solution",
            "Include relevant context and scope"
        ]
        
        # Build the same prompt as the main app
        rules_list = [r['name'] for r in (rules_payload.get('rules') or [])]
        rules_lines = "\n".join(f"- {n}" for n in rules_list)
        advice = "\n".join(f"- {tip}" for tip in advice_list)
        
        user_prompt = (
            "Criteria to evaluate (use EXACTLY these names as keys; do NOT invent or add any others):\n"
            f"{rules_lines}\n\n"
            "General advice for the user (DO NOT treat these as criteria keys):\n"
            f"{advice}\n\n"
            "Here is the text to review:\n"
            f"\"\"\"\n{text}\n\"\"\"\n\n"
            "Instructions:\n"
            f"- You must return a JSON with this exact structure and keys ONLY from this list: {json.dumps(rules_list)}\n"
            "- For each criterion, include: passed (boolean), justification (string), and if not passed, a question (string).\n"
            "- Do NOT add any keys not present in the criteria list. Do NOT use advice items as keys.\n"
            "- Do NOT use Markdown formatting (no ```json or ``` markers)\n"
            "- Return ONLY raw JSON without any formatting or code blocks\n\n"
            "Return your response as JSON like:\n"
            "{\n"
            "  \"evaluation\": {\n"
            "    \"<criterion_name>\": {\n"
            "      \"passed\": true/false,\n"
            "      \"justification\": \"...\",\n"
            "      \"question\": \"...\"\n"
            "    }\n"
            "  }\n"
            "}\n"
            "- Only return the JSON object; no extra commentary, no Markdown formatting."
        )
        
        # Call LLM with same configuration as main app
        model_kwargs = {
            "model": ACTIVE_MODEL_CONFIG["model"],
            "api_base": ACTIVE_MODEL_CONFIG["api_base"],
            "custom_llm_provider": ACTIVE_MODEL_CONFIG["provider"],
            "temperature": 0.1,
            "max_tokens": 2000
        }
        
        if ACTIVE_MODEL_CONFIG["use_token_provider"]:
            model_kwargs["azure_ad_token_provider"] = ACTIVE_MODEL_CONFIG["token_provider"]
            model_kwargs["api_version"] = ACTIVE_MODEL_CONFIG["api_version"]
        else:
            model_kwargs["api_key"] = ACTIVE_MODEL_CONFIG["api_key"]
        
        # Call LLM with retry logic
        max_retries = 2
        for attempt in range(max_retries):
            try:
                response = litellm.completion(
                    messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_prompt}],
                    **model_kwargs
                )
                break
            except Exception as retry_error:
                if attempt == max_retries - 1:
                    return jsonify({"error": f"LLM service error: {str(retry_error)}"}), 500
                time.sleep(1)
        
        # Validate response
        if not response or "choices" not in response or not response["choices"]:
            return jsonify({"error": "Invalid LLM response structure"}), 500
            
        llm_result_str = response["choices"][0]["message"]["content"]
        
        if not llm_result_str or not llm_result_str.strip():
            return jsonify({"error": "LLM returned empty response"}), 500
        
        # Parse JSON response
        try:
            llm_result = json.loads(llm_result_str)
        except Exception as e:
            # Try to extract JSON from Markdown code blocks
            try:
                if "```json" in llm_result_str:
                    start_marker = "```json"
                    end_marker = "```"
                    start_idx = llm_result_str.find(start_marker) + len(start_marker)
                    end_idx = llm_result_str.find(end_marker, start_idx)
                    
                    if start_idx != -1 and end_idx != -1:
                        json_content = llm_result_str[start_idx:end_idx].strip()
                        llm_result = json.loads(json_content)
                    else:
                        return jsonify({"error": "Malformed LLM response"}), 500
                else:
                    return jsonify({"error": "Malformed LLM response"}), 500
            except Exception:
                return jsonify({"error": "Failed to parse LLM response"}), 500
        
        # Extract evaluation results
        evaluation = llm_result.get("evaluation", {})
        if not evaluation:
            return jsonify({"error": "No evaluation results found"}), 500
        
        # Calculate score using custom weights
        total_criteria = len(rules_list)
        passed_criteria = sum(1 for v in evaluation.values() if v.get("passed", False))
        
        # Calculate weighted score
        total_score = 0
        for criterion in custom_criteria:
            criteria_name = criterion["name"]
            if criteria_name in evaluation and evaluation[criteria_name].get("passed", False):
                total_score += criterion["normalized_weight"]
        
        score = round(total_score)
        
        # Simplify evaluation results to only include passed status and normalized score
        simplified_evaluation = {}
        
        for criteria_name, criteria_data in evaluation.items():
            if isinstance(criteria_data, dict):
                # Find the corresponding criterion to get its weight
                criterion_info = next((c for c in custom_criteria if c["name"] == criteria_name), None)
                criteria_score = criterion_info["normalized_weight"] if criterion_info and criteria_data.get("passed", False) else 0
                
                simplified_evaluation[criteria_name] = {
                    "passed": criteria_data.get("passed", False),
                    "score": criteria_score
                }
        
        return jsonify({
            "score": score,
            "evaluation": simplified_evaluation,
            "input_type": input_type,
            "total_criteria": total_criteria,
            "passed_criteria": passed_criteria
        })
        
    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route("/speech-to-text", methods=["POST"])
def speech_to_text():
    print("Received request to /speech-to-text")
 
    if 'audio' not in request.files:
        print("No audio file found in request.")
        return jsonify({"error": "No audio file uploaded."}), 400
 
    audio_file = request.files['audio']
    print(f"Audio file received: {audio_file.filename}")
 
    try:
        # Create temporary files for raw and mp3 audio
        with tempfile.NamedTemporaryFile(delete=True, suffix="_raw") as raw_temp, \
             tempfile.NamedTemporaryFile(delete=True, suffix=".mp3") as mp3_temp:
 
            # Save raw audio to temp file
            audio_file.save(raw_temp.name)
            print(f"Raw audio temporarily saved to: {raw_temp.name}")
 
            # Convert to MP3
            audio = AudioSegment.from_file(raw_temp.name)
            audio.export(mp3_temp.name, format="mp3")
            print(f"Audio converted to MP3: {mp3_temp.name}")
 
            # Encode MP3 to base64
            with open(mp3_temp.name, "rb") as f:
                audio_base64 = base64.b64encode(f.read()).decode("utf-8")
            print("MP3 audio file successfully encoded to base64.")
 
        # Send to LLM for transcription
        print("Sending request to LLM for transcription...")
        response = client.chat.completions.create(
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcribe this audio word for word, in exactly the order it is spoken."
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_base64,
                            "format": "mp3"
                        },
                    },
                ],
            }],
            model="Phi-4-multimodal-instruct",
            max_completion_tokens=512,
            temperature=0.1,
        )
 
        transcription = response.choices[0].message.content
        print("Transcription received from LLM.")
        return jsonify({"transcription": transcription})
 
    except Exception as e:
        print(f"Error during transcription: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("Starting LanguageTool Flask App...")
    with open("./config.yaml", 'r') as f:
        config = yaml.safe_load(f)
    CONNECTION_PAYLOAD = config.get("Engineering_SAGE_SVC", {})
    app.config['ENABLE_SSO'] = config.get("AppConfig", {}).get("ENABLE_SSO", True)
    app.config['DEV_MODE'] = config.get("AppConfig", {}).get("DEV_MODE", False)
    
    DATABASE = "SAGE"
    SCHEMA = "TEXTIO_SERVICES_INPUTS"
    if app.config['DEV_MODE']:
        SCHEMA = f"DEV_{SCHEMA}"
    print(f"SSO Enabled: {app.config['ENABLE_SSO']}")
    print(f"Development Mode Enabled: {app.config['DEV_MODE']}")
    app.run(host='127.0.0.1', port=8055)

