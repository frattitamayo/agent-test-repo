# Context Package: Implement User Authentication System

## Codebase References

### Existing API Structure
- **backend/api/properties/search.js** — Current property search endpoint serving as reference for Express routing patterns and response handling. This file will need authentication middleware integration.
- **backend/database/queries/property-search.sql** — Demonstrates SQL query organization pattern. Authentication queries should follow this structure (e.g., `backend/database/queries/auth-*.sql`).

### Files to Create
- **backend/api/auth/login.js** — New login endpoint for JWT token generation
- **backend/api/auth/refresh.js** — Token refresh endpoint (target state requirement)
- **backend/middleware/authenticate.js** — JWT validation middleware to protect routes
- **backend/database/queries/auth-create-user.sql** — User credential insertion query
- **backend/database/queries/auth-find-user.sql** — User lookup for login validation
- **backend/database/migrations/001-create-users-table.sql** — Schema migration for user credentials table
- **backend/config/jwt.js** — JWT configuration (secret, expiration, algorithm)

### Missing Infrastructure Files
The repository currently lacks:
- **package.json** — No dependency manifest exists. Must be created with express, jsonwebtoken, bcrypt, express-rate-limit.
- **backend/database/connection.js** — Database connection module not present. Property search SQL file implies database exists but connection logic is not visible.
- **backend/server.js** or app initialization — search.js appears to be a standalone file run directly (per README). Need to understand if this is the server entry point or if a separate server file exists.

## Architecture Context

### Current System State
The repository represents a minimal Node.js backend with:
- **Single-file API endpoints:** backend/api/properties/search.js runs as standalone server (README shows `node backend/api/properties/search.js`)
- **SQL-based data layer:** Queries stored as .sql files in backend/database/queries, implying SQL database backend
- **No apparent framework bootstrapping:** No Express app initialization visible; search.js likely contains its own server setup
- **No existing middleware:** No authentication, logging, or error handling middleware infrastructure detected

### Integration Points
**Authentication Flow:**
1. Client submits credentials → POST /api/auth/login
2. Login endpoint validates against users table → returns JWT
3. Client includes JWT in Authorization header (Bearer token) → subsequent API calls
4. Authentication middleware intercepts requests → validates JWT → allows/denies access
5. Protected endpoints (e.g., /api/properties/search) execute only after validation

**Middleware Injection:**
The authentication middleware must be inserted into the Express middleware chain before route handlers. Since backend/api/properties/search.js is currently standalone, refactoring options:
- **Option A:** Extract server initialization to backend/server.js, register all routes with middleware
- **Option B:** Import and apply middleware directly in search.js (faster, less architectural change)

**Database Schema Extension:**
New `users` table must coexist with existing property data tables. Schema should include:
- user_id (primary key)
- username (unique)
- password_hash (bcrypt)
- created_at, updated_at timestamps
- Optional: last_login, login_attempts for audit logging

### Technology Assumptions
- **Database Engine:** SQL-based (PostgreSQL or MySQL) inferred from .sql file patterns. Connection pooling not visible; may need to implement or verify existing pool supports concurrent auth queries.
- **Node.js Version:** Not specified. Modern async/await patterns assumed for bcrypt and JWT operations.
- **Express Framework:** Implied by intent constraints but not confirmed in visible files. Search.js may use raw http module or minimalist framework.

## Pattern Library

### File Organization Patterns
**API Endpoints:** `backend/api/{domain}/{action}.js` structure observed
- Follow this pattern: `backend/api/auth/login.js`, `backend/api/auth/refresh.js`

**Database Queries:** `backend/database/queries/{domain}-{action}.sql`
- Create: `auth-create-user.sql`, `auth-find-user.sql`, `auth-update-login-timestamp.sql`

**Naming Conventions:**
- Kebab-case for file names (property-search.sql, not propertySearch.sql)
- SQL files named with {table}-{operation} pattern

### Code Patterns (Inferred)
Since actual JavaScript implementation is not visible in search.js content, standard Node.js/Express patterns apply:
- **Async/await** for database and cryptographic operations
- **Error-first callbacks** or Promise-based error handling
- **Middleware signature:** `(req, res, next) => null`
- **Response format:** JSON with appropriate HTTP status codes

### Security Patterns to Establish
- **Environment variables** for JWT_SECRET (never hardcode)
- **Helmet.js** for HTTP header security (recommended addition)
- **CORS configuration** if frontend exists on different origin
- **Input validation** using express-validator or similar before database queries

## Prior Orbit References

### Prior Authentication Attempts
Artifacts directory shows three prior orbit UUIDs:
- `93d08324-efe3-4d8d-bbfd-abe2bed1568c` — Contains intent_document.md and orbit_log.md
- `bffba690-3729-48f5-9223-6609f344063f` — Complete artifact set (intent, context, proposal, verification)
- `ffce316e-4d4e-46c6-bb4f-c5310e36a19f` — Partial artifact set (intent, context, proposal)

**Implications:** Multiple previous orbits exist but their content is not accessible. Possible scenarios:
1. Prior authentication implementation attempts that failed or were abandoned
2. Unrelated feature orbits in the same project
3. Test/demo orbits in development repository

**Action Required:** Review .orbital/artifacts/**/intent_document.md files to determine if authentication was previously attempted and why current orbit is necessary. If this is a second attempt, avoid repeating previous failure modes.

### Codebase Evolution
README contains informal note ("nathan here") suggesting active development. Repository is minimal but may have hidden complexity:
- **Git history** should be checked for deleted authentication code
- **Environment-specific files** (.env, config/*) may exist but not be tracked in repository structure provided

## Risk Assessment

### High-Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Breaking property search API** | HIGH — Core functionality unavailable to existing consumers | MEDIUM — Middleware misconfiguration or route precedence errors | Implement middleware as opt-in initially; test search endpoint with and without auth header before enforcing; maintain backward compatibility flag |
| **JWT secret exposure** | CRITICAL — All tokens compromised, full authentication bypass | MEDIUM — Hardcoded secrets or committed .env files | Use environment variables; add .env to .gitignore; document secret generation process; implement secret rotation strategy |
| **SQL injection in auth queries** | CRITICAL — Database compromise, credential theft | MEDIUM — Parameterized queries not used consistently | Use prepared statements for all user input; never concatenate username/password into SQL; code review all query files |
| **Bcrypt performance bottleneck** | MEDIUM — Login endpoint latency exceeds 50ms budget | HIGH — Synchronous bcrypt.compare blocks event loop | Use bcrypt.compare (async) not compareSync; consider worker threads for high-load scenarios; benchmark with 10 rounds vs 12 rounds |
| **Missing database connection** | HIGH — Cannot execute any auth queries | HIGH — Connection module not found in repository structure | Verify database connection exists; create connection pool if missing; test connection before implementing auth logic |

### Medium-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Token expiration handling** | Users logged out unexpectedly | Implement refresh token flow in target state; clear error messages on token expiration; client-side token lifetime tracking |
| **Rate limiting bypass** | Brute force attacks on login endpoint | Apply rate limiting per IP and per username; consider progressive delays; alert on repeated failures |
| **Concurrent session conflicts** | Users with multiple devices experience logouts | Design for multiple active tokens per user (stretch goal); avoid single-session enforcement unless required |
| **Audit log volume** | Database growth from authentication events | Implement log rotation; summarize/archive old events; configure log levels (error vs info) |

### Low-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Middleware ordering bugs** | CORS or body parsing fails before auth check | Document middleware chain order; test cross-origin requests; ensure body-parser runs before auth routes |
| **JWT algorithm downgrade** | Tokens signed with weaker algorithm | Explicitly specify HS256 in JWT config; reject tokens with alg:none; validate algorithm in middleware |
| **Username enumeration** | Attackers identify valid usernames | Use identical error messages for "user not found" vs "wrong password"; consider timing attack mitigation |

### Performance Concerns

**Token Validation Overhead:**
- Intent specifies <50ms for auth middleware, <20ms target
- JWT validation is CPU-bound (signature verification)
- Mitigation: Cache decoded tokens in-memory with short TTL (10-30 seconds); use RS256 only if public key verification required (HS256 faster)

**Database Query Latency:**
- User lookup on login requires database round-trip
- Bcrypt comparison adds 50-100ms per login attempt
- Mitigation: Connection pooling; database indexes on username column; async bcrypt; consider Redis cache for user lookup (stretch)

### Security Boundaries

**Trust Boundaries to Enforce:**
1. **Client → API:** All requests untrusted until JWT validated
2. **API → Database:** Use connection credentials with minimum required privileges (no DROP, ALTER permissions)
3. **Environment → Code:** Secrets passed via environment variables, never in source code

**Attack Vectors to Address:**
- Credential stuffing (rate limiting)
- Token theft (HTTPS enforcement, secure cookie flags if using cookies)
- Session fixation (regenerate tokens on privilege escalation)
- Timing attacks (constant-time comparison for bcrypt, consistent error responses)