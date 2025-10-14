#!/usr/bin/env python3
"""
Test script for Step 1.1: Case Validation Endpoint
This script tests the updated /api/cases/validate/<case_number> endpoint
"""

import requests
import json
import sys

# Configuration
BASE_URL = "http://127.0.0.1:8055"
TEST_CASE_NUMBER = "CASE-2024-001"  # Change this to a case that exists in your database

def test_case_validation():
    """Test the case validation endpoint"""
    print("🧪 Testing Step 1.1: Case Validation Endpoint")
    print("=" * 50)
    
    # Test 1: Valid case number
    print(f"Test 1: Validating case '{TEST_CASE_NUMBER}'")
    try:
        response = requests.get(f"{BASE_URL}/api/cases/validate/{TEST_CASE_NUMBER}")
        print(f"Status Code: {response.status_code}")
        
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
            
    except requests.exceptions.ConnectionError:
        print("❌ ERROR: Could not connect to the server")
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
    
    success = test_case_validation()
    
    if success:
        print("\n✅ All tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Please check the errors above.")
        sys.exit(1)
