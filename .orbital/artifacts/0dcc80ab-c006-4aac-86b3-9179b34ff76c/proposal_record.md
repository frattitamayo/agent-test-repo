# Proposal Record: Implement Property Search API with Database Integration

## Interpreted Intent

This orbit establishes the foundational database-connected API endpoint for property search functionality. The core objective is transforming the existing stub at `backend/api/properties/search.js` into a fully functional HTTP server that:

1. Loads and executes the SQL query from `backend/database/queries/property-search.sql`
2. Returns property data as JSON over HTTP GET at `/api/properties/search` on port 3000
3. Implements production-grade error handling without exposing internal database details
4. Establishes patterns for database connection management that will be reused across future endpoints

This is not about building a feature-complete property search system. Pagination, filtering, authentication, and advanced query capabilities are explicitly out of scope. The intent is to create a working reference implementation that proves the database integration pattern and serves as a template for subsequent API endpoints.

The Trust Tier 2 (Supervised) assignment reflects this orbit's dual role: it must work correctly as a functional endpoint while also establishing reusable patterns that other engineers will follow. Mistakes here propagate across the codebase.

## Implementation Plan

### Phase 1: Dependency and Configuration Setup

**File: `package.json`** (CREATE)
```json
{
  "name": "property-search-api",
  "version": "1.0.0",
  "type": "module",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "pg": "^8.11.3"
  },
  "scripts": {
    "start": "node backend/api/properties/search.js"
  }
}
```

**Rationale**: Defaulting to PostgreSQL (`pg` package) based on common Node.js patterns. The SQL file will be inspected for dialect-specific syntax, but generic SQL is PostgreSQL-compatible. Using ES modules (`"type": "module"`) for modern Node.js patterns.

**File: `.env.example`** (CREATE)
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=properties
DB_USER=postgres
DB_PASSWORD=
DB_POOL_MIN=2
DB_POOL_MAX=10
```

**File: `.gitignore`** (CREATE or UPDATE)
```
.env
node_modules/
```

**Rationale**: Environment variables prevent credential leakage. The `.env.example` serves as documentation without exposing secrets.

### Phase 2: Database Connection Layer

**File: `backend/database/connection.js`** (CREATE)

This module establishes a connection pool and provides a query execution interface:

```javascript
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'properties',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Cache for loaded SQL queries
const queryCache = new Map();

/**
 * Load SQL query from file system
 * @param {string} queryName - Name of query file without .sql extension
 * @returns {Promise<string>} SQL query text
 */
async function loadQuery(queryName) {
  if (queryCache.has(queryName)) {
    return queryCache.get(queryName);
  }

  const queryPath = path.join(__dirname, 'queries', `${queryName}.sql`);
  const queryText = await fs.readFile(queryPath, 'utf-8');
  queryCache.set(queryName, queryText);
  return queryText;
}

/**
 * Execute a database query with timeout and error handling
 * @param {string} queryName - Name of query file without .sql extension
 * @param {Array} params - Query parameters for parameterized queries
 * @returns {Promise<Object>} Query result
 */
async function executeQuery(queryName, params = []) {
  const client = await pool.connect();
  try {
    const queryText = await loadQuery(queryName);
    
    // Set statement timeout to 5 seconds
    await client.query('SET statement_timeout = 5000');
    
    const result = await client.query(queryText, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Test database connectivity
 * @returns {Promise<boolean>} True if connection successful
 */
async function healthCheck() {
  try {
    const result = await pool.query('SELECT NOW()');
    return result.rowCount === 1;
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return false;
  }
}

export { executeQuery, healthCheck, pool };
```

**Rationale**: 
- Connection pooling prevents resource exhaustion and improves performance
- SQL file caching eliminates repeated filesystem reads
- Statement timeout (5 seconds) prevents runaway queries
- Health check enables graceful startup validation
- Client release in `finally` block prevents connection leaks

### Phase 3: API Endpoint Implementation

**File: `backend/api/properties/search.js`** (MODIFY)

```javascript
import http from 'http';
import { executeQuery, healthCheck } from '../../database/connection.js';

const PORT = 3000;

/**
 * Sanitize error for client response
 * @param {Error} error - Original error
 * @returns {Object} Sanitized error response
 */
function sanitizeError(error) {
  // Log full error server-side
  console.error('Error processing request:', {
    message: error.message,
    stack: error.stack,
    code: error.code
  });

  // Return sanitized error to client
  if (error.code === '57014') {
    // PostgreSQL query timeout
    return {
      error: {
        message: 'Query execution timeout',
        code: 'TIMEOUT'
      }
    };
  }

  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return {
      error: {
        message: 'Database connection failed',
        code: 'DB_UNAVAILABLE'
      }
    };
  }

  // Generic error for everything else
  return {
    error: {
      message: 'An error occurred processing your request',
      code: 'INTERNAL_ERROR'
    }
  };
}

/**
 * Handle property search requests
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleSearch(req, res) {
  // Only accept GET requests
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED'
      }
    }));
    return;
  }

  try {
    // Execute the property-search query
    const result = await executeQuery('property-search');

    // Transform database rows to API response format
    const response = {
      data: result.rows,
      count: result.rowCount
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));

  } catch (error) {
    const sanitized = sanitizeError(error);
    const statusCode = sanitized.error.code === 'DB_UNAVAILABLE' ? 503 : 500;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sanitized, null, 2));
  }
}

/**
 * Request router
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/properties/search') {
    await handleSearch(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'Endpoint not found',
        code: 'NOT_FOUND'
      }
    }));
  }
});

/**
 * Start server with database health check
 */
async function startServer() {
  console.log('Checking database connection...');
  
  const isHealthy = await healthCheck();
  if (!isHealthy) {
    console.error('Failed to connect to database. Check your .env configuration.');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`Property Search API listening on http://localhost:${PORT}`);
    console.log(`Endpoint: http://localhost:${PORT}/api/properties/search`);
  });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();
```

**Rationale**:
- Native `http` module keeps implementation lightweight
- Database health check at startup prevents silent failures
- Method validation (GET only) prevents unexpected behavior
- Structured error responses with status codes follow REST conventions
- Error sanitization prevents information leakage while logging full details server-side
- Graceful shutdown handling for production environments

### Phase 4: Documentation Updates

**File: `README.md`** (MODIFY)

Update the "Running the sample API" section:

```markdown
## Running the sample API

### Prerequisites

1. Node.js 18+ installed
2. PostgreSQL database accessible
3. Database populated with properties table (see Setup section)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file from template:
   ```bash
   cp .env.example .env
   ```

3. Configure database credentials in `.env`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=properties
   DB_USER=your_username
   DB_PASSWORD=your_password
   ```

4. (Optional) Create sample database:
   ```sql
   CREATE DATABASE properties;
   -- Run your schema and seed scripts
   ```

### Running

From the repository root:
```bash
npm start
```

Or directly:
```bash
node backend/api/properties/search.js
```

### Testing

Open your browser or use curl:
```bash
curl http://localhost:3000/api/properties/search
```

Expected response:
```json
{
  "data": [
    {
      "id": 1,
      "address": "123 Main St",
      "price": 350000
      // ... other fields from your properties table
    }
  ],
  "count": 1
}
```

### Error Responses

The API returns structured error responses:

**Database Unavailable (503):**
```json
{
  "error": {
    "message": "Database connection failed",
    "code": "DB_UNAVAILABLE"
  }
}
```

**Query Timeout (500):**
```json
{
  "error": {
    "message": "Query execution timeout",
    "code": "TIMEOUT"
  }
}
```

**Generic Error (500):**
```json
{
  "error": {
    "message": "An error occurred processing your request",
    "code": "INTERNAL_ERROR"
  }
}
```
```

**Rationale**: Documentation must reflect actual setup requirements including environment variables and database configuration. Example responses set expectations for API consumers.

### Phase 5: SQL Query Validation

**File: `backend/database/queries/property-search.sql`** (INSPECT, potentially MODIFY)

The existing SQL file must be validated for:
1. PostgreSQL compatibility (if dialect-specific syntax exists)
2. Proper column selection (no `SELECT *` without documentation)
3. Absence of SQL injection vectors (should be parameterized or static)
4. Performance considerations (indexes, LIMIT clauses)

If the query requires user input parameters, it must be refactored to use parameterized queries (`$1`, `$2`, etc. for PostgreSQL).

**Example modification** (if current query is `SELECT * FROM properties`):
```sql
-- Retrieve all properties
-- TODO: Add WHERE clauses for filtering in future orbits
-- TODO: Add LIMIT/OFFSET for pagination in future orbits
SELECT 
  id,
  address,
  city,
  state,
  zip_code,
  price,
  bedrooms,
  bathrooms,
  square_feet,
  listing_date,
  status
FROM properties
WHERE status = 'active'
ORDER BY listing_date DESC
LIMIT 100;
```

**Rationale**: Explicit column selection documents the API contract. LIMIT clause prevents accidental full table scans. Active status filter is a common default.

## Risk Surface

### Critical Security Risks

**SQL Injection (HIGH SEVERITY)**
- **Manifestation**: If query parameters are concatenated into SQL strings rather than using parameterized queries
- **Mitigation**: Current implementation uses `pg` library's parameterized query interface (`client.query(text, params)`). The `property-search.sql` file must be validated to ensure it uses parameter placeholders (`$1`, `$2`) rather than string concatenation
- **Residual Risk**: LOW — pattern is secure by default; validation step required

**Credential Exposure (HIGH SEVERITY)**
- **Manifestation**: Database credentials committed to git or exposed in error messages
- **Mitigation**: `.gitignore` prevents `.env` commit; error sanitization removes connection strings from client responses; full errors logged server-side only
- **Residual Risk**: LOW — requires developer discipline to avoid committing `.env`

### Operational Risks

**Database Unavailable at Startup (MEDIUM SEVERITY)**
- **Manifestation**: API starts successfully but all requests fail with 503 errors
- **Mitigation**: Health check in `startServer()` validates connectivity before accepting traffic; process exits with error code 1 if check fails
- **Residual Risk**: LOW — deployment automation can detect exit code and halt deployment

**Connection Pool Exhaustion (MEDIUM SEVERITY)**
- **Manifestation**: Under load, all pool connections consumed; new requests hang or timeout
- **Mitigation**: Pool configured with max 10 connections and 30-second idle timeout; client release in `finally` block prevents leaks; connection timeout set to 5 seconds
- **Residual Risk**: MEDIUM — acceptable for sample API; production would need load testing and auto-scaling

**Query Timeout Edge Cases (LOW SEVERITY)**
- **Manifestation**: Long-running query consumes resources; client waits indefinitely
- **Mitigation**: Statement timeout set to 5 seconds per query; timeout returns 500 with `TIMEOUT` error code
- **Residual Risk**: LOW — 5 seconds sufficient for simple property search

### Performance Risks

**Full Table Scan (MEDIUM SEVERITY)**
- **Manifestation**: Query executes without indexes; response time degrades with dataset size
- **Mitigation**: SQL query inspection phase will add LIMIT clause if missing; documentation will note index requirements
- **Residual Risk**: MEDIUM — requires database administrator to create appropriate indexes

**SQL File Read Overhead (LOW SEVERITY)**
- **Manifestation**: Each request reads SQL file from disk, adding latency
- **Mitigation**: Query caching in `loadQuery()` function reads file once per query name
- **Residual Risk**: NEGLIGIBLE — cached in memory after first request

### Data Integrity Risks

**Empty Result Set Handling (LOW SEVERITY)**
- **Manifestation**: Query returns zero rows; unclear if error or valid state
- **Mitigation**: Empty array returned with 200 status and `count: 0`; distinguishes from error states
- **Residual Risk**: NEGLIGIBLE — behavior documented in README

**Type Coercion Issues (LOW SEVERITY)**
- **Manifestation**: PostgreSQL types (e.g., NUMERIC, TIMESTAMP) serialize incorrectly to JSON
- **Mitigation**: `pg` library handles standard type conversions automatically; custom types would require explicit handling
- **Residual Risk**: LOW — acceptable for initial implementation; future orbit can add type transformations

### Pattern Establishment Risks

**Single-File Server Pattern (LOW SEVERITY)**
- **Manifestation**: Pattern doesn't scale to multiple endpoints; each file starts its own server
- **Mitigation**: Document limitation in proposal; accept as temporary pattern for sample API
- **Residual Risk**: MEDIUM — future orbit should refactor to central server with route handlers

**No Logging Infrastructure (MEDIUM SEVERITY)**
- **Manifestation**: Production debugging difficult without structured logs
- **Mitigation**: Console logging provides basic observability; full errors logged with stack traces
- **Residual Risk**: MEDIUM — acceptable for development; production needs structured logging library

## Scope Estimate

**Estimated Orbit Count**: 1 (this orbit only)

**Complexity Assessment**: **MEDIUM**

### Breakdown

| Phase | Effort | Risk | Dependencies |
|-------|--------|------|--------------|
| **Dependency Setup** | 30 minutes | LOW | None |
| **Connection Layer** | 2 hours | MEDIUM | package.json, .env configuration |
| **API Implementation** | 2 hours | MEDIUM | Connection layer complete |
| **Documentation** | 1 hour | LOW | API implementation complete |
| **SQL Validation** | 30 minutes | LOW | Access to SQL file content |
| **Manual Testing** | 1 hour | LOW | Database instance available |
| **Total** | **7 hours** | **MEDIUM** | Database credentials and instance |

### Assumptions

1. **Database exists and is accessible** — This proposal assumes a PostgreSQL instance is already provisioned with appropriate credentials
2. **SQL query is valid** — The existing `property-search.sql` file contains working SQL compatible with PostgreSQL
3. **No schema migrations needed** — Database schema already contains a properties table matching the query expectations
4. **Local development environment** — Testing assumes local Node.js and database setup, not production deployment

### Complexity Drivers

- **First orbit establishes patterns** — Connection management, error handling, and file organization decisions affect future work
- **Multiple integration points** — HTTP server, filesystem I/O (SQL files), database connections, and environment configuration
- **Security considerations** — Credential management and error sanitization require careful implementation
- **Limited existing infrastructure** — No package.json, no connection patterns, no error handling examples to follow

### Out of Scope

The following are explicitly deferred to future orbits:
- Query parameterization for user-provided filters
- Pagination (LIMIT/OFFSET handling)
- Authentication and authorization
- Rate limiting or request throttling
- Structured logging (Winston, Pino, etc.)
- Unit or integration tests
- API documentation generation (Swagger/OpenAPI)
- Production deployment configuration
- Monitoring and alerting
- Centralized server with route registration

## Human Modifications

Pending human review.