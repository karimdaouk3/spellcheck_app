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

# ==================== EXTERNAL CRM INTEGRATION ====================
# CRM functions with caching and batch processing optimizations

# CRM Cache for performance optimization
_crm_cache = {}
CRM_CACHE_TTL = 300  # 5 minutes

def check_external_crm_exists(case_number):
    """
    Check if a case exists in external CRM by querying available case numbers.
    Returns True if case exists in CRM, False otherwise.
    """
    try:
        user_data = session.get('user_data')
        if not user_data:
            print("❌ [CRM] No user data available for CRM check")
            return False
        
        user_email = user_data.get('email', '')
        if not user_email:
            print("❌ [CRM] No user email available for CRM check")
            return False
        
        # Convert email to uppercase format as required by CRM
        user_email_upper = user_email.upper()
        print(f"🔍 [CRM] Checking if case {case_number} exists for user {user_email_upper}")
        
        # Query 1: Check if case exists in CRM for this user
        query = f"""
            SELECT DISTINCT "Case Number"
            FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T
            WHERE "USER_EMAILS" LIKE %s
            AND "Case Number" IS NOT NULL
            AND "Case Number" = %s
        """
        
        like_pattern = f"%~{user_email_upper}~%"
        # Convert case_number to string to match database column type
        case_number_str = str(case_number)
        print(f"🔍 [CRM] Query parameters: like_pattern='{like_pattern}', case_number_str='{case_number_str}'")
        result = snowflake_query(query, CONNECTION_PAYLOAD, (like_pattern, case_number_str))
        
        print(f"📊 [CRM] Query result for case {case_number}:")
        print(f"   - Result is None: {result is None}")
        print(f"   - Result is empty: {result.empty if result is not None else 'N/A'}")
        if result is not None and not result.empty:
            print(f"   - Number of rows returned: {len(result)}")
            print(f"   - Columns: {list(result.columns)}")
            print(f"   - Sample data: {result.head(3).to_dict('records')}")
            print(f"✅ [CRM] Case {case_number} found in CRM for user {user_email_upper}")
            return True
        else:
            print(f"❌ [CRM] Case {case_number} not found in CRM for user {user_email_upper}")
            return False
            
    except Exception as e:
        print(f"❌ [CRM] Error checking case {case_number} in CRM: {e}")
        # Check if it's a database access error
        if "Database 'IT_SF_SHARE_REPLICA' does not exist or not authorized" in str(e):
            print(f"⚠️ [CRM] IT_SF_SHARE_REPLICA database not accessible, defaulting to False for case {case_number}")
            return False
        else:
            print(f"❌ [CRM] Unexpected error for case {case_number}: {e}")
            return False

def check_external_crm_status_for_case(case_id):
    """
    Check case status in external CRM to determine if case is open or closed.
    
    Returns:
        'open' - Case is still open in external CRM
        'closed' - Case has been closed in external CRM
    """
    try:
        print(f"🔍 [CRM] Checking status for case {case_id} in external CRM")
        
        # Query 2: Check if case is actually closed (has closure date)
        query = f"""
            SELECT DISTINCT "[Case Number]"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY
            WHERE "Verify Closure Date/Time" IS NOT NULL
            AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
            AND "[Case Number]" = %s
        """
        
        result = snowflake_query(query, PROD_PAYLOAD, (case_id,))
        
        print(f"📊 [CRM] Query result for case {case_id}:")
        print(f"   - Result is None: {result is None}")
        print(f"   - Result is empty: {result.empty if result is not None else 'N/A'}")
        if result is not None and not result.empty:
            print(f"   - Number of rows returned: {len(result)}")
            print(f"   - Columns: {list(result.columns)}")
            print(f"   - Sample data: {result.head(3).to_dict('records')}")
            print(f"❌ [CRM] Case {case_id} is CLOSED in external CRM (has Verify Closure Date/Time)")
            return "closed"
        else:
            print(f"   - No matching records found with closure date in GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY")
            print(f"   - This means case {case_id} is either OPEN or not tracked in CRM")
            print(f"✅ [CRM] Case {case_id} is OPEN in external CRM (no closure date or not tracked)")
            return "open"
            
    except Exception as e:
        print(f"❌ [CRM] Error checking status for case {case_id}: {e}")
        # Check if it's a database access error
        if "Database 'GEAR' does not exist or not authorized" in str(e):
            print(f"⚠️ [CRM] GEAR database not accessible, defaulting to 'open' for case {case_id}")
            return "open"  # Default to open if database not accessible
        else:
            print(f"❌ [CRM] Unexpected error for case {case_id}: {e}")
            return "open"  # Default to open if error occurs

def check_external_crm_status_batch(case_ids):
    """
    Batch check case status in external CRM for multiple cases at once.
    This is much more efficient than individual queries.
    Includes caching to avoid repeated database calls.
    
    Args:
        case_ids: List of case IDs to check
        
    Returns:
        dict: {case_id: status} mapping
    """
    if not case_ids:
        return {}
    
    current_time = time.time()
    status_map = {}
    uncached_cases = []
    
    # Check cache first
    for case_id in case_ids:
        cache_key = f"crm_status_{case_id}"
        if (cache_key in _crm_cache and 
            current_time - _crm_cache[cache_key]['timestamp'] < CRM_CACHE_TTL):
            status_map[case_id] = _crm_cache[cache_key]['status']
            print(f"📦 [CRM] Using cached status for case {case_id}: {status_map[case_id]}")
        else:
            uncached_cases.append(case_id)
    
    # Only query database for uncached cases
    if uncached_cases:
        try:
            print(f"🔍 [CRM] Batch checking status for {len(uncached_cases)} uncached cases in external CRM")
            
            # Create IN clause for batch query
            case_ids_str = ','.join([str(cid) for cid in uncached_cases])
            
            # Optimized batch query to check all cases at once
            query = f"""
                SELECT DISTINCT "[Case Number]"
                FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY
                WHERE "Verify Closure Date/Time" IS NOT NULL
                AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
                AND "[Case Number]" IN ({case_ids_str})
            """
            
            result = snowflake_query(query, PROD_PAYLOAD)
            
            print(f"📊 [CRM] Batch query result:")
            print(f"   - Result is None: {result is None}")
            print(f"   - Result is empty: {result.empty if result is not None else 'N/A'}")
            if result is not None and not result.empty:
                print(f"   - Number of rows returned: {len(result)}")
                print(f"   - Columns: {list(result.columns)}")
                print(f"   - Sample data: {result.head(5).to_dict('records')}")
            
            # Build status mapping for uncached cases
            closed_cases = set()
            
            if result is not None and not result.empty:
                closed_cases = set(result["Case Number"].tolist())
                print(f"❌ [CRM] Found {len(closed_cases)} closed cases in external CRM: {list(closed_cases)}")
            else:
                print(f"ℹ️ [CRM] No closed cases found in external CRM")
                print(f"   - This means all {len(uncached_cases)} cases are OPEN or not tracked in CRM")
            
            # Map uncached cases to their status and cache results
            for case_id in uncached_cases:
                if case_id in closed_cases:
                    status = "closed"
                    print(f"❌ [CRM] Case {case_id}: CLOSED (has Verify Closure Date/Time)")
                else:
                    status = "open"
                    print(f"✅ [CRM] Case {case_id}: OPEN (no closure date or not tracked in CRM)")
                
                status_map[case_id] = status
                
                # Cache the result
                cache_key = f"crm_status_{case_id}"
                _crm_cache[cache_key] = {
                    'status': status,
                    'timestamp': current_time
                }
            
            print(f"📊 [CRM] Batch status results for uncached cases: {status_map}")
            
        except Exception as e:
            print(f"❌ [CRM] Error in batch status check: {e}")
            # Check if it's a database access error
            if "Database 'GEAR' does not exist or not authorized" in str(e):
                print(f"⚠️ [CRM] GEAR database not accessible, defaulting all uncached cases to 'open'")
                for case_id in uncached_cases:
                    status_map[case_id] = "open"
                    # Cache the default result
                    cache_key = f"crm_status_{case_id}"
                    _crm_cache[cache_key] = {
                        'status': "open",
                        'timestamp': current_time
                    }
            else:
                print(f"❌ [CRM] Unexpected error in batch check: {e}")
                for case_id in uncached_cases:
                    status_map[case_id] = "open"
                    # Cache the default result
                    cache_key = f"crm_status_{case_id}"
                    _crm_cache[cache_key] = {
                        'status': "open",
                        'timestamp': current_time
                    }
    
    return status_map

def get_external_case_id(case_number):
    """
    Get external case ID from CRM.
    For now, return the same case number.
    """
    return case_number

def get_available_case_numbers():
    """
    Get list of available case numbers for the current user from CRM.
    Used to suggest case numbers when creating a new case.
    """
    try:
        user_data = session.get('user_data')
        if not user_data:
            print("❌ [CRM] No user data available for case number suggestions")
            return []
        
        user_email = user_data.get('email', '')
        if not user_email:
            print("❌ [CRM] No user email available for case number suggestions")
            return []
        
        # Convert email to uppercase format as required by CRM
        user_email_upper = user_email.upper()
        print(f"🔍 [CRM] Getting available case numbers for user {user_email_upper}")
        
        # Query 1: Get available case numbers for this user
        query = f"""
            SELECT DISTINCT "Case Number"
            FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T
            WHERE "USER_EMAILS" LIKE %s
            AND "Case Number" IS NOT NULL
            ORDER BY "Case Number" DESC
        """
        
        like_pattern = f"%~{user_email_upper}~%"
        result = snowflake_query(query, CONNECTION_PAYLOAD, (like_pattern,))
        
        if result is not None and not result.empty:
            case_numbers = result["Case Number"].tolist()
            print(f"✅ [CRM] Found {len(case_numbers)} available case numbers for user {user_email_upper}")
            return case_numbers
        else:
            print(f"ℹ️ [CRM] No case numbers found for user {user_email_upper}")
            return []
            
    except Exception as e:
        print(f"❌ [CRM] Error getting available case numbers: {e}")
        # Check if it's a database access error
        if "Database 'IT_SF_SHARE_REPLICA' does not exist or not authorized" in str(e):
            print(f"⚠️ [CRM] IT_SF_SHARE_REPLICA database not accessible, returning empty list")
            return []
        else:
            print(f"❌ [CRM] Unexpected error getting case numbers: {e}")
            return []

def get_case_details(case_number):
    """
    Get detailed case information from CRM for a specific case.
    Returns case details including FSR information, symptoms, etc.
    """
    try:
        print(f"🔍 [CRM] Getting case details for case {case_number}")
        
        # Query 3: Get case information
        query = f"""
            SELECT DISTINCT
            "Case Number",
            "FSR Number",
            "FSR Creation Date",
            "FSR Current Symptom",
            "FSR Current Problem Statement",
            "FSR Daily Notes",
            "Part Number",
            "Part Description",
            "Part Disposition Code 1",
            "Part Disposition Code 2",
            "Part Disposition Code 3"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_FSR_DETAIL
            WHERE "Case Number" = %s
            ORDER BY "FSR Number", "FSR Creation Date" ASC
        """
        
        result = snowflake_query(query, PROD_PAYLOAD, (case_number,))
        
        if result is not None and not result.empty:
            print(f"✅ [CRM] Found case details for case {case_number}")
            # Convert to list of dictionaries for JSON serialization
            case_details = result.to_dict('records')
            return case_details
        else:
            print(f"ℹ️ [CRM] No case details found for case {case_number}")
            return []
            
    except Exception as e:
        print(f"❌ [CRM] Error getting case details for case {case_number}: {e}")
        # Check if it's a database access error
        if "Database 'GEAR' does not exist or not authorized" in str(e):
            print(f"⚠️ [CRM] GEAR database not accessible, returning empty list for case {case_number}")
            return []
        else:
            print(f"❌ [CRM] Unexpected error getting case details for case {case_number}: {e}")
            return []
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
            "username": "karim_daouk",
            "email": "KARIM.DAOUK@KLA.COM",
            "first_name": "Karim",
            "last_name": "Daouk",
            "employee_id": "12345",
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
# Note: All mock data has been removed. The application now uses the database endpoints:
# - /api/cases/user-cases (GET) - Database endpoint
# - /api/cases/data (GET) - Database endpoint  
# - /api/cases/input-state (GET/PUT) - Database endpoint
# - /api/cases/create (POST) - Database endpoint
# - /api/cases/feedback (POST) - Database endpoint
# - /api/cases/generate-feedback (POST) - Database endpoint

@app.route('/api/cases/validate/<case_number>', methods=['GET'])
def validate_case_number(case_number):
    """
    Database endpoint to validate if a case number exists in the system.
    Returns whether the case is valid and if it's open or closed.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    try:
        # Convert case_number to int (database expects numeric)
        case_number_int = int(case_number)
        
        # Check if case exists for this user
        query = f"""
            SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        result = snowflake_query(query, CONNECTION_PAYLOAD, (case_number_int, user_id))
        
        if result is None or result.empty:
            return jsonify({
                "valid": False,
                "case_number": case_number,
                "message": "Case not found"
            }), 404
        
        case_row = result.iloc[0]
        return jsonify({
            "valid": True,
            "case_number": case_number,
            "case_status": case_row["CASE_STATUS"],
            "last_sync": case_row["CRM_LAST_SYNC_TIME"].isoformat() if case_row["CRM_LAST_SYNC_TIME"] else None
        })
        
    except ValueError:
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"Error validating case {case_number} for user {user_id}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/user-cases', methods=['GET'])
def get_user_cases():
    """
    Database endpoint to get all cases for the current user.
    Returns list of cases that belong to the user with their status.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/user-cases: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    print(f"🚀 [Backend] /api/cases/user-cases: Fetching cases for user {user_id}")
    
    try:
        query = f"""
            SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CREATED_BY_USER = %s
        """
        print(f"📊 [Backend] Executing query: {query}")
        result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
        
        cases = []
        if result is not None and not result.empty:
            print(f"✅ [Backend] Found {len(result)} cases in database")
            for _, row in result.iterrows():
                case_info = {
                    "case_id": row["CASE_ID"],
                    "case_status": row["CASE_STATUS"],
                    "last_sync_time": row["CRM_LAST_SYNC_TIME"],
                    "is_closed": row["CASE_STATUS"] == "closed",
                    "needs_feedback": False  # Will be determined by external CRM check
                }
                cases.append(case_info)
                print(f"📝 [Backend] Case {case_info['case_id']}: status={case_info['case_status']}")
        else:
            print("ℹ️ [Backend] No cases found for user")
        
        response_data = {
            "user_id": user_id,
            "cases": cases,
            "count": len(cases)
        }
        print(f"📤 [Backend] Returning {len(cases)} cases to frontend")
        return jsonify(response_data)
        
    except Exception as e:
        print(f"❌ [Backend] Error fetching user cases for user {user_id}: {e}")
        # Check if it's a table not found error
        if "does not exist" in str(e) or "not found" in str(e):
            print(f"⚠️ [Backend] Database tables not found, returning empty cases for user {user_id}")
            return jsonify({
                "user_id": user_id,
                "cases": [],
                "count": 0,
                "message": "Database tables not yet created"
            })
        else:
            print(f"❌ [Backend] Unexpected database error for user {user_id}: {e}")
            return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/check-external-status', methods=['POST'])
def check_external_crm_status():
    """
    Check external CRM status for user's open cases.
    Returns cases that are closed in external CRM but still open in database.
    These cases need feedback from the user.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/check-external-status: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    print(f"🚀 [Backend] /api/cases/check-external-status: Checking external CRM for user {user_id}")
    
    try:
        # Get all open cases for the user
        query = f"""
            SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CREATED_BY_USER = %s AND CASE_STATUS = 'open'
        """
        print(f"📊 [Backend] Executing query: {query}")
        result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
        
        cases_needing_feedback = []
        if result is not None and not result.empty:
            print(f"✅ [Backend] Found {len(result)} open cases to check")
            
            # Extract case IDs for batch processing
            case_ids = [row["CASE_ID"] for _, row in result.iterrows()]
            print(f"🔍 [Backend] Batch checking CRM status for cases: {case_ids}")
            
            # Batch check external CRM status for all cases at once
            external_statuses = check_external_crm_status_batch(case_ids)
            
            for _, row in result.iterrows():
                case_id = row["CASE_ID"]
                external_status = external_statuses.get(case_id, "open")  # Default to open if not found
                print(f"📋 [Backend] Case {case_id} external status: {external_status}")
                
                # If case is closed in external CRM but open in database, needs feedback
                if external_status == "closed":
                    cases_needing_feedback.append({
                        "case_id": case_id,
                        "case_status": row["CASE_STATUS"],
                        "last_sync_time": row["CRM_LAST_SYNC_TIME"],
                        "external_status": external_status,
                        "needs_feedback": True
                    })
                    print(f"⚠️ [Backend] Case {case_id} closed in external CRM - needs feedback")
                else:
                    print(f"✅ [Backend] Case {case_id} still open in external CRM")
        else:
            print("ℹ️ [Backend] No open cases found for user")
        
        response_data = {
            "user_id": user_id,
            "cases_needing_feedback": cases_needing_feedback,
            "count": len(cases_needing_feedback)
        }
        print(f"📤 [Backend] Returning {len(cases_needing_feedback)} cases needing feedback")
        return jsonify(response_data)
        
    except Exception as e:
        print(f"❌ [Backend] Error checking external CRM status for user {user_id}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/data', methods=['GET'])
def get_user_case_data():
    """
    Database endpoint to get all case data for the current user.
    Returns all open cases with their problem statements and FSR notes.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    try:
        print(f"🚀 [Backend] /api/cases/data: Getting case data for user {user_id}")
        
        # Optimized single query to get all case data at once
        # Use ROW_NUMBER() to get the most recent data for each case/field combination
        query = f"""
            WITH latest_input_state AS (
                SELECT 
                    CASE_SESSION_ID,
                    INPUT_FIELD_ID,
                    INPUT_FIELD_VALUE,
                    LINE_ITEM_ID,
                    LAST_UPDATED,
                    ROW_NUMBER() OVER (
                        PARTITION BY CASE_SESSION_ID, INPUT_FIELD_ID 
                        ORDER BY LAST_UPDATED DESC, LINE_ITEM_ID DESC
                    ) as rn
                FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            )
            SELECT 
                cs.CASE_ID,
                cs.CASE_STATUS,
                lis_problem.INPUT_FIELD_VALUE as PROBLEM_STATEMENT,
                lis_fsr.INPUT_FIELD_VALUE as FSR_NOTES,
                lis_fsr.LINE_ITEM_ID as FSR_LINE_ITEM_ID,
                lis_problem.LAST_UPDATED as PROBLEM_LAST_UPDATED,
                lis_fsr.LAST_UPDATED as FSR_LAST_UPDATED
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS cs
            LEFT JOIN latest_input_state lis_problem 
                ON cs.ID = lis_problem.CASE_SESSION_ID 
                AND lis_problem.INPUT_FIELD_ID = 1
                AND lis_problem.rn = 1
            LEFT JOIN latest_input_state lis_fsr 
                ON cs.ID = lis_fsr.CASE_SESSION_ID 
                AND lis_fsr.INPUT_FIELD_ID = 2
                AND lis_fsr.rn = 1
            WHERE cs.CREATED_BY_USER = %s AND cs.CASE_STATUS = 'open'
            ORDER BY cs.CASE_ID, lis_fsr.LINE_ITEM_ID
        """
        print(f"📊 [Backend] Executing optimized query: {query}")
        cases_result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
        
        cases = {}
        if cases_result is not None and not cases_result.empty:
            print(f"📊 [Backend] /api/cases/data: Processing {len(cases_result)} rows from database")
            # Group by case_id to handle multiple FSR line items per case
            case_data = {}
            for idx, row in cases_result.iterrows():
                case_id = row["CASE_ID"]
                problem_statement = row["PROBLEM_STATEMENT"] or ""
                fsr_notes = row["FSR_NOTES"] or ""
                line_item_id = row["FSR_LINE_ITEM_ID"]
                
                problem_last_updated = row.get("PROBLEM_LAST_UPDATED", "N/A")
                fsr_last_updated = row.get("FSR_LAST_UPDATED", "N/A")
                
                print(f"📊 [Backend] /api/cases/data: Row {idx}: case_id={case_id}, problem_length={len(problem_statement)}, fsr_length={len(fsr_notes)}, line_item_id={line_item_id}")
                print(f"📊 [Backend] /api/cases/data: Row {idx}: problem_preview={problem_statement[:50]}...")
                print(f"📊 [Backend] /api/cases/data: Row {idx}: fsr_preview={fsr_notes[:50]}...")
                print(f"📊 [Backend] /api/cases/data: Row {idx}: problem_last_updated={problem_last_updated}, fsr_last_updated={fsr_last_updated}")
                
                if case_id not in case_data:
                    case_data[case_id] = {
                        "caseNumber": case_id,
                        "problemStatement": problem_statement,
                        "fsrNotes": "",
                        "updatedAt": datetime.utcnow().isoformat() + 'Z'
                    }
                    print(f"📊 [Backend] /api/cases/data: Created new case_data entry for case_id={case_id}")
                
                # Use the last FSR line item (highest LINE_ITEM_ID)
                if fsr_notes and (not case_data[case_id]["fsrNotes"] or line_item_id > case_data[case_id].get("lastLineItemId", 0)):
                    case_data[case_id]["fsrNotes"] = fsr_notes
                    case_data[case_id]["lastLineItemId"] = line_item_id
                    print(f"📊 [Backend] /api/cases/data: Updated FSR notes for case_id={case_id} with line_item_id={line_item_id}")
            
            # Convert to the expected format
            cases = {case_id: data for case_id, data in case_data.items()}
            print(f"✅ [Backend] Processed {len(cases)} cases with optimized query")
            
            # Debug: Print final case data
            for case_id, data in cases.items():
                print(f"📊 [Backend] /api/cases/data: Final case {case_id}:")
                print(f"📊 [Backend] /api/cases/data: - problemStatement_length={len(data['problemStatement'])}")
                print(f"📊 [Backend] /api/cases/data: - fsrNotes_length={len(data['fsrNotes'])}")
                print(f"📊 [Backend] /api/cases/data: - problemStatement_preview={data['problemStatement'][:100]}...")
                print(f"📊 [Backend] /api/cases/data: - fsrNotes_preview={data['fsrNotes'][:100]}...")
        
        return jsonify({
            "user_id": str(user_id),
            "cases": cases,
            "count": len(cases),
            "timestamp": datetime.utcnow().isoformat() + 'Z',
            "cache_bust": request.args.get('cache_bust', 'none')
        })
        
    except Exception as e:
        print(f"❌ [Backend] Error fetching case data for user {user_id}: {e}")
        # Check if it's a table not found error
        if "does not exist" in str(e) or "not found" in str(e):
            print(f"⚠️ [Backend] Database tables not found, returning empty cases for user {user_id}")
            return jsonify({
                "user_id": str(user_id),
                "cases": {},
                "count": 0,
                "message": "Database tables not yet created"
            })
        else:
            print(f"❌ [Backend] Unexpected database error for user {user_id}: {e}")
            return jsonify({"error": "Database error occurred"}), 500

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

# Removed: /api/cases/data/<case_number> PUT - Replaced by /api/cases/input-state PUT

# Removed: /api/cases/data POST - No longer needed, individual cases handled by database endpoints

@app.route('/api/cases/suggestions', methods=['GET'])
def get_case_suggestions():
    """
    Get available case numbers from CRM to suggest to users.
    Returns list of case numbers the user has access to.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/suggestions: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    user_email = user_data.get('email')
    if not user_email:
        return jsonify({"error": "No email found in user data"}), 400
    
    # Convert email to uppercase to match CRM format
    user_email_upper = user_email.upper()
    print(f"🔍 [CRM] Getting case suggestions for user: {user_email} (formatted: {user_email_upper})")
    
    try:
        case_numbers = get_available_case_numbers(user_email_upper)
        print(f"✅ [CRM] Found {len(case_numbers)} available cases")
        
        return jsonify({
            "success": True,
            "case_numbers": case_numbers,
            "count": len(case_numbers)
        })
        
    except Exception as e:
        print(f"❌ [Backend] Error getting case suggestions: {e}")
        return jsonify({"error": "Failed to get case suggestions"}), 500

@app.route('/api/cases/details/<case_number>', methods=['GET'])
def get_case_details_endpoint(case_number):
    """
    Get detailed case information from CRM for a specific case.
    Returns FSR details, symptoms, problem statements, etc.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/details: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    try:
        print(f"🔍 [CRM] Getting case details for case: {case_number}")
        case_details = get_case_details(case_number)
        print(f"✅ [CRM] Found {len(case_details)} FSR records for case {case_number}")
        
        return jsonify({
            "success": True,
            "case_number": case_number,
            "details": case_details,
            "count": len(case_details)
        })
        
    except Exception as e:
        print(f"❌ [Backend] Error getting case details for {case_number}: {e}")
        return jsonify({"error": "Failed to get case details"}), 500

# ==================== CRM INTEGRATION FUNCTIONS ====================

def get_available_case_numbers(user_email):
    """
    CRM Query 1: Get available case numbers for suggestions
    Use this in: /api/cases/suggestions
    """
    try:
        query = """
            SELECT DISTINCT "Case Number"
            FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T
            WHERE "USER_EMAILS" LIKE %s 
            AND "Case Number" IS NOT NULL 
            ORDER BY "Case Number" DESC
        """
        
        like_pattern = f"%~{user_email.upper()}~%"
        result = snowflake_query(query, CONNECTION_PAYLOAD, (like_pattern,))
        
        if result is not None and not result.empty:
            return result["Case Number"].tolist()
        else:
            return []
            
    except Exception as e:
        print(f"Error getting available case numbers: {e}")
        return []

def check_case_status_batch(case_numbers):
    """
    CRM Query 2 (Batch): Check multiple cases at once
    Use this in: /api/cases/check-external-status (optimized)
    """
    try:
        if not case_numbers:
            return {}
        
        # Create IN clause for batch query
        case_list = "', '".join(str(case) for case in case_numbers)
        
        query = f"""
            SELECT DISTINCT "[Case Number]" AS "Case Number"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY 
            WHERE "Verify Closure Date/Time" IS NULL 
            AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
            AND "[Case Number]" IN ('{case_list}')
            ORDER BY "[Case Number]" DESC
        """
        
        result = snowflake_query(query, PROD_PAYLOAD)
        
        if result is not None and not result.empty:
            open_cases = set(result["Case Number"].tolist())
            
            # Return status for each case
            case_status = {}
            for case_num in case_numbers:
                case_status[case_num] = 'open' if case_num in open_cases else 'closed'
            
            return case_status
        else:
            return {case_num: 'closed' for case_num in case_numbers}
            
    except Exception as e:
        print(f"Error in batch case status check: {e}")
        return {case_num: 'unknown' for case_num in case_numbers}

def get_case_details(case_number):
    """
    CRM Query 3: Get detailed case information
    Use this in: /api/cases/details/<case_number>
    """
    try:
        query = """
            SELECT DISTINCT
                "Case Number",
                "FSR Number",
                "FSR Creation Date",
                "FSR Current Symptom",
                "FSR Current Problem Statement",
                "FSR Daily Notes",
                "Part Number",
                "Part Description",
                "Part Disposition Code 1",
                "Part Disposition Code 2",
                "Part Disposition Code 3"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_FSR_DETAIL
            WHERE "Case Number" = %s
            ORDER BY "FSR Number", "FSR Creation Date" ASC
        """
        
        result = snowflake_query(query, PROD_PAYLOAD, params=(case_number,))
        
        if result is not None and not result.empty:
            return result.to_dict('records')
        else:
            return []
            
    except Exception as e:
        print(f"Error getting case details: {e}")
        return []

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
    timestamp = datetime.utcnow()
 
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
        VALUES (%s, %s, %s, %s, %s, %s)
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
    timestamp = datetime.utcnow()

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
                VALUES (%s, %s, %s, %s, %s, %s, %s)
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
                    VALUES (%s, %s, %s, %s, %s)
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
        evaluation_id = None
        try:
            total = len(evaluation) if isinstance(evaluation, dict) else 0
            passed = sum(1 for v in evaluation.values() if v.get("passed")) if total else 0
            score_num = (passed / total) * 100 if total else 0
            
            # Insert and get the evaluation ID
            insert_query = f"""
                INSERT INTO {DATABASE}.{SCHEMA}.LLM_EVALUATION
                (USER_INPUT_ID, ORIGINAL_TEXT, REWRITTEN_TEXT, SCORE, REWRITE_UUID, TIMESTAMP)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            snowflake_query(insert_query, CONNECTION_PAYLOAD,
                          (user_input_id, input_text, input_text, score_num, None, timestamp),
                          return_df=False)
            
            # Get the evaluation ID that was just inserted
            id_query = f"""
                SELECT ID FROM {DATABASE}.{SCHEMA}.LLM_EVALUATION 
                WHERE USER_INPUT_ID = %s AND TIMESTAMP = %s
                ORDER BY ID DESC LIMIT 1
            """
            id_result = snowflake_query(id_query, CONNECTION_PAYLOAD, (user_input_id, timestamp))
            if id_result is not None and not id_result.empty:
                evaluation_id = int(id_result.iloc[0]["ID"])  # Convert to int for JSON serialization
                print(f"[DBG] /llm LLM_EVALUATION step1 created with ID: {evaluation_id}")
        except Exception as e:
            print(f"[DBG] /llm LLM_EVALUATION step1 error: {e}")

        llm_result["rewrite_uuid"] = str(rewrite_uuid)  # Ensure string for JSON serialization
        llm_result["evaluation_id"] = int(evaluation_id) if evaluation_id is not None else None
        if 'user_input_id' not in llm_result and 'evaluation' in llm_result:
            llm_result["user_input_id"] = user_input_id
        print(f"[DBG] /llm returning step1 result uid={user_input_id} batch={rewrite_uuid} eval_id={evaluation_id}")
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
                        VALUES (%s, %s, %s)
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
                VALUES (%s, %s, %s, %s, %s, %s)
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
            
            # Update LAST_INPUT_STATE with the rewritten text for persistence
            print(f"[DBG] /llm step2 PERSISTENCE CHECK: rewritten={bool(rewritten)}, user_input_id={data.get('user_input_id')}")
            if rewritten and data.get("user_input_id"):
                user_data = session.get("user_data", {})
                user_id = user_data.get("user_id")
                print(f"[DBG] /llm step2 PERSISTENCE: user_id={user_id}, session_data={user_data}")
                
                # Get the case session ID from the user input
                case_query = f"""
                    SELECT CASE_ID, INPUT_FIELD_TYPE 
                    FROM {DATABASE}.{SCHEMA}.USER_SESSION_INPUTS 
                    WHERE ID = %s
                """
                print(f"[DBG] /llm step2 PERSISTENCE: Querying USER_SESSION_INPUTS for user_input_id={data.get('user_input_id')}")
                case_result = snowflake_query(case_query, CONNECTION_PAYLOAD, (data.get("user_input_id"),))
                print(f"[DBG] /llm step2 PERSISTENCE: case_result={case_result is not None}, empty={case_result.empty if case_result is not None else 'N/A'}")
                
                if case_result is not None and not case_result.empty:
                    case_id = case_result.iloc[0]["CASE_ID"]
                    input_field_type = case_result.iloc[0]["INPUT_FIELD_TYPE"]
                    print(f"[DBG] /llm step2 PERSISTENCE: Found case_id={case_id}, input_field_type={input_field_type}")
                    
                    # Get case session ID
                    session_query = f"""
                        SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
                        WHERE CASE_ID = %s AND CREATED_BY_USER = %s
                    """
                    print(f"[DBG] /llm step2 PERSISTENCE: Querying CASE_SESSIONS for case_id={case_id}, user_id={user_id}")
                    session_result = snowflake_query(session_query, CONNECTION_PAYLOAD, (case_id, user_id))
                    print(f"[DBG] /llm step2 PERSISTENCE: session_result={session_result is not None}, empty={session_result.empty if session_result is not None else 'N/A'}")
                    
                    if session_result is not None and not session_result.empty:
                        case_session_id = session_result.iloc[0]["ID"]
                        print(f"[DBG] /llm step2 PERSISTENCE: Found case_session_id={case_session_id}")
                        
                        # Determine input field ID based on type
                        input_field_id = 1 if input_field_type == "problem_statement" else 2
                        print(f"[DBG] /llm step2 PERSISTENCE: input_field_id={input_field_id} (1=problem_statement, 2=fsr_notes)")
                        
                        # Update LAST_INPUT_STATE with rewritten text
                        print(f"[DBG] /llm step2 PERSISTENCE: About to update LAST_INPUT_STATE with:")
                        print(f"[DBG] /llm step2 PERSISTENCE: - case_session_id={case_session_id}")
                        print(f"[DBG] /llm step2 PERSISTENCE: - input_field_id={input_field_id}")
                        print(f"[DBG] /llm step2 PERSISTENCE: - rewritten_text_length={len(rewritten) if rewritten else 0}")
                        print(f"[DBG] /llm step2 PERSISTENCE: - rewritten_text_preview={rewritten[:100] if rewritten else 'None'}...")
                        
                        update_query = f"""
                            MERGE INTO {DATABASE}.{SCHEMA}.LAST_INPUT_STATE AS target
                            USING (SELECT %s as CASE_SESSION_ID, %s as INPUT_FIELD_ID, %s as INPUT_FIELD_VALUE, %s as LINE_ITEM_ID, %s as INPUT_FIELD_EVAL_ID) AS source
                            ON target.CASE_SESSION_ID = source.CASE_SESSION_ID 
                               AND target.INPUT_FIELD_ID = source.INPUT_FIELD_ID 
                               AND target.LINE_ITEM_ID = source.LINE_ITEM_ID
                            WHEN MATCHED THEN UPDATE SET 
                                INPUT_FIELD_VALUE = source.INPUT_FIELD_VALUE,
                                LAST_UPDATED = CURRENT_TIMESTAMP()
                            WHEN NOT MATCHED THEN INSERT 
                                (CASE_SESSION_ID, INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID, LAST_UPDATED)
                                VALUES (source.CASE_SESSION_ID, source.INPUT_FIELD_ID, source.INPUT_FIELD_VALUE, source.LINE_ITEM_ID, source.INPUT_FIELD_EVAL_ID, CURRENT_TIMESTAMP())
                        """
                        print(f"[DBG] /llm step2 PERSISTENCE: Executing MERGE query...")
                        snowflake_query(update_query, CONNECTION_PAYLOAD, 
                                       (case_session_id, input_field_id, rewritten, 1, None), 
                                       return_df=False)
                        print(f"[DBG] /llm step2 PERSISTENCE: ✅ Successfully updated LAST_INPUT_STATE with rewritten text for case {case_id}")
                    else:
                        print(f"[DBG] /llm step2 PERSISTENCE: ❌ No case session found for case_id={case_id}, user_id={user_id}")
                else:
                    print(f"[DBG] /llm step2 PERSISTENCE: ❌ No user session input found for user_input_id={data.get('user_input_id')}")
            else:
                print(f"[DBG] /llm step2 PERSISTENCE: ❌ Skipping persistence - rewritten={bool(rewritten)}, user_input_id={data.get('user_input_id')}")
                        
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

@app.route('/api/cases/feedback', methods=['POST'])
def submit_case_feedback():
    """
    Database endpoint to submit feedback for a closed case.
    Stores feedback data in CASE_REVIEW table including symptom, fault, and fix.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Validate required fields
    required_fields = ['case_number', 'feedback']
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    feedback = data.get('feedback', {})
    feedback_required = ['symptom', 'fault', 'fix']
    for field in feedback_required:
        if field not in feedback or not feedback[field].strip():
            return jsonify({"error": f"Missing or empty feedback field: {field}"}), 400
    
    try:
        from datetime import datetime
        case_number = int(data.get('case_number'))
        
        # Check if case exists for this user
        case_check_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        case_result = snowflake_query(case_check_query, CONNECTION_PAYLOAD, (case_number, user_id))
        
        if case_result is None or case_result.empty:
            return jsonify({"error": "Case not found"}), 404
        
        # Insert feedback into CASE_REVIEW table
        insert_feedback_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.CASE_REVIEW 
            (CASE_ID, USER_ID, CLOSED_DATE, SYMPTOM, FAULT, FIX, SUBMITTED_AT)
            VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP())
        """
        
        closed_date = data.get('closed_date')
        if closed_date:
            # Parse ISO format date if provided
            try:
                closed_date_parsed = datetime.fromisoformat(closed_date.replace('Z', '+00:00'))
            except:
                closed_date_parsed = None
        else:
            closed_date_parsed = None
        
        snowflake_query(insert_feedback_query, CONNECTION_PAYLOAD, 
                       (case_number, user_id, closed_date_parsed,
                        feedback.get('symptom', '').strip(),
                        feedback.get('fault', '').strip(),
                        feedback.get('fix', '').strip()),
                       return_df=False)
        
        # Update case status to 'closed' since feedback has been provided
        update_case_status_query = f"""
            UPDATE {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            SET CASE_STATUS = 'closed'
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        snowflake_query(update_case_status_query, CONNECTION_PAYLOAD, 
                       (case_number, user_id), 
                       return_df=False)
        
        print(f"📝 Feedback submitted for case {case_number} by user {user_id}")
        print(f"   Symptom: {feedback.get('symptom', '')[:50]}...")
        print(f"   Fault: {feedback.get('fault', '')[:50]}...")
        print(f"   Fix: {feedback.get('fix', '')[:50]}...")
        print(f"✅ Case {case_number} status updated to 'closed'")
        
        return jsonify({
            "success": True,
            "message": "Feedback submitted successfully",
            "case_number": case_number,
            "submitted_at": datetime.utcnow().isoformat() + 'Z'
        })
        
    except ValueError:
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"Error submitting feedback for case {data.get('case_number')}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/generate-feedback', methods=['POST'])
def generate_case_feedback():
    """
    Generate LLM-based feedback for a closed case using case information.
    Uses direct LLM call with the same configuration as the rest of the application.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    if not data or 'case_number' not in data:
        return jsonify({"error": "Case number required"}), 400
    
    case_number = data.get('case_number')
    user_id = str(user_data.get('user_id', '0'))
    
    # Get case information from database
    try:
        case_number_int = int(case_number)
        
        # Get case session ID
        session_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        session_result = snowflake_query(session_query, CONNECTION_PAYLOAD, (case_number_int, user_id))
        
        if session_result is None or session_result.empty:
            return jsonify({"error": "Case not found"}), 404
        
        case_session_id = session_result.iloc[0]["ID"]
        
        # Get problem statement
        problem_query = f"""
            SELECT INPUT_FIELD_VALUE
            FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            WHERE CASE_SESSION_ID = %s AND INPUT_FIELD_ID = 1
        """
        problem_result = snowflake_query(problem_query, CONNECTION_PAYLOAD, (case_session_id,))
        
        # Get FSR notes
        fsr_query = f"""
            SELECT INPUT_FIELD_VALUE
            FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            WHERE CASE_SESSION_ID = %s AND INPUT_FIELD_ID = 2
            ORDER BY LINE_ITEM_ID DESC
            LIMIT 1
        """
        fsr_result = snowflake_query(fsr_query, CONNECTION_PAYLOAD, (case_session_id,))
        
        problem_statement = ""
        if problem_result is not None and not problem_result.empty:
            problem_statement = problem_result.iloc[0]["INPUT_FIELD_VALUE"] or ""
        
        fsr_notes = ""
        if fsr_result is not None and not fsr_result.empty:
            fsr_notes = fsr_result.iloc[0]["INPUT_FIELD_VALUE"] or ""
            
    except ValueError:
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"Error fetching case data for feedback generation: {e}")
        return jsonify({"error": "Database error occurred"}), 500
    
    try:
        # Use actual database data for LLM input
        # If no data found, use fallback mock data
        if not problem_statement and not fsr_notes:
            problem_statement = "Customer experiencing database connection timeouts during peak hours, causing application crashes and data loss. Users unable to complete transactions."
            fsr_notes = "Root cause identified: Connection pool exhausted due to unoptimized queries. Implemented connection pooling, query optimization, and added monitoring. Case resolved successfully."
        
        # Prepare case information for LLM using database data
        case_info = f"""
Case Number: {case_number}
Problem Statement: {problem_statement}
FSR Notes: {fsr_notes}
"""
        
        # Create LLM prompt
        llm_prompt = f"""
Based on the following closed case information, generate a structured feedback response with three components:

Case Information:
{case_info}

Please provide:
1. SYMPTOM: A clear description of what symptoms or issues were reported
2. FAULT: The root cause or fault that was identified
3. FIX: The solution that was implemented to resolve the issue

Format your response as:
SYMPTOM: [description]
FAULT: [root cause]
FIX: [solution implemented]

Be specific and technical, drawing from the case information provided.
"""
        
        # Direct LLM call using the same configuration as the main app
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
        
        # Call LLM directly
        response = litellm.completion(
            messages=[
                {"role": "user", "content": llm_prompt}
            ],
            **model_kwargs
        )
        
        generated_content = response.choices[0].message.content
        
        # Parse the LLM response to extract symptom, fault, fix
        lines = generated_content.split('\n')
        symptom = ""
        fault = ""
        fix = ""
        
        current_section = None
        for line in lines:
            line = line.strip()
            if line.startswith('SYMPTOM:'):
                current_section = 'symptom'
                symptom = line.replace('SYMPTOM:', '').strip()
            elif line.startswith('FAULT:'):
                current_section = 'fault'
                fault = line.replace('FAULT:', '').strip()
            elif line.startswith('FIX:'):
                current_section = 'fix'
                fix = line.replace('FIX:', '').strip()
            elif current_section and line:
                # Continue adding to current section
                if current_section == 'symptom':
                    symptom += ' ' + line
                elif current_section == 'fault':
                    fault += ' ' + line
                elif current_section == 'fix':
                    fix += ' ' + line
        
        return jsonify({
            "success": True,
            "case_number": case_number,
            "generated_feedback": {
                "symptom": symptom.strip(),
                "fault": fault.strip(),
                "fix": fix.strip()
            }
        })
            
    except Exception as e:
        print(f"Error generating feedback: {e}")
        return jsonify({"error": "Error generating feedback"}), 500

@app.route('/api/cases/create', methods=['POST'])
def create_case():
    """
    Database endpoint to create a new case session.
    Creates a new case in CASE_SESSIONS table for the authenticated user.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_number = data.get('case_number')
    user_id = user_data.get('user_id')
    
    if not case_number:
        return jsonify({"error": "Case number required"}), 400
    
    try:
        # Check if case already exists for this user
        check_query = f"""
            SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        check_result = snowflake_query(check_query, CONNECTION_PAYLOAD, (case_number, user_id))
        
        if check_result is not None and check_result.iloc[0, 0] > 0:
            return jsonify({"error": "Case already exists"}), 409
        
        # Check external CRM (placeholder function)
        exists_in_crm = check_external_crm_exists(case_number)
        print(f"🔍 [Backend] Case {case_number} exists in external CRM: {exists_in_crm}")
        
        # Insert new case session
        insert_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
            VALUES (%s, %s, 'open', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """
        snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                       (case_number, user_id), 
                       return_df=False)
        
        # Prepare response with CRM status
        response_data = {
            "success": True,
            "case_number": case_number,
            "message": "Case created successfully",
            "exists_in_crm": exists_in_crm
        }
        
        if not exists_in_crm:
            response_data["warning"] = "Case not found in external CRM. This case will be tracked locally but may not sync with external systems."
            print(f"⚠️ [Backend] Case {case_number} not found in external CRM - showing warning")
        else:
            print(f"✅ [Backend] Case {case_number} found in external CRM")
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"Error creating case {case_number} for user {user_id}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/delete/<case_number>', methods=['DELETE'])
def delete_case(case_number):
    """
    Delete a case from the database.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/delete: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    print(f"🗑️ [Backend] /api/cases/delete: Deleting case {case_number} for user {user_id}")
    
    try:
        # Convert case_number to int (database expects numeric)
        case_number_int = int(case_number)
        
        # Check if case exists for this user
        check_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        result = snowflake_query(check_query, CONNECTION_PAYLOAD, (case_number_int, user_id))
        
        if result is None or result.empty:
            print(f"❌ [Backend] Case {case_number} not found for user {user_id}")
            return jsonify({"error": "Case not found"}), 404
        
        case_session_id = result.iloc[0]["ID"]
        print(f"📊 [Backend] Found case session ID: {case_session_id}")
        
        # Delete from LAST_INPUT_STATE first (foreign key constraint)
        delete_input_state_query = f"""
            DELETE FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE 
            WHERE CASE_SESSION_ID = %s
        """
        snowflake_query(delete_input_state_query, CONNECTION_PAYLOAD, (case_session_id,), return_df=False)
        print(f"✅ [Backend] Deleted input state records for case {case_number}")
        
        # Delete from CASE_SESSIONS
        delete_case_query = f"""
            DELETE FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE ID = %s
        """
        snowflake_query(delete_case_query, CONNECTION_PAYLOAD, (case_session_id,), return_df=False)
        print(f"✅ [Backend] Deleted case session for case {case_number}")
        
        return jsonify({
            "success": True,
            "message": f"Case {case_number} deleted successfully"
        })
        
    except ValueError:
        print(f"❌ [Backend] Invalid case number format: {case_number}")
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"❌ [Backend] Error deleting case {case_number} for user {user_id}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/input-state', methods=['GET'])
def get_input_state():
    """
    Database endpoint to get input state for a specific case.
    Returns the current input state (problem statement, FSR notes) for a case.
    """
    user_data = session.get('user_data')
    if not user_data:
        print("❌ [Backend] /api/cases/input-state GET: Not authenticated")
        return jsonify({"error": "Not authenticated"}), 401
    
    case_number = request.args.get('case_number')
    if not case_number:
        print("❌ [Backend] /api/cases/input-state GET: Case number required")
        return jsonify({"error": "Case number required"}), 400
    
    user_id = user_data.get('user_id')
    print(f"🚀 [Backend] /api/cases/input-state GET: Fetching input state for case {case_number}, user {user_id}")
    
    try:
        case_number_int = int(case_number)
        
        # Get case session ID
        session_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        session_result = snowflake_query(session_query, CONNECTION_PAYLOAD, (case_number_int, user_id))
        
        if session_result is None or session_result.empty:
            return jsonify({"error": "Case not found"}), 404
        
        case_session_id = session_result.iloc[0]["ID"]
        
        # Get problem statement (INPUT_FIELD_ID = 1)
        problem_query = f"""
            SELECT INPUT_FIELD_VALUE, LAST_UPDATED
            FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            WHERE CASE_SESSION_ID = %s AND INPUT_FIELD_ID = 1
        """
        print(f"[DBG] /api/cases/input-state GET: Querying problem statement for case_session_id={case_session_id}")
        problem_result = snowflake_query(problem_query, CONNECTION_PAYLOAD, (case_session_id,))
        print(f"[DBG] /api/cases/input-state GET: problem_result={problem_result is not None}, empty={problem_result.empty if problem_result is not None else 'N/A'}")
        if problem_result is not None and not problem_result.empty:
            problem_text = problem_result.iloc[0]["INPUT_FIELD_VALUE"] or ""
            print(f"[DBG] /api/cases/input-state GET: problem_text_length={len(problem_text)}, preview={problem_text[:100]}...")
        
        # Get FSR notes (INPUT_FIELD_ID = 2)
        fsr_query = f"""
            SELECT LINE_ITEM_ID, INPUT_FIELD_VALUE, LAST_UPDATED
            FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            WHERE CASE_SESSION_ID = %s AND INPUT_FIELD_ID = 2
            ORDER BY LINE_ITEM_ID
        """
        print(f"[DBG] /api/cases/input-state GET: Querying FSR notes for case_session_id={case_session_id}")
        fsr_result = snowflake_query(fsr_query, CONNECTION_PAYLOAD, (case_session_id,))
        print(f"[DBG] /api/cases/input-state GET: fsr_result={fsr_result is not None}, empty={fsr_result.empty if fsr_result is not None else 'N/A'}")
        if fsr_result is not None and not fsr_result.empty:
            for idx, row in fsr_result.iterrows():
                fsr_text = row["INPUT_FIELD_VALUE"] or ""
                print(f"[DBG] /api/cases/input-state GET: fsr_line_{row['LINE_ITEM_ID']}_length={len(fsr_text)}, preview={fsr_text[:100]}...")
        
        # Build response
        response_data = {
            "case_number": case_number,
            "problem_statement": "",
            "fsr_notes": "",
            "fsr_line_items": []
        }
        
        if problem_result is not None and not problem_result.empty:
            problem_row = problem_result.iloc[0]
            response_data["problem_statement"] = problem_row["INPUT_FIELD_VALUE"] or ""
        
        if fsr_result is not None and not fsr_result.empty:
            # Get all FSR line items
            for _, fsr_row in fsr_result.iterrows():
                line_item = {
                    "line_item_id": fsr_row["LINE_ITEM_ID"],
                    "value": fsr_row["INPUT_FIELD_VALUE"],
                    "last_updated": fsr_row["LAST_UPDATED"].isoformat() if fsr_row["LAST_UPDATED"] else None
                }
                response_data["fsr_line_items"].append(line_item)
            
            # Get the last FSR line item for the main fsr_notes field
            last_fsr = fsr_result.iloc[-1]
            response_data["fsr_notes"] = last_fsr["INPUT_FIELD_VALUE"] or ""
        
        return jsonify(response_data)
        
    except ValueError:
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"Error getting input state for case {case_number}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/input-state', methods=['PUT'])
def update_input_state():
    """
    Database endpoint to update input state for a specific case.
    Saves problem statement and FSR notes to LAST_INPUT_STATE table.
    """
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_number = data.get('case_number')
    problem_statement = data.get('problem_statement', '')
    fsr_notes = data.get('fsr_notes', '')
    evaluation_id = data.get('evaluation_id')  # LLM evaluation ID to link to
    
    if not case_number:
        return jsonify({"error": "Case number required"}), 400
    
    user_id = user_data.get('user_id')
    
    try:
        case_number_int = int(case_number)
        
        # Get case session ID
        session_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        session_result = snowflake_query(session_query, CONNECTION_PAYLOAD, (case_number_int, user_id))
        
        if session_result is None or session_result.empty:
            return jsonify({"error": "Case not found"}), 404
        
        case_session_id = session_result.iloc[0]["ID"]
        
        # Update problem statement using MERGE (Snowflake upsert)
        if problem_statement:
            problem_merge = f"""
                MERGE INTO {DATABASE}.{SCHEMA}.LAST_INPUT_STATE AS target
                USING (SELECT %s as CASE_SESSION_ID, %s as INPUT_FIELD_ID, %s as INPUT_FIELD_VALUE, %s as LINE_ITEM_ID, %s as INPUT_FIELD_EVAL_ID) AS source
                ON target.CASE_SESSION_ID = source.CASE_SESSION_ID 
                   AND target.INPUT_FIELD_ID = source.INPUT_FIELD_ID 
                   AND target.LINE_ITEM_ID = source.LINE_ITEM_ID
                WHEN MATCHED THEN UPDATE SET 
                    INPUT_FIELD_VALUE = source.INPUT_FIELD_VALUE,
                    LAST_UPDATED = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT 
                    (CASE_SESSION_ID, INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID, LAST_UPDATED)
                    VALUES (source.CASE_SESSION_ID, source.INPUT_FIELD_ID, source.INPUT_FIELD_VALUE, source.LINE_ITEM_ID, source.INPUT_FIELD_EVAL_ID, CURRENT_TIMESTAMP())
            """
            snowflake_query(problem_merge, CONNECTION_PAYLOAD, 
                           (case_session_id, 1, problem_statement, None, evaluation_id), 
                           return_df=False)
        
        # Update FSR notes using MERGE (Snowflake upsert)
        if fsr_notes:
            fsr_merge = f"""
                MERGE INTO {DATABASE}.{SCHEMA}.LAST_INPUT_STATE AS target
                USING (SELECT %s as CASE_SESSION_ID, %s as INPUT_FIELD_ID, %s as INPUT_FIELD_VALUE, %s as LINE_ITEM_ID, %s as INPUT_FIELD_EVAL_ID) AS source
                ON target.CASE_SESSION_ID = source.CASE_SESSION_ID 
                   AND target.INPUT_FIELD_ID = source.INPUT_FIELD_ID 
                   AND target.LINE_ITEM_ID = source.LINE_ITEM_ID
                WHEN MATCHED THEN UPDATE SET 
                    INPUT_FIELD_VALUE = source.INPUT_FIELD_VALUE,
                    LAST_UPDATED = CURRENT_TIMESTAMP()
                WHEN NOT MATCHED THEN INSERT 
                    (CASE_SESSION_ID, INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID, LAST_UPDATED)
                    VALUES (source.CASE_SESSION_ID, source.INPUT_FIELD_ID, source.INPUT_FIELD_VALUE, source.LINE_ITEM_ID, source.INPUT_FIELD_EVAL_ID, CURRENT_TIMESTAMP())
            """
            snowflake_query(fsr_merge, CONNECTION_PAYLOAD, 
                           (case_session_id, 2, fsr_notes, 1, evaluation_id), 
                           return_df=False)
        
        return jsonify({
            "success": True,
            "case_number": case_number,
            "message": "Input state updated successfully"
        })
        
    except ValueError:
        return jsonify({"error": "Invalid case number format"}), 400
    except Exception as e:
        print(f"Error updating input state for case {case_number}: {e}")
        return jsonify({"error": "Database error occurred"}), 500

@app.route('/api/cases/clear-feedback-flags', methods=['POST'])
def clear_feedback_flags():
    """
    Debug endpoint to clear localStorage feedback flags for testing.
    This allows the feedback popup to show again for testing.
    """
    return jsonify({
        "success": True,
        "message": "Feedback flags cleared. Refresh the page to see feedback popup again.",
        "instructions": "Run localStorage.clear() in browser console to clear all feedback flags"
    })

if __name__ == "__main__":
    print("Starting LanguageTool Flask App...")
    with open("./config.yaml", 'r') as f:
        config = yaml.safe_load(f)
    CONNECTION_PAYLOAD = config.get("Engineering_SAGE_SVC", {})
    PROD_PAYLOAD = config.get("Production_SAGE_SVC", {})
    app.config['ENABLE_SSO'] = config.get("AppConfig", {}).get("ENABLE_SSO", True)
    app.config['DEV_MODE'] = config.get("AppConfig", {}).get("DEV_MODE", False)
    
    DATABASE = "SAGE"
    SCHEMA = "TEXTIO_SERVICES_INPUTS"
    if app.config['DEV_MODE']:
        SCHEMA = f"DEV_{SCHEMA}"
    print(f"SSO Enabled: {app.config['ENABLE_SSO']}")
    print(f"Development Mode Enabled: {app.config['DEV_MODE']}")
    app.run(host='127.0.0.1', port=8055)

