# Context Package: Implement Property Search API Endpoint

## Codebase References

### Primary Implementation Surface
- **`backend/api/properties/search.js`** — Current entry point file for the property search endpoint. This is the main file to be enhanced with full HTTP server logic, parameter handling, and database integration.
- **`backend/database/queries/property-search.sql`** — SQL query template that defines the database schema contract and search logic pattern. Must be loaded and parameterized by the API implementation.

### Directory Structure
```
backend/
├── api/
│   └── properties/
│       └── search.js          # Main implementation target
└── database/
    └── queries/
        └── property-search.sql # Query template reference
```

### Missing Infrastructure Files
The repository currently lacks several standard backend files that typically accompany an API implementation:
- No `package.json` visible (dependency management)
- No database connection module (assumed to be needed)
- No environment configuration file (`.env` or config module)
- No error handling middleware
- No logging utility

These gaps must be addressed in the implementation or documented as assumptions.

## Architecture Context

### Current State
The repository represents a minimal starter structure with placeholder files. Based on the README instructions (`node backend/api/properties/search.js`), the architecture expects **standalone executable Node.js files** that can run directly without a framework bootstrapper.

### Expected Data Flow
1. HTTP request arrives at `/api/properties/search` with query parameters
2. API handler validates and sanitizes parameters
3. SQL query template is loaded from `backend/database/queries/property-search.sql`
4. Parameters are bound to the SQL query using parameterized statements
5. Query executes against the database
6. Results are transformed into JSON response structure
7. HTTP response with appropriate status code and body

### Service Boundaries
This is a **read-only query service** with no side effects:
- **Input:** HTTP GET requests with query string parameters
- **Output:** JSON array of property objects
- **No state mutations:** Does not modify database or system state
- **No authentication layer:** Public endpoint with no authorization checks

### Infrastructure Constraints
- **Port 3000:** Hardcoded requirement per Intent constraints
- **Node.js execution model:** Direct execution via `node` command, not via framework CLI
- **Database connection:** Must establish connection within the script or import from a shared module (currently undefined)
- **No container runtime:** No evidence of Docker or containerization; assumes bare Node.js environment

### Deployment Context
Per README, deployment is manual execution from repository root. No CI/CD pipeline, no deployment manifests, no infrastructure-as-code. This suggests a development/demo environment rather than production.

## Pattern Library

### HTTP Server Patterns
Since the repository lacks a visible framework dependency, the implementation must either:
1. **Use Node.js built-in `http` module** — Minimal, no dependencies, matches the "standalone script" execution model
2. **Import Express.js** — More conventional for REST APIs, but requires adding to dependencies

**Recommendation:** Use Node.js `http` module to match the minimal dependency philosophy evident in the repository structure.

### Query Parameter Handling
Standard Node.js URL parsing approach:
```javascript
const url = require('url');
const queryParams = url.parse(req.url, true).query;
```

### SQL Parameterization Pattern
To prevent SQL injection per Intent security constraints, use parameterized queries:
- **PostgreSQL:** `$1, $2, $3` placeholders
- **MySQL:** `?` placeholders
- **SQLite:** `?` or `$param` placeholders

The actual database driver is unknown and must be inferred or assumed during implementation.

### Response Structure Pattern
Standard JSON envelope structure for REST APIs:
```json
{
  "data": [],
  "count": 0,
  "status": "success"
}
```

Or simplified (just return the array if no metadata is needed):
```json
[
  { "id": 1, "address": "...", "price": 0, "type": "..." }
]
```

### Error Response Pattern
```json
{
  "error": "Error message",
  "status": "error",
  "code": 400
}
```

### File Organization Convention
Based on the existing structure, the repository follows a **feature-organized** pattern:
- `backend/api/{domain}/{action}.js` for endpoints
- `backend/database/queries/{domain}-{action}.sql` for SQL templates

## Prior Orbit References

**Orbit 0 — Baseline Implementation**

This is the inaugural orbit for the repository. No prior implementation exists beyond placeholder files. Key observations:

- **No production code:** Current `search.js` is a stub or minimal example
- **No test coverage:** No test files visible in repository structure
- **No operational history:** Cannot reference patterns from prior changes

### Lessons from Repository State
- The README's manual execution instruction (`node backend/api/properties/search.js`) establishes a constraint: the file must be independently executable
- The separation of SQL into `.sql` files suggests an intention to keep business logic separate from data access logic
- The minimal structure implies incremental buildout — start simple, add complexity as needed

## Risk Assessment

### Security Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **SQL Injection** | Critical — database compromise, data exfiltration | High if raw query concatenation used | MUST use parameterized queries; validate/sanitize all inputs; never interpolate user input directly into SQL |
| **Data Exposure** | Medium — unintended sensitive field leakage | Medium without explicit field whitelisting | Define explicit response schema; SELECT only required fields; add data classification review |
| **Denial of Service** | Medium — unbounded query results crash server | Medium without result limits | Implement max result cap (e.g., 1000 rows); add query timeout; rate limiting recommended |
| **Information Disclosure via Errors** | Low — stack traces reveal internal structure | Medium if errors not caught | Wrap all operations in try/catch; return generic error messages to client; log details server-side only |

### Performance Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Slow Query Performance** | High — violates 2-second constraint | High without indexes | Verify database indexes on searchable fields (location, price, type); add query explain analysis |
| **Memory Exhaustion** | High — server crash on large result sets | Medium with no pagination | Stream results or enforce LIMIT clause; monitor heap usage |
| **Connection Pool Exhaustion** | Medium — concurrent requests fail | Medium if no pooling | Use connection pooling library (e.g., `pg-pool`); implement connection limits |

### Integration Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Database Connection Failure** | Critical — endpoint non-functional | High on first run (no config provided) | Add connection retry logic; validate database credentials; provide clear setup documentation |
| **SQL Schema Mismatch** | High — query fails or returns incorrect data | High (no schema defined) | Document expected table schema; add schema validation step; include migration script or setup instructions |
| **Missing Dependencies** | Critical — script won't run | High (no `package.json`) | Create `package.json` with required database driver; document installation steps |

### Operational Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **No Logging** | Medium — debugging production issues impossible | Certain without implementation | Add structured logging for requests, errors, query times; log to stdout for container compatibility |
| **No Health Check** | Low — monitoring can't verify service health | Certain without implementation | Add `/health` endpoint; include database connectivity check |
| **Port Conflict** | Low — service won't start | Low but possible | Add port configuration via environment variable with 3000 as default; document port requirements |

### Regression Risks

**No existing functionality to regress** — this is net-new implementation. However, future changes must maintain:
- API contract compatibility (response structure)
- Query parameter names and behavior
- Port 3000 availability
- SQL query pattern established in `property-search.sql`

### Mitigation Priority
1. **Critical:** SQL injection prevention (parameterized queries)
2. **Critical:** Database connection handling and error management
3. **High:** Query performance validation against 2-second constraint
4. **High:** Missing dependencies documentation (`package.json`, database driver)
5. **Medium:** Logging and observability for supervised deployment
6. **Medium:** Result set size limits to prevent memory issues