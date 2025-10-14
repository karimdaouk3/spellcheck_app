# Complete Database Implementation Guide

## Overview
This document describes the complete workflow and all missing database implementations needed for the FSR Coach application to work correctly in production. Currently, the application uses mock data and in-memory storage that needs to be replaced with proper database implementations.

---

## Current Application Workflow

### 1. User Authentication Flow
```
User Login → SSO Authentication → Database User Check/Insert → Session Creation → 
Frontend Initialization → Case Management Setup → External CRM Sync → App Ready
```

### 2. Case Management Workflow
```
Case Creation → Database Validation → Case Session Tracking → 
External CRM Sync → Status Monitoring → Feedback Collection → Case Closure
```

### 3. LLM Evaluation Workflow
```
Text Submission → Criteria Loading → LLM Processing → 
Database Logging → Score Calculation → Feedback Collection
```

---

## Current Database Tables (Already Implemented)

### 1. USER_INFORMATION
```sql
CREATE TABLE USER_INFORMATION (
    ID INTEGER PRIMARY KEY,
    FIRST_NAME VARCHAR(255),
    LAST_NAME VARCHAR(255),
    EMAIL VARCHAR(255),
    EMPLOYEEID VARCHAR(255) UNIQUE
);
```
**Status**: ✅ **IMPLEMENTED** - Used for user authentication and session management

### 2. CRITERIA
```sql
CREATE TABLE CRITERIA (
    ID INTEGER PRIMARY KEY,
    CRITERIA VARCHAR(255),
    WEIGHT DECIMAL(5,2),
    CRITERIA_DESCRIPTION TEXT
);
```
**Status**: ✅ **IMPLEMENTED** - Used for LLM evaluation criteria

### 3. CRITERIA_GROUPS
```sql
CREATE TABLE CRITERIA_GROUPS (
    CRITERIA_ID INTEGER,
    INPUT_FIELD_TYPE VARCHAR(50),
    "GROUP" VARCHAR(50),
    GROUP_VERSION INTEGER,
    CRITERIA_VERSION INTEGER,
    DATE_ADDED TIMESTAMP
);
```
**Status**: ✅ **IMPLEMENTED** - Used for grouping criteria by input type

### 4. USER_SESSION_INPUTS
```sql
CREATE TABLE USER_SESSION_INPUTS (
    ID INTEGER PRIMARY KEY,
    USER_ID INTEGER,
    APP_SESSION_ID VARCHAR(255),
    CASE_ID VARCHAR(255),
    LINE_ITEM_ID VARCHAR(255),
    INPUT_FIELD_TYPE VARCHAR(50),
    INPUT_TEXT TEXT,
    TIMESTAMP TIMESTAMP_NTZ
);
```
**Status**: ✅ **IMPLEMENTED** - Used for logging user inputs

### 5. EVALUATION_FEEDBACK
```sql
CREATE TABLE EVALUATION_FEEDBACK (
    ID INTEGER PRIMARY KEY,
    REWRITE_ID INTEGER,
    USER_INPUT_ID INTEGER,
    FEEDBACK TEXT,
    TIMESTAMP TIMESTAMP_NTZ,
    EXPLANATION TEXT,
    PASSED BOOLEAN
);
```
**Status**: ✅ **IMPLEMENTED** - Used for storing user feedback on evaluations

### 6. OVERALL_FEEDBACK
```sql
CREATE TABLE OVERALL_FEEDBACK (
    USER_ID INTEGER,
    EXPERIENCE_RATING INTEGER,
    HELPFULNESS_RATING INTEGER,
    FUTURE_INTEREST VARCHAR(50),
    FEEDBACK_TEXT TEXT,
    TIMESTAMP TIMESTAMP_NTZ
);
```
**Status**: ✅ **IMPLEMENTED** - Used for overall application feedback

---

## Missing Database Implementations

### 1. CASE_SESSIONS Table (NEW - CRITICAL)
```sql
CREATE TABLE case_sessions (
    id INTEGER AUTOINCREMENT PRIMARY KEY,
    case_id VARCHAR(100) NOT NULL,                    -- Case number
    creation_time TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    created_by_user INTEGER NOT NULL,                 -- FK to USER_INFORMATION.ID
    exists_in_crm BOOLEAN DEFAULT FALSE,              -- Whether case exists in external CRM
    case_status VARCHAR(20) DEFAULT 'open',           -- 'open' or 'closed'
    last_sync_time TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,                                       -- Additional notes
    
    -- Foreign Keys
    FOREIGN KEY (created_by_user) REFERENCES USER_INFORMATION(ID),
    FOREIGN KEY (case_id) REFERENCES CASE_SESSIONS(case_id),
    
    -- Constraints
    UNIQUE(case_id, created_by_user),
    
    -- Indexes
    INDEX idx_case_id (case_id),
    INDEX idx_created_by_user (created_by_user),
    INDEX idx_case_status (case_status),
    INDEX idx_creation_time (creation_time)
);
```
**Purpose**: Unified table for case tracking, CRM sync, and case status (replaces `cases` + `user_cases` tables)
**Status**: ❌ **NOT IMPLEMENTED** - Critical for case management

### 2. LAST_INPUT_STATE Table (NEW - CRITICAL)
```sql
CREATE TABLE last_input_state (
    id INTEGER AUTOINCREMENT PRIMARY KEY,
    case_session_id INTEGER NOT NULL,                 -- FK to case_sessions.id
    input_field_id VARCHAR(50) NOT NULL,               -- 'problem_statement' or 'fsr'
    input_field_value TEXT NOT NULL,                  -- The actual text content
    line_item_id INTEGER NULL,                        -- Number if FSR line item, NULL if problem statement
    input_field_eval_uuid VARCHAR(255) NULL,          -- FK to LLM_EVALUATION.REWRITE_UUID
    last_updated TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (case_session_id) REFERENCES case_sessions(id),
    FOREIGN KEY (input_field_eval_uuid) REFERENCES LLM_EVALUATION(REWRITE_UUID),
    
    -- Constraints
    UNIQUE(case_session_id, input_field_id, line_item_id, input_field_eval_uuid),
    
    -- Indexes
    INDEX idx_case_session (case_session_id),
    INDEX idx_input_field (input_field_id),
    INDEX idx_eval_uuid (input_field_eval_uuid),
    INDEX idx_last_updated (last_updated)
);
```
**Purpose**: Track current input state for each case session and field (problem statement, FSR line items)
**Status**: ❌ **NOT IMPLEMENTED** - Critical for input state tracking

### 3. CASE_REVIEW Table (NEW - CRITICAL)
```sql
CREATE TABLE case_feedback (
    id INTEGER AUTOINCREMENT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    case_number VARCHAR(100) NOT NULL,
    closed_date TIMESTAMP_NTZ NOT NULL,
    symptom TEXT NOT NULL,
    fault TEXT NOT NULL,
    fix TEXT NOT NULL,
    submitted_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (user_id) REFERENCES USER_INFORMATION(ID),
    FOREIGN KEY (case_number) REFERENCES CASE_SESSIONS(case_id),
    
    -- Indexes
    INDEX idx_user_id (user_id),
    INDEX idx_case_number (case_number),
    INDEX idx_submitted_at (submitted_at)
);
```
**Purpose**: Store feedback for closed cases
**Status**: ❌ **NOT IMPLEMENTED** - Critical for feedback collection

---

## Database Tables to Create - Complete Specification

**IMPORTANT**: Only these 3 tables need to be created. No other database changes are required.

### 1. CASE_SESSIONS Table
**Purpose**: Unified table for case tracking, CRM sync, and case status management

```sql
CREATE TABLE CASE_SESSIONS (
    ID NUMBER AUTOINCREMENT PRIMARY KEY,
    CASE_ID NUMBER NOT NULL,
    CREATION_TIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    CREATED_BY_USER NUMBER NOT NULL,
    CASE_STATUS VARCHAR(20) DEFAULT 'open',
    CRM_LAST_SYNC_TIME TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (CREATED_BY_USER) REFERENCES USER_INFORMATION(ID),
    FOREIGN KEY (CASE_ID) REFERENCES CASE_SESSIONS(CASE_ID),
    
    -- Constraints
    UNIQUE(CASE_ID, CREATED_BY_USER),
    
    -- Indexes
    INDEX IDX_CASE_ID (CASE_ID),
    INDEX IDX_CREATED_BY_USER (CREATED_BY_USER),
    INDEX IDX_CASE_STATUS (CASE_STATUS),
    INDEX IDX_CREATION_TIME (CREATION_TIME)
);
```

**Column Explanations**:
- `ID` - Primary key, auto-incrementing number
- `CASE_ID` - Self-referencing foreign key to CASE_SESSIONS.CASE_ID
- `CREATION_TIME` - When this case session was created, defaults to current timestamp
- `CREATED_BY_USER` - Foreign key to USER_INFORMATION.ID, who created this case session
- `CASE_STATUS` - Status of the case: 'open' or 'closed'
- `CRM_LAST_SYNC_TIME` - When case status was last synchronized with external CRM (for tracking when we last checked if case is still open in external system)

**Foreign Keys**:
- `CREATED_BY_USER` → `USER_INFORMATION(ID)` - Links to user who created the case
- `CASE_ID` → `CASE_SESSIONS(CASE_ID)` - Self-referencing foreign key

**Unique Constraint**:
- `(CASE_ID, CREATED_BY_USER)` - Ensures one case session per case per user

**Database Environment**: Follows established convention for PROD/DEV database targeting

---

### 2. LAST_INPUT_STATE Table
**Purpose**: Track current input state for each case session and field (problem statement, FSR line items)

```sql
CREATE TABLE LAST_INPUT_STATE (
    ID NUMBER AUTOINCREMENT PRIMARY KEY,
    CASE_SESSION_ID NUMBER NOT NULL,
    INPUT_FIELD_ID NUMBER NOT NULL,
    INPUT_FIELD_VALUE VARCHAR NOT NULL,
    LINE_ITEM_ID NUMBER NULL,
    INPUT_FIELD_EVAL_ID NUMBER NULL,
    LAST_UPDATED TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (CASE_SESSION_ID) REFERENCES CASE_SESSIONS(ID),
    FOREIGN KEY (INPUT_FIELD_EVAL_ID) REFERENCES LLM_EVALUATION(REWRITE_UUID),
    
    -- Constraints
    UNIQUE(CASE_SESSION_ID, INPUT_FIELD_ID, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID),
    
    -- Indexes
    INDEX IDX_CASE_SESSION (CASE_SESSION_ID),
    INDEX IDX_INPUT_FIELD (INPUT_FIELD_ID),
    INDEX IDX_EVAL_ID (INPUT_FIELD_EVAL_ID),
    INDEX IDX_LAST_UPDATED (LAST_UPDATED)
);
```

**Column Explanations**:
- `ID` - Primary key, auto-incrementing number
- `CASE_SESSION_ID` - Foreign key to CASE_SESSIONS.ID, which case session this belongs to
- `INPUT_FIELD_ID` - Type of input field: 'problem_statement' or 'fsr'
- `INPUT_FIELD_VALUE` - The actual text content of the input
- `LINE_ITEM_ID` - For FSR notes: line item number (1, 2, 3...). NULL for problem statement
- `INPUT_FIELD_EVAL_ID` - ID of the last LLM evaluation for this input (links to LLM_EVALUATION.REWRITE_UUID)
- `LAST_UPDATED` - When this input state was last updated

**Foreign Keys**:
- `CASE_SESSION_ID` → `CASE_SESSIONS(ID)` - Links to the case session
- `INPUT_FIELD_EVAL_ID` → `LLM_EVALUATION(REWRITE_UUID)` - Links to the LLM evaluation

**Unique Constraint**:
- `(CASE_SESSION_ID, INPUT_FIELD_ID, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID)` - Ensures one state per case/field/line/evaluation combination

**Usage Examples**:
- Problem statement: `(CASE_SESSION_ID=1, INPUT_FIELD_ID='problem_statement', LINE_ITEM_ID=NULL)`
- FSR line 1: `(CASE_SESSION_ID=1, INPUT_FIELD_ID='fsr', LINE_ITEM_ID=1)`
- FSR line 2: `(CASE_SESSION_ID=1, INPUT_FIELD_ID='fsr', LINE_ITEM_ID=2)`

**Important**: This table is populated when user submits for review (including rewrites), NOT automatically

---

### 3. CASE_REVIEW Table
**Purpose**: Store feedback for closed cases (symptom, fault, fix)

```sql
CREATE TABLE CASE_REVIEW (
    ID NUMBER AUTOINCREMENT PRIMARY KEY,
    CASE_ID NUMBER NOT NULL,
    USER_ID NUMBER NOT NULL,
    CLOSED_DATE TIMESTAMP_NTZ NOT NULL,
    SYMPTOM VARCHAR NOT NULL,
    FAULT VARCHAR NOT NULL,
    FIX VARCHAR NOT NULL,
    SUBMITTED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (USER_ID) REFERENCES USER_INFORMATION(ID),
    FOREIGN KEY (CASE_ID) REFERENCES CASE_SESSIONS(CASE_ID),
    
    -- Indexes
    INDEX IDX_USER_ID (USER_ID),
    INDEX IDX_CASE_ID (CASE_ID),
    INDEX IDX_SUBMITTED_AT (SUBMITTED_AT)
);
```

**Column Explanations**:
- `ID` - Primary key, auto-incrementing number
- `CASE_ID` - Foreign key to CASE_SESSIONS.CASE_ID, which case this feedback is for
- `USER_ID` - Foreign key to USER_INFORMATION.ID, who submitted the feedback
- `CLOSED_DATE` - When the case was closed (from external CRM or system)
- `SYMPTOM` - Description of the symptoms/issues reported
- `FAULT` - Root cause or fault that was identified
- `FIX` - Solution that was implemented to resolve the issue
- `SUBMITTED_AT` - When this feedback was submitted, defaults to current timestamp

**Foreign Keys**:
- `USER_ID` → `USER_INFORMATION(ID)` - Links to user who submitted feedback
- `CASE_ID` → `CASE_SESSIONS(CASE_ID)` - Links to the case session

---

## Important Implementation Notes

### 1. Database Naming Convention
- **All table and column names use UPPERCASE** to match existing database convention
- **Follows established PROD/DEV database targeting** used by other parts of the application
- **Dynamic table naming**: Use `{DATABASE}.{SCHEMA}.TABLE_NAME` format in all queries
- **Environment handling**: 
  - **PROD**: `SAGE.TEXTIO_SERVICES_INPUTS.TABLE_NAME`
  - **DEV**: `SAGE.DEV_TEXTIO_SERVICES_INPUTS.TABLE_NAME`

### 2. Case Session Caching Strategy
- **Initial Load**: Case sessions are loaded when user opens the site (on page load)
- **Caching**: Case sessions are cached in frontend memory/localStorage
- **No Database Calls**: When switching between cases on frontend, use cached data
- **Refresh Strategy**: Only reload from database when:
  - User refreshes the page
  - New case is created
  - Case status changes (open → closed)

### 3. Input State Timing
- **NOT Automatic**: `LAST_INPUT_STATE` is NOT populated automatically
- **Trigger Events**: Only populated when user submits for review (including rewrites)
- **No Auto-Save**: Remove auto-save functionality that was previously planned
- **Manual Save**: Only save input state when user explicitly submits for LLM review

### 4. Updated Access Patterns

#### **Case Session Loading (Cached)**
```javascript
// Frontend: Load once on page load, then cache
async loadCases() {
    // Only call database on initial load
    const response = await fetch('/api/cases/data');
    // Cache results in memory/localStorage
    this.cases = response.cases;
}

// Frontend: Use cached data for switching
switchToCase(caseNumber) {
    // Use cached data, no database call
    const caseData = this.cases.find(c => c.caseNumber === caseNumber);
    this.populateEditors(caseData);
}
```

#### **Input State Saving (Manual Only)**
```javascript
// Frontend: Only save when submitting for review
async submitToLLM(text, answers = null, field = this.activeField) {
    // ... LLM processing ...
    
    // Save input state to database after successful LLM submission
    await this.saveInputStateToDatabase(field, text, llmResult);
}
```

---

## Mock Endpoints That Need Database Implementation

### 1. Case Validation Endpoints
**Current Mock**: `MOCK_VALID_CASES`, `MOCK_CLOSED_CASES`
**Database Implementation Needed**:
```python
@app.route('/api/cases/validate/<case_number>', methods=['GET'])
def validate_case_number(case_number):
    # TODO: Replace with actual database query
    query = f"""
        SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        WHERE CASE_ID = %s
        LIMIT 1
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (case_number,))
    # Return validation result
```

### 2. User Cases Endpoints
**Current Mock**: `MOCK_USER_CASE_DATA`
**Database Implementation Needed**:
```python
@app.route('/api/cases/user-cases', methods=['GET'])
def get_user_cases():
    # TODO: Replace with actual database query
    user_id = session.get('user_data').get('user_id')
    query = f"""
        SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        WHERE CREATED_BY_USER = %s
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
    # Return user's cases
```

### 3. Case Data Endpoints
**Current Mock**: `MOCK_USER_CASE_DATA`
**Database Implementation Needed**:
```python
@app.route('/api/cases/data', methods=['GET'])
def get_user_case_data():
    # TODO: Replace with actual database query
    user_id = session.get('user_data').get('user_id')
    
    # Get case sessions with problem statements
    query = f"""
        SELECT cs.CASE_ID, cs.CASE_STATUS,
               lis_problem.INPUT_FIELD_VALUE as problem_statement
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS cs
        LEFT JOIN {DATABASE}.{SCHEMA}.LAST_INPUT_STATE lis_problem 
            ON cs.ID = lis_problem.CASE_SESSION_ID 
            AND lis_problem.INPUT_FIELD_ID = 'problem_statement'
        WHERE cs.CREATED_BY_USER = %s AND cs.CASE_STATUS = 'open'
    """
    cases = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
    
    # Get FSR line items for each case
    for case in cases:
        fsr_query = f"""
            SELECT LINE_ITEM_ID, INPUT_FIELD_VALUE, INPUT_FIELD_EVAL_ID, LAST_UPDATED
            FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
            WHERE CASE_SESSION_ID = (
                SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS WHERE CASE_ID = %s AND CREATED_BY_USER = %s
            ) AND INPUT_FIELD_ID = 'fsr'
            ORDER BY LINE_ITEM_ID
        """
        fsr_items = snowflake_query(fsr_query, CONNECTION_PAYLOAD, (case['case_id'], user_id))
        
        # Add FSR data to case
        case['fsr_line_items'] = fsr_items
        case['fsr_notes'] = fsr_items[-1]['input_field_value'] if fsr_items else ''  # Last line item for text box
        case['fsr_count'] = len(fsr_items)
    
    return jsonify({"cases": cases})
```

### 4. Case Status Endpoints
**Current Mock**: `MOCK_CLOSED_CASES`
**Database Implementation Needed**:
```python
@app.route('/api/cases/status', methods=['POST'])
def check_cases_status():
    # TODO: Replace with actual database query
    case_numbers = request.get_json().get('case_numbers', [])
    query = f"""
        SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS
        WHERE CASE_ID IN %s
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (tuple(case_numbers),))
    # Return status for each case
```

### 5. Case Creation Endpoints
**Current Mock**: In-memory storage
**Database Implementation Needed**:
```python
@app.route('/api/cases/create', methods=['POST'])
def create_case():
    # TODO: Replace with actual database insert
    case_number = data.get('case_number')
    user_id = session.get('user_data').get('user_id')
    
    # Check external CRM
    exists_in_crm = check_external_crm_exists(case_number)
    
    # Insert into case_sessions (replaces cases + user_cases)
    insert_query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
        VALUES (%s, %s, 'open', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    """
    snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                   (case_number, user_id), 
                   return_df=False)
```

### 6. Case Feedback Endpoints
**Current Mock**: `MOCK_CASE_REVIEW`
**Database Implementation Needed**:
```python
@app.route('/api/cases/feedback', methods=['POST'])
def submit_case_feedback():
    # TODO: Replace with actual database insert
    query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.CASE_REVIEW 
        (USER_ID, CASE_NUMBER, CLOSED_DATE, SYMPTOM, FAULT, FIX)
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    # Store feedback in database
```

### 7. Input State Management Endpoints (NEW)
**Current Mock**: None (uses localStorage)
**Database Implementation Needed**:
```python
@app.route('/api/cases/input-state', methods=['GET'])
def get_input_state():
    # TODO: Replace localStorage with database query
    query = f"""
        SELECT INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, 
               INPUT_FIELD_EVAL_ID, LAST_UPDATED
        FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
        WHERE CASE_SESSION_ID = %s
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (case_session_id,))
    # Return input state data
```

### 8. Input State Update Endpoints (NEW)
**Current Mock**: None (uses localStorage)
**Database Implementation Needed**:
```python
@app.route('/api/cases/input-state', methods=['PUT'])
def update_input_state():
    # TODO: Replace localStorage with database update
    data = request.get_json()
    case_session_id = data.get('case_session_id')
    input_field_id = data.get('input_field_id')
    input_field_value = data.get('input_field_value')
    line_item_id = data.get('line_item_id')
    input_field_eval_uuid = data.get('input_field_eval_uuid')
    
    # Use Snowflake MERGE syntax for upsert
    merge_query = f"""
        MERGE INTO {DATABASE}.{SCHEMA}.LAST_INPUT_STATE AS target
        USING (
            SELECT %s as CASE_SESSION_ID, %s as INPUT_FIELD_ID, %s as INPUT_FIELD_VALUE, 
                   %s as LINE_ITEM_ID, %s as INPUT_FIELD_EVAL_ID, CURRENT_TIMESTAMP() as LAST_UPDATED
        ) AS source
        ON target.CASE_SESSION_ID = source.CASE_SESSION_ID 
           AND target.INPUT_FIELD_ID = source.INPUT_FIELD_ID 
           AND target.LINE_ITEM_ID = source.LINE_ITEM_ID
        WHEN MATCHED THEN
            UPDATE SET 
                INPUT_FIELD_VALUE = source.INPUT_FIELD_VALUE,
                INPUT_FIELD_EVAL_ID = source.INPUT_FIELD_EVAL_ID,
                LAST_UPDATED = source.LAST_UPDATED
        WHEN NOT MATCHED THEN
            INSERT (CASE_SESSION_ID, INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, INPUT_FIELD_EVAL_ID, LAST_UPDATED)
            VALUES (source.CASE_SESSION_ID, source.INPUT_FIELD_ID, source.INPUT_FIELD_VALUE, 
                    source.LINE_ITEM_ID, source.INPUT_FIELD_EVAL_ID, source.LAST_UPDATED)
    """
    snowflake_query(merge_query, CONNECTION_PAYLOAD, 
                   (case_session_id, input_field_id, input_field_value, line_item_id, input_field_eval_uuid),
                   return_df=False)
```

---

## External CRM Integration (NEW - CRITICAL)

### 1. CRM Status Check Function
```python
def check_external_crm_status(case_id):
    """Check case status in external CRM system"""
    if not case_id:
        return 'unknown'
    
    try:
        # TODO: Implement actual CRM API call
        # response = requests.get(f"https://crm-api.com/cases/{case_id}")
        # return response.json()['status']
        
        # Placeholder implementation
        return 'open'  # or 'closed' based on external check
    except:
        return 'unknown'
```

### 2. CRM Case Validation Function
```python
def check_external_crm_exists(case_number):
    """Check if case exists in external CRM"""
    # TODO: Implement actual CRM validation
    # This would query external CRM system
    return True  # or False based on external check
```

### 3. Case Status Sync Endpoint
```python
@app.route('/api/cases/sync-status', methods=['GET'])
def sync_case_status():
    """Sync case status with external CRM"""
    user_data = session.get('user_data')
    user_id = user_data.get('user_id')
    
    # Get all user's case sessions
    query = f"""
        SELECT cs.ID, cs.CASE_ID, cs.CASE_STATUS
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS cs
        WHERE cs.CREATED_BY_USER = %s AND cs.CASE_STATUS = 'open'
    """
    user_cases = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
    
    closed_cases = []
    for case in user_cases:
        if case['exists_in_crm']:
            external_status = check_external_crm_status(case['case_id'])
            
            if external_status == 'closed':
                # Update case status in database
                update_query = f"""
                    UPDATE {DATABASE}.{SCHEMA}.CASE_SESSIONS 
                    SET CASE_STATUS = 'closed', CRM_LAST_SYNC_TIME = CURRENT_TIMESTAMP()
                    WHERE ID = %s
                """
                snowflake_query(update_query, CONNECTION_PAYLOAD, (case['id'],))
                closed_cases.append(case)
    
    return jsonify({"closed_cases": closed_cases})
```

---

## Implementation Priority

### Phase 1: Critical Database Tables (HIGH PRIORITY)
1. **CASE_SESSIONS** - Case tracking, CRM sync, and case status management
2. **LAST_INPUT_STATE** - Input state tracking (problem statement, FSR line items)
3. **CASE_REVIEW** - Feedback collection for closed cases

### Phase 2: Database Endpoint Implementation (HIGH PRIORITY)
1. Replace all mock endpoints with database queries
2. Implement case validation against database
3. Implement user case data storage and retrieval
4. Implement case status checking and updates

### Phase 3: External CRM Integration (MEDIUM PRIORITY)
1. Implement CRM API integration functions
2. Implement case status synchronization
3. Implement external case validation
4. Implement automated case closure detection

### Phase 4: Advanced Features (LOW PRIORITY)
1. Case history and audit trails
2. Advanced reporting and analytics
3. Bulk case operations
4. Case assignment and ownership

---

## Migration Strategy

### Step 1: Database Schema Creation
```sql
-- Create all missing tables with dynamic naming
CREATE TABLE {DATABASE}.{SCHEMA}.CASE_SESSIONS (...);
CREATE TABLE {DATABASE}.{SCHEMA}.LAST_INPUT_STATE (...);
CREATE TABLE {DATABASE}.{SCHEMA}.CASE_REVIEW (...);
```

### Step 2: Data Migration
```python
# Migrate existing mock data to database
# 1. Insert mock cases into CASE_SESSIONS table
# 2. Migrate user case data to LAST_INPUT_STATE table
# 3. Create CASE_SESSIONS entries for existing cases
```

### Step 3: Endpoint Replacement
```python
# Replace all mock endpoints with database queries
# 1. Update case validation endpoints
# 2. Update user case data endpoints
# 3. Update case status endpoints
# 4. Update case creation endpoints
```

### Step 4: Testing and Validation
```python
# Test all endpoints with database
# 1. Verify case creation works
# 2. Verify case data storage works
# 3. Verify case status checking works
# 4. Verify feedback collection works
```

---

## Current Mock Data to Remove

### 1. Mock Constants (Remove from app.py)
```python
# Remove these lines:
MOCK_VALID_CASES = [...]
MOCK_CLOSED_CASES = [...]
MOCK_USER_CASE_DATA = {...}
MOCK_CASE_REVIEW = {...}
```

### 2. Mock Endpoints (Replace with database queries)
```python
# Replace these endpoints:
@app.route('/api/cases/validate/<case_number>', methods=['GET'])
@app.route('/api/cases/user-cases', methods=['GET'])
@app.route('/api/cases/status', methods=['POST'])
@app.route('/api/cases/data', methods=['GET'])
@app.route('/api/cases/data/<case_number>', methods=['GET'])
@app.route('/api/cases/data/<case_number>', methods=['PUT'])
@app.route('/api/cases/data', methods=['POST'])
@app.route('/api/cases/feedback', methods=['POST'])
```

---

## Summary

The application currently has **6 implemented database tables** and **3 critical missing tables**. The mock endpoints need to be replaced with proper database implementations to make the application production-ready.

**Total Missing Implementations**: 3 database tables + 8 mock endpoints + external CRM integration
**Estimated Implementation Time**: 2-3 weeks for complete database implementation
**Critical Dependencies**: External CRM API access and integration requirements

---

## Complete Implementation Checklist

### ✅ **Already Implemented (6 tables):**
1. ✅ `USER_INFORMATION` - User authentication and session management
2. ✅ `CRITERIA` - LLM evaluation criteria
3. ✅ `CRITERIA_GROUPS` - Criteria grouping by input type
4. ✅ `USER_SESSION_INPUTS` - User input logging
5. ✅ `EVALUATION_FEEDBACK` - User feedback on evaluations
6. ✅ `OVERALL_FEEDBACK` - Application feedback collection

### ❌ **Still Missing (3 tables):**
1. ❌ `CASE_SESSIONS` - Case tracking, CRM sync, and case status management
2. ❌ `LAST_INPUT_STATE` - Input state tracking (problem statement, FSR line items)
3. ❌ `CASE_REVIEW` - Feedback collection for closed cases

### ❌ **Mock Endpoints to Replace (8 endpoints):**
1. ❌ `/api/cases/validate/<case_number>` - Case validation
2. ❌ `/api/cases/user-cases` - User case listing
3. ❌ `/api/cases/data` - Case data retrieval
4. ❌ `/api/cases/status` - Case status checking
5. ❌ `/api/cases/create` - Case creation
6. ❌ `/api/cases/feedback` - Case feedback submission
7. ❌ `/api/cases/input-state` - Input state management (NEW)
8. ❌ `/api/cases/input-state` - Input state updates (NEW)

### ❌ **External CRM Integration:**
1. ❌ CRM status check functions
2. ❌ CRM case validation functions
3. ❌ Case status synchronization
4. ❌ External case ID mapping

### ❌ **Mock Data to Remove:**
1. ❌ `MOCK_VALID_CASES` - Replace with `CASE_SESSIONS` queries
2. ❌ `MOCK_CLOSED_CASES` - Replace with `CASE_SESSIONS.CASE_STATUS`
3. ❌ `MOCK_USER_CASE_DATA` - Replace with `LAST_INPUT_STATE` queries
4. ❌ `MOCK_CASE_REVIEW` - Replace with `CASE_REVIEW` table

### ❌ **Frontend Changes Needed:**
1. ❌ Replace localStorage with database API calls
2. ❌ Update CaseManager to use database endpoints
3. ❌ Implement input state synchronization
4. ❌ Update case creation flow
5. ❌ Update feedback collection flow

---

## Implementation Priority

### **Phase 1: Database Tables (HIGH PRIORITY)**
1. Create `CASE_SESSIONS` table
2. Create `LAST_INPUT_STATE` table  
3. Create `CASE_REVIEW` table

### **Phase 2: Backend Endpoints (HIGH PRIORITY)**
1. Replace all 8 mock endpoints with database queries using `{DATABASE}.{SCHEMA}.TABLE_NAME` format
2. Implement external CRM integration functions
3. Remove all mock data constants
4. Implement case session caching strategy (load once, cache in frontend)
5. Implement manual input state saving (only on LLM submission)

### **Phase 3: Frontend Integration (MEDIUM PRIORITY)**
1. Update CaseManager to use database endpoints with caching
2. Replace localStorage with database API calls (except for caching)
3. Implement input state synchronization (manual save only)
4. Remove auto-save functionality
5. Implement case session caching (load once on page load)

### **Phase 4: Testing & Validation (MEDIUM PRIORITY)**
1. Test all database endpoints
2. Verify case creation and management
3. Test feedback collection workflow
4. Validate external CRM integration