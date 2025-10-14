#!/usr/bin/env python3
"""
Database Connection Test for Step 1.1
This script tests the database connection and adds test data if needed
"""

import sys
import os
import yaml

# Add the current directory to Python path so we can import from app.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from snowflakeconnection import snowflake_query
    print("✅ Successfully imported snowflake_query")
except ImportError as e:
    print(f"❌ ERROR: Could not import snowflake_query: {e}")
    print("Make sure snowflakeconnection.py is in the current directory")
    sys.exit(1)

# Load configuration like app.py does
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
    print("Make sure config.yaml exists and is properly formatted")
    sys.exit(1)

def test_database_connection():
    """Test the database connection"""
    print("🧪 Testing Database Connection")
    print("=" * 40)
    
    try:
        # Test basic connection
        query = "SELECT 1 as test_connection"
        result = snowflake_query(query, CONNECTION_PAYLOAD)
        
        if result is not None and not result.empty:
            print("✅ Database connection successful!")
            print(f"Database: {DATABASE}")
            print(f"Schema: {SCHEMA}")
        else:
            print("❌ Database connection failed - no result returned")
            return False
            
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False
    
    return True

def check_case_sessions_table():
    """Check if CASE_SESSIONS table exists and has data"""
    print("\n🔍 Checking CASE_SESSIONS table")
    print("=" * 40)
    
    try:
        # Check if table exists and get row count
        query = f"""
            SELECT COUNT(*) as row_count
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS
        """
        result = snowflake_query(query, CONNECTION_PAYLOAD)
        
        if result is not None and not result.empty:
            row_count = result.iloc[0]["ROW_COUNT"]
            print(f"✅ CASE_SESSIONS table exists with {row_count} rows")
            
            if row_count == 0:
                print("⚠️  Table is empty - you may want to add test data")
                return False
            else:
                return True
        else:
            print("❌ CASE_SESSIONS table not found or empty")
            return False
            
    except Exception as e:
        print(f"❌ Error checking CASE_SESSIONS table: {e}")
        return False

def get_sample_cases():
    """Get sample cases from the database"""
    print("\n📋 Sample Cases in Database")
    print("=" * 40)
    
    try:
        query = f"""
            SELECT CASE_ID, CASE_STATUS, CREATED_BY_USER, CREATION_TIME
            FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS
            ORDER BY CREATION_TIME DESC
            LIMIT 5
        """
        result = snowflake_query(query, CONNECTION_PAYLOAD)
        
        if result is not None and not result.empty:
            print("Sample cases:")
            for _, row in result.iterrows():
                print(f"  - {row['CASE_ID']} (Status: {row['CASE_STATUS']}, User: {row['CREATED_BY_USER']})")
            return True
        else:
            print("No cases found in database")
            return False
            
    except Exception as e:
        print(f"❌ Error getting sample cases: {e}")
        return False

def add_test_cases():
    """Add test cases to the database"""
    print("\n➕ Adding Test Cases")
    print("=" * 40)
    
    test_cases = [
        (2024001, 0, 'open'),
        (2024002, 0, 'open'),
        (2024003, 0, 'closed'),
        (9999001, 0, 'open'),
    ]
    
    added_count = 0
    
    for test_case_id, user_id, status in test_cases:
        try:
            # Check if test case already exists
            check_query = f"""
                SELECT COUNT(*) as exists_count
                FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS
                WHERE CASE_ID = %s
            """
            check_result = snowflake_query(check_query, CONNECTION_PAYLOAD, (test_case_id,))
            
            if check_result is not None and check_result.iloc[0]["EXISTS_COUNT"] > 0:
                print(f"✅ Test case {test_case_id} already exists")
                continue
            
            # Insert test case
            insert_query = f"""
                INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
                (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
            """
            snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                           (test_case_id, user_id, status), 
                           return_df=False)
            
            print(f"✅ Test case {test_case_id} added successfully")
            added_count += 1
            
        except Exception as e:
            print(f"❌ Error adding test case {test_case_id}: {e}")
    
    print(f"✅ Added {added_count} new test cases")
    return added_count > 0

def main():
    """Main test function"""
    print("🚀 Database Connection Test for Step 1.1")
    print("=" * 50)
    
    # Test 1: Database connection
    if not test_database_connection():
        print("\n❌ Database connection failed. Please check your configuration.")
        return False
    
    # Test 2: Check CASE_SESSIONS table
    if not check_case_sessions_table():
        print("\n⚠️  CASE_SESSIONS table is empty or doesn't exist.")
        print("Adding test cases...")
        if add_test_cases():
            print("✅ Test cases added successfully")
        else:
            print("❌ Failed to add test cases")
            return False
    
    # Test 3: Get sample cases
    get_sample_cases()
    
    print("\n" + "=" * 50)
    print("🎉 Database connection test completed!")
    print("\nYou can now run the Flask app and test the endpoint:")
    print("1. Start the Flask app: python app.py")
    print("2. Run the endpoint test: python test_step_1_1.py")
    
    return True

if __name__ == "__main__":
    success = main()
    
    if success:
        print("\n✅ All database tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Database tests failed. Please check the errors above.")
        sys.exit(1)
