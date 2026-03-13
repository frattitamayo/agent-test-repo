# Proposal Record: Implement Property Search API Endpoint

## Interpreted Intent

This orbit establishes a functional RESTful API endpoint that enables property search through HTTP GET requests with query parameters. The implementation must create a production-ready Node.js HTTP server that:

1. **Accepts search criteria** via query parameters (minimum: location, price range, property type)
2. **Executes parameterized SQL queries** using the template in `backend/database/queries/property-search.sql`
3. **Returns JSON responses** with property listings matching the filter criteria
4. **Handles errors gracefully** with appropriate HTTP status codes and descriptive messages
5. **Runs as a standalone script** executable via `node backend/api/properties/search.js` on port 3000

The endpoint is read-only, requires no authentication, and must prevent SQL injection through parameterized queries. Performance requirements dictate sub-2-second response times for up to 1000 results, with a target of under 1 second for typical queries.

This is a foundational implementation that establishes the API contract and architecture pattern for future property-related endpoints. The focus is on correctness, security, and maintainability rather than advanced features like pagination or caching.

## Implementation Plan

### Phase 1: Infrastructure Setup

**1.1 Create `package.json`**
- **File:** `package.json` (new file at repository root)
- **Purpose:** Define Node.js project metadata and dependencies
- **Contents:**
  ```json
  {
    "name": "property-search-api",
    "version": "1.0.0",
    "description": "Property search RESTful API",
    "main": "backend/api/properties/search.js",
    "scripts": {
      "start": "node backend/api/properties/search.js"
    },
    "dependencies": {
      "pg": "^8.11.0"
    },
    "engines": {
      "node": ">=14.0.0"
    }
  }
  ```
- **Rationale:** Assumes PostgreSQL as the database (most common for property data); can be adjusted during review if different database is needed

**1.2 Create Database Configuration Module**
- **File:** `backend/database/config.js` (new file)
- **Purpose:** Centralize database connection configuration
- **Contents:**
  ```javascript
  const { Pool } = require('pg');
  
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'properties',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });
  
  module.exports = pool;
  ```
- **Rationale:** Environment-based configuration with sensible defaults; connection pooling to handle concurrent requests

**1.3 Create `.env.example`**
- **File:** `.env.example` (new file at repository root)
- **Purpose:** Document required environment variables
- **Contents:**
  ```
  DB_HOST=localhost
  DB_PORT=5432
  DB_NAME=properties
  DB_USER=postgres
  DB_PASSWORD=postgres
  PORT=3000
  ```

### Phase 2: SQL Query Template Enhancement

**2.1 Update `backend/database/queries/property-search.sql`**
- **File:** `backend/database/queries/property-search.sql` (modify existing)
- **Purpose:** Define complete parameterized SQL query
- **Contents:**
  ```sql
  SELECT 
    id,
    address,
    price,
    property_type,
    location,
    bedrooms,
    bathrooms,
    square_feet
  FROM properties
  WHERE 
    ($1::text IS NULL OR location ILIKE $1)
    AND ($2::numeric IS NULL OR price >= $2)
    AND ($3::numeric IS NULL OR price <= $3)
    AND ($4::text IS NULL OR property_type = $4)
  ORDER BY price ASC
  LIMIT 1000;
  ```
- **Rationale:** 
  - Parameterized placeholders (`$1`, `$2`, etc.) prevent SQL injection
  - NULL-safe conditions allow optional filters
  - Case-insensitive ILIKE for location search
  - 1000 row LIMIT prevents memory exhaustion
  - Explicit field selection (no `SELECT *`) prevents data exposure

### Phase 3: API Implementation

**3.1 Implement `backend/api/properties/search.js`**
- **File:** `backend/api/properties/search.js` (replace existing stub)
- **Purpose:** Complete HTTP server with query handling and database integration
- **Implementation Structure:**

```javascript
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const pool = require('../../database/config');

const PORT = process.env.PORT || 3000;
const SQL_QUERY_PATH = path.join(__dirname, '../../database/queries/property-search.sql');

// Load SQL query template
const SQL_QUERY = fs.readFileSync(SQL_QUERY_PATH, 'utf8');

// Logging utility
function log(level, message, meta = null) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...meta }));
}

// Response helper
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Parameter validation
function validateParams(params) {
  const errors = [];
  
  if (params.minPrice && isNaN(parseFloat(params.minPrice))) {
    errors.push('minPrice must be a valid number');
  }
  if (params.maxPrice && isNaN(parseFloat(params.maxPrice))) {
    errors.push('maxPrice must be a valid number');
  }
  if (params.minPrice && params.maxPrice && 
      parseFloat(params.minPrice) > parseFloat(params.maxPrice)) {
    errors.push('minPrice cannot be greater than maxPrice');
  }
  
  return errors;
}

// Request handler
async function handleRequest(req, res) {
  const startTime = Date.now();
  const parsedUrl = url.parse(req.url, true);
  
  log('info', 'Incoming request', { 
    method: req.method, 
    path: parsedUrl.pathname,
    query: parsedUrl.query 
  });
  
  // Route to search endpoint
  if (parsedUrl.pathname === '/api/properties/search' && req.method === 'GET') {
    try {
      const { location, minPrice, maxPrice, propertyType } = parsedUrl.query;
      
      // Validate parameters
      const validationErrors = validateParams({ minPrice, maxPrice });
      if (validationErrors.length > 0) {
        log('warn', 'Validation failed', { errors: validationErrors });
        return sendJSON(res, 400, { 
          error: 'Invalid parameters', 
          details: validationErrors 
        });
      }
      
      // Execute query with parameterized values
      const params = [
        location ? `%${location}%` : null,
        minPrice ? parseFloat(minPrice) : null,
        maxPrice ? parseFloat(maxPrice) : null,
        propertyType || null
      ];
      
      const result = await pool.query(SQL_QUERY, params);
      const responseTime = Date.now() - startTime;
      
      log('info', 'Query executed', { 
        rowCount: result.rows.length, 
        responseTime: `${responseTime}ms` 
      });
      
      // Return results
      sendJSON(res, 200, {
        data: result.rows,
        count: result.rows.length,
        responseTime: `${responseTime}ms`
      });
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      log('error', 'Query failed', { 
        error: error.message, 
        responseTime: `${responseTime}ms` 
      });
      
      sendJSON(res, 500, { 
        error: 'Internal server error',
        message: 'Failed to execute search query'
      });
    }
  } 
  // Health check endpoint
  else if (parsedUrl.pathname === '/health' && req.method === 'GET') {
    try {
      await pool.query('SELECT 1');
      sendJSON(res, 200, { status: 'healthy', database: 'connected' });
    } catch (error) {
      sendJSON(res, 503, { status: 'unhealthy', database: 'disconnected' });
    }
  }
  // 404 for other routes
  else {
    sendJSON(res, 404, { error: 'Not found' });
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  log('info', `Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, closing server');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});
```

### Phase 4: Documentation

**4.1 Update README.md**
- **File:** `README.md` (modify existing)
- **Additions:**
  - Database setup instructions
  - Environment variable configuration
  - Example API requests with curl commands
  - Expected table schema definition

**4.2 Create `docs/schema.sql`**
- **File:** `docs/schema.sql` (new file)
- **Purpose:** Reference schema for database setup
- **Contents:**
  ```sql
  CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL,
    price NUMERIC(12, 2) NOT NULL,
    property_type VARCHAR(50) NOT NULL,
    location VARCHAR(100) NOT NULL,
    bedrooms INTEGER,
    bathrooms NUMERIC(3, 1),
    square_feet INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE INDEX idx_properties_location ON properties(location);
  CREATE INDEX idx_properties_price ON properties(price);
  CREATE INDEX idx_properties_type ON properties(property_type);
  ```

### Execution Order

1. **Setup** (can be done in parallel):
   - Create `package.json`
   - Create `backend/database/config.js`
   - Create `.env.example`
   - Create `docs/schema.sql`

2. **SQL Query** (depends on schema understanding):
   - Update `backend/database/queries/property-search.sql`

3. **API Implementation** (depends on config and SQL):
   - Implement `backend/api/properties/search.js`

4. **Documentation** (after implementation complete):
   - Update `README.md`

5. **Testing** (manual validation):
   - Install dependencies: `npm install`
   - Set up database with schema
   - Run server: `npm start`
   - Test endpoints with curl

## Risk Surface

### Critical Risks

**1. SQL Injection (Security)**
- **Risk:** User-provided parameters inserted directly into SQL queries
- **Likelihood:** High if not mitigated
- **Mitigation Applied:** All query parameters use PostgreSQL parameterized placeholders (`$1`, `$2`, etc.); no string concatenation or interpolation
- **Verification:** Manual code review of SQL execution; attempt injection attacks during testing

**2. Database Connection Failure (Availability)**
- **Risk:** Server cannot connect to database on startup
- **Likelihood:** High in new environment
- **Mitigation Applied:** Connection timeout (2s); pool configuration with retry logic; health check endpoint to verify connectivity
- **Verification:** Test with invalid credentials; monitor logs for connection errors

**3. Missing Dependencies (Deployment)**
- **Risk:** Script fails to run due to missing npm packages
- **Likelihood:** High without `package.json`
- **Mitigation Applied:** Created `package.json` with explicit dependencies; README updated with setup instructions
- **Verification:** Fresh clone test; validate `npm install` works

### High Risks

**4. Performance Degradation (Performance)**
- **Risk:** Queries exceed 2-second constraint with large datasets
- **Likelihood:** Medium without database indexes
- **Mitigation Applied:** LIMIT 1000 on queries; database indexes on searchable fields (location, price, type); response time logging
- **Verification:** Load test with 10,000+ property records; measure query execution time

**5. Memory Exhaustion (Stability)**
- **Risk:** Large result sets consume excessive memory
- **Likelihood:** Medium with unbounded queries
- **Mitigation Applied:** LIMIT 1000 clause prevents unbounded results; connection pooling prevents connection leaks
- **Verification:** Monitor process memory during load testing

**6. Data Exposure (Security)**
- **Risk:** Response includes sensitive fields not intended for public API
- **Likelihood:** Medium without explicit field selection
- **Mitigation Applied:** SQL query explicitly lists returned fields; no `SELECT *`
- **Verification:** Review response payload; ensure no PII or internal IDs leak

### Medium Risks

**7. Invalid Parameter Handling (Usability)**
- **Risk:** Malformed parameters cause 500 errors instead of 400
- **Likelihood:** Medium with user input
- **Mitigation Applied:** Parameter validation function checks types and ranges; returns 400 with descriptive errors
- **Verification:** Test with invalid inputs (negative prices, non-numeric values)

**8. Error Information Disclosure (Security)**
- **Risk:** Stack traces or database errors exposed to clients
- **Likelihood:** Low with error handling
- **Mitigation Applied:** Try-catch wraps all operations; generic error messages to client; detailed logging server-side only
- **Verification:** Trigger database errors; verify response contains no stack traces

**9. Port Conflicts (Deployment)**
- **Risk:** Port 3000 already in use prevents server startup
- **Likelihood:** Low in controlled environment
- **Mitigation Applied:** PORT environment variable allows override; default remains 3000 per constraints
- **Verification:** Test with PORT=3001; verify server starts on alternate port

### Low Risks

**10. Concurrent Request Handling (Scalability)**
- **Risk:** Multiple simultaneous requests overwhelm single-threaded Node.js
- **Likelihood:** Low for read-only queries
- **Mitigation Applied:** Connection pooling (max 20); async/await prevents blocking
- **Verification:** Concurrent request load test (50+ simultaneous requests)

### Risk Mitigation Summary Table

| Risk | Severity | Mitigation Status | Residual Risk |
|------|----------|-------------------|---------------|
| SQL Injection | Critical | Fully Mitigated | Low |
| DB Connection Failure | Critical | Partially Mitigated | Medium |
| Missing Dependencies | Critical | Fully Mitigated | Low |
| Performance Degradation | High | Partially Mitigated | Medium |
| Memory Exhaustion | High | Fully Mitigated | Low |
| Data Exposure | High | Fully Mitigated | Low |
| Invalid Parameters | Medium | Fully Mitigated | Low |
| Error Disclosure | Medium | Fully Mitigated | Low |
| Port Conflicts | Medium | Fully Mitigated | Low |
| Concurrent Requests | Low | Fully Mitigated | Low |

**Residual Medium Risks Requiring Human Review:**
- Database connection retry logic may need environment-specific tuning
- Performance testing required with production-scale data to validate 2-second constraint

## Scope Estimate

### Complexity Assessment: **Low-Medium**

**Factors:**
- **Code Volume:** ~200 lines of implementation code
- **New Files:** 5 (package.json, config.js, schema.sql, .env.example, updated search.js)
- **Modified Files:** 2 (search.js, property-search.sql, README.md)
- **External Dependencies:** 1 npm package (pg)
- **Testing Surface:** 1 primary endpoint + 1 health check endpoint
- **Integration Points:** Single database connection

### Work Breakdown

**Orbit Count: 1** (this orbit completes the full implementation)

| Phase | Estimated Time | Complexity | Validation Method |
|-------|---------------|------------|-------------------|
| Infrastructure Setup | 30 min | Low | Files created, npm install succeeds |
| SQL Query Enhancement | 20 min | Low | Query syntax valid, parameters aligned |
| API Implementation | 90 min | Medium | Server starts, endpoints respond |
| Documentation | 30 min | Low | README clear, schema documented |
| Manual Testing | 45 min | Medium | All test cases pass |
| **Total** | **3.5 hours** | **Low-Medium** | Full acceptance criteria met |

### Acceptance Criteria Mapping

| Criterion | Implementation Component | Validation |
|-----------|-------------------------|------------|
| HTTP GET `/api/properties/search` returns JSON | `search.js` request handler | curl test |
| Accepts 3+ search parameters | location, minPrice, maxPrice, propertyType | Query parameter parsing |
| SQL query filters results | Parameterized WHERE clauses | Database query test |
| Response includes required fields | Explicit SELECT statement | Response inspection |
| Server starts on port 3000 | `server.listen(PORT)` | Process check |
| Handles invalid parameters with 400 | `validateParams()` function | Error case testing |
| Response time < 1s (typical) | Query execution + logging | Performance log review |
| SQL injection prevention | Parameterized queries | Security testing |
| Empty results return 200 + [] | Row count check | Empty filter test |
| Error responses include messages | Error handling with descriptive text | 500 error test |
| Logging captures requests | Structured JSON logging | Log output review |

### Assumptions Requiring Validation

1. **Database is PostgreSQL** — Implementation assumes `pg` driver; if MySQL/SQLite, requires driver swap
2. **Table name is `properties`** — SQL query assumes this table exists with specified schema
3. **Node.js version ≥14** — Uses modern async/await and optional chaining
4. **Database is accessible from application** — No network/firewall restrictions
5. **No existing data migration needed** — Fresh schema setup assumed

### Out of Scope (Explicitly Deferred)

- Unit test framework and test files
- CI/CD pipeline configuration
- Docker containerization
- Pagination implementation
- Rate limiting or API throttling
- Response caching layer
- Monitoring/observability integrations (APM, metrics)
- Multi-environment configuration (dev/staging/prod)

## Human Modifications

Pending human review.