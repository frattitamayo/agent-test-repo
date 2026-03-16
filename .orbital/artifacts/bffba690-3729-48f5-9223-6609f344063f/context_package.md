# Context Package: Add Property Filtering to Search API

## Codebase References

### Files to Modify
- **backend/api/properties/search.js** — Current property search endpoint. Must be extended to:
  - Parse query parameters from `req.query` (Express standard)
  - Validate filter parameters (minPrice, maxPrice, location, propertyType)
  - Pass validated parameters to SQL query execution
  - Return 400 errors for invalid inputs with descriptive messages
  - Maintain existing response format and authentication flow

- **backend/database/queries/property-search.sql** — Current SQL query returning all properties. Must be modified to:
  - Accept optional filter parameters via parameterized query ($1, $2, $3, $4, etc.)
  - Build conditional WHERE clause that applies filters only when parameters are non-null
  - Use AND logic to combine multiple filters
  - Maintain query structure compatible with existing connection pool

### Files to Create
- **backend/database/migrations/002-add-property-indexes.sql** — Migration to create database indexes on filterable columns (price, location, property_type) for target state performance requirement

- **backend/validation/property-filters.js** (optional) — Dedicated validation module for filter parameters if validation logic becomes complex. Can be inline in search.js for minimum viable implementation.

### Existing Infrastructure (from Auth Orbit)
- **backend/database/connection.js** — Database connection pool already established. Query execution pattern: `await pool.query(sqlQuery, [param1, param2, ...])`. Must use this same pattern for filtered queries.

- **backend/middleware/authenticate.js** — JWT authentication middleware already protecting /api/properties/search. No changes required but must remain in place (all search requests go through authentication first).

- **backend/server.js** (or search.js if standalone) — Express server setup with body parsing and authentication middleware chain. Filter logic integrates after authentication middleware runs.

### Unknown/Missing Context
- **properties table schema** — Exact column names not visible in repository structure. Common patterns would be:
  - `price` (NUMERIC/DECIMAL) or `listing_price`
  - `location` (VARCHAR/TEXT) or `city`, `address`, `region`
  - `property_type` (VARCHAR/TEXT) or `type`, `category`
  - Need to inspect actual database schema or query existing property-search.sql for column references

- **Current property-search.sql content** — File exists but content not provided. Likely contains `SELECT * FROM properties` or similar base query. Must examine to understand current structure before adding WHERE clause.

## Architecture Context

### Current System State
Based on prior authentication orbit and repository structure:
- **API Layer:** Express-based REST API with JWT authentication protecting all endpoints
- **Routing:** Property search exposed at GET /api/properties/search
- **Authentication Flow:** Client → JWT Bearer token → authenticate middleware → search endpoint → database query → JSON response
- **Database Layer:** SQL database (PostgreSQL or MySQL) with connection pooling, parameterized queries stored as .sql files

### Filter Integration Data Flow
```
1. Client Request: GET /api/properties/search?minPrice=100000&location=Seattle
2. Authentication Middleware: Validates JWT, sets req.user
3. Search Endpoint Handler:
   a. Parse req.query (Express automatic parsing)
   b. Validate filter parameters (type checking, range validation)
   c. Build parameter array for SQL [minPrice, location, ...]
   d. Load property-search.sql (modified with conditional WHERE)
   e. Execute: await pool.query(sql, params)
   f. Return filtered results as JSON
4. Client receives filtered property list
```

### Query Construction Pattern
Since SQL must be parameterized but WHERE clause is conditional, two approaches:

**Approach A: Dynamic WHERE with conditional parameters (recommended)**
```sql
SELECT * FROM properties
WHERE 
  ($1::numeric IS NULL OR price >= $1)
  AND ($2::numeric IS NULL OR price <= $2)
  AND ($3::text IS NULL OR LOWER(location) = LOWER($3))
  AND ($4::text IS NULL OR property_type = $4);
```
Pass `null` for unused filters. Database evaluates `IS NULL` check first, short-circuits unused conditions.

**Approach B: String concatenation with parameterized values (NOT RECOMMENDED)**
Build WHERE clause dynamically in JavaScript based on present parameters. Violates constraint against dynamic SQL and increases SQL injection risk.

**Decision:** Use Approach A. Cleaner, safer, consistent with parameterized query requirement.

### Performance Considerations
- **Without Indexes:** Sequential table scan on 10,000 rows. Estimated query time: 100-300ms for filtered queries.
- **With Indexes:** Index seek on price range, location, property_type. Estimated query time: 10-50ms for typical filters.
- **Index Strategy:** Composite index vs separate indexes. For filters combined with AND logic, separate single-column indexes likely sufficient (database can use index intersection). Composite index (price, location, property_type) would be faster but less flexible.

### Backward Compatibility Strategy
- **No parameters:** Call endpoint as `/api/properties/search` (no query string)
- **Validation logic:** Treat missing parameters as `null` or `undefined`, not as empty strings
- **SQL behavior:** `$1 IS NULL` evaluates to true when parameter is null → condition is skipped → no filtering applied
- **Testing:** Must verify existing clients (no parameters) still receive full result set

## Pattern Library

### File Organization Patterns (Established in Auth Orbit)
- **API Endpoints:** `backend/api/{domain}/{action}.js`
  - Property search follows this: `backend/api/properties/search.js`
  - Maintain this structure (do not move to `/api/search` or `/api/properties`)

- **Database Queries:** `backend/database/queries/{domain}-{action}.sql`
  - Current: `property-search.sql`
  - Modified file should remain at same path with same name (backward compatibility)

- **Database Migrations:** `backend/database/migrations/{number}-{description}.sql`
  - Auth orbit used `001-create-users-table.sql`
  - Next migration should be `002-add-property-indexes.sql`

- **Naming Conventions:** Kebab-case for files, SQL files follow `{table}-{operation}` pattern

### Query Execution Pattern (from Auth Orbit)
```javascript
const fs = require('fs');
const path = require('path');
const pool = require('../../database/connection');

// Load SQL query from file
const searchQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/property-search.sql'),
  'utf8'
);

// Execute with parameterized values
const result = await pool.query(searchQuery, [param1, param2, param3]);
res.json(result.rows);
```
**Filter implementation must follow this pattern.** Do not inline SQL strings in JavaScript.

### Error Handling Pattern (from Auth Orbit)
```javascript
// Input validation errors: 400 status
if (!isValidInput) {
  return res.status(400).json({
    error: 'INVALID_PARAMETER',
    message: 'Descriptive error message',
    field: 'minPrice' // field-level validation for target state
  });
}

// Database errors: 500 status
try {
  const result = await pool.query(searchQuery, params);
  res.json(result.rows);
} catch (error) {
  console.error('Search error:', error);
  res.status(500).json({
    error: 'SERVER_ERROR',
    message: 'Property search failed'
  });
}
```
**Consistent error structure:** `{ error: 'ERROR_CODE', message: '...' }`

### Validation Patterns
Based on auth orbit validation in login.js:
```javascript
// Type validation
if (minPrice !== undefined && isNaN(Number(minPrice))) {
  return res.status(400).json({
    error: 'INVALID_PARAMETER',
    message: 'minPrice must be a number'
  });
}

// Range validation (target state)
if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
  return res.status(400).json({
    error: 'INVALID_RANGE',
    message: 'minPrice cannot exceed maxPrice'
  });
}
```

### Logging Pattern (from Auth Orbit)
Auth orbit logs authentication events. Search filtering should log:
```javascript
console.log('Property search filters:', {
  userId: req.user.userId,
  filters: { minPrice, maxPrice, location, propertyType },
  resultCount: result.rows.length
});
```
Do not log full query results (PII/performance concern), only filter parameters and counts.

## Prior Orbit References

### Authentication System Orbit
**Artifacts:** Complete set in `.orbital/artifacts/bffba690-3729-48f5-9223-6609f344063f/`

**Key Patterns Established:**
1. **Middleware Chain:** Body parser → public routes → authentication → protected routes
   - Property search already protected by authenticate middleware
   - Filter logic runs AFTER authentication (req.user available)

2. **Database Connection Pool:**
   - Created in `backend/database/connection.js`
   - Max 20 concurrent connections
   - Connection timeout 2 seconds
   - Property filtering queries will share this pool

3. **SQL File Management:**
   - Queries stored as .sql files, loaded via fs.readFileSync
   - Parameterized queries only ($1, $2, etc.)
   - No string concatenation or dynamic SQL

4. **Performance Targets:**
   - Auth middleware adds <50ms latency (hard requirement), <20ms target
   - Property search filtering must stay within 200ms total (includes auth overhead)
   - Net filter query budget: ~150-180ms after auth middleware

5. **Error Response Format:**
   - Consistent `{ error: 'CODE', message: '...' }` structure
   - 400 for client errors (validation)
   - 401 for auth errors (not applicable here, handled by middleware)
   - 500 for server errors (database failures)

### Other Prior Orbits
**Incomplete Orbit:** `.orbital/artifacts/ffce316e-4d4e-46c6-bb4f-c5310e36a19f/`
- Contains intent, context, and proposal but no verification protocol
- Topic unknown (artifacts not accessible)
- **Implication:** May indicate a failed or abandoned orbit. Check for lessons learned in proposal or orbit log if accessible.

**Early Orbit:** `.orbital/artifacts/93d08324-efe3-4d8d-bbfd-abe2bed1568c/`
- Contains only intent and orbit log
- Predates complete artifact structure
- Likely early testing or initialization orbit

### Lessons from Auth Orbit (Applicable to Filtering)
1. **Security Review Critical:** Auth orbit required human review for SQL injection prevention. Filter queries also manipulate SQL WHERE clauses → same scrutiny required.

2. **Performance Benchmarking:** Auth orbit included load testing for latency targets. Filter implementation must include similar benchmarking with various filter combinations.

3. **Backward Compatibility Testing:** Auth orbit maintained property search functionality. Filter implementation must verify both filtered AND unfiltered requests work.

4. **Incremental Deployment:** Auth orbit used phased rollout with feature flags. Consider similar approach: deploy filtering logic but make it opt-in initially before enforcing.

## Risk Assessment

### High-Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **SQL Injection via Filter Parameters** | CRITICAL — Database compromise, data theft | MEDIUM — Dynamic WHERE clause construction vulnerable if not parameterized | Use parameterized queries exclusively ($1 IS NULL pattern). Validate all inputs before query execution. Code review SQL construction logic. Never concatenate user input into SQL strings. |
| **Backward Compatibility Break** | HIGH — Existing clients fail, production outage | MEDIUM — Unfiltered requests might return different results or errors | Test endpoint without query parameters extensively. Ensure null/undefined parameters skip filtering. Compare unfiltered results before and after deployment. Add automated regression test for zero-parameter case. |
| **Performance Regression on Unfiltered Queries** | HIGH — Slower baseline query impacts all users | MEDIUM — Added WHERE clause logic might slow unoptimized queries | Use `IS NULL` checks that short-circuit efficiently. Test unfiltered query performance before/after. Monitor P95 latency in production. Ensure database query planner optimizes IS NULL conditions correctly. |
| **Missing Database Indexes** | HIGH — 200ms performance target unachievable | HIGH — Target state requires indexes that may not exist | Check current database schema for indexes on price, location, property_type. Create migration script for indexes. Use CREATE INDEX CONCURRENTLY (PostgreSQL) to avoid blocking production queries. Test query plans with EXPLAIN ANALYZE. |
| **Parameter Validation Bypass** | MEDIUM — Malformed inputs cause database errors or unexpected results | MEDIUM — Type coercion edge cases (empty strings, NaN, negative numbers) | Strict validation: check typeof, isNaN, range constraints. Reject empty strings (convert to null). Validate maxPrice >= minPrice. Test with fuzzing inputs (special characters, SQL keywords, extremely large numbers). |

### Medium-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Case Sensitivity Issues** | Users expect case-insensitive location search | Use LOWER() in SQL query for location comparison. Document behavior in API docs. Consider stretch goal for multiple location values. |
| **Query Parameter Injection** | Non-SQL injection (e.g., NoSQL, XSS if logged) | Validate parameter names (only accept minPrice, maxPrice, location, propertyType). Reject unknown parameters. Sanitize logged values. |
| **Filter Combination Explosion** | Many combinations to test (4 filters = 16 scenarios) | Prioritize testing common combinations. Use property-based testing for validation logic. Document expected behavior for edge cases. |
| **Database Connection Exhaustion** | Filtered queries might be slower, hold connections longer | Monitor connection pool usage. Consider query timeout (inherit from pool config). Add query performance logging to identify slow filters. |
| **Empty Result Sets** | Overly restrictive filters return no results | Return empty array (not error). Include filter metadata in response for debugging. Log zero-result filter combinations for analytics. |

### Low-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Inconsistent Property Type Values** | Database has "apartment", "Apartment", "APARTMENT" | Normalize property_type values in database (migration). Use case-insensitive comparison. Stretch goal: validate against enum of allowed types. |
| **Price Precision Issues** | Floating point comparison for currency | Use database NUMERIC/DECIMAL type for price. Avoid JavaScript floating point arithmetic in validation. |
| **Location Format Ambiguity** | "Seattle" vs "Seattle, WA" vs "Seattle, Washington" | Document expected format in API docs. Stretch goal: normalize location input (trim, lowercase). Consider location hierarchy (city, state, country) in future orbit. |

### Performance Risks

| Scenario | Risk | Mitigation |
|----------|------|------------|
| **Full Table Scan Without Indexes** | Query time >1 second on 10,000 rows | Create indexes before deployment. Monitor query plans. Consider partial indexes for common filters. |
| **Index Bloat** | Indexes on text columns (location, property_type) grow large | Monitor index size. Consider prefix indexes for long text values. Use VACUUM (PostgreSQL) or OPTIMIZE TABLE (MySQL) regularly. |
| **Multiple Index Lookups** | Database uses separate indexes for each filter, slow intersection | Test with EXPLAIN ANALYZE. Consider composite index if single-filter queries rare. Benchmark worst-case: all 4 filters applied simultaneously. |
| **Expensive String Operations** | LOWER() function prevents index usage | Use functional index: `CREATE INDEX idx_location_lower ON properties (LOWER(location))`. Test query plan with function. |

### Edge Cases to Test

| Edge Case | Expected Behavior |
|-----------|-------------------|
| minPrice = 0 | Valid (free properties), apply filter |
| maxPrice = 0 | Invalid (illogical), return 400 error (target state) |
| minPrice > maxPrice | Invalid, return 400 error with clear message (target state) |
| location = "" (empty string) | Treat as null/no filter, not literal empty string match |
| location = "null" | Treat as string literal "null", not null filter |
| propertyType with SQL keywords | "SELECT", "DROP", etc. → validate as string, parameterized query prevents injection |
| Very large numbers | minPrice = 999999999999 → validate max safe integer, prevent overflow |
| Negative prices | minPrice = -1000 → validate positive numbers only (minimum viable: allow and let SQL handle; target state: explicit validation) |
| Special characters in location | "Seattle; DROP TABLE--" → parameterized query prevents injection, validate as string |
| Unicode in location | "Zürich", "北京" → ensure database encoding supports, test UTF-8 handling |
| Multiple query parameters with same name | ?location=Seattle&location=Portland → Express req.query behavior (last value wins unless array), document behavior |

### Security Attack Vectors

| Attack Vector | Defense |
|--------------|---------|
| **SQL Injection via minPrice** | Type validation (must be number), parameterized query ($1), no string concatenation |
| **SQL Injection via location** | Parameterized query ($3), no string operations outside SQL, LOWER() function in SQL only |
| **Parameter Pollution** | Validate only expected parameters, reject unknown keys, use explicit parameter extraction |
| **Denial of Service via Expensive Queries** | Query timeout (connection pool default 2 seconds), rate limiting (inherited from auth), monitor slow query log |
| **Information Disclosure via Error Messages** | Generic error messages (no stack traces), don't reveal table/column names, log detailed errors server-side only |
| **Authentication Bypass** | Impossible (authenticate middleware runs first), verify middleware remains in place during testing |

### Monitoring and Observability

**Metrics to Track:**
- Filter parameter usage frequency (which filters used most)
- Query execution time by filter combination
- Empty result rate (filters too restrictive)
- Validation error rate by parameter
- Database index hit rate (vs sequential scans)

**Alerting Thresholds:**
- P95 query latency >200ms → investigate performance regression
- Validation error rate >5% → possible API misuse or documentation issue
- Empty result rate >50% → users not finding properties, filter UX issue
- Sequential scan rate >10% → missing or unused indexes