# Connection Payload Usage Summary

## Overview
This document explains which connection payload is used for different types of queries in the application.

---

## Connection Payloads

1. **CONNECTION_PAYLOAD** (Engineering_SAGE_SVC)
   - Source: `config.yaml` → `Engineering_SAGE_SVC` (or from utils if available)
   - Used for: Local database queries and IT_SF_SHARE_REPLICA CRM queries

2. **PROD_PAYLOAD** (Production_SAGE_SVC)
   - Source: `config.yaml` → `Production_SAGE_SVC`
   - Used for: GEAR.INSIGHTS CRM queries only

---

## Query Type Breakdown

### ✅ Local Database Queries (Use CONNECTION_PAYLOAD)

All queries to local application tables use `CONNECTION_PAYLOAD`:
- `SAGE.TEXTIO_SERVICES_INPUTS.*` (production) or `SAGE.DEV_TEXTIO_SERVICES_INPUTS.*` (dev)
- Tables: `CASE_SESSIONS`, `USER_INFORMATION`, `LAST_INPUT_STATE`, `KLA_GLOSSARY`, etc.
- **These queries automatically switch between dev/prod schemas based on `DEV_MODE`**

**Examples:**
- `/api/cases/data` - Get user cases
- `/api/cases/user-cases` - Get user case list
- `/api/cases/validate/<case_number>` - Validate case
- User authentication queries
- All application data storage/retrieval

---

### ✅ IT_SF_SHARE_REPLICA CRM Queries (Use CONNECTION_PAYLOAD)

Queries to `IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T` use `CONNECTION_PAYLOAD`:

**Functions:**
- `get_available_case_numbers()` - Get case number suggestions
- `check_external_crm_exists()` - Check if case exists in CRM
- Validation queries in `get_case_titles_batch()` and `get_case_details()`

**Note:** These use `CONNECTION_PAYLOAD` (Engineering_SAGE_SVC), not `PROD_PAYLOAD`

---

### ✅ GEAR.INSIGHTS CRM Queries (Use PROD_PAYLOAD)

Queries to `GEAR.INSIGHTS.*` tables use `PROD_PAYLOAD`:

**Tables:**
- `GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_CASE_SUMMARY` - Case status checks
- `GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_FSR_DETAIL` - Case titles and details

**Functions:**
- `check_external_crm_status_batch()` - Check if cases are open/closed
- `get_case_details()` - Get detailed case information
- `get_case_titles_batch()` - Get case titles for suggestions

**All GEAR queries use `PROD_PAYLOAD` (Production_SAGE_SVC)**

---

## Summary

| Query Type | Connection Payload | Database/Schema |
|------------|-------------------|-----------------|
| Local app tables | `CONNECTION_PAYLOAD` | `SAGE.TEXTIO_SERVICES_INPUTS` (or `SAGE.DEV_TEXTIO_SERVICES_INPUTS` if DEV_MODE) |
| IT_SF_SHARE_REPLICA | `CONNECTION_PAYLOAD` | `IT_SF_SHARE_REPLICA.RSRV.*` |
| GEAR.INSIGHTS | `PROD_PAYLOAD` | `GEAR.INSIGHTS.*` |

---

## Current Implementation Status

✅ **Correctly Implemented:**
- Local database queries use `CONNECTION_PAYLOAD` and switch schemas based on `DEV_MODE`
- GEAR.INSIGHTS queries use `PROD_PAYLOAD`

⚠️ **Note:**
- IT_SF_SHARE_REPLICA queries currently use `CONNECTION_PAYLOAD` (Engineering_SAGE_SVC)
- If these should use `PROD_PAYLOAD` instead, that would need to be changed

