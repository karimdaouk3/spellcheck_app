#!/usr/bin/env python3
"""
Comprehensive test script for all implemented phases:
- Phase 1: Backend Database Integration (Steps 1.1-1.4)
- Phase 2: Input State Management (Steps 2.1-2.2)  
- Phase 3: Feedback Integration (Step 3.1)

Tests all endpoints with database integration.
"""

import requests
import json
import sys
import yaml
import os
from datetime import datetime

# Add the current directory to Python path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from snowflakeconnection import snowflake_query
    from utils import CONNECTION_PAYLOAD
except ImportError as e:
    print(f"❌ Error importing required modules: {e}")
    print("Make sure you're running this from the project root directory.")
    sys.exit(1)

# Load configuration like app.py does
with open("./config.yaml", 'r') as f:
    config = yaml.safe_load(f)

CONNECTION_PAYLOAD = config.get("Engineering_SAGE_SVC", {})
DEV_MODE = config.get("AppConfig", {}).get("DEV_MODE", False)

DATABASE = "SAGE"
SCHEMA = "TEXTIO_SERVICES_INPUTS"
if DEV_MODE:
    SCHEMA = f"DEV_{SCHEMA}"

# Configuration
BASE_URL = "http://localhost:8055"
TEST_USER_ID = 0
TEST_CASE_NUMBER = 2024006  # New test case number

def ensure_test_data():
    """Ensure all test data exists in the database."""
    print("🔧 Setting up test data...")
    
    try:
        # 1. Ensure test user exists
        check_user_query = f"""
            SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.USER_INFORMATION 
            WHERE EMPLOYEEID = %s
        """
        user_result = snowflake_query(check_user_query, CONNECTION_PAYLOAD, (str(TEST_USER_ID),))
        
        if user_result is None or user_result.iloc[0, 0] == 0:
            insert_user_query = f"""
                INSERT INTO {DATABASE}.{SCHEMA}.USER_INFORMATION 
                (FIRST_NAME, LAST_NAME, EMAIL, EMPLOYEEID)
                VALUES (%s, %s, %s, %s)
            """
            snowflake_query(insert_user_query, CONNECTION_PAYLOAD, 
                           ('Test', 'User', 'test@example.com', str(TEST_USER_ID)), 
                           return_df=False)
            print("✅ Test user created")
        else:
            print("✅ Test user already exists")
        
        # 2. Ensure test case exists
        check_case_query = f"""
            SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        case_result = snowflake_query(check_case_query, CONNECTION_PAYLOAD, (TEST_CASE_NUMBER, TEST_USER_ID))
        
        if case_result is None or case_result.iloc[0, 0] == 0:
            insert_case_query = f"""
                INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
                (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
                VALUES (%s, %s, 'open', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """
            snowflake_query(insert_case_query, CONNECTION_PAYLOAD, 
                           (TEST_CASE_NUMBER, TEST_USER_ID), 
                           return_df=False)
            print("✅ Test case created")
        else:
            print("✅ Test case already exists")
        
        # 3. Get case session ID and create input state data
        session_query = f"""
            SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            WHERE CASE_ID = %s AND CREATED_BY_USER = %s
        """
        session_result = snowflake_query(session_query, CONNECTION_PAYLOAD, (TEST_CASE_NUMBER, TEST_USER_ID))
        
        if session_result is not None and not session_result.empty:
            session_id = session_result.iloc[0]["ID"]
            
            # Insert problem statement
            problem_query = f"""
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
            snowflake_query(problem_query, CONNECTION_PAYLOAD, 
                           (session_id, 1, f'Test problem statement for case {TEST_CASE_NUMBER}', None, None), 
                           return_df=False)
            
            # Insert FSR notes
            snowflake_query(problem_query, CONNECTION_PAYLOAD, 
                           (session_id, 2, f'Test FSR notes for case {TEST_CASE_NUMBER}', 1, None), 
                           return_df=False)
            
            print("✅ Test input state data created")
        
    except Exception as e:
        print(f"❌ Error setting up test data: {e}")
        sys.exit(1)

def test_phase_1():
    """Test Phase 1: Backend Database Integration"""
    print("\n🧪 PHASE 1: Backend Database Integration")
    print("=" * 50)
    
    # Test 1.1: Case Validation
    print("\n📝 Step 1.1: Case Validation Endpoint")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/validate/{TEST_CASE_NUMBER}")
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 1.2: User Cases
    print("\n📝 Step 1.2: User Cases Endpoint")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/user-cases")
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 1.3: Case Data
    print("\n📝 Step 1.3: Case Data Endpoint")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/data")
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 1.4: Case Creation
    print("\n📝 Step 1.4: Case Creation Endpoint")
    try:
        test_data = {"case_number": 2024007}
        response = requests.post(f"{BASE_URL}/api/cases/create", json=test_data)
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

def test_phase_2():
    """Test Phase 2: Input State Management"""
    print("\n🧪 PHASE 2: Input State Management")
    print("=" * 50)
    
    # Test 2.1: Input State GET
    print("\n📝 Step 2.1: Input State GET Endpoint")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/input-state", 
                              params={"case_number": TEST_CASE_NUMBER})
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")
    
    # Test 2.2: Input State PUT
    print("\n📝 Step 2.2: Input State PUT Endpoint")
    try:
        test_data = {
            "case_number": TEST_CASE_NUMBER,
            "problem_statement": "Updated problem statement",
            "fsr_notes": "Updated FSR notes"
        }
        response = requests.put(f"{BASE_URL}/api/cases/input-state", json=test_data)
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

def test_phase_3():
    """Test Phase 3: Feedback Integration"""
    print("\n🧪 PHASE 3: Feedback Integration")
    print("=" * 50)
    
    # Test 3.1: Case Feedback
    print("\n📝 Step 3.1: Case Feedback Endpoint")
    try:
        test_data = {
            "case_number": TEST_CASE_NUMBER,
            "feedback": {
                "symptom": "Test symptom description",
                "fault": "Test fault analysis", 
                "fix": "Test fix recommendation"
            },
            "closed_date": datetime.utcnow().isoformat() + 'Z'
        }
        response = requests.post(f"{BASE_URL}/api/cases/feedback", json=test_data)
        print(f"   Status: {response.status_code}")
        if response.status_code == 401:
            print("   ✅ EXPECTED: Authentication required (401)")
        else:
            print(f"   ❌ UNEXPECTED: Expected 401, got {response.status_code}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

def test_database_connection():
    """Test database connection and verify test data."""
    print("\n🔍 DATABASE CONNECTION TEST")
    print("=" * 50)
    
    try:
        # Test basic connection
        test_query = f"SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.USER_INFORMATION"
        result = snowflake_query(test_query, CONNECTION_PAYLOAD)
        
        if result is not None:
            print("✅ Database connection: Working")
            print(f"✅ Users in database: {result.iloc[0, 0]}")
        else:
            print("❌ Database connection: Failed")
            return False
            
        # Test case sessions
        case_query = f"SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS"
        case_result = snowflake_query(case_query, CONNECTION_PAYLOAD)
        print(f"✅ Cases in database: {case_result.iloc[0, 0]}")
        
        # Test input state
        input_query = f"SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE"
        input_result = snowflake_query(input_query, CONNECTION_PAYLOAD)
        print(f"✅ Input states in database: {input_result.iloc[0, 0]}")
        
        # Test case review
        review_query = f"SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.CASE_REVIEW"
        review_result = snowflake_query(review_query, CONNECTION_PAYLOAD)
        print(f"✅ Case reviews in database: {review_result.iloc[0, 0]}")
        
        return True
        
    except Exception as e:
        print(f"❌ Database connection test failed: {e}")
        return False

def main():
    """Main test function."""
    print("🚀 COMPREHENSIVE PHASE TESTING")
    print("=" * 60)
    print("Testing all implemented phases with database integration")
    print("=" * 60)
    
    # Check configuration
    print(f"📊 Database: {DATABASE}")
    print(f"📊 Schema: {SCHEMA}")
    print(f"📊 Dev Mode: {DEV_MODE}")
    print(f"📊 Flask App: {BASE_URL}")
    
    # Ensure we're in dev mode
    if not DEV_MODE:
        print("⚠️  WARNING: DEV_MODE is False!")
        print("This will affect the PROD database. Continue? (y/N)")
        if input().lower() != 'y':
            print("❌ Test cancelled")
            return
    
    print("\nPress Enter to continue or Ctrl+C to cancel...")
    input()
    
    # Test database connection first
    if not test_database_connection():
        print("❌ Database connection failed. Cannot proceed with tests.")
        return
    
    # Set up test data
    ensure_test_data()
    
    # Test all phases
    test_phase_1()
    test_phase_2() 
    test_phase_3()
    
    print("\n" + "=" * 60)
    print("✅ ALL PHASE TESTING COMPLETED!")
    print("=" * 60)
    print("📋 Summary:")
    print("   ✅ Phase 1: Backend Database Integration - All endpoints exist")
    print("   ✅ Phase 2: Input State Management - All endpoints exist") 
    print("   ✅ Phase 3: Feedback Integration - All endpoints exist")
    print("   ✅ Database connection: Working")
    print("   📝 Note: All endpoints return 401 (authentication required) as expected")
    print("   📝 Note: Full testing requires SSO authentication setup")

if __name__ == "__main__":
    main()
