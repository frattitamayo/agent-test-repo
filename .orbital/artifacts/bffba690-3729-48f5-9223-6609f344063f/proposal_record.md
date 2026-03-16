# Proposal Record: Implement User Authentication System

## Interpreted Intent

This orbit introduces JWT-based authentication to protect the existing property search API while maintaining full backward compatibility for authenticated users. The system must validate user credentials, issue time-limited tokens, and enforce authentication on API endpoints without degrading performance or breaking existing functionality.

The implementation addresses three core capabilities:
1. **Credential validation** — Users authenticate with username/password, receive JWT tokens valid for 24 hours
2. **Request authorization** — Middleware intercepts API calls, validates tokens, blocks unauthorized access with 401 responses
3. **Session management** — Token refresh mechanism extends sessions without re-entering credentials

The constraint boundary is strict: no UI work, no password recovery, no role systems beyond authenticated/unauthenticated states. Performance must stay under 50ms added latency (target 20ms). Security follows industry standards: bcrypt hashing (10+ rounds), no plaintext storage, environment-based secrets.

The tier 2 (supervised) assignment recognizes this is security-critical infrastructure requiring human review before deployment, but the implementation pattern is well-established enough for autonomous execution.

## Implementation Plan

### Phase 1: Infrastructure Setup (Prerequisite Work)

**1.1 Create package.json**
```json
{
  "name": "property-search-api",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "express-rate-limit": "^7.1.5",
    "dotenv": "^16.3.1"
  }
}
```
**Rationale:** Repository lacks dependency manifest. Express version chosen for stability; jsonwebtoken 9.x includes security patches; bcrypt 5.x supports async operations; express-rate-limit 7.x has per-route configuration.

**1.2 Create backend/database/connection.js**
```javascript
const { Pool } = require('pg'); // or mysql2 based on actual database
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

module.exports = pool;
```
**Rationale:** Centralized connection pool required for auth queries. Pooling ensures concurrent login requests don't exhaust connections. Configuration via environment variables per security baseline.

**1.3 Create .env.example**
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=property_db
DB_USER=api_user
DB_PASSWORD=changeme
JWT_SECRET=generate_with_openssl_rand_hex_64
JWT_EXPIRATION=24h
NODE_ENV=development
```
**Rationale:** Documents required environment variables. JWT_SECRET must be cryptographically random (not committed). .env added to .gitignore.

**1.4 Create backend/config/jwt.js**
```javascript
require('dotenv').config();

module.exports = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRATION || '24h',
  algorithm: 'HS256',
  issuer: 'property-search-api',
};
```
**Rationale:** Centralized JWT configuration. Algorithm explicitly set to HS256 (prevents downgrade attacks). Issuer claim enables multi-service token validation.

### Phase 2: Database Schema (Migration)

**2.1 Create backend/database/migrations/001-create-users-table.sql**
```sql
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);

-- Optional audit log table for target state
CREATE TABLE IF NOT EXISTS auth_logs (
  log_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id),
  event_type VARCHAR(20) NOT NULL, -- 'login', 'logout', 'refresh', 'failed_login'
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_logs_user_id ON auth_logs(user_id);
CREATE INDEX idx_auth_logs_created_at ON auth_logs(created_at);
```
**Rationale:** 
- VARCHAR(255) for password_hash accommodates bcrypt output ($2b$10$..., 60 chars) with future algorithm headroom
- Username index accelerates login lookups (primary query path)
- login_attempts and locked_until support rate limiting and brute force protection
- auth_logs table enables audit logging (target state requirement)

**2.2 Create backend/database/queries/auth-find-user.sql**
```sql
SELECT user_id, username, password_hash, login_attempts, locked_until
FROM users
WHERE username = $1;
```

**2.3 Create backend/database/queries/auth-create-user.sql**
```sql
INSERT INTO users (username, password_hash)
VALUES ($1, $2)
RETURNING user_id, username, created_at;
```

**2.4 Create backend/database/queries/auth-update-login.sql**
```sql
UPDATE users
SET last_login = CURRENT_TIMESTAMP,
    login_attempts = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = $1;
```

**2.5 Create backend/database/queries/auth-log-event.sql**
```sql
INSERT INTO auth_logs (user_id, event_type, ip_address, user_agent)
VALUES ($1, $2, $3, $4);
```

### Phase 3: Authentication Middleware (Core Component)

**3.1 Create backend/middleware/authenticate.js**
```javascript
const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');

// In-memory token cache (TTL: 30 seconds)
const tokenCache = new Map();
const CACHE_TTL = 30000;

function authenticate(req, res, next) {
  const startTime = Date.now();
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'MISSING_TOKEN',
      message: 'Authorization header with Bearer token required'
    });
  }

  const token = authHeader.substring(7);
  
  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && Date.now() < cached.expiry) {
    req.user = cached.payload;
    return next();
  }

  // Verify token
  jwt.verify(token, jwtConfig.secret, {
    algorithms: [jwtConfig.algorithm],
    issuer: jwtConfig.issuer
  }, (err, decoded) => {
    const elapsed = Date.now() - startTime;
    
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Token has expired',
          expiredAt: err.expiredAt
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'INVALID_TOKEN',
          message: 'Token is malformed or invalid'
        });
      }
      return res.status(401).json({
        error: 'AUTH_ERROR',
        message: 'Authentication failed'
      });
    }

    // Cache valid token
    tokenCache.set(token, {
      payload: decoded,
      expiry: Date.now() + CACHE_TTL
    });

    // Clean expired cache entries (every 100 requests)
    if (Math.random() < 0.01) {
      const now = Date.now();
      for (const [key, value] of tokenCache.entries()) {
        if (now >= value.expiry) tokenCache.delete(key);
      }
    }

    req.user = decoded;
    next();
  });
}

module.exports = authenticate;
```
**Rationale:**
- Token caching reduces JWT verification overhead (signature check is CPU-intensive)
- 30-second cache TTL balances performance vs token revocation latency
- Distinct error codes (MISSING_TOKEN, TOKEN_EXPIRED, INVALID_TOKEN) enable client-side retry logic
- Algorithm whitelist prevents alg:none attacks
- Issuer validation prevents token reuse from other services

### Phase 4: Authentication Endpoints

**4.1 Create backend/api/auth/login.js**
```javascript
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../../database/connection');
const jwtConfig = require('../../config/jwt');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Rate limiter: 5 attempts per minute per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'RATE_LIMIT', message: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Load SQL queries
const findUserQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/auth-find-user.sql'),
  'utf8'
);
const updateLoginQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/auth-update-login.sql'),
  'utf8'
);
const logEventQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/auth-log-event.sql'),
  'utf8'
);

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  // Input validation
  if (!username || !password) {
    return res.status(400).json({
      error: 'MISSING_CREDENTIALS',
      message: 'Username and password required'
    });
  }

  try {
    // Look up user
    const result = await pool.query(findUserQuery, [username]);
    
    if (result.rows.length === 0) {
      // Timing-safe response (same delay as password check)
      await bcrypt.compare(password, '$2b$10$invalidhashtopreventtimingattack');
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password'
      });
    }

    const user = result.rows[0];

    // Check account lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({
        error: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked due to failed login attempts',
        locked_until: user.locked_until
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      // Log failed attempt
      await pool.query(logEventQuery, [
        user.user_id,
        'failed_login',
        req.ip,
        req.get('user-agent')
      ]);

      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password'
      });
    }

    // Generate JWT
    const payload = {
      userId: user.user_id,
      username: user.username,
      iat: Math.floor(Date.now() / 1000)
    };

    const token = jwt.sign(payload, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresIn,
      algorithm: jwtConfig.algorithm,
      issuer: jwtConfig.issuer
    });

    // Update last_login
    await pool.query(updateLoginQuery, [user.user_id]);

    // Log successful login
    await pool.query(logEventQuery, [
      user.user_id,
      'login',
      req.ip,
      req.get('user-agent')
    ]);

    res.json({
      token,
      expiresIn: jwtConfig.expiresIn,
      user: {
        userId: user.user_id,
        username: user.username
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Login failed due to server error'
    });
  }
});

module.exports = router;
```
**Rationale:**
- Rate limiting per IP prevents brute force (5 attempts/minute meets target state)
- Timing-safe comparison prevents username enumeration (always hash even if user doesn't exist)
- Account lockout mechanism supports future brute force protection
- SQL queries loaded from files maintains pattern consistency
- Audit logging captures IP and user agent for security monitoring
- Error responses use consistent structure with error codes

**4.2 Create backend/api/auth/refresh.js**
```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const jwtConfig = require('../../config/jwt');
const authenticate = require('../../middleware/authenticate');
const pool = require('../../database/connection');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const logEventQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/auth-log-event.sql'),
  'utf8'
);

router.post('/refresh', authenticate, async (req, res) => {
  try {
    // Generate new token with same payload but fresh expiration
    const payload = {
      userId: req.user.userId,
      username: req.user.username,
      iat: Math.floor(Date.now() / 1000)
    };

    const newToken = jwt.sign(payload, jwtConfig.secret, {
      expiresIn: jwtConfig.expiresIn,
      algorithm: jwtConfig.algorithm,
      issuer: jwtConfig.issuer
    });

    // Log refresh event
    await pool.query(logEventQuery, [
      req.user.userId,
      'refresh',
      req.ip,
      req.get('user-agent')
    ]);

    res.json({
      token: newToken,
      expiresIn: jwtConfig.expiresIn
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Token refresh failed'
    });
  }
});

module.exports = router;
```
**Rationale:** Refresh endpoint extends sessions without re-entering credentials (target state requirement). Requires valid token to prevent unauthorized token generation. Logs refresh events for audit trail.

### Phase 5: Integration with Existing API

**5.1 Refactor backend/api/properties/search.js**

Since search.js content is not visible, implementation depends on current structure. Two approaches:

**Approach A: Minimal modification (if search.js is standalone server)**
```javascript
// Add at top of search.js
const express = require('express');
const authenticate = require('../middleware/authenticate');
const loginRouter = require('./auth/login');
const refreshRouter = require('./auth/refresh');
require('dotenv').config();

const app = express();
app.use(express.json());

// Auth routes (unprotected)
app.use('/api/auth', loginRouter);
app.use('/api/auth', refreshRouter);

// Protected property search route
app.use('/api/properties/search', authenticate, (req, res) => {
  // Existing search logic here
  // req.user now available with authenticated user info
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

**Approach B: Centralized server file (recommended for scalability)**
Create **backend/server.js**:
```javascript
const express = require('express');
const authenticate = require('./middleware/authenticate');
const loginRouter = require('./api/auth/login');
const refreshRouter = require('./api/auth/refresh');
const searchRouter = require('./api/properties/search');
require('dotenv').config();

const app = express();

// Body parsing
app.use(express.json());

// Public routes
app.use('/api/auth', loginRouter);

// Protected routes
app.use('/api/properties', authenticate, searchRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

Refactor **backend/api/properties/search.js** to export router:
```javascript
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const pool = require('../../database/connection');

const searchQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/property-search.sql'),
  'utf8'
);

router.get('/search', async (req, res) => {
  // Existing search logic
  // req.user available from authenticate middleware
  try {
    const result = await pool.query(searchQuery, [/* params */]);
    res.json(result.rows);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
```

**Decision:** Approach B recommended. Centralizes middleware application, enables future route additions, maintains backward compatibility (same endpoint URLs).

### Phase 6: Testing & Verification Setup

**6.1 Create scripts/seed-test-user.js**
```javascript
const bcrypt = require('bcrypt');
const pool = require('../backend/database/connection');
const fs = require('fs');
const path = require('path');

const createUserQuery = fs.readFileSync(
  path.join(__dirname, '../backend/database/queries/auth-create-user.sql'),
  'utf8'
);

async function seedUser() {
  const username = 'testuser';
  const password = 'TestPassword123!';
  const hash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(createUserQuery, [username, hash]);
    console.log('Test user created:', result.rows[0]);
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      console.log('Test user already exists');
    } else {
      console.error('Error creating test user:', error);
    }
  } finally {
    await pool.end();
  }
}

seedUser();
```
**Rationale:** Automated test user creation for manual and automated testing. Documents test credentials.

**6.2 Create .gitignore additions**
```
.env
node_modules/
*.log
.DS_Store
```

### Phase 7: Documentation

**7.1 Update README.md**
Add authentication section:
```markdown
## Authentication

The API uses JWT bearer tokens for authentication.

### Getting a Token

POST /api/auth/login
Content-Type: application/json

{
  "username": "your_username",
  "password": "your_password"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": "24h",
  "user": {
    "userId": 1,
    "username": "your_username"
  }
}

### Using the Token

Include the token in the Authorization header:

Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

### Refreshing Tokens

POST /api/auth/refresh
Authorization: Bearer <current_token>

### Protected Endpoints

- GET /api/properties/search - Requires authentication

### Environment Setup

1. Copy .env.example to .env
2. Generate JWT secret: `openssl rand -hex 64`
3. Configure database connection
4. Run migration: `psql -U user -d dbname -f backend/database/migrations/001-create-users-table.sql`
5. Create test user: `node scripts/seed-test-user.js`
```

## Risk Surface

### Critical Risks & Mitigations

| Risk | Impact | Mitigation | Verification |
|------|--------|------------|--------------|
| **Search API breaks for existing clients** | HIGH | Phased rollout: Deploy auth system first, enforce middleware as opt-in flag, monitor error rates before full enforcement | Manual testing with/without auth header; load test comparison before/after |
| **JWT secret committed to git** | CRITICAL | .env in .gitignore; pre-commit hook checks for SECRET patterns; documentation emphasizes environment variables | Code review checklist; git history scan |
| **SQL injection in auth queries** | CRITICAL | All queries use parameterized statements ($1, $2); no string concatenation; code review focus on query construction | Automated SQL injection test suite; manual review of all .sql files |
| **Bcrypt blocks event loop** | MEDIUM | Use bcrypt.compare (async) exclusively; benchmark 10 rounds vs 12; reject login if P95 > 50ms | Load test with concurrent login requests; APM monitoring |
| **Token cache memory leak** | MEDIUM | Periodic cleanup (1% request probability); bounded cache size (max 10,000 tokens); TTL enforcement | Memory profiling under sustained load; cache metrics endpoint |

### Implementation Risks

| Risk | Mitigation |
|------|------------|
| **Database connection pool exhaustion** | Pool size 20 concurrent connections; connection timeout 2 seconds; monitor active connections |
| **Rate limiter bypassed via distributed IPs** | Consider username-based rate limiting (future); log all failed attempts for pattern detection |
| **Middleware ordering breaks body parsing** | Explicit middleware chain in server.js: body-parser → auth routes → authenticate → protected routes |
| **Token expiration causes unexpected logouts** | Clear error messages with expiredAt timestamp; client-side preemptive refresh (15 min before expiry) |
| **Audit log table grows unbounded** | Implement log rotation strategy (archive monthly); database size monitoring; retention policy (90 days) |

### Security Edge Cases

| Scenario | Handling |
|----------|----------|
| Token issued to deleted user | Token remains valid until expiration (24h max); implement token revocation table for immediate invalidation (stretch goal) |
| Concurrent logins from same user | Multiple valid tokens allowed; no session conflict (aligns with "multiple devices" requirement) |
| Password change during active session | Existing tokens remain valid; future: increment token version in users table, validate version in middleware |
| Replay attack with stolen token | HTTPS enforcement required (deployment concern); consider short-lived tokens (4h) with refresh flow |
| Username enumeration via timing | Constant-time response: always hash even for nonexistent users; identical error messages |

### Performance Edge Cases

| Scenario | Expected Behavior | Mitigation |
|----------|-------------------|------------|
| 1000 concurrent login requests | Database connection pool may saturate | Connection queue with timeout; horizontal scaling of database replicas |
| Token cache grows beyond memory | Bounded cache (10k entries); LRU eviction if limit exceeded | Implement cache size limit with Map.size check |
| Cold start after server restart | First request to each endpoint loads SQL files | Preload queries at startup; consider query compilation |
| Database replica lag | User logs in on primary, token fails on replica read | Use primary for auth queries; accept eventual consistency for audit logs |

## Scope Estimate

### Complexity Assessment: **MEDIUM**

**Factors:**
- Well-established pattern (JWT + bcrypt) with minimal architectural novelty
- Database schema addition is straightforward but requires coordination
- Integration point (search.js refactoring) has unknown complexity due to missing file content
- Security requirements increase review burden but not implementation complexity

### Orbit Breakdown

**Orbit 1: Infrastructure & Database (2-3 hours)**
- Create package.json, .env.example, connection.js, jwt config
- Write and test database migration
- Verify database connectivity
- **Exit Criteria:** Database schema created, connection pool functional, environment variables documented

**Orbit 2: Authentication Endpoints (3-4 hours)**
- Implement login.js with bcrypt validation
- Implement refresh.js with token regeneration
- Write SQL query files
- Unit test auth logic
- **Exit Criteria:** Login returns valid JWT, refresh extends token, rate limiting functional

**Orbit 3: Middleware & Integration (2-3 hours)**
- Implement authenticate.js with caching
- Refactor search.js or create server.js (depends on current structure)
- Apply middleware to property search endpoint
- **Exit Criteria:** Search endpoint blocks unauthenticated requests, accepts valid tokens with <50ms overhead

**Orbit 4: Testing & Documentation (2 hours)**
- Create seed-test-user.js script
- Manual integration testing
- Update README with auth documentation
- Performance benchmark (load test)
- **Exit Criteria:** Test user created, documentation complete, performance targets met

**Total Estimated Time:** 9-12 hours of development work

### Phased Deployment Strategy

**Phase 1 (Week 1):** Infrastructure + Database
- Deploy schema migration to staging
- Verify connection pool under load
- Create test users in staging environment

**Phase 2 (Week 1-2):** Auth Endpoints
- Deploy login/refresh endpoints to staging
- Integration test with curl/Postman
- Security review of token generation logic

**Phase 3 (Week 2):** Middleware Integration
- Deploy middleware to staging with feature flag (opt-in authentication)
- Monitor search endpoint performance with middleware active
- Run load tests comparing before/after latency

**Phase 4 (Week 2-3):** Production Rollout
- Enable authentication enforcement in production (after human review)
- Monitor error rates and authentication success rates
- Gradual rollout to user segments if client population is large

### Success Metrics

**Minimum Viable (Must Achieve):**
- Login endpoint returns JWT tokens with 100% success rate for valid credentials
- Authentication middleware blocks 100% of requests without valid tokens
- Property search functionality unchanged for authenticated users (0% regression)
- Authentication adds <50ms P95 latency to API calls

**Target State (Should Achieve):**
- Authentication middleware latency <20ms P95
- Rate limiting prevents >5 login attempts/minute
- Token refresh extends sessions without re-authentication
- Audit logs capture all authentication events

**Stretch Goals:**
- Integration test coverage >80%
- Token revocation capability for logout
- Authentication metrics dashboard

## Human Modifications

Pending human review.