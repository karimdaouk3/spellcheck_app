# Database Integration Plan - Step by Step

## Overview
This plan integrates the new database tables (`CASE_SESSIONS`, `LAST_INPUT_STATE`, `CASE_REVIEW`) with the existing application, replacing mock endpoints with real database queries.

**Note**: `CASE_REVIEW` table is actually named `CASE_REVIEW` in the database.

---

## Phase 1: Backend Database Integration (Start Here)

### Step 1.1: Update Case Validation Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/validate/<case_number>`

**Changes**:
```python
@app.route('/api/cases/validate/<case_number>', methods=['GET'])
def validate_case_number(case_number):
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    query = f"""
        SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        WHERE CASE_ID = %s
        LIMIT 1
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (case_number,))
    
    if result is not None and not result.empty:
        case_data = result.iloc[0]
        return jsonify({
            "valid": True,
            "case_id": case_data["CASE_ID"],
            "case_status": case_data["CASE_STATUS"],
            "last_sync_time": case_data["CRM_LAST_SYNC_TIME"]
        })
    else:
        return jsonify({"valid": False, "message": "Case not found"})
```

**Test**: 
1. Start the app
2. Go to `/api/cases/validate/CASE-2024-001` (or any case number)
3. Should return JSON with case details or "Case not found"

---

### Step 1.2: Update User Cases Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/user-cases`

**Changes**:
```python
@app.route('/api/cases/user-cases', methods=['GET'])
def get_user_cases():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    query = f"""
        SELECT CASE_ID, CASE_STATUS, CRM_LAST_SYNC_TIME
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        WHERE CREATED_BY_USER = %s
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
    
    cases = []
    if result is not None and not result.empty:
        for _, row in result.iterrows():
            cases.append({
                "case_id": row["CASE_ID"],
                "case_status": row["CASE_STATUS"],
                "last_sync_time": row["CRM_LAST_SYNC_TIME"]
            })
    
    return jsonify({"cases": cases, "count": len(cases)})
```

**Test**:
1. Login to the app
2. Go to `/api/cases/user-cases`
3. Should return JSON with user's cases

---

### Step 1.3: Update Case Data Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/data`

**Changes**:
```python
@app.route('/api/cases/data', methods=['GET'])
def get_user_case_data():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Get case sessions with problem statements
    query = f"""
        SELECT cs.CASE_ID, cs.CASE_STATUS,
               lis_problem.INPUT_FIELD_VALUE as problem_statement
        FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS cs
        LEFT JOIN {DATABASE}.{SCHEMA}.LAST_INPUT_STATE lis_problem 
            ON cs.ID = lis_problem.CASE_SESSION_ID 
            AND lis_problem.INPUT_FIELD_ID = 1
        WHERE cs.CREATED_BY_USER = %s AND cs.CASE_STATUS = 'open'
    """
    cases_result = snowflake_query(query, CONNECTION_PAYLOAD, (user_id,))
    
    cases = {}
    if cases_result is not None and not cases_result.empty:
        for _, case_row in cases_result.iterrows():
            case_id = case_row["CASE_ID"]
            
            # Get FSR line items for this case
            fsr_query = f"""
                SELECT LINE_ITEM_ID, INPUT_FIELD_VALUE, INPUT_FIELD_EVAL_ID, LAST_UPDATED
                FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
                WHERE CASE_SESSION_ID = (
                    SELECT ID FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
                    WHERE CASE_ID = %s AND CREATED_BY_USER = %s
                ) AND INPUT_FIELD_ID = 2
                ORDER BY LINE_ITEM_ID
            """
            fsr_result = snowflake_query(fsr_query, CONNECTION_PAYLOAD, (case_id, user_id))
            
            fsr_notes = ""
            if fsr_result is not None and not fsr_result.empty:
                # Get the last FSR line item for the text box
                last_fsr = fsr_result.iloc[-1]
                fsr_notes = last_fsr["INPUT_FIELD_VALUE"]
            
            cases[case_id] = {
                "caseNumber": case_id,
                "problemStatement": case_row["problem_statement"] or "",
                "fsrNotes": fsr_notes,
                "updatedAt": datetime.utcnow().isoformat() + 'Z'
            }
    
    return jsonify({
        "user_id": str(user_id),
        "cases": cases,
        "count": len(cases)
    })
```

**Test**:
1. Login to the app
2. Go to `/api/cases/data`
3. Should return JSON with case data including problem statements and FSR notes

---

### Step 1.4: Update Case Creation Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/create` (POST)

**Changes**:
```python
@app.route('/api/cases/create', methods=['POST'])
def create_case():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_number = data.get('case_number')
    user_id = user_data.get('user_id')
    
    if not case_number:
        return jsonify({"error": "Case number required"}), 400
    
    # Check if case already exists
    check_query = f"""
        SELECT COUNT(*) FROM {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        WHERE CASE_ID = %s AND CREATED_BY_USER = %s
    """
    check_result = snowflake_query(check_query, CONNECTION_PAYLOAD, (case_number, user_id))
    
    if check_result is not None and check_result.iloc[0, 0] > 0:
        return jsonify({"error": "Case already exists"}), 409
    
    # Check external CRM (placeholder)
    exists_in_crm = check_external_crm_exists(case_number)
    
    # Insert new case session
    insert_query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.CASE_SESSIONS 
        (CASE_ID, CREATED_BY_USER, CASE_STATUS, CREATION_TIME, CRM_LAST_SYNC_TIME)
        VALUES (%s, %s, 'open', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    """
    snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                   (case_number, user_id), 
                   return_df=False)
    
    return jsonify({
        "success": True,
        "case_number": case_number,
        "message": "Case created successfully"
    })
```

**Test**:
1. Login to the app
2. Send POST request to `/api/cases/create` with JSON: `{"case_number": "TEST-001"}`
3. Should return success message
4. Verify case appears in `/api/cases/user-cases`

---

## Phase 2: Input State Management

### Step 2.1: Create Input State GET Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/input-state`

**Changes**:
```python
@app.route('/api/cases/input-state', methods=['GET'])
def get_input_state():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    case_session_id = request.args.get('case_session_id')
    if not case_session_id:
        return jsonify({"error": "case_session_id required"}), 400
    
    query = f"""
        SELECT INPUT_FIELD_ID, INPUT_FIELD_VALUE, LINE_ITEM_ID, 
               INPUT_FIELD_EVAL_ID, LAST_UPDATED
        FROM {DATABASE}.{SCHEMA}.LAST_INPUT_STATE
        WHERE CASE_SESSION_ID = %s
    """
    result = snowflake_query(query, CONNECTION_PAYLOAD, (case_session_id,))
    
    input_states = []
    if result is not None and not result.empty:
        for _, row in result.iterrows():
            input_states.append({
                "input_field_id": row["INPUT_FIELD_ID"],
                "input_field_value": row["INPUT_FIELD_VALUE"],
                "line_item_id": row["LINE_ITEM_ID"],
                "input_field_eval_uuid": row["INPUT_FIELD_EVAL_ID"],
                "last_updated": row["LAST_UPDATED"]
            })
    
    return jsonify({"input_states": input_states})
```

**Test**:
1. Get a case_session_id from the database
2. Go to `/api/cases/input-state?case_session_id=1`
3. Should return JSON with input states

---

### Step 2.2: Create Input State PUT Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/input-state` (PUT)

**Changes**:
```python
@app.route('/api/cases/input-state', methods=['PUT'])
def update_input_state():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_session_id = data.get('case_session_id')
    input_field_id = data.get('input_field_id')
    input_field_value = data.get('input_field_value')
    line_item_id = data.get('line_item_id')
    input_field_eval_uuid = data.get('input_field_eval_uuid')
    
    if not all([case_session_id, input_field_id, input_field_value is not None]):
        return jsonify({"error": "Missing required fields"}), 400
    
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
    
    return jsonify({"success": True, "message": "Input state updated"})
```

**Test**:
1. Send PUT request to `/api/cases/input-state` with JSON:
   ```json
   {
     "case_session_id": 1,
     "input_field_id": "problem_statement",
     "input_field_value": "Test problem statement",
     "line_item_id": null,
     "input_field_eval_uuid": null
   }
   ```
2. Should return success message
3. Verify with GET request to see the data was saved

---

## Phase 3: Feedback Integration

### Step 3.1: Update Case Feedback Endpoint
**File**: `app.py`  
**Endpoint**: `/api/cases/feedback` (POST)

**Changes**:
```python
@app.route('/api/cases/feedback', methods=['POST'])
def submit_case_feedback():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Validate required fields
    required_fields = ['case_number', 'feedback']
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    feedback = data.get('feedback', {})
    feedback_required = ['symptom', 'fault', 'fix']
    for field in feedback_required:
        if field not in feedback or not feedback[field].strip():
            return jsonify({"error": f"Missing or empty feedback field: {field}"}), 400
    
    # Insert into CASE_REVIEW table
    insert_query = f"""
        INSERT INTO {DATABASE}.{SCHEMA}.CASE_REVIEW 
        (USER_ID, CASE_NUMBER, CLOSED_DATE, SYMPTOM, FAULT, FIX)
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    snowflake_query(insert_query, CONNECTION_PAYLOAD, 
                   (user_id, data.get('case_number'), data.get('closed_date'), 
                    feedback.get('symptom'), feedback.get('fault'), feedback.get('fix')),
                   return_df=False)
    
    return jsonify({
        "success": True,
        "message": "Feedback submitted successfully"
    })
```

**Test**:
1. Send POST request to `/api/cases/feedback` with JSON:
   ```json
   {
     "case_number": "CASE-2024-001",
     "closed_date": "2024-01-15T10:00:00Z",
     "feedback": {
       "symptom": "System was slow",
       "fault": "Memory leak in application",
       "fix": "Restarted the application"
     }
   }
   ```
2. Should return success message

---

## Phase 4: Frontend Integration

### Step 4.1: Update CaseManager.loadCases()
**File**: `static/js/editor.js`

**Changes**:
```javascript
async loadCases() {
    if (this.userId === null || this.userId === undefined) {
        console.warn('No user ID available, cannot load cases');
        this.cases = [];
        return;
    }
    
    try {
        // Load cases from backend (cached after first load)
        console.log(`Loading cases for user ${this.userId} from backend...`);
        const response = await fetch('/api/cases/data');
        
        if (response.ok) {
            const data = await response.json();
            const backendCases = data.cases || {};
            
            console.log(`✅ Successfully loaded ${Object.keys(backendCases).length} cases from backend`);
            
            // Convert backend format to frontend format
            this.cases = Object.values(backendCases).map(caseData => ({
                id: Date.now() + Math.random(), // Generate unique ID
                caseNumber: caseData.caseNumber,
                problemStatement: caseData.problemStatement || '',
                fsrNotes: caseData.fsrNotes || '',
                createdAt: new Date(caseData.updatedAt || Date.now()),
                updatedAt: new Date(caseData.updatedAt || Date.now())
            }));
            
            // Cache in localStorage for offline access
            this.saveCasesLocally();
        } else {
            // Fallback to localStorage if backend fails
            console.warn('Backend failed, using cached data');
            this.loadCasesLocally();
        }
    } catch (error) {
        console.error('Error loading cases:', error);
        this.loadCasesLocally();
    }
}
```

**Test**:
1. Open the app
2. Check browser console for case loading messages
3. Verify cases appear in the sidebar

---

### Step 4.2: Update CaseManager.saveCaseToBackend()
**File**: `static/js/editor.js`

**Changes**:
```javascript
async saveCaseToBackend(caseData) {
    if (this.userId === null || this.userId === undefined) {
        console.warn('No user ID available, cannot save to backend');
        return;
    }
    
    // Skip saving untracked cases to backend
    if (caseData.isTrackedInDatabase === false) {
        console.log(`Skipping backend save for untracked case ${caseData.caseNumber}`);
        return;
    }
    
    try {
        // Save input state to database
        const caseSessionId = await this.getCaseSessionId(caseData.caseNumber);
        
        if (caseSessionId) {
            // Save problem statement
            if (caseData.problemStatement) {
                await this.saveInputState(caseSessionId, 'problem_statement', caseData.problemStatement, null);
            }
            
            // Save FSR notes
            if (caseData.fsrNotes) {
                await this.saveInputState(caseSessionId, 'fsr', caseData.fsrNotes, 1);
            }
        }
        
        console.log(`Saved case ${caseData.caseNumber} to backend`);
        return true;
    } catch (error) {
        console.error(`Error saving case ${caseData.caseNumber} to backend:`, error);
        return false;
    }
}

async getCaseSessionId(caseNumber) {
    // Get case session ID for the case
    const response = await fetch(`/api/cases/validate/${encodeURIComponent(caseNumber)}`);
    if (response.ok) {
        const data = await response.json();
        return data.case_session_id; // You'll need to modify the validate endpoint to return this
    }
    return null;
}

async saveInputState(caseSessionId, inputFieldId, inputFieldValue, lineItemId) {
    const response = await fetch('/api/cases/input-state', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            case_session_id: caseSessionId,
            input_field_id: inputFieldId,
            input_field_value: inputFieldValue,
            line_item_id: lineItemId,
            input_field_eval_uuid: null
        })
    });
    
    return response.ok;
}
```

**Test**:
1. Create a new case
2. Add some text to problem statement and FSR notes
3. Switch to another case and back
4. Verify text is preserved (saved to database)

---

### Step 4.3: Update LLM Submission to Save Input State
**File**: `static/js/editor.js`

**Changes**:
```javascript
// In submitToLLM method, after successful LLM processing:
async submitToLLM(text, answers = null, field = this.activeField) {
    // ... existing LLM processing code ...
    
    // After successful LLM processing, save input state
    if (this.currentCase && this.currentCase.caseNumber) {
        const caseSessionId = await this.getCaseSessionId(this.currentCase.caseNumber);
        if (caseSessionId) {
            const inputFieldId = (field === 'editor2') ? 'fsr' : 'problem_statement';
            const lineItemId = (field === 'editor2') ? this.fields.editor2.lineItemId : null;
            
            await this.saveInputState(caseSessionId, inputFieldId, text, lineItemId);
        }
    }
    
    // ... rest of existing code ...
}
```

**Test**:
1. Submit text for LLM review
2. Check database to verify input state was saved
3. Verify the data appears in `/api/cases/data`

---

## Phase 5: Remove Mock Data

### Step 5.1: Remove Mock Constants
**File**: `app.py`

**Remove these lines**:
```python
# Remove these mock constants:
MOCK_VALID_CASES = [...]
MOCK_CLOSED_CASES = [...]
MOCK_USER_CASE_DATA = {...}
MOCK_CASE_REVIEW = {...}
```

### Step 5.2: Remove Mock Endpoint Implementations
**File**: `app.py`

**Replace all mock endpoint implementations** with the database versions from Steps 1.1-3.1.

---

## Testing Checklist

### Backend Testing
- [ ] Case validation endpoint works
- [ ] User cases endpoint returns correct data
- [ ] Case data endpoint returns problem statements and FSR notes
- [ ] Case creation endpoint works
- [ ] Input state GET/PUT endpoints work
- [ ] Feedback submission works

### Frontend Testing
- [ ] Cases load in sidebar on page load
- [ ] Case switching works with cached data
- [ ] Text is preserved when switching cases
- [ ] LLM submission saves input state
- [ ] Feedback popup works for closed cases

### Integration Testing
- [ ] End-to-end case creation and management
- [ ] End-to-end feedback collection
- [ ] Database queries use correct table names
- [ ] No mock data dependencies remain

---

## Rollback Plan

If any step fails:
1. **Backend Issues**: Revert to mock endpoints temporarily
2. **Database Issues**: Check table names and column names match exactly
3. **Frontend Issues**: Keep localStorage fallback active
4. **Integration Issues**: Test each endpoint individually

---

## Next Steps After Completion

1. **Performance Testing**: Test with multiple users and large datasets
2. **Error Handling**: Add comprehensive error handling and logging
3. **Monitoring**: Add database query monitoring and performance metrics
4. **Documentation**: Update API documentation with new endpoints
5. **User Training**: Update user documentation if needed
