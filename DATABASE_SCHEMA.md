# Database Schema Documentation

## Overview
This document describes all database tables and their columns used in the FSR Coach application for **PRODUCTION** environment.

**Database**: `SAGE`  
**Schema**: `TEXTIO_SERVICES_INPUTS`  
**Format**: `SAGE.TEXTIO_SERVICES_INPUTS.TABLE_NAME`

---

## Tables

### 1. USER_INFORMATION
Stores user authentication and profile information.

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing user ID
- `FIRST_NAME` (VARCHAR(255)) - User's first name
- `LAST_NAME` (VARCHAR(255)) - User's last name
- `EMAIL` (VARCHAR(255)) - User's email address
- `EMPLOYEEID` (VARCHAR(255), UNIQUE) - Employee ID (used for SSO authentication)

**Usage**: User authentication, session management, user identification

---

### 2. CASE_SESSIONS
Tracks case sessions for each user. Each row represents a case that a user has opened/created.

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing session ID
- `CASE_ID` (NUMBER) - The case number (can be large integer)
- `CREATED_BY_USER` (NUMBER) - Foreign key to USER_INFORMATION.ID
- `USER_ID` (NUMBER) - User ID (duplicate of CREATED_BY_USER for convenience)
- `CASE_STATUS` (VARCHAR(20)) - Status: 'open' or 'closed' (default: 'open')
- `CASE_TITLE` (VARCHAR(500)) - Title of the case (from CRM or user input)
- `CREATION_TIME` (TIMESTAMP_NTZ) - When the case session was created
- `CRM_LAST_SYNC_TIME` (TIMESTAMP_NTZ) - Last time case status was synced with external CRM
- `LAST_ACCESSED_AT` (TIMESTAMP_NTZ) - Last time the case was accessed (for sorting)

**Usage**: Case management, tracking which cases users have opened, case status tracking

---

### 3. LAST_INPUT_STATE
Stores the current state of user inputs (problem statements and FSR notes) for each case session.

**Columns**:
- `CASE_SESSION_ID` (INTEGER) - Foreign key to CASE_SESSIONS.ID
- `INPUT_FIELD_ID` (INTEGER) - Field type: 1 = problem_statement, 2 = fsr_notes
- `INPUT_FIELD_VALUE` (TEXT) - The actual text content
- `LINE_ITEM_ID` (INTEGER, NULLABLE) - For FSR notes, identifies which line item (default: 1 for problem statement, NULL for single FSR note)
- `INPUT_FIELD_EVAL_ID` (INTEGER, NULLABLE) - Foreign key to LLM_EVALUATION.ID (links to the evaluation that generated this text)
- `LAST_UPDATED` (TIMESTAMP_NTZ) - When this input was last updated

**Usage**: Persisting user input state, restoring text on page reload, tracking which evaluation generated which text

---

### 4. USER_SESSION_INPUTS
Logs all user text inputs submitted for LLM evaluation.

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing input ID
- `USER_ID` (INTEGER) - Foreign key to USER_INFORMATION.ID
- `APP_SESSION_ID` (VARCHAR(255)) - Application session identifier
- `CASE_ID` (VARCHAR(255)) - Case number (as string)
- `LINE_ITEM_ID` (VARCHAR(255), NULLABLE) - FSR line item identifier (if applicable)
- `INPUT_FIELD_TYPE` (VARCHAR(50)) - Type: 'problem_statement' or 'fsr'
- `INPUT_TEXT` (TEXT) - The original text submitted by the user
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the input was submitted

**Usage**: Audit trail of user inputs, linking to LLM evaluations

---

### 5. LLM_EVALUATION
Stores LLM evaluation results (scores, original text, rewritten text).

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing evaluation ID
- `USER_INPUT_ID` (INTEGER) - Foreign key to USER_SESSION_INPUTS.ID
- `ORIGINAL_TEXT` (TEXT) - Original text submitted by user
- `REWRITTEN_TEXT` (TEXT, NULLABLE) - Rewritten text (for step 2 - rewrite)
- `SCORE` (NUMBER) - Evaluation score (0-100)
- `REWRITE_UUID` (VARCHAR(255), NULLABLE) - UUID linking to rewrite prompts/questions
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the evaluation was performed
- `EVALUATION_DETAILS` (VARIANT/JSON) - Full evaluation details including questions, answers, and complete LLM result object

**Usage**: Storing LLM evaluation results, history persistence, full state restoration

---

### 6. LLM_REWRITE_PROMPTS
Stores rewrite questions/prompts generated during LLM evaluation (step 1).

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing prompt ID
- `REWRITE_UUID` (VARCHAR(255)) - UUID linking multiple prompts to the same rewrite session
- `CRITERIA_ID` (INTEGER) - Foreign key to CRITERIA.ID (which criteria this question is about)
- `CRITERIA_SCORE` (NUMBER) - Score for this specific criteria
- `REWRITE_QUESTION` (TEXT) - The question/prompt text
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the prompt was generated

**Usage**: Storing rewrite questions for step 2 (rewrite), linking questions to criteria

---

### 7. USER_REWRITE_INPUTS
Logs user answers to rewrite questions (step 2).

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing input ID
- `REWRITE_UUID` (VARCHAR(255)) - UUID linking to LLM_REWRITE_PROMPTS.REWRITE_UUID
- `USER_INPUT_ID` (INTEGER) - Foreign key to USER_SESSION_INPUTS.ID
- `ANSWERS` (TEXT/VARIANT) - JSON object containing user's answers to rewrite questions
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the answers were submitted

**Usage**: Storing user answers to rewrite questions for step 2 processing

---

### 8. EVALUATION_FEEDBACK
Stores user feedback on LLM evaluations (thumbs up/down, comments).

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing feedback ID
- `REWRITE_ID` (INTEGER, NULLABLE) - Foreign key to LLM_EVALUATION.ID
- `USER_INPUT_ID` (INTEGER) - Foreign key to USER_SESSION_INPUTS.ID
- `FEEDBACK` (TEXT, NULLABLE) - User's feedback text
- `EXPLANATION` (TEXT, NULLABLE) - Additional explanation
- `PASSED` (BOOLEAN, NULLABLE) - Whether the evaluation passed user's criteria
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the feedback was submitted

**Usage**: Collecting user feedback on LLM evaluations for improvement

---

### 9. REWRITE_EVALUATION
Stores user feedback on rewrite results (thumbs up/down, comments).

**Columns**:
- `USER_INPUT_ID` (INTEGER) - Foreign key to USER_SESSION_INPUTS.ID
- `REWRITE_UUID` (VARCHAR(255)) - UUID linking to LLM_REWRITE_PROMPTS.REWRITE_UUID
- `FEEDBACK_TEXT` (TEXT, NULLABLE) - User's feedback text
- `SENTIMENT` (VARCHAR(50)) - Sentiment: 'positive', 'negative', or other
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the feedback was submitted

**Usage**: Collecting user feedback on rewrite results

---

### 10. OVERALL_FEEDBACK
Stores overall application feedback from users.

**Columns**:
- `USER_ID` (INTEGER) - Foreign key to USER_INFORMATION.ID
- `EXPERIENCE_RATING` (INTEGER) - Rating of overall experience (1-5 scale)
- `HELPFULNESS_RATING` (INTEGER) - Rating of helpfulness (1-5 scale)
- `FUTURE_INTEREST` (VARCHAR(50)) - User's interest in future use
- `FEEDBACK_TEXT` (TEXT, NULLABLE) - Additional feedback text
- `TIMESTAMP` (TIMESTAMP_NTZ) - When the feedback was submitted

**Usage**: Collecting overall application feedback for improvement

---

### 11. CASE_REVIEW
Stores feedback for closed cases (symptom, fault, fix).

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing review ID
- `CASE_ID` (NUMBER) - Foreign key to CASE_SESSIONS.CASE_ID
- `USER_ID` (INTEGER) - Foreign key to USER_INFORMATION.ID
- `CLOSED_DATE` (TIMESTAMP_NTZ) - When the case was closed
- `SYMPTOM` (VARCHAR) - Description of symptoms/issues reported
- `FAULT` (VARCHAR) - Root cause or fault identified
- `FIX` (VARCHAR) - Solution implemented
- `SUBMITTED_AT` (TIMESTAMP_NTZ) - When this review was submitted

**Usage**: Collecting feedback on closed cases for knowledge base

---

### 12. CRITERIA
Stores evaluation criteria used by the LLM.

**Columns**:
- `ID` (INTEGER, PRIMARY KEY) - Auto-incrementing criteria ID
- `CRITERIA` (VARCHAR(255)) - Criteria name/identifier
- `WEIGHT` (DECIMAL(5,2)) - Weight for scoring (0-100)
- `CRITERIA_DESCRIPTION` (TEXT) - Description of the criteria

**Usage**: Defining evaluation criteria for LLM evaluations

---

### 13. CRITERIA_GROUPS
Groups criteria by input field type and version.

**Columns**:
- `CRITERIA_ID` (INTEGER) - Foreign key to CRITERIA.ID
- `INPUT_FIELD_TYPE` (VARCHAR(50)) - Type: 'PROBLEM_STATEMENT' or 'FSR_DAILY_NOTE'
- `GROUP` (VARCHAR(50)) - Group name (e.g., 'DEFAULT')
- `GROUP_VERSION` (INTEGER) - Version of the group
- `CRITERIA_VERSION` (INTEGER) - Version of the criteria
- `DATE_ADDED` (TIMESTAMP) - When this criteria was added to the group

**Usage**: Organizing criteria by input type and versioning

---

### 14. KLA_GLOSSARY
Stores KLA-specific glossary terms and definitions.

**Columns**:
- `TERM` (VARCHAR) - Glossary term
- `DEF` (TEXT) - Definition of the term

**Usage**: Spell checking and terminology validation

---

## Relationships

### Foreign Key Relationships:
- `CASE_SESSIONS.CREATED_BY_USER` → `USER_INFORMATION.ID`
- `CASE_SESSIONS.USER_ID` → `USER_INFORMATION.ID`
- `LAST_INPUT_STATE.CASE_SESSION_ID` → `CASE_SESSIONS.ID`
- `LAST_INPUT_STATE.INPUT_FIELD_EVAL_ID` → `LLM_EVALUATION.ID`
- `USER_SESSION_INPUTS.USER_ID` → `USER_INFORMATION.ID`
- `LLM_EVALUATION.USER_INPUT_ID` → `USER_SESSION_INPUTS.ID`
- `LLM_REWRITE_PROMPTS.CRITERIA_ID` → `CRITERIA.ID`
- `USER_REWRITE_INPUTS.USER_INPUT_ID` → `USER_SESSION_INPUTS.ID`
- `EVALUATION_FEEDBACK.USER_INPUT_ID` → `USER_SESSION_INPUTS.ID`
- `EVALUATION_FEEDBACK.REWRITE_ID` → `LLM_EVALUATION.ID`
- `REWRITE_EVALUATION.USER_INPUT_ID` → `USER_SESSION_INPUTS.ID`
- `OVERALL_FEEDBACK.USER_ID` → `USER_INFORMATION.ID`
- `CASE_REVIEW.USER_ID` → `USER_INFORMATION.ID`
- `CASE_REVIEW.CASE_ID` → `CASE_SESSIONS.CASE_ID`
- `CRITERIA_GROUPS.CRITERIA_ID` → `CRITERIA.ID`

---

## Notes

- All table and column names use **UPPERCASE** to match Snowflake conventions
- Timestamps use `TIMESTAMP_NTZ` (no timezone) for consistency
- The `EVALUATION_DETAILS` column in `LLM_EVALUATION` is a `VARIANT` type (JSON) in Snowflake
- Case numbers (`CASE_ID`) can be large integers and may require special handling for precision
- The `LAST_INPUT_STATE` table uses `INPUT_FIELD_ID` to distinguish between problem statements (1) and FSR notes (2)
- Multiple FSR line items can exist per case (identified by `LINE_ITEM_ID`)

---

## Environment-Specific Notes

**PRODUCTION**:
- Database: `SAGE`
- Schema: `TEXTIO_SERVICES_INPUTS`
- Full path: `SAGE.TEXTIO_SERVICES_INPUTS.TABLE_NAME`

**DEVELOPMENT**:
- Database: `SAGE`
- Schema: `DEV_TEXTIO_SERVICES_INPUTS`
- Full path: `SAGE.DEV_TEXTIO_SERVICES_INPUTS.TABLE_NAME`

The application automatically selects the correct schema based on the `DEV_MODE` configuration flag.

