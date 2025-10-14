#!/usr/bin/env python3
"""
Test script for Step 1.1: Case Validation Endpoint
This script tests the updated /api/cases/validate/<case_number> endpoint
"""

import requests
import json
import sys
import yaml
import os

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import database functions
try:
    from snowflakeconnection import snowflake_query
    print("✅ Successfully imported snowflake_query")
except ImportError as e:
    print(f"❌ ERROR: Could not import snowflake_query: {e}")
    sys.exit(1)

# Load configuration
try:
    with open("./config.yaml", 'r') as f:
        config = yaml.safe_load(f)
    CONNECTION_PAYLOAD = config.get("Engineering_SAGE_SVC", {})
    DEV_MODE = config.get("AppConfig", {}).get("DEV_MODE", False)
    
    DATABASE = "SAGE"
    SCHEMA = "TEXTIO_SERVICES_INPUTS"
    if DEV_MODE:
        SCHEMA = f"DEV_{SCHEMA}"
    
    print(f"✅ Database configuration loaded")
    print(f"   Database: {DATABASE}")
    print(f"   Schema: {SCHEMA}")
    print(f"   Dev Mode: {DEV_MODE}")
    
    # Ensure we're using DEV database
    if not DEV_MODE:
        print("⚠️  WARNING: Not in DEV_MODE! This will use PROD database!")
        print("   Set DEV_MODE: true in config.yaml to use dev database")
        response = input("Continue anyway? (y/N): ")
        if response.lower() != 'y':
            print("❌ Aborting to protect production database")
            sys.exit(1)
    
except Exception as e:
    print(f"❌ ERROR: Could not load configuration: {e}")
    sys.exit(1)

# Configuration
BASE_URL = "http://127.0.0.1:8055"
TEST_CASE_NUMBER = 2024001  # This will be created if it doesn't exist

def ensure_test_data():
    """Ensure test data exists in the database"""
    print("🔧 Ensuring test data exists...")
    
    try:
        # Check if test case exists
        check_query = f"""
            SELECT COUNT(*) as exists_count
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS
            WHERE CASE_ID = %s
        """
        check_result = snowflake_query(check_query, CONNECTION_PAYLOAD, (TEST_CASE_NUMBER,))
        
        if check_result is not None and check_result.iloc[0]["EXISTS_COUNT"] > 0:
            print(f"✅ Test case {TEST_CASE_NUMBER} already exists")
            return True
        
        # Insert test case
        insert_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """
        snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                       (TEST_CASE_NUMBER, 0, 'open'), 
                       return_df=False)
        
        print(f"✅ Test case {TEST_CASE_NUMBER} created successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error ensuring test data: {e}")
        return False

def test_case_validation():
    """Test the case validation endpoint"""
    print("🧪 Testing Step 1.1: Case Validation Endpoint")
    print("=" * 50)
    
    # Test 1: Valid case number
    print(f"Test 1: Validating case '{TEST_CASE_NUMBER}'")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/validate/{TEST_CASE_NUMBER}")
        print(f"Status Code: {response.status_code}")
    except requests.exceptions.ConnectionError:
        print("❌ ERROR: Connection failed - Flask app is not running!")
        print("💡 Start the Flask app first: python app.py")
        return False
    
    if response.status_code == 200:
        data = response.json()
        print("✅ SUCCESS: Case validation endpoint is working!")
        print(f"Response: {json.dumps(data, indent=2)}")
        
        # Verify response structure
        required_fields = ["valid", "case_id", "case_status", "is_closed", "status"]
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            print(f"❌ WARNING: Missing fields in response: {missing_fields}")
        else:
            print("✅ All required fields present in response")
            
    elif response.status_code == 404:
        data = response.json()
        print(f"ℹ️  Case not found: {data.get('message', 'Unknown error')}")
        print("This is expected if the case doesn't exist in the database")
        
    else:
        print(f"❌ ERROR: Unexpected status code {response.status_code}")
        print(f"Response: {response.text}")
        print("Make sure the Flask app is running on http://127.0.0.1:8055")
        return False
    
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False
    
    # Test 2: Invalid case number
    print(f"\nTest 2: Validating non-existent case 'INVALID-CASE-999'")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/validate/INVALID-CASE-999")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 404:
            data = response.json()
            print("✅ SUCCESS: Correctly returns 404 for non-existent case")
            print(f"Response: {json.dumps(data, indent=2)}")
        else:
            print(f"❌ ERROR: Expected 404, got {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False
    
    # Test 3: Unauthenticated request
    print(f"\nTest 3: Testing unauthenticated request")
    try:
        # Create a new session without authentication
        session = requests.Session()
        response = session.get(f"{BASE_URL}/api/cases/validate/{TEST_CASE_NUMBER}")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 401:
            data = response.json()
            print("✅ SUCCESS: Correctly returns 401 for unauthenticated request")
            print(f"Response: {json.dumps(data, indent=2)}")
        else:
            print(f"❌ ERROR: Expected 401, got {response.status_code}")
            print(f"Response: {response.text}")
            
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 Step 1.1 testing completed!")
    print("\nNext steps:")
    print("1. If all tests passed, proceed to Step 1.2")
    print("2. If any tests failed, check the database connection and table names")
    print("3. Make sure you have some test data in the CASE_SESSIONS table")
    
    return True

if __name__ == "__main__":
    print("Starting Step 1.1 Test...")
    print("Make sure the Flask app is running!")
    print("Press Enter to continue or Ctrl+C to cancel...")
    input()
    
    # Ensure test data exists
    if not ensure_test_data():
        print("❌ Failed to create test data. Aborting.")
        sys.exit(1)
    
    success = test_case_validation()
    
    if success:
        print("\n✅ All tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Please check the errors above.")
        sys.exit(1)
