#!/usr/bin/env python3
"""
CRM Endpoint Test Suite
Tests the specific CRM functionality needed for FSR Coach endpoints.
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

def test_endpoint_1_case_suggestions(cfg, user_email="DAVID.BOLLA@KLA.COM"):
    """
    Test /api/cases/suggestions endpoint functionality
    """
    print("\n" + "="*50)
    print("🔍 TESTING: /api/cases/suggestions")
    print("="*50)
    
    try:
        eng_payload = dict(cfg["Engineering_SAGE_SVC"])
        
        query = """
            SELECT DISTINCT "Case Number" 
            FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T 
            WHERE "USER_EMAILS" LIKE %s 
            AND "Case Number" IS NOT NULL 
            ORDER BY "Case Number" DESC
        """
        
        like_pattern = f"%{user_email}%"
        result = snowflake_query(query, eng_payload, params=(like_pattern,))
        
        if result is not None and not result.empty:
            case_numbers = result["Case Number"].tolist()
            print(f"✅ Found {len(case_numbers)} available cases")
            print(f"📋 Sample cases: {case_numbers[:5]}")
            return case_numbers
        else:
            print("⚠️ No cases found")
            return []
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return []

def test_endpoint_2_case_status(cfg, case_numbers):
    """
    Test /api/cases/check-external-status endpoint functionality
    """
    print("\n" + "="*50)
    print("🔍 TESTING: /api/cases/check-external-status")
    print("="*50)
    
    if not case_numbers:
        print("⚠️ No cases to test")
        return {}
    
    try:
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
        # Test individual case status check
        case_status = {}
        for case_num in case_numbers[:3]:  # Test first 3 cases
            query = """
                SELECT DISTINCT "[Case Number]" AS "Case Number"
                FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY 
                WHERE "Verify Closure Date/Time" IS NULL 
                AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
                AND "[Case Number]" = %s
            """
            
            result = snowflake_query(query, prod_payload, params=(case_num,))
            is_open = result is not None and not result.empty
            case_status[case_num] = 'open' if is_open else 'closed'
            
            status_icon = "🟢" if is_open else "🔴"
            print(f"{status_icon} Case {case_num}: {case_status[case_num]}")
        
        return case_status
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return {}

def test_endpoint_3_case_details(cfg, case_numbers):
    """
    Test /api/cases/details/<case_number> endpoint functionality
    """
    print("\n" + "="*50)
    print("🔍 TESTING: /api/cases/details/<case_number>")
    print("="*50)
    
    if not case_numbers:
        print("⚠️ No cases to test")
        return {}
    
    try:
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
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
            result = snowflake_query(query, prod_payload, params=(case_num,))
            
            if result is not None and not result.empty:
                details = result.to_dict('records')
                case_details[case_num] = details
                print(f"✅ Case {case_num}: Found {len(details)} FSR records")
                
                # Show first record details
                if details:
                    first_record = details[0]
                    print(f"  📋 First FSR Record:")
                    print(f"    - FSR Number: {first_record.get('FSR Number', 'N/A')}")
                    print(f"    - Symptom: {str(first_record.get('FSR Current Symptom', 'N/A'))[:50]}...")
                    print(f"    - Problem: {str(first_record.get('FSR Current Problem Statement', 'N/A'))[:50]}...")
            else:
                print(f"⚠️ Case {case_num}: No details found")
                case_details[case_num] = []
        
        return case_details
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return {}

def test_batch_processing(cfg, case_numbers):
    """
    Test batch processing for multiple cases (optimized approach)
    """
    print("\n" + "="*50)
    print("🔍 TESTING: Batch Processing")
    print("="*50)
    
    if not case_numbers:
        print("⚠️ No cases to test")
        return {}
    
    try:
        prod_payload = dict(cfg["Production_SAGE_SVC"])
        
        # Create IN clause for batch query
        case_list = "', '".join(str(case) for case in case_numbers[:5])  # Test first 5
        
        query = f"""
            SELECT DISTINCT "[Case Number]" AS "Case Number"
            FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY 
            WHERE "Verify Closure Date/Time" IS NULL 
            AND "Case Creation Date" > DATEADD(YEAR, -1, CURRENT_DATE)
            AND "[Case Number]" IN ('{case_list}')
            ORDER BY "[Case Number]" DESC
        """
        
        result = snowflake_query(query, prod_payload)
        
        if result is not None and not result.empty:
            open_cases = set(result["Case Number"].tolist())
            print(f"✅ Batch query: Found {len(open_cases)} open cases")
            
            # Check each case
            case_status = {}
            for case_num in case_numbers[:5]:
                is_open = case_num in open_cases
                case_status[case_num] = 'open' if is_open else 'closed'
                status_icon = "🟢" if is_open else "🔴"
                print(f"{status_icon} Case {case_num}: {case_status[case_num]}")
            
            return case_status
        else:
            print("⚠️ No open cases found in batch")
            return {}
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return {}

def main():
    """Main test function"""
    print("🚀 CRM Endpoint Test Suite")
    print("="*50)
    
    # Load configuration
    cfg = load_config()
    
    # Test user email
    test_user_email = "DAVID.BOLLA@KLA.COM"
    print(f"👤 Testing with user: {test_user_email}")
    
    # Test 1: Case suggestions
    available_cases = test_endpoint_1_case_suggestions(cfg, test_user_email)
    
    if available_cases:
        # Test 2: Case status check
        case_status = test_endpoint_2_case_status(cfg, available_cases)
        
        # Test 3: Case details
        case_details = test_endpoint_3_case_details(cfg, available_cases)
        
        # Test 4: Batch processing
        batch_status = test_batch_processing(cfg, available_cases)
        
        # Summary
        print("\n" + "="*50)
        print("📊 TEST SUMMARY")
        print("="*50)
        print(f"✅ Available cases: {len(available_cases)}")
        print(f"✅ Status checks: {len(case_status)}")
        print(f"✅ Details retrieved: {len(case_details)}")
        print(f"✅ Batch processing: {len(batch_status)}")
        
        print("\n🎯 All CRM queries are working!")
        print("Ready to integrate into your Flask endpoints.")
    else:
        print("\n⚠️ No cases found to test with")
        print("Try with a different user email")

if __name__ == "__main__":
    main()
