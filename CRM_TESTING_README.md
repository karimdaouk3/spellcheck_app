# CRM Query Testing Suite

This directory contains comprehensive tests for all CRM database queries needed for the FSR Coach application endpoints.

## Files Created

### Test Files
- **`test_crm_queries.py`** - Comprehensive CRM query tests with detailed debugging
- **`test_crm_endpoints.py`** - Endpoint-specific CRM functionality tests
- **`run_crm_tests.py`** - Test runner script to execute all tests

### Integration Files
- **`crm_integration_guide.py`** - Ready-to-use CRM query functions for Flask endpoints

## Quick Start

### 1. Run All Tests
```bash
python run_crm_tests.py
```

### 2. Run Individual Tests
```bash
# Comprehensive tests
python test_crm_queries.py

# Endpoint-specific tests  
python test_crm_endpoints.py
```

## CRM Queries Tested

### Query 1: Available Case Numbers
- **Purpose**: Get case numbers available to a user for suggestions
- **Database**: `IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T`
- **Endpoint**: `/api/cases/suggestions`
- **Function**: `get_available_case_numbers(user_email)`

### Query 2: Case Status Check
- **Purpose**: Check if cases are open (not closed) in CRM
- **Database**: `GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY`
- **Endpoint**: `/api/cases/check-external-status`
- **Function**: `check_case_status(case_number)` or `check_case_status_batch(case_numbers)`

### Query 3: Case Details
- **Purpose**: Get detailed case information (FSR details, symptoms, etc.)
- **Database**: `GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_FSR_DETAIL`
- **Endpoint**: `/api/cases/details/<case_number>`
- **Function**: `get_case_details(case_number)`

## Prerequisites

1. **`config.yaml`** - Must contain your Snowflake credentials
2. **`snowflakeconnection.py`** - Must be in the same directory
3. **Database Access** - Must have access to both `IT_SF_SHARE_REPLICA` and `GEAR` databases

## Configuration

The tests use the same configuration structure as your existing setup:

```yaml
# config.yaml
Engineering_SAGE_SVC:
  account: "your_account"
  user: "your_user"
  password: "your_password"
  # ... other connection details

Production_SAGE_SVC:
  account: "your_account"
  user: "your_user"
  password: "your_password"
  # ... other connection details
```

## Test Output

The tests provide detailed output including:
- ✅ Success/failure status for each query
- 📊 Number of records found
- 🔍 Sample data from queries
- ⚠️ Error messages if queries fail
- 📋 Summary of all test results

## Integration into Flask App

After testing, copy the functions from `crm_integration_guide.py` into your `app.py`:

```python
# Add these functions to app.py
def get_available_case_numbers(user_email):
    # ... (from crm_integration_guide.py)

def check_case_status_batch(case_numbers):
    # ... (from crm_integration_guide.py)

def get_case_details(case_number):
    # ... (from crm_integration_guide.py)
```

Then use the Flask endpoint examples provided in the integration guide.

## Troubleshooting

### Common Issues
1. **Import Error**: Make sure `snowflakeconnection.py` is in the same directory
2. **Config Error**: Verify `config.yaml` exists and has correct credentials
3. **Database Access**: Ensure you have permissions for both databases
4. **No Data**: Try with a different user email that has cases in the CRM

### Debug Mode
All test files include extensive debugging output. Look for:
- `✅` - Successful operations
- `❌` - Errors or failures
- `⚠️` - Warnings or no data found
- `🔍` - Debug information

## Next Steps

1. **Run the tests** to verify all CRM queries work
2. **Check the output** for any errors or issues
3. **Copy the functions** from `crm_integration_guide.py` to your Flask app
4. **Implement the endpoints** using the provided examples
5. **Test the endpoints** in your Flask application

## Support

If you encounter issues:
1. Check the test output for specific error messages
2. Verify your database credentials and permissions
3. Ensure all required files are present
4. Try with different test data (user emails, case numbers)
