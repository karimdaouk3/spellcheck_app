"""
Mock Snowflake connection module for testing purposes.
This provides a basic interface that matches the expected snowflake_query function.
"""

import pandas as pd
from datetime import datetime

def snowflake_query(query, connection_payload, params=None, return_df=True):
    """
    Mock snowflake_query function for testing.
    
    Args:
        query (str): SQL query string
        connection_payload (dict): Connection configuration
        params (tuple): Query parameters
        return_df (bool): Whether to return a DataFrame
    
    Returns:
        pandas.DataFrame or None: Query results
    """
    print(f"🔍 Mock Query: {query}")
    print(f"📊 Params: {params}")
    print(f"🔧 Connection: {connection_payload}")
    
    # Mock successful connection
    if "Testing Database Connection" in str(query) or "SELECT 1" in query:
        return pd.DataFrame([{"1": 1}])
    
    # Mock CASE_SESSIONS table check
    if "CASE_SESSIONS" in query and "COUNT" in query:
        return pd.DataFrame([{"EXISTS_COUNT": 0}])
    
    # Mock CASE_SESSIONS table data
    if "CASE_SESSIONS" in query and "SELECT" in query and "COUNT" not in query:
        # Return empty DataFrame to simulate no data
        return pd.DataFrame()
    
    # Mock successful insert
    if "INSERT INTO" in query:
        print("✅ Mock insert successful")
        return None
    
    # Default: return empty DataFrame
    return pd.DataFrame()

def test_connection():
    """Test the mock connection"""
    print("🧪 Testing mock Snowflake connection...")
    result = snowflake_query("SELECT 1", {}, return_df=True)
    if result is not None:
        print("✅ Mock connection successful!")
        return True
    else:
        print("❌ Mock connection failed!")
        return False

if __name__ == "__main__":
    test_connection()
