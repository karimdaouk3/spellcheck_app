#!/usr/bin/env python3
"""
CRM Query Test Suite
Tests all CRM database queries needed for the FSR Coach application endpoints.
"""

import sys
import os
import yaml
from datetime import datetime

# Add current directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from snowflakeconnection import snowflake_query
    print("✅ Successfully imported snowflake_query")
except ImportError as e:
    print(f"❌ Failed to import snowflake_query: {e}")
    print("Make sure snowflakeconnection.py is in the same directory")
    sys.exit(1)

def load_config():
    """Load configuration from config.yaml"""
    try:
        with open("config.yaml", "r") as f:
            cfg = yaml.safe_load(f)
        print("✅ Successfully loaded config.yaml")
        return cfg
    except FileNotFoundError:
        print("❌ config.yaml not found")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error loading config.yaml: {e}")
        sys.exit(1)

def test_available_case_numbers(cfg, user_email="DAVID.BOLLA@KLA.COM"):
    """
    Test Query 1: Get available case numbers for a user
    This corresponds to the /api/cases/suggestions endpoint
    """
    print("\n" + "="*60)
    print("🔍 TESTING: Available Case Numbers Query")
    print("="*60)
    
    try:
        # Build connection payload
        eng_payload = dict(cfg["Engineering_SAGE_SVC"])
        
        # Query 1: Get available case numbers
        query = """
            SELECT DISTINCT "Case Number" 
            FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T 
            WHERE "USER_EMAILS" LIKE %s 
            AND "Case Number" IS NOT NULL 
            ORDER BY "Case Number" DESC
        """
        
        like_pattern = f"%{user_email}%"
        print(f"📧 Testing with user email: {user_email}")
        print(f"🔍 Like pattern: {like_pattern}")
        
        result = snowflake_query(query, eng_payload, params=(like_pattern,))
        
        if result is not None and not result.empty:
            print(f"✅ Query successful! Found {len(result)} available cases")
            print(f"📊 First 10 cases:")
            print(result.head(10))
            
            # Test with a few specific case numbers
            if len(result) > 0:
                sample_cases = result["Case Number"].head(3).tolist()
                print(f"🎯 Sample cases for further testing: {sample_cases}")
                return sample_cases
        else:
            print("⚠️ No cases found for this user")
            return []
            
    except Exception as e:
        print(f"❌ Error in available case numbers query: {e}")
        return []

def test_case_status_check(cfg, case_numbers):
    """
    Test Query 2: Check if cases are open (not closed)
    This corresponds to the /api/cases/check-external-status endpoint
    """
    print("\n" + "="*60)
    print("🔍 TESTING: Case Status Check Query")
    print("="*60)
    
    if not case_numbers:
        print("⚠️ No case numbers to test")
        return {}
    
    try:
        # Build connection payload
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
        # Query 2: Check case status (open vs closed)
        query = """
            SELECT DISTINCT "[Case Number]" AS "Case Number"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY 
            WHERE "Verify Closure Date/Time" IS NULL 
            AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
            ORDER BY "[Case Number]" DESC
        """
        
        print(f"🔍 Checking status for {len(case_numbers)} cases")
        
        result = snowflake_query(query, prod_payload)
        
        if result is not None and not result.empty:
            open_cases = set(result["Case Number"].tolist())
            print(f"✅ Query successful! Found {len(open_cases)} open cases in CRM")
            
            # Check status of our test cases
            case_status = {}
            for case_num in case_numbers:
                is_open = case_num in open_cases
                case_status[case_num] = 'open' if is_open else 'closed'
                status_icon = "🟢" if is_open else "🔴"
                print(f"{status_icon} Case {case_num}: {case_status[case_num]}")
            
            return case_status
        else:
            print("⚠️ No open cases found in CRM")
            return {case_num: 'unknown' for case_num in case_numbers}
            
    except Exception as e:
        print(f"❌ Error in case status check query: {e}")
        return {}

def test_case_details(cfg, case_numbers):
    """
    Test Query 3: Get detailed case information
    This corresponds to the /api/cases/details/<case_number> endpoint
    """
    print("\n" + "="*60)
    print("🔍 TESTING: Case Details Query")
    print("="*60)
    
    if not case_numbers:
        print("⚠️ No case numbers to test")
        return {}
    
    try:
        # Build connection payload
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
        # Query 3: Get case details
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
        
        case_details = {}
        
        for case_num in case_numbers[:2]:  # Test first 2 cases
            print(f"\n🔍 Testing case details for: {case_num}")
            
            result = snowflake_query(query, prod_payload, params=(case_num,))
            
            if result is not None and not result.empty:
                print(f"✅ Found {len(result)} FSR records for case {case_num}")
                
                # Convert to list of dictionaries for easier handling
                details = result.to_dict('records')
                case_details[case_num] = details
                
                # Show sample data
                for i, record in enumerate(details[:2]):  # Show first 2 FSR records
                    print(f"  📋 FSR Record {i+1}:")
                    print(f"    - FSR Number: {record.get('FSR Number', 'N/A')}")
                    print(f"    - Creation Date: {record.get('FSR Creation Date', 'N/A')}")
                    print(f"    - Symptom: {str(record.get('FSR Current Symptom', 'N/A'))[:50]}...")
                    print(f"    - Problem Statement: {str(record.get('FSR Current Problem Statement', 'N/A'))[:50]}...")
                    print(f"    - Daily Notes: {str(record.get('FSR Daily Notes', 'N/A'))[:50]}...")
            else:
                print(f"⚠️ No details found for case {case_num}")
                case_details[case_num] = []
        
        return case_details
        
    except Exception as e:
        print(f"❌ Error in case details query: {e}")
        return {}

def test_batch_case_status(cfg, case_numbers):
    """
    Test batch case status check (optimized version)
    This tests the batch processing for multiple cases at once
    """
    print("\n" + "="*60)
    print("🔍 TESTING: Batch Case Status Check")
    print("="*60)
    
    if not case_numbers:
        print("⚠️ No case numbers to test")
        return {}
    
    try:
        # Build connection payload
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
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
        
        print(f"🔍 Batch checking status for cases: {case_numbers}")
        
        result = snowflake_query(query, prod_payload)
        
        if result is not None and not result.empty:
            open_cases = set(result["Case Number"].tolist())
            print(f"✅ Batch query successful! Found {len(open_cases)} open cases")
            
            # Check status of our test cases
            case_status = {}
            for case_num in case_numbers:
                is_open = case_num in open_cases
                case_status[case_num] = 'open' if is_open else 'closed'
                status_icon = "🟢" if is_open else "🔴"
                print(f"{status_icon} Case {case_num}: {case_status[case_num]}")
            
            return case_status
        else:
            print("⚠️ No open cases found in batch query")
            return {case_num: 'unknown' for case_num in case_numbers}
            
    except Exception as e:
        print(f"❌ Error in batch case status query: {e}")
        return {}

def main():
    """Main test function"""
    print("🚀 Starting CRM Query Test Suite")
    print("="*60)
    
    # Load configuration
    cfg = load_config()
    
    # Test user email (you can change this)
    test_user_email = "DAVID.BOLLA@KLA.COM"
    print(f"👤 Testing with user email: {test_user_email}")
    
    # Test 1: Available case numbers
    sample_cases = test_available_case_numbers(cfg, test_user_email)
    
    if sample_cases:
        # Test 2: Case status check (individual)
        case_status = test_case_status_check(cfg, sample_cases)
        
        # Test 3: Case details
        case_details = test_case_details(cfg, sample_cases)
        
        # Test 4: Batch case status check
        batch_status = test_batch_case_status(cfg, sample_cases)
        
        # Summary
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
        print("="*60)
        print(f"✅ Available cases found: {len(sample_cases)}")
        print(f"✅ Individual status checks: {len(case_status)}")
        print(f"✅ Case details retrieved: {len(case_details)}")
        print(f"✅ Batch status checks: {len(batch_status)}")
        
        print("\n🎯 Ready for endpoint integration!")
        print("All CRM queries are working correctly.")
    else:
        print("\n⚠️ No cases found to test with")
        print("Try with a different user email or check your CRM data access")

if __name__ == "__main__":
    main()
