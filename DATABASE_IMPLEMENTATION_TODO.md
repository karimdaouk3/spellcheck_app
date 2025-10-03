# Database Implementation TODO

This document outlines all the changes needed to replace the mock in-memory storage with a real database.

---

## Overview
Currently, the application uses mock data stored in Python dictionaries. This data is lost when the Flask server restarts. To make the application production-ready, you need to implement persistent database storage.

---

## Database Schema Design

### Table 1: `cases`
Stores metadata about all cases in the system.

```sql
CREATE TABLE cases (
    case_number VARCHAR(100) PRIMARY KEY,
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    closed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Purpose**: Track which case numbers are valid and whether they're open or closed.

---

### Table 2: `user_cases`
Stores user-specific case data (problem statements and FSR notes).

```sql
CREATE TABLE user_cases (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    case_number VARCHAR(100) NOT NULL,
    problem_statement TEXT,
    fsr_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (case_number) REFERENCES cases(case_number),
    UNIQUE(user_id, case_number)
);
```

**Purpose**: Store each user's work on their cases. Multiple users can work on the same case number.

**Indexes**:
- `INDEX idx_user_id (user_id)` - for fast user lookups
- `INDEX idx_case_number (case_number)` - for fast case lookups
- `INDEX idx_user_case (user_id, case_number)` - for composite queries

---

## Mock Data to Replace

### 1. `MOCK_VALID_CASES` (lines 174-184 in app.py)
**Current**: Hardcoded list of valid case numbers
```python
MOCK_VALID_CASES = [
    "CASE-2024-001",
    "CASE-2024-002",
    # ...
]
```

**Replace with**: Query to `cases` table
```python
def is_valid_case(case_number):
    """Check if case exists in database"""
    query = "SELECT case_number FROM cases WHERE case_number = %s"
    result = db.execute(query, (case_number,))
    return result is not None
```

---

### 2. `MOCK_CLOSED_CASES` (lines 187-190 in app.py)
**Current**: Hardcoded list of closed cases
```python
MOCK_CLOSED_CASES = [
    "CASE-2024-002",
    "67890"
]
```

**Replace with**: Query to `cases` table
```python
def is_case_closed(case_number):
    """Check if case is closed"""
    query = "SELECT is_open FROM cases WHERE case_number = %s"
    result = db.execute(query, (case_number,))
    return result and not result['is_open']
```

---

### 3. `MOCK_USER_CASE_DATA` (lines 193-210 in app.py)
**Current**: Dictionary storing user case data in memory
```python
MOCK_USER_CASE_DATA = {
    "0": {
        "CASE-2024-001": {...},
        "CASE-2024-003": {...}
    }
}
```

**Replace with**: Queries to `user_cases` table (see endpoints below)

---

## API Endpoints to Update

### 1. `/api/cases/validate/<case_number>` (GET)
**File**: `app.py` lines 212-232

**Current Logic**:
```python
is_valid = case_number in MOCK_VALID_CASES
is_closed = case_number in MOCK_CLOSED_CASES
```

**Replace with**:
```python
@app.route('/api/cases/validate/<case_number>', methods=['GET'])
def validate_case_number(case_number):
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    # Query database
    query = """
        SELECT case_number, is_open 
        FROM cases 
        WHERE case_number = %s
    """
    result = db.execute(query, (case_number,))
    
    if not result:
        return jsonify({
            "valid": False,
            "message": f"Case number '{case_number}' does not exist in the system."
        }), 404
    
    return jsonify({
        "valid": True,
        "case_number": case_number,
        "is_closed": not result['is_open'],
        "status": "open" if result['is_open'] else "closed"
    })
```

---

### 2. `/api/cases/user-cases` (GET)
**File**: `app.py` lines 234-250

**Current Logic**: Returns hardcoded valid cases excluding closed ones

**Replace with**:
```python
@app.route('/api/cases/user-cases', methods=['GET'])
def get_user_cases():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Query database for user's cases that are still open
    query = """
        SELECT DISTINCT uc.case_number
        FROM user_cases uc
        JOIN cases c ON uc.case_number = c.case_number
        WHERE uc.user_id = %s AND c.is_open = TRUE
        ORDER BY uc.updated_at DESC
    """
    results = db.execute_all(query, (user_id,))
    case_numbers = [row['case_number'] for row in results]
    
    return jsonify({
        "user_id": user_id,
        "cases": case_numbers,
        "count": len(case_numbers)
    })
```

---

### 3. `/api/cases/status` (POST)
**File**: `app.py` lines 265-294

**Current Logic**: Checks case numbers against hardcoded lists

**Replace with**:
```python
@app.route('/api/cases/status', methods=['POST'])
def check_cases_status():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    data = request.get_json()
    case_numbers = data.get('case_numbers', [])
    
    if not case_numbers:
        return jsonify({"results": []})
    
    # Query database for all case numbers at once
    placeholders = ','.join(['%s'] * len(case_numbers))
    query = f"""
        SELECT case_number, is_open
        FROM cases
        WHERE case_number IN ({placeholders})
    """
    results = db.execute_all(query, tuple(case_numbers))
    
    # Create lookup dictionary
    cases_dict = {row['case_number']: row for row in results}
    
    # Build response
    response_results = []
    for case_number in case_numbers:
        if case_number in cases_dict:
            case_data = cases_dict[case_number]
            response_results.append({
                "case_number": case_number,
                "valid": True,
                "is_closed": not case_data['is_open'],
                "status": "open" if case_data['is_open'] else "closed"
            })
        else:
            response_results.append({
                "case_number": case_number,
                "valid": False,
                "is_closed": False,
                "status": "invalid"
            })
    
    return jsonify({"results": response_results})
```

---

### 4. `/api/cases/data` (GET)
**File**: `app.py` lines 296-336

**Current Logic**: Returns data from `MOCK_USER_CASE_DATA` dictionary

**Replace with**:
```python
@app.route('/api/cases/data', methods=['GET'])
def get_user_case_data():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Query database for user's case data (only open cases)
    query = """
        SELECT 
            uc.case_number,
            uc.problem_statement,
            uc.fsr_notes,
            uc.updated_at
        FROM user_cases uc
        JOIN cases c ON uc.case_number = c.case_number
        WHERE uc.user_id = %s AND c.is_open = TRUE
        ORDER BY uc.updated_at DESC
    """
    results = db.execute_all(query, (user_id,))
    
    # Convert to dictionary format expected by frontend
    cases = {}
    for row in results:
        cases[row['case_number']] = {
            "caseNumber": row['case_number'],
            "problemStatement": row['problem_statement'] or '',
            "fsrNotes": row['fsr_notes'] or '',
            "updatedAt": row['updated_at'].isoformat() + 'Z'
        }
    
    return jsonify({
        "user_id": str(user_id),
        "cases": cases,
        "count": len(cases)
    })
```

---

### 5. `/api/cases/data/<case_number>` (GET)
**File**: `app.py` lines 338-356

**Current Logic**: Returns data from `MOCK_USER_CASE_DATA` dictionary

**Replace with**:
```python
@app.route('/api/cases/data/<case_number>', methods=['GET'])
def get_case_data(case_number):
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Query database for specific case
    query = """
        SELECT 
            uc.case_number,
            uc.problem_statement,
            uc.fsr_notes,
            uc.updated_at
        FROM user_cases uc
        WHERE uc.user_id = %s AND uc.case_number = %s
    """
    result = db.execute(query, (user_id, case_number))
    
    if not result:
        return jsonify({
            "found": False,
            "message": "No saved data for this case"
        }), 404
    
    return jsonify({
        "found": True,
        "data": {
            "caseNumber": result['case_number'],
            "problemStatement": result['problem_statement'] or '',
            "fsrNotes": result['fsr_notes'] or '',
            "updatedAt": result['updated_at'].isoformat() + 'Z'
        }
    })
```

---

### 6. `/api/cases/data/<case_number>` (PUT)
**File**: `app.py` lines 358-400

**Current Logic**: Updates `MOCK_USER_CASE_DATA` dictionary

**Replace with**:
```python
@app.route('/api/cases/data/<case_number>', methods=['PUT'])
def save_case_data(case_number):
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    
    # Validate case exists and is open
    case_query = """
        SELECT case_number, is_open 
        FROM cases 
        WHERE case_number = %s
    """
    case_result = db.execute(case_query, (case_number,))
    
    if not case_result:
        return jsonify({"error": "Invalid case number"}), 400
    
    if not case_result['is_open']:
        return jsonify({"error": "Cannot save data for closed case"}), 400
    
    # Get data from request
    data = request.get_json()
    problem_statement = data.get('problemStatement', '')
    fsr_notes = data.get('fsrNotes', '')
    
    # Insert or update user case data
    upsert_query = """
        INSERT INTO user_cases (user_id, case_number, problem_statement, fsr_notes)
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            problem_statement = VALUES(problem_statement),
            fsr_notes = VALUES(fsr_notes),
            updated_at = CURRENT_TIMESTAMP
    """
    # Or for PostgreSQL:
    # upsert_query = """
    #     INSERT INTO user_cases (user_id, case_number, problem_statement, fsr_notes)
    #     VALUES (%s, %s, %s, %s)
    #     ON CONFLICT (user_id, case_number)
    #     DO UPDATE SET
    #         problem_statement = EXCLUDED.problem_statement,
    #         fsr_notes = EXCLUDED.fsr_notes,
    #         updated_at = CURRENT_TIMESTAMP
    # """
    
    db.execute(upsert_query, (user_id, case_number, problem_statement, fsr_notes))
    db.commit()
    
    return jsonify({
        "success": True,
        "message": "Case data saved successfully",
        "case_number": case_number,
        "updated_at": datetime.utcnow().isoformat() + 'Z'
    })
```

---

### 7. `/api/cases/data` (POST)
**File**: `app.py` lines 402-451

**Current Logic**: Batch updates `MOCK_USER_CASE_DATA` dictionary

**Replace with**:
```python
@app.route('/api/cases/data', methods=['POST'])
def save_multiple_cases():
    user_data = session.get('user_data')
    if not user_data:
        return jsonify({"error": "Not authenticated"}), 401
    
    user_id = user_data.get('user_id')
    data = request.get_json()
    cases = data.get('cases', [])
    
    saved_count = 0
    errors = []
    
    for case_data in cases:
        case_number = case_data.get('caseNumber')
        
        # Validate case
        case_query = "SELECT case_number, is_open FROM cases WHERE case_number = %s"
        case_result = db.execute(case_query, (case_number,))
        
        if not case_result:
            errors.append(f"Invalid case: {case_number}")
            continue
        
        if not case_result['is_open']:
            errors.append(f"Case is closed: {case_number}")
            continue
        
        # Insert or update
        try:
            upsert_query = """
                INSERT INTO user_cases (user_id, case_number, problem_statement, fsr_notes)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    problem_statement = VALUES(problem_statement),
                    fsr_notes = VALUES(fsr_notes),
                    updated_at = CURRENT_TIMESTAMP
            """
            db.execute(upsert_query, (
                user_id,
                case_number,
                case_data.get('problemStatement', ''),
                case_data.get('fsrNotes', '')
            ))
            saved_count += 1
        except Exception as e:
            errors.append(f"Error saving {case_number}: {str(e)}")
    
    db.commit()
    
    return jsonify({
        "success": True,
        "saved_count": saved_count,
        "errors": errors
    })
```

---

## Database Connection Setup

### Option 1: MySQL/MariaDB
```python
import mysql.connector
from mysql.connector import pooling

# Create connection pool
db_config = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME", "fsr_coach"),
    "pool_name": "fsr_pool",
    "pool_size": 5
}

connection_pool = mysql.connector.pooling.MySQLConnectionPool(**db_config)

class Database:
    def execute(self, query, params=None):
        """Execute query and return single result"""
        conn = connection_pool.get_connection()
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(query, params or ())
            result = cursor.fetchone()
            return result
        finally:
            cursor.close()
            conn.close()
    
    def execute_all(self, query, params=None):
        """Execute query and return all results"""
        conn = connection_pool.get_connection()
        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute(query, params or ())
            results = cursor.fetchall()
            return results
        finally:
            cursor.close()
            conn.close()
    
    def commit(self):
        """Commit current transaction"""
        pass  # Auto-commit is on by default

db = Database()
```

### Option 2: PostgreSQL
```python
import psycopg2
from psycopg2 import pool

# Create connection pool
connection_pool = psycopg2.pool.SimpleConnectionPool(
    1, 20,
    host=os.getenv("DB_HOST", "localhost"),
    database=os.getenv("DB_NAME", "fsr_coach"),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD")
)

class Database:
    def execute(self, query, params=None):
        conn = connection_pool.getconn()
        cursor = conn.cursor()
        try:
            cursor.execute(query, params or ())
            result = cursor.fetchone()
            if result:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, result))
            return None
        finally:
            cursor.close()
            connection_pool.putconn(conn)
    
    def execute_all(self, query, params=None):
        conn = connection_pool.getconn()
        cursor = conn.cursor()
        try:
            cursor.execute(query, params or ())
            results = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in results]
        finally:
            cursor.close()
            connection_pool.putconn(conn)
    
    def commit(self):
        conn = connection_pool.getconn()
        try:
            conn.commit()
        finally:
            connection_pool.putconn(conn)

db = Database()
```

### Option 3: SQLAlchemy ORM (Recommended for Flask)
```python
from flask_sqlalchemy import SQLAlchemy

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Define models
class Case(db.Model):
    __tablename__ = 'cases'
    case_number = db.Column(db.String(100), primary_key=True)
    is_open = db.Column(db.Boolean, nullable=False, default=True)
    closed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class UserCase(db.Model):
    __tablename__ = 'user_cases'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(100), nullable=False)
    case_number = db.Column(db.String(100), db.ForeignKey('cases.case_number'), nullable=False)
    problem_statement = db.Column(db.Text)
    fsr_notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'case_number', name='unique_user_case'),)
```

---

## Environment Variables

Add to `.env` file:
```
DB_HOST=localhost
DB_NAME=fsr_coach
DB_USER=your_username
DB_PASSWORD=your_password
DB_PORT=3306  # or 5432 for PostgreSQL
```

---

## Migration Steps

### Step 1: Set up database
1. Create database: `CREATE DATABASE fsr_coach;`
2. Run schema creation scripts (see schema above)
3. Optionally seed with test data

### Step 2: Install database driver
```bash
# For MySQL
pip install mysql-connector-python

# OR for PostgreSQL
pip install psycopg2-binary

# OR for SQLAlchemy (recommended)
pip install flask-sqlalchemy
```

### Step 3: Add to requirements.txt
```
flask-sqlalchemy==3.0.5
# OR
mysql-connector-python==8.2.0
# OR
psycopg2-binary==2.9.9
```

### Step 4: Replace mock endpoints
- Update all 7 endpoints listed above
- Test each endpoint individually
- Verify data persistence after server restart

### Step 5: Remove mock data
Delete these from `app.py`:
- Lines 174-184: `MOCK_VALID_CASES`
- Lines 187-190: `MOCK_CLOSED_CASES`
- Lines 193-210: `MOCK_USER_CASE_DATA`

### Step 6: Add database initialization
Create `init_db.py`:
```python
from your_app import db, Case

# Create tables
db.create_all()

# Seed with test cases
test_cases = [
    Case(case_number='CASE-2024-001', is_open=True),
    Case(case_number='CASE-2024-002', is_open=False),
    Case(case_number='CASE-2024-003', is_open=True),
    # ... add more
]

db.session.bulk_save_objects(test_cases)
db.session.commit()
```

---

## Additional Features to Consider

### 1. Case History/Audit Trail
Track all changes to case data:
```sql
CREATE TABLE case_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100),
    case_number VARCHAR(100),
    field_name VARCHAR(50),
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. Case Assignments
Track who "owns" each case:
```sql
CREATE TABLE case_assignments (
    case_number VARCHAR(100) PRIMARY KEY,
    assigned_to VARCHAR(100),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_number) REFERENCES cases(case_number)
);
```

### 3. Case Sharing/Collaboration
Allow multiple users to collaborate:
```sql
CREATE TABLE case_collaborators (
    id SERIAL PRIMARY KEY,
    case_number VARCHAR(100),
    user_id VARCHAR(100),
    permission_level VARCHAR(20), -- 'read', 'write', 'admin'
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4. Automatic Case Closing
Add a background job that checks for case closure:
```python
from apscheduler.schedulers.background import BackgroundScheduler

def check_and_close_cases():
    """Check external system for closed cases and update database"""
    # Query your case management system
    closed_cases = external_api.get_closed_cases()
    
    # Update database
    for case_number in closed_cases:
        query = "UPDATE cases SET is_open = FALSE, closed_at = NOW() WHERE case_number = %s"
        db.execute(query, (case_number,))
    db.commit()

# Run every hour
scheduler = BackgroundScheduler()
scheduler.add_job(check_and_close_cases, 'interval', hours=1)
scheduler.start()
```

---

## Testing Checklist

After implementing database:
- [ ] User can add a new case
- [ ] User's case data saves to database
- [ ] User can reload page and see their cases
- [ ] User can switch between cases
- [ ] Auto-save works (every 30 seconds)
- [ ] Closed cases are filtered out
- [ ] Invalid case numbers are rejected
- [ ] Multiple users can have the same case number
- [ ] Users only see their own case data
- [ ] Server restart doesn't lose data

---

## Performance Considerations

### Indexing
Ensure proper indexes exist:
```sql
CREATE INDEX idx_user_cases_user_id ON user_cases(user_id);
CREATE INDEX idx_user_cases_case_number ON user_cases(case_number);
CREATE INDEX idx_user_cases_updated ON user_cases(updated_at DESC);
CREATE INDEX idx_cases_open ON cases(is_open);
```

### Connection Pooling
- Use connection pooling (already shown above)
- Set appropriate pool size (5-20 connections typical)
- Monitor connection usage

### Caching
Consider caching frequently accessed data:
```python
from flask_caching import Cache

cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@cache.memoize(timeout=300)  # Cache for 5 minutes
def get_valid_case_numbers():
    query = "SELECT case_number FROM cases WHERE is_open = TRUE"
    results = db.execute_all(query)
    return [row['case_number'] for row in results]
```

---

## Security Considerations

1. **SQL Injection Prevention**: Always use parameterized queries (shown in examples)
2. **User Isolation**: Always filter by `user_id` from session
3. **Input Validation**: Validate all input data
4. **Rate Limiting**: Consider adding rate limits to prevent abuse
5. **Audit Logging**: Log all data modifications

---

## Rollback Plan

If database implementation has issues:
1. Keep mock data code in a separate branch
2. Use feature flags to switch between mock/real database
3. Have database backups before going live

```python
USE_DATABASE = os.getenv('USE_DATABASE', 'false').lower() == 'true'

if USE_DATABASE:
    # Use real database
    cases = get_cases_from_db(user_id)
else:
    # Use mock data
    cases = MOCK_USER_CASE_DATA.get(user_id, {})
```

---

## Summary

**Files to Modify**:
- `app.py` - Replace 7 endpoints (lines 212-451)
- `requirements.txt` - Add database driver
- Create `init_db.py` - Database initialization script
- Create `.env` - Add database credentials

**Estimated Time**: 4-8 hours for basic implementation

**Priority Order**:
1. Set up database and create tables ✅
2. Implement `/api/cases/data` GET/PUT (most critical) ✅
3. Implement validation endpoints ✅
4. Implement batch operations ✅
5. Add indexes and optimization ✅
6. Add monitoring and logging ✅

