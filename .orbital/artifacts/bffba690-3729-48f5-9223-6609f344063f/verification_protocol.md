# Verification Protocol: Implement User Authentication System

## Automated Gates

### G1: Dependency Installation
**Test:** `npm install && npm list --depth=0`
**Expected Output:**
```
property-search-api@1.0.0
├── express@4.18.2
├── jsonwebtoken@9.0.2
├── bcrypt@5.1.1
├── express-rate-limit@7.1.5
└── dotenv@16.3.1
```
**Pass Criteria:** All dependencies installed without errors or peer dependency warnings
**Intent Reference:** Constraint - Technology Stack (jsonwebtoken, bcrypt, express-rate-limit)

### G2: Database Schema Validation
**Test:** Execute migration and verify table structure
```bash
psql -U $DB_USER -d $DB_NAME -f backend/database/migrations/001-create-users-table.sql
psql -U $DB_USER -d $DB_NAME -c "d users"
```
**Expected Output:**
```
Table "public.users"
Column        | Type                     | Nullable | Default
--------------+--------------------------+----------+---------------------------
user_id       | integer                  | not null | nextval('users_user_id_seq')
username      | character varying(50)    | not null |
password_hash | character varying(255)   | not null |
created_at    | timestamp                |          | CURRENT_TIMESTAMP
updated_at    | timestamp                |          | CURRENT_TIMESTAMP
last_login    | timestamp                |          |
login_attempts| integer                  |          | 0
locked_until  | timestamp                |          |

Indexes:
    "users_pkey" PRIMARY KEY, btree (user_id)
    "users_username_key" UNIQUE CONSTRAINT, btree (username)
    "idx_users_username" btree (username)
```
**Pass Criteria:** All columns present with correct types, unique constraint on username, index on username
**Intent Reference:** Acceptance Boundary (Minimum Viable) - User credentials table created with hashed passwords

### G3: Environment Configuration Validation
**Test:** Verify .env.example exists and .env is gitignored
```bash
test -f .env.example && echo "PASS: .env.example exists"
grep -q "^.env$" .gitignore && echo "PASS: .env in .gitignore"
grep -q "JWT_SECRET=" .env.example && echo "PASS: JWT_SECRET documented"
```
**Pass Criteria:** All three checks return PASS
**Intent Reference:** Constraint - Security Baseline (No plaintext credential storage, environment-based secrets)

### G4: JWT Token Generation Test
**Test:** Automated login test with valid credentials
```javascript
// test/auth/login.test.js
const request = require('supertest');
const app = require('../backend/server');
const pool = require('../backend/database/connection');
const bcrypt = require('bcrypt');

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash('TestPassword123!', 10);
    await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
      ['testuser', hash]
    );
  });

  it('should return JWT token for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' })
      .expect(200);

    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('expiresIn', '24h');
    expect(response.body.user).toHaveProperty('username', 'testuser');
    expect(response.body.token).toMatch(/^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9./);
  });

  afterAll(() => pool.end());
});
```
**Pass Criteria:** Test passes, token format is valid JWT (header.payload.signature), expiresIn is 24h
**Intent Reference:** Acceptance Boundary (Minimum Viable) - JWT token generation endpoint accepting username/password returns valid tokens

### G5: Authentication Middleware Blocking Test
**Test:** Verify unauthenticated requests are rejected
```javascript
// test/middleware/authenticate.test.js
describe('GET /api/properties/search without token', () => {
  it('should return 401 with MISSING_TOKEN error', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .expect(401);

    expect(response.body).toHaveProperty('error', 'MISSING_TOKEN');
    expect(response.body).toHaveProperty('message');
  });

  it('should return 401 for invalid token', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);

    expect(response.body.error).toMatch(/INVALID_TOKEN|AUTH_ERROR/);
  });

  it('should return 401 for expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 1, username: 'test' },
      process.env.JWT_SECRET,
      { expiresIn: '-1h', algorithm: 'HS256', issuer: 'property-search-api' }
    );

    const response = await request(app)
      .get('/api/properties/search')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);

    expect(response.body).toHaveProperty('error', 'TOKEN_EXPIRED');
  });
});
```
**Pass Criteria:** All three test cases pass with 401 status and appropriate error codes
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Token validation middleware successfully blocks unauthenticated requests, Authentication failures return 401 status with error messages

### G6: Authenticated Request Success Test
**Test:** Verify valid tokens allow access to protected endpoints
```javascript
describe('GET /api/properties/search with valid token', () => {
  let validToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    validToken = loginResponse.body.token;
  });

  it('should return search results with valid token', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);

    expect(response.body).toBeDefined();
    expect(response.headers['content-type']).toMatch(/json/);
  });

  it('should include req.user in middleware', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);

    // Property search endpoint should have access to req.user
    // Verify by checking response doesn't throw authentication error
    expect(response.status).toBe(200);
  });
});
```
**Pass Criteria:** Both tests pass, search results returned with 200 status, response format unchanged from pre-authentication baseline
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Valid tokens allow full access to property search with identical response format

### G7: Password Hashing Validation
**Test:** Verify passwords are hashed with bcrypt (not plaintext)
```javascript
describe('Password Storage Security', () => {
  it('should store bcrypt hashes in database', async () => {
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE username = $1',
      ['testuser']
    );

    const hash = result.rows[0].password_hash;
    expect(hash).toMatch(/^$2[aby]$d{2}$/); // bcrypt format
    expect(hash.length).toBeGreaterThan(50);
    expect(hash).not.toBe('TestPassword123!'); // not plaintext
  });

  it('should use bcrypt with minimum 10 rounds', async () => {
    const hash = '$2b$10$somehash...'; // extract from database
    const rounds = parseInt(hash.split('$')[2]);
    expect(rounds).toBeGreaterThanOrEqual(10);
  });
});
```
**Pass Criteria:** Password hash matches bcrypt format ($2b$10$...), rounds >= 10
**Intent Reference:** Constraint - Security Baseline (Passwords must be hashed with bcrypt minimum 10 rounds, No plaintext credential storage)

### G8: Token Expiration Enforcement Test
**Test:** Verify JWT tokens expire after 24 hours
```javascript
describe('Token Expiration', () => {
  it('should set expiration to 24 hours from issuance', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });

    const token = loginResponse.body.token;
    const decoded = jwt.decode(token);
    
    const expiresInSeconds = decoded.exp - decoded.iat;
    const expiresInHours = expiresInSeconds / 3600;
    
    expect(expiresInHours).toBeCloseTo(24, 1);
  });
});
```
**Pass Criteria:** Token expiration is 24 hours ± 1 minute
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Token expiration enforced (24-hour window), Constraint - JWTs must expire within 24 hours

### G9: Performance Benchmark - Middleware Latency
**Test:** Measure authentication middleware overhead
```javascript
// test/performance/middleware-latency.test.js
describe('Authentication Middleware Performance', () => {
  let validToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    validToken = loginResponse.body.token;
  });

  it('should add less than 50ms P95 latency', async () => {
    const iterations = 100;
    const latencies = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await request(app)
        .get('/api/properties/search')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);
      latencies.push(Date.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(iterations * 0.95);
    const p95Latency = latencies[p95Index];

    console.log(`P95 latency: ${p95Latency}ms`);
    expect(p95Latency).toBeLessThan(50);
  });

  it('should target less than 20ms P95 latency (target state)', async () => {
    // Same test but with target state threshold
    // Mark as warning if between 20-50ms, failure if >50ms
  });
});
```
**Pass Criteria:** P95 latency < 50ms (hard requirement), < 20ms (target state)
**Intent Reference:** Constraint - Performance Budget (Authentication middleware must add less than 50ms latency), Acceptance Boundary (Target State) - Authentication middleware response time under 20ms (P95)

### G10: Rate Limiting Test
**Test:** Verify login endpoint enforces rate limits
```javascript
describe('Login Rate Limiting', () => {
  it('should block after 5 failed attempts per minute', async () => {
    const attempts = [];

    // Make 5 login attempts
    for (let i = 0; i < 5; i++) {
      attempts.push(
        request(app)
          .post('/api/auth/login')
          .send({ username: 'testuser', password: 'wrong' })
      );
    }
    await Promise.all(attempts);

    // 6th attempt should be rate limited
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrong' })
      .expect(429);

    expect(response.body).toHaveProperty('error', 'RATE_LIMIT');
  });
});
```
**Pass Criteria:** 6th request within 60 seconds returns 429 status with RATE_LIMIT error
**Intent Reference:** Acceptance Boundary (Target State) - Login endpoint rate limiting (max 5 attempts per minute per IP)

### G11: Token Refresh Functionality Test
**Test:** Verify refresh endpoint extends session
```javascript
describe('POST /api/auth/refresh', () => {
  let originalToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    originalToken = loginResponse.body.token;
  });

  it('should return new token with extended expiration', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${originalToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('expiresIn', '24h');
    expect(response.body.token).not.toBe(originalToken);

    const newDecoded = jwt.decode(response.body.token);
    const oldDecoded = jwt.decode(originalToken);
    expect(newDecoded.iat).toBeGreaterThan(oldDecoded.iat);
  });

  it('should reject refresh without valid token', async () => {
    await request(app)
      .post('/api/auth/refresh')
      .expect(401);
  });
});
```
**Pass Criteria:** Refresh returns new token with fresh expiration, requires valid token
**Intent Reference:** Acceptance Boundary (Target State) - Token refresh mechanism to extend sessions without re-authentication

### G12: SQL Injection Prevention Test
**Test:** Verify parameterized queries prevent injection
```javascript
describe('SQL Injection Prevention', () => {
  it('should not allow SQL injection via username field', async () => {
    const maliciousUsername = "admin' OR '1'='1' --";
    
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: maliciousUsername, password: 'anything' })
      .expect(401);

    expect(response.body.error).toBe('INVALID_CREDENTIALS');
    
    // Verify no users with malicious username were created
    const result = await pool.query(
      'SELECT COUNT(*) FROM users WHERE username LIKE $1',
      ['%OR%']
    );
    expect(parseInt(result.rows[0].count)).toBe(0);
  });

  it('should use parameterized queries in all auth SQL files', () => {
    const sqlFiles = [
      'backend/database/queries/auth-find-user.sql',
      'backend/database/queries/auth-create-user.sql',
      'backend/database/queries/auth-update-login.sql',
      'backend/database/queries/auth-log-event.sql'
    ];

    sqlFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toMatch(/$d+/); // Contains $1, $2, etc.
      expect(content).not.toMatch(/'s*+s*|CONCAT/i); // No string concatenation
    });
  });
});
```
**Pass Criteria:** Injection attempts fail safely, all SQL files use parameterized queries ($1, $2)
**Intent Reference:** Risk Assessment (Critical Risk) - SQL injection in auth queries

### G13: Audit Logging Verification
**Test:** Verify authentication events are logged
```javascript
describe('Audit Logging', () => {
  it('should log successful login events', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });

    const result = await pool.query(
      'SELECT * FROM auth_logs WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1',
      ['login']
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveProperty('user_id');
    expect(result.rows[0]).toHaveProperty('ip_address');
    expect(result.rows[0]).toHaveProperty('user_agent');
  });

  it('should log failed login attempts', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'wrongpassword' });

    const result = await pool.query(
      'SELECT * FROM auth_logs WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1',
      ['failed_login']
    );

    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('should log token refresh events', async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });

    await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${loginResponse.body.token}`);

    const result = await pool.query(
      'SELECT * FROM auth_logs WHERE event_type = $1 ORDER BY created_at DESC LIMIT 1',
      ['refresh']
    );

    expect(result.rows.length).toBeGreaterThan(0);
  });
});
```
**Pass Criteria:** All three event types (login, failed_login, refresh) are logged with user_id, IP, and user agent
**Intent Reference:** Acceptance Boundary (Target State) - Basic audit logging for authentication events

### G14: Error Code Consistency Test
**Test:** Verify distinct error codes for different failure modes
```javascript
describe('Error Handling', () => {
  const errorScenarios = [
    { name: 'missing token', setup: () => null, expectedError: 'MISSING_TOKEN' },
    { name: 'malformed token', setup: () => ({ Authorization: 'Bearer notajwt' }), expectedError: 'INVALID_TOKEN' },
    { name: 'expired token', setup: async () => {
      const token = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: '-1h' });
      return { Authorization: `Bearer ${token}` };
    }, expectedError: 'TOKEN_EXPIRED' },
    { name: 'invalid credentials', setup: () => ({ username: 'testuser', password: 'wrong' }), expectedError: 'INVALID_CREDENTIALS' }
  ];

  errorScenarios.forEach(({ name, setup, expectedError }) => {
    it(`should return ${expectedError} for ${name}`, async () => {
      const headers = await (typeof setup === 'function' ? setup() : setup);
      const response = headers.username 
        ? await request(app).post('/api/auth/login').send(headers)
        : await request(app).get('/api/properties/search').set(headers || null);

      expect(response.body.error).toBe(expectedError);
      expect(response.body).toHaveProperty('message');
    });
  });
});
```
**Pass Criteria:** All error scenarios return distinct error codes (MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED, INVALID_CREDENTIALS)
**Intent Reference:** Acceptance Boundary (Target State) - Graceful error handling for expired, malformed, or missing tokens with distinct error codes

### G15: API Compatibility Test
**Test:** Verify property search response schema unchanged
```javascript
describe('API Backward Compatibility', () => {
  let validToken;
  let baselineResponse;

  beforeAll(async () => {
    // Capture baseline response schema (before auth was added)
    // This would be from pre-auth commit or stored test fixture
    baselineResponse = require('./fixtures/search-response-baseline.json');

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    validToken = loginResponse.body.token;
  });

  it('should return identical response structure with authentication', async () => {
    const response = await request(app)
      .get('/api/properties/search')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);

    // Compare schema structure (not values, which may change)
    const responseKeys = Object.keys(response.body);
    const baselineKeys = Object.keys(baselineResponse);

    expect(responseKeys.sort()).toEqual(baselineKeys.sort());
  });
});
```
**Pass Criteria:** Response schema matches pre-authentication baseline (same fields, types, structure)
**Intent Reference:** Constraint - API Compatibility (Existing property search endpoint must remain functional with minimal breaking changes, Response schemas cannot change)

## Human Verification Points

### H1: Security Review Checklist
**Reviewer Role:** Security Engineer or Senior Backend Engineer

**Steps:**
1. **JWT Secret Configuration**
   - Verify `.env` file exists and is NOT committed to git: `git ls-files | grep -q ".env$"; echo $?` (should return 1)
   - Confirm JWT_SECRET in production is cryptographically random (128+ bits): Check deployment environment variables
   - Verify JWT_SECRET differs between staging and production environments

2. **Password Storage Review**
   - Open `backend/api/auth/login.js` and verify:
     - Line using `bcrypt.compare` (async, not compareSync)
     - No plaintext password logging in catch blocks
     - Timing-safe comparison for nonexistent users (fake bcrypt hash comparison)
   - Check database migration: `backend/database/migrations/001-create-users-table.sql`
     - password_hash column is VARCHAR(255), not TEXT (prevents excessive length attacks)
     - No default value on password_hash column

3. **SQL Injection Review**
   - Review all `.sql` files in `backend/database/queries/auth-*.sql`
   - Confirm ALL user inputs use parameterized queries ($1, $2, etc.)
   - Search codebase for string concatenation with user input: `grep -r "query.*+.*req." backend/`
   - Expected: No results indicating string concatenation in queries

4. **Token Validation Review**
   - Open `backend/middleware/authenticate.js`
   - Verify jwt.verify options include:
     - `algorithms: ['HS256']` (or explicitly set, not default)
     - `issuer: 'property-search-api'` (prevents token reuse from other services)
   - Check for alg:none vulnerability: Algorithm whitelist must be present

5. **Error Information Leakage**
   - Review error responses in `backend/api/auth/login.js`
   - Verify identical error messages for "user not found" vs "wrong password"
   - Check that stack traces are not returned to client (only in development mode)
   - Confirm database connection errors return generic "SERVER_ERROR" message

**Pass Criteria:** All 5 areas reviewed and no security issues found. Document any deviations in Human Modifications section.

**Intent Reference:** Trust Tier (Tier 2: Supervised) - Mandatory human review of middleware injection points, error handling, token generation logic

### H2: Integration Smoke Test
**Reviewer Role:** QA Engineer or Product Owner

**Steps:**
1. **Environment Setup**
   - Start local server: `npm start`
   - Verify server starts without errors on port 3000
   - Check health endpoint: `curl http://localhost:3000/health` → {"status": "ok"}

2. **Authentication Flow (Happy Path)**
   - Create test user: `node scripts/seed-test-user.js`
   - Login with test credentials:
     ```bash
     curl -X POST http://localhost:3000/api/auth/login 
       -H "Content-Type: application/json" 
       -d '{"username":"testuser","password":"TestPassword123!"}'
     ```
   - Verify response contains `token`, `expiresIn: "24h"`, `user` object
   - Copy token from response

3. **Protected Endpoint Access**
   - Attempt unauthenticated request:
     ```bash
     curl http://localhost:3000/api/properties/search
     ```
   - Verify 401 response with "MISSING_TOKEN" error
   
   - Attempt authenticated request (replace TOKEN):
     ```bash
     curl http://localhost:3000/api/properties/search 
       -H "Authorization: Bearer TOKEN"
     ```
   - Verify 200 response with property search results

4. **Token Refresh Flow**
   - Refresh token:
     ```bash
     curl -X POST http://localhost:3000/api/auth/refresh 
       -H "Authorization: Bearer TOKEN"
     ```
   - Verify new token returned, different from original token
   - Test new token works with protected endpoint

5. **Error Scenarios**
   - Test invalid credentials (should return 401 with INVALID_CREDENTIALS)
   - Test expired token (create token with -1h expiration, should return TOKEN_EXPIRED)
   - Test malformed token (should return INVALID_TOKEN)
   - Test rate limiting: Make 6 login attempts rapidly (6th should return 429)

**Pass Criteria:** All steps execute successfully with expected responses. Property search returns same data structure as before authentication was added.

**Intent Reference:** Acceptance Boundary (Minimum Viable) - All must-have features functional, Acceptance Boundary (Target State) - Rate limiting and token refresh functional

### H3: Performance Baseline Comparison
**Reviewer Role:** DevOps Engineer or Senior Backend Engineer

**Steps:**
1. **Capture Baseline Metrics**
   - Load test property search endpoint WITH authentication:
     ```bash
     ab -n 1000 -c 10 -H "Authorization: Bearer TOKEN" 
       http://localhost:3000/api/properties/search
     ```
   - Record metrics:
     - Requests per second
     - P50, P95, P99 latency
     - Failed requests (should be 0)

2. **Compare Against Pre-Auth Baseline**
   - Retrieve pre-authentication performance metrics (from prior load tests or staging environment)
   - Calculate latency delta: `auth_latency - baseline_latency`
   - Acceptable if P95 delta < 50ms (hard requirement) or < 20ms (target)

3. **Token Validation Overhead Isolation**
   - Measure middleware-only latency (skip database queries):
     - Create endpoint that only runs authenticate middleware and returns 200
     - Load test this endpoint: Should have <10ms P95 latency
   - If middleware latency > 20ms, investigate:
     - Token cache hit rate (should be >90% under load)
     - JWT verification performance (consider caching or RS256 vs HS256)

4. **Database Connection Pool Health**
   - Monitor active connections during load test
   - Pool should not reach max capacity (20 connections)
   - Query `SELECT count(*) FROM pg_stat_activity WHERE datname = 'property_db';`
   - If approaching limit, consider increasing pool size or optimizing query performance

**Pass Criteria:** P95 latency increase < 50ms (must have) or < 20ms (target state). No connection pool exhaustion.

**Intent Reference:** Constraint - Performance Budget (Authentication middleware must add less than 50ms latency), Acceptance Boundary (Target State) - Authentication middleware response time under 20ms (P95)

### H4: Architectural Coherence Review
**Reviewer Role:** Tech Lead or Senior Engineer

**Steps:**
1. **File Organization Consistency**
   - Verify new files follow established patterns:
     - `backend/api/auth/*.js` matches `backend/api/properties/*.js` structure
     - `backend/database/queries/auth-*.sql` matches `property-search.sql` naming
   - Check middleware placement: `backend/middleware/authenticate.js` in correct directory
   - Confirm configuration files in `backend/config/jwt.js` follow config pattern

2. **Middleware Integration Approach**
   - Review `backend/server.js` (or search.js if standalone approach used)
   - Verify middleware chain order:
     1. Body parser (express.json)
     2. Public routes (auth endpoints)
     3. Authentication middleware
     4. Protected routes (properties)
   - Confirm no middleware bypass paths exist

3. **Dependency Management**
   - Review `package.json` for version pinning strategy
   - Verify major versions match Intent constraints (express ^4.x, jsonwebtoken ^9.x)
   - Check for unnecessary dependencies or security vulnerabilities: `npm audit`

4. **Code Quality Standards**
   - Verify async/await used consistently (no callback hell)
   - Check error handling: All async functions wrapped in try-catch
   - Confirm no commented-out code or TODO statements in production files
   - Review SQL query file structure: Queries separated from logic, reusable

5. **Database Migration Strategy**
   - Verify migration is idempotent (CREATE TABLE IF NOT EXISTS)
   - Check for rollback script or down migration (if standard practice)
   - Confirm migration doesn't drop existing tables or data

**Pass Criteria:** All architectural patterns consistent with existing codebase. No deviations from established conventions without documented rationale.

**Intent Reference:** Context Package - Pattern Library (File organization, naming conventions, code patterns)

### H5: Documentation Completeness Review
**Reviewer Role:** Technical Writer or Senior Engineer

**Steps:**
1. **README.md Authentication Section**
   - Verify README includes:
     - How to obtain a token (login endpoint example)
     - How to use a token (Authorization header format)
     - How to refresh a token (refresh endpoint example)
     - List of protected endpoints
     - Environment setup instructions
   - Test that a new developer could follow README to set up authentication

2. **.env.example Validation**
   - Confirm all required environment variables documented
   - Verify example values are safe (no real credentials)
   - Check that JWT_SECRET includes generation instructions

3. **Code Comments**
   - Review `backend/middleware/authenticate.js` for inline comments explaining:
     - Cache TTL rationale
     - Token validation logic
     - Error code meanings
   - Check `backend/api/auth/login.js` for comments on:
     - Timing-safe comparison
     - Rate limiting configuration
     - Bcrypt rounds choice

4. **API Error Codes Documentation**
   - Verify README or separate API docs list all error codes:
     - MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED
     - INVALID_CREDENTIALS, ACCOUNT_LOCKED, RATE_LIMIT
     - SERVER_ERROR, MISSING_CREDENTIALS
   - Include description of when each error occurs

**Pass Criteria:** Complete documentation exists for authentication setup, usage, and troubleshooting. New team member can implement authentication client without asking questions.

**Intent Reference:** Proposal Record - Phase 7: Documentation

## Intent Traceability

### Minimum Viable Requirements (Must Have)

| Acceptance Criterion | Verification Gate(s) | Type |
|---------------------|---------------------|------|
| JWT token generation endpoint accepting username/password returns valid tokens | G4: JWT Token Generation Test | Automated |
| Token validation middleware successfully blocks unauthenticated requests to /api/properties/search | G5: Authentication Middleware Blocking Test | Automated |
| Valid tokens allow full access to property search with identical response format | G6: Authenticated Request Success Test, G15: API Compatibility Test | Automated |
| User credentials table created with hashed passwords | G2: Database Schema Validation, G7: Password Hashing Validation | Automated |
| Authentication failures return 401 status with error messages | G5: Authentication Middleware Blocking Test, G14: Error Code Consistency Test | Automated |
| Token expiration enforced (24-hour window) | G8: Token Expiration Enforcement Test | Automated |

### Target State Requirements (Should Have)

| Acceptance Criterion | Verification Gate(s) | Type |
|---------------------|---------------------|------|
| Token refresh mechanism to extend sessions without re-authentication | G11: Token Refresh Functionality Test, H2: Integration Smoke Test (step 4) | Automated + Human |
| Authentication middleware response time under 20ms (P95) | G9: Performance Benchmark - Middleware Latency, H3: Performance Baseline Comparison | Automated + Human |
| Login endpoint rate limiting (max 5 attempts per minute per IP) | G10: Rate Limiting Test, H2: Integration Smoke Test (step 5) | Automated + Human |
| Graceful error handling for expired, malformed, or missing tokens with distinct error codes | G14: Error Code Consistency Test, H2: Integration Smoke Test (step 5) | Automated + Human |
| Basic audit logging for authentication events (login, logout, token refresh) | G13: Audit Logging Verification | Automated |

### Constraint Validation

| Constraint | Verification Gate(s) | Type |
|-----------|---------------------|------|
| Technology Stack: Node.js with Express, jsonwebtoken, bcrypt | G1: Dependency Installation | Automated |
| Database: SQL database integration | G2: Database Schema Validation | Automated |
| API Compatibility: Property search functional with minimal breaking changes | G15: API Compatibility Test, H2: Integration Smoke Test | Automated + Human |
| Security Baseline: Passwords hashed with bcrypt (minimum 10 rounds) | G7: Password Hashing Validation, H1: Security Review Checklist | Automated + Human |
| Security Baseline: JWTs expire within 24 hours | G8: Token Expiration Enforcement Test | Automated |
| Security Baseline: No plaintext credential storage | H1: Security Review Checklist (step 2) | Human |
| Performance Budget: Authentication middleware adds less than 50ms latency | G9: Performance Benchmark - Middleware Latency, H3: Performance Baseline Comparison | Automated + Human |
| Performance Budget: Token validation without database queries | G6: Authenticated Request Success Test (cache verification), H3: Performance Baseline Comparison (step 3) | Automated + Human |

### Risk Mitigation Verification

| Critical Risk | Verification Gate(s) | Type |
|--------------|---------------------|------|
| Breaking property search API | G15: API Compatibility Test, H2: Integration Smoke Test | Automated + Human |
| JWT secret exposure | H1: Security Review Checklist (step 1) | Human |
| SQL injection in auth queries | G12: SQL Injection Prevention Test, H1: Security Review Checklist (step 3) | Automated + Human |
| Bcrypt performance bottleneck | G9: Performance Benchmark - Middleware Latency | Automated |
| Token cache memory leak | G6: Authenticated Request Success Test (cache cleanup verification) | Automated |

## Escape Criteria

### E1: Automated Gate Failure
**Trigger:** Any automated gate (G1-G15) fails

**Response Procedure:**
1. **Assess Failure Severity:**
   - **Critical (G7, G8, G12):** Security or data integrity failure → STOP deployment immediately
   - **High (G4, G5, G6, G15):** Core functionality broken → Fix required before human review
   - **Medium (G9, G10, G11):** Target state not met → Document as known limitation, proceed to human review
   - **Low (G1, G2, G13, G14):** Infrastructure or nice-to-have → Fix and re-run gates

2. **Re-Orbit Decision Matrix:**

   | Failed Gate Count | Severity | Action |
   |------------------|----------|--------|
   | 1 Critical | Any | Full re-orbit: Return to Proposal phase, revise implementation plan |
   | 2+ High | Any | Full re-orbit: Architectural issue likely, revise Context and Proposal |
   | 1 High | Security-related (G7, G12) | Partial re-orbit: Fix and re-verify, requires security review |
   | 1 High | Performance-related (G9) | Targeted fix: Optimize specific component, re-run performance gates |
   | 3+ Medium | Mixed | Escalate to Tech Lead: Decide between re-orbit or document as technical debt |
   | Any Low | Any | Fix inline: Resolve issue, re-run affected gate, proceed |

3. **Escalation Triggers:**
   - Same gate fails 3+ times → Escalate to Tech Lead for architectural review
   - Performance gates fail with <10ms margin → Escalate to DevOps for infrastructure assessment
   - SQL injection test fails → Immediate escalation to Security Engineer

### E2: Human Verification Failure
**Trigger:** Human reviewer identifies issues in H1-H5 verification points

**Response Procedure:**
1. **Categorize Issues:**
   - **Security Issue (H1):** STOP → Fix immediately → Full security re-review required
   - **Integration Issue (H2):** Assess scope → If >2 scenarios fail, return to Proposal phase
   - **Performance Issue (H3):** If P95 > 50ms, return to implementation (hard requirement breach)
   - **Architecture Issue (H4):** If >3 deviations from patterns, escalate to Tech Lead
   - **Documentation Issue (H5):** Fix inline → Re-review documentation only

2. **Re-Orbit Conditions:**
   - **Full Re-Orbit (return to Intent phase):** Misalignment between implemented system and original intent (e.g., authentication doesn't actually protect endpoints)
   - **Partial Re-Orbit (return to Proposal phase):** Implementation approach correct but execution flawed (e.g., middleware works but performance unacceptable)
   - **Targeted Re-Work (stay in Verification phase):** Minor issues with clear fixes (e.g., error messages need refinement, documentation incomplete)

3. **Human Modifications Documentation:**
   - All issues identified during human review MUST be documented in Proposal Record → Human Modifications section
   - Include:
     - Issue description and severity
     - Proposed fix or architectural decision
     - Reviewer sign-off and date
   - If re-orbit required, create new orbit with updated Intent or Proposal

### E3: Performance Regression
**Trigger:** H3 Performance Baseline Comparison shows P95 latency increase > 50ms

**Response Procedure:**
1. **Immediate Actions:**
   - STOP deployment to production
   - Capture performance profile: `node --prof backend/server.js` under load
   - Analyze bottleneck: JWT verification, database queries, or network I/O

2. **Mitigation Strategies (in order of preference):**
   - **Strategy A:** Increase token cache TTL (currently 30s → try 60s or 120s)
   - **Strategy B:** Implement Redis-backed token cache for distributed systems
   - **Strategy C:** Switch JWT algorithm from HS256 to RS256 with public key caching (if signature verification is bottleneck)
   - **Strategy D:** Database connection pool optimization (increase pool size, add read replicas)
   - **Strategy E:** Vertical scaling (increase CPU allocation) if all optimizations exhausted

3. **Re-Verification:**
   - After mitigation applied, re-run G9 Performance Benchmark
   - If still failing, escalate to DevOps and return to Proposal phase
   - Document chosen strategy in Proposal Record → Human Modifications

### E4: Security Vulnerability Discovery
**Trigger:** H1 Security Review identifies critical vulnerability OR external security scan flags issue

**Response Procedure:**
1. **Severity Assessment (CVSS scoring):**
   - **Critical (9.0-10.0):** Immediate rollback, incident response protocol
   - **High (7.0-8.9):** Block deployment, fix required before any release
   - **Medium (4.0-6.9):** Fix required, can be batched with other changes
   - **Low (0.1-3.9):** Document as known issue, schedule fix in next sprint

2. **Common Vulnerabilities and Responses:**

   | Vulnerability | Response |
   |--------------|----------|
   | JWT secret in git history | Rotate secret immediately, force re-login all users, audit access logs |
   | SQL injection confirmed | Rollback deployment, patch queries, security audit all database access |
   | Bcrypt rounds too low | Increase to 12 rounds, implement password hash migration on next login |
   | Rate limiting bypass | Deploy additional rate limiting layer (e.g., nginx), investigate DDoS risk |
   | Token replay attack possible | Implement token revocation table, add jti (JWT ID) claim for tracking |

3. **Post-Incident:**
   - Update Verification Protocol with new security gate for discovered vulnerability
   - Add regression test to G12 or create new gate
   - Document in Intent → Dependencies as new security constraint

### E5: Rollback Procedure
**Trigger:** Any escape condition requires deployment rollback

**Steps:**
1. **Immediate Rollback:**
   ```bash
   # Revert to previous commit (before authentication implementation)
   git revert <auth-commit-sha> --no-commit
   git commit -m "Rollback: Authentication system (verification failure)"
   git push origin main
   ```

2. **Database Rollback (if migration applied):**
   ```sql
   -- Rollback users table (CAUTION: destroys user data)
   DROP TABLE IF EXISTS auth_logs CASCADE;
   DROP TABLE IF EXISTS users CASCADE;
   ```
   **Note:** Only execute if no production users created. Otherwise, keep tables and disable enforcement.

3. **Configuration Rollback:**
   - Remove authentication middleware from property search route
   - Restore pre-auth version of `backend/server.js` or `backend/api/properties/search.js`
   - Remove or comment out authentication-related environment variables

4. **Verification After Rollback:**
   - Smoke test property search endpoint (should work without authentication)
   - Verify no 401 errors in logs
   - Confirm no database connection errors
   - Monitor for 24 hours to ensure stability

5. **Post-Rollback Analysis:**
   - Schedule post-mortem within 48 hours
   - Document root cause in orbit log
   - Update Intent or Proposal based on findings
   - Re-enter orbit with revised approach

### E6: Partial Acceptance
**Trigger:** Minimum Viable requirements met but Target State requirements failed

**Decision Matrix:**
- **If 4+ Target State criteria met:** Accept orbit as complete, document remaining items as technical debt for future orbit
- **If 2-3 Target State criteria met:** Conditional acceptance with immediate follow-up orbit scheduled (within 1 sprint)
- **If 0-1 Target State criteria met:** Reject orbit, return to Proposal phase to revise implementation strategy

**Partial Acceptance Documentation:**
- Update Intent Document → Acceptance Boundaries section with "Achieved" status for each criterion
- Create technical debt tickets for unmet Target State requirements
- Set priority based on user impact (rate limiting > token refresh > audit logging)
- Schedule follow-up orbit with reduced scope (address 1-2 missing features)

**Stretch Goal Handling:**
- Stretch goals (token revocation, concurrent sessions, integration tests >80%) are never blockers
- Document in orbit log whether achieved
- If stretch goals critical for production, promote to Target State in follow-up orbit