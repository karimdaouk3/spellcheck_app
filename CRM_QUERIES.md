# CRM Case Queries Documentation

## Overview
This document explains the SQL queries used to fetch case data from CRM on initial load and when typing to open a new case.

---

## 1. Initial Load Query

**Endpoint**: `/api/cases/data`  
**Location**: `app.py` lines 908-942

**Purpose**: Fetches all open cases that already exist in the local database for the current user.

**SQL Query**:
```sql
SELECT 
    cs.CASE_ID,
    cs.CASE_STATUS,
    cs.CASE_TITLE,  -- Title from local database
    cs.LAST_ACCESSED_AT,
    lis_problem.INPUT_FIELD_VALUE as PROBLEM_STATEMENT,
    lis_fsr.INPUT_FIELD_VALUE as FSR_NOTES
FROM CASE_SESSIONS cs
LEFT JOIN latest_input_state lis_problem ON ...
LEFT JOIN latest_input_state lis_fsr ON ...
WHERE cs.CREATED_BY_USER = %s AND cs.CASE_STATUS = 'open'
```

**What it does**: 
- Queries the local `CASE_SESSIONS` table
- Includes `CASE_TITLE` from the local database
- Returns cases the user has already opened

---

## 2. Case Number Suggestions Query

**Function**: `get_available_case_numbers()`  
**Location**: `app.py` lines 1360-1364  
**Used by**: `/api/cases/suggestions` and `/api/cases/suggestions/preload`

**Purpose**: Fetches available case numbers from CRM to show in the suggestions dropdown when typing.

**SQL Query**:
```sql
SELECT DISTINCT "Case Number" as CASE_NUMBER
FROM IT_SF_SHARE_REPLICA.RSRV.CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T
WHERE "Case Number" IS NOT NULL
AND "USER_EMAILS" LIKE %s
```

**What it does**:
- Queries the CRM `ROW_LEVEL_SECURITY` table
- **Only selects case numbers** - no title field
- Filters by user email for security
- Returns list of case numbers the user can access

---

## 3. Case Title Fetching Query

**Function**: `get_case_titles_batch()`  
**Location**: `app.py` lines 1620-1631  
**Used by**: `/api/cases/titles` (POST endpoint)

**Purpose**: Fetches case titles for multiple case numbers to display in suggestions.

**SQL Query**:
```sql
SELECT DISTINCT
    "Case Number",
    "Case Title",
    ROW_NUMBER() OVER (
        PARTITION BY "Case Number" 
        ORDER BY "FSR Number" DESC, "FSR Creation Date" DESC
    ) as rn
FROM GEAR.INSIGHTS.CRMSV_INTERFACE_SAGE_FSR_DETAIL
WHERE "Case Number" IN ('...')
QUALIFY rn = 1
```

**What it does**:
- Queries a **different CRM table** (`FSR_DETAIL`) than the case number query
- Gets the latest FSR record for each case (ordered by FSR Number and Creation Date)
- Returns case number → title mapping
- **Issue**: If a case has no FSR records or the FSR record has no title, the title will be empty

---

## Why Some Cases Don't Show Titles

The case number query uses `CRMSV_INTERFACE_SAGE_ROW_LEVEL_SECURITY_T`, while the title query uses `CRMSV_INTERFACE_SAGE_FSR_DETAIL`. These tables may not be in sync:

- A case can exist in `ROW_LEVEL_SECURITY_T` (appears in suggestions)
- But have no matching records in `FSR_DETAIL` (no title available)
- Or the FSR records may have NULL/empty `"Case Title"` values

This is why some suggested cases don't have titles even though they exist in CRM.


