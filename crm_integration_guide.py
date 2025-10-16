#!/usr/bin/env python3
"""
CRM Integration Guide
Shows how to integrate the tested CRM queries into Flask endpoints.
"""

# Example Flask endpoint implementations using the tested CRM queries

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
        
        like_pattern = f"%{user_email}%"
        result = snowflake_query(query, CONNECTION_PAYLOAD, params=(like_pattern,))
        
        if result is not None and not result.empty:
            return result["Case Number"].tolist()
        else:
            return []
            
    except Exception as e:
        print(f"Error getting available case numbers: {e}")
        return []

def check_case_status(case_number):
    """
    CRM Query 2: Check if a case is open (not closed)
    Use this in: /api/cases/check-external-status
    """
    try:
        query = """
            SELECT DISTINCT "[Case Number]" AS "Case Number"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY 
            WHERE "Verify Closure Date/Time" IS NULL 
            AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
            AND "[Case Number]" = %s
        """
        
        result = snowflake_query(query, CONNECTION_PAYLOAD, params=(case_number,))
        
        if result is not None and not result.empty:
            return 'open'
        else:
            return 'closed'
            
    except Exception as e:
        print(f"Error checking case status: {e}")
        return 'unknown'

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
        
        result = snowflake_query(query, CONNECTION_PAYLOAD)
        
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
        
        result = snowflake_query(query, CONNECTION_PAYLOAD, params=(case_number,))
        
        if result is not None and not result.empty:
            return result.to_dict('records')
        else:
            return []
            
    except Exception as e:
        print(f"Error getting case details: {e}")
        return []

# Example Flask endpoint implementations:

"""
@app.route('/api/cases/suggestions', methods=['GET'])
def get_case_suggestions():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_email = user_data.get('email')
    if not user_email:
        return jsonify({"error": "No email found"}), 400
    
    try:
        case_numbers = get_available_case_numbers(user_email)
        return jsonify({
            "success": True,
            "case_numbers": case_numbers,
            "count": len(case_numbers)
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get case suggestions: {str(e)}"}), 500

@app.route('/api/cases/check-external-status', methods=['POST'])
def check_external_crm_status():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_numbers = data.get('case_numbers', [])
    
    if not case_numbers:
        return jsonify({"error": "No case numbers provided"}), 400
    
    try:
        case_status = check_case_status_batch(case_numbers)
        
        # Filter for cases that need feedback (closed in CRM but open locally)
        cases_needing_feedback = [
            case_num for case_num, status in case_status.items() 
            if status == 'closed'
        ]
        
        return jsonify({
            "success": True,
            "case_status": case_status,
            "cases_needing_feedback": cases_needing_feedback
        })
    except Exception as e:
        return jsonify({"error": f"Failed to check case status: {str(e)}"}), 500

@app.route('/api/cases/details/<case_number>', methods=['GET'])
def get_case_details_endpoint(case_number):
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    try:
        case_details = get_case_details(case_number)
        return jsonify({
            "success": True,
            "case_number": case_number,
            "details": case_details,
            "count": len(case_details)
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get case details: {str(e)}"}), 500
"""

if __name__ == "__main__":
    print("📋 CRM Integration Guide")
    print("="*50)
    print("This file contains the CRM query functions ready for integration.")
    print("Copy the functions into your app.py file.")
    print("Use the Flask endpoint examples as templates.")
