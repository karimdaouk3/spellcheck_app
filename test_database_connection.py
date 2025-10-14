#!/usr/bin/env python3
"""
Database Connection Test for Step 1.1
This script tests the database connection and adds test data if needed
"""

import sys
import os

# Add the current directory to Python path so we can import from app.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from app import snowflake_query, CONNECTION_PAYLOAD, DATABASE, SCHEMA
    print("✅ Successfully imported database connection from app.py")
except ImportError as e:
    print(f"❌ ERROR: Could not import database connection: {e}")
    print("Make sure you're running this from the app directory")
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

def add_test_case():
    """Add a test case to the database"""
    print("\n➕ Adding Test Case")
    print("=" * 40)
    
    test_case_id = "CASE-2024-001"
    
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
            return True
        
        # Insert test case
        insert_query = f"""
            INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
            (CASE_ID, CREATED_BY_USER, EXISTS_IN_CRM, CASE_STATUS, CREATION_TIME, LAST_SYNC_TIME)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """
        snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                       (test_case_id, 0, False, 'open'), 
                       return_df=False)
        
        print(f"✅ Test case {test_case_id} added successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error adding test case: {e}")
        return False

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
        print("Adding a test case...")
        if add_test_case():
            print("✅ Test case added successfully")
        else:
            print("❌ Failed to add test case")
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
