# Proposal Record: Implement Property Search API Endpoint

## Interpreted Intent

This orbit implements a filtered property search API endpoint that enables front-end applications to query properties based on four search criteria: location (exact match), price range (min/max boundaries), property type (categorical filter), and availability status (categorical filter). The endpoint returns paginated JSON results conforming to the established API contract pattern visible in the codebase.

The implementation must prioritize security (SQL injection prevention through parameterized queries) and performance (sub-500ms p95 response time under concurrent load). The endpoint is read-only, stateless, and does not include advanced search features like full-text search, geospatial queries, or relevance ranking.

Success is measured by: correct filter application, pagination functionality, response time compliance, comprehensive input validation with actionable error messages, and total result count metadata.

## Implementation Plan

### Phase 1: Pre-Implementation Verification

**Action 1.1: Inspect Existing Files**

Examine the current state of target files to determine modification vs. creation strategy:

- **`backend/api/properties/search.js`** — Determine if this is an empty stub, partial implementation, or complete existing endpoint
- **`backend/database/queries/property-search.sql`** — Verify if SQL template exists and assess its structure

**Action 1.2: Locate Infrastructure Dependencies**

Identify and document the following files (critical for correct implementation):

- Database connection pool module (expected path: `backend/database/pool.js` or `backend/database/connection.js`)
- API router registration file (expected path: `backend/api/index.js` or `backend/api/properties/index.js`)
- Existing API endpoint for pattern reference (any file in `backend/api/` that demonstrates response formatting)
- Validation utilities if standardized (expected path: `backend/api/middleware/` or `backend/utils/validation.js`)

**Action 1.3: Database Schema Verification**

Query the `properties` table schema to confirm:

- Column names match assumptions: `location`, `price`, `property_type`, `availability_status`
- Data types for each column (TEXT, INTEGER/NUMERIC, ENUM/VARCHAR, ENUM/VARCHAR respectively)
- Existing indexes on searchable columns (critical for performance constraint)
- Presence of `id`, `created_at`, and other metadata columns for response construction

**Decision Point**: If indexes are missing on `location`, `price`, `property_type`, or `availability_status`, create a separate orbit for index creation before implementing this endpoint.

### Phase 2: SQL Query Implementation

**File: `backend/database/queries/property-search.sql`**

Create or modify the SQL query template with the following structure:

```sql
SELECT 
    id,
    location,
    price,
    property_type,
    availability_status,
    created_at,
    -- additional property fields as needed
    COUNT(*) OVER() AS total_count
FROM properties
WHERE 
    ($1::text IS NULL OR location = $1)
    AND ($2::numeric IS NULL OR price >= $2)
    AND ($3::numeric IS NULL OR price <= $3)
    AND ($4::text IS NULL OR property_type = $4)
    AND ($5::text IS NULL OR availability_status = $5)
ORDER BY created_at DESC
LIMIT $6
OFFSET $7;
```

**Design Rationale**:

- Uses PostgreSQL parameterized queries (`$1` through `$7`) to prevent SQL injection
- Implements NULL-safe filtering: if a parameter is NULL, that filter is bypassed (allows optional filters)
- Includes `COUNT(*) OVER()` window function to return total result count without a separate query (performance optimization)
- Uses `LIMIT` and `OFFSET` for pagination
- Default sort by `created_at DESC` (newest first) — can be enhanced in future orbits

**Performance Consideration**: The `COUNT(*) OVER()` adds overhead. If performance testing reveals this violates the 500ms constraint, split into two queries: one for results, one for count (executed in parallel).

### Phase 3: API Endpoint Implementation

**File: `backend/api/properties/search.js`**

Implement the route handler following this structure:

```javascript
const fs = require('fs');
const path = require('path');
const pool = require('../../database/pool'); // Adjust path based on actual structure

// Load SQL query template at module initialization (performance optimization)
const searchQuerySQL = fs.readFileSync(
    path.join(__dirname, '../../database/queries/property-search.sql'),
    'utf8'
);

// Property type whitelist (prevents invalid enum values)
const VALID_PROPERTY_TYPES = ['residential', 'commercial', 'industrial', 'land'];
const VALID_STATUSES = ['available', 'pending', 'sold', 'off-market'];

// Pagination constraints
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

async function searchProperties(req, res) {
    try {
        // Extract and validate query parameters
        const {
            location,
            minPrice,
            maxPrice,
            propertyType,
            status,
            page = 1,
            pageSize = DEFAULT_PAGE_SIZE
        } = req.query;

        // Input validation
        const validationErrors = [];

        // Validate price range
        const parsedMinPrice = minPrice ? parseFloat(minPrice) : null;
        const parsedMaxPrice = maxPrice ? parseFloat(maxPrice) : null;

        if (minPrice && (isNaN(parsedMinPrice) || parsedMinPrice < 0)) {
            validationErrors.push({ field: 'minPrice', message: 'Must be a non-negative number' });
        }
        if (maxPrice && (isNaN(parsedMaxPrice) || parsedMaxPrice < 0)) {
            validationErrors.push({ field: 'maxPrice', message: 'Must be a non-negative number' });
        }
        if (parsedMinPrice && parsedMaxPrice && parsedMinPrice > parsedMaxPrice) {
            validationErrors.push({ field: 'priceRange', message: 'minPrice cannot exceed maxPrice' });
        }

        // Validate property type against whitelist
        if (propertyType && !VALID_PROPERTY_TYPES.includes(propertyType)) {
            validationErrors.push({ 
                field: 'propertyType', 
                message: `Must be one of: ${VALID_PROPERTY_TYPES.join(', ')}` 
            });
        }

        // Validate status against whitelist
        if (status && !VALID_STATUSES.includes(status)) {
            validationErrors.push({ 
                field: 'status', 
                message: `Must be one of: ${VALID_STATUSES.join(', ')}` 
            });
        }

        // Validate pagination parameters
        const parsedPage = parseInt(page, 10);
        const parsedPageSize = parseInt(pageSize, 10);

        if (isNaN(parsedPage) || parsedPage < 1) {
            validationErrors.push({ field: 'page', message: 'Must be a positive integer' });
        }
        if (isNaN(parsedPageSize) || parsedPageSize < 1 || parsedPageSize > MAX_PAGE_SIZE) {
            validationErrors.push({ 
                field: 'pageSize', 
                message: `Must be between 1 and ${MAX_PAGE_SIZE}` 
            });
        }

        // Return validation errors if any
        if (validationErrors.length > 0) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid search parameters',
                    details: validationErrors
                }
            });
        }

        // Calculate OFFSET for pagination
        const offset = (parsedPage - 1) * parsedPageSize;

        // Execute query with parameterized values
        const result = await pool.query(searchQuerySQL, [
            location || null,
            parsedMinPrice || null,
            parsedMaxPrice || null,
            propertyType || null,
            status || null,
            parsedPageSize,
            offset
        ]);

        // Extract total count from first row (if results exist)
        const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;

        // Remove total_count from individual rows (it's metadata, not property data)
        const properties = result.rows.map(row => {
            const { total_count, ...property } = row;
            return property;
        });

        // Calculate pagination metadata
        const totalPages = Math.ceil(totalCount / parsedPageSize);
        const hasMore = parsedPage < totalPages;

        // Return success response
        res.status(200).json({
            data: properties,
            pagination: {
                page: parsedPage,
                pageSize: parsedPageSize,
                total: totalCount,
                totalPages: totalPages,
                hasMore: hasMore
            }
        });

    } catch (error) {
        // Log detailed error server-side
        console.error('Property search error:', error);

        // Return sanitized error to client
        res.status(500).json({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An error occurred while searching properties'
            }
        });
    }
}

module.exports = searchProperties;
```

**Key Implementation Details**:

- **SQL Injection Prevention**: All user inputs passed as parameterized query arguments, never concatenated into SQL
- **Input Validation**: Comprehensive validation with field-level error messages (meets "Exceptional" acceptance criteria)
- **Whitelist Validation**: Property types and statuses validated against predefined lists
- **Pagination**: Default page size of 20, maximum 100 to prevent resource exhaustion
- **Error Handling**: Specific error codes (400, 500) with structured error objects
- **Performance**: SQL template loaded once at module initialization, not on every request

### Phase 4: Route Registration

**File: `backend/api/properties/index.js` or `backend/api/index.js`**

Register the search endpoint (exact file depends on existing routing architecture):

```javascript
const express = require('express');
const router = express.Router();
const searchProperties = require('./search');

// GET /api/properties/search
router.get('/search', searchProperties);

module.exports = router;
```

**Alternative**: If the app uses a centralized router in `backend/api/index.js`, add:

```javascript
const propertiesSearch = require('./properties/search');
app.get('/api/properties/search', propertiesSearch);
```

### Phase 5: Testing and Validation

**Action 5.1: Unit Tests**

Create test file: `backend/api/properties/search.test.js`

Test cases must cover:

- Valid search with all parameters (location + price range + type + status)
- Valid search with subset of parameters (location only, price range only, etc.)
- Pagination correctness (page 1, page 2, boundary conditions)
- Input validation errors (negative prices, invalid property type, invalid page number)
- SQL injection attempts (parameterized query should safely handle malicious input)
- Empty result set handling (no properties match criteria)
- Maximum page size enforcement

**Action 5.2: Integration Tests**

Test against actual database with known test data:

- Verify filter logic correctness (results match WHERE clauses)
- Confirm total count accuracy
- Validate response format matches API contract
- Test concurrent request handling (simulate 100 concurrent searches)

**Action 5.3: Performance Benchmarking**

Use load testing tool (e.g., Apache Bench, k6) to measure:

- p95 response time under 100 concurrent searches
- Connection pool behavior (no starvation, proper connection release)
- Database query execution time (use PostgreSQL `EXPLAIN ANALYZE` on the query)

**Performance Gate**: If p95 > 500ms, investigate:

1. Missing indexes (most likely cause)
2. `COUNT(*) OVER()` overhead (consider separate count query)
3. Database connection pool size (may need tuning)

## Risk Surface

### SQL Injection Risk (Critical)

**Mitigation**: All user inputs passed as parameterized query arguments (`$1` through `$7` in the SQL template). The implementation must never use template literals or string concatenation to build SQL queries.

**Verification**: Code review must confirm no instances of `pool.query(`SELECT ... WHERE location = '${location}'`)` or similar patterns. Unit tests should include SQL injection attack strings (e.g., `location="'; DROP TABLE properties; --"`) and verify they are safely handled.

### Missing Database Indexes Risk (High)

**Impact**: Without indexes on `location`, `price`, `property_type`, and `availability_status`, queries may perform full table scans, violating the 500ms performance constraint.

**Mitigation**: Pre-implementation Phase 1.3 requires index verification. If indexes are missing, this orbit should be paused and a separate orbit created to add indexes before continuing.

**Index Strategy**:
- Single-column indexes on each searchable field (minimum)
- Composite index on `(location, price, property_type, availability_status)` if multi-filter searches are common (optimal)

### Input Validation Bypass Risk (Medium)

**Scenario**: If frontend sends unexpected parameter types (e.g., array instead of string), validation logic might fail unpredictably.

**Mitigation**: The validation logic uses explicit type coercion (`parseFloat`, `parseInt`) and checks for `isNaN`. Array inputs will be converted to `NaN` and rejected. Additional safety: use `typeof` checks before parsing.

### Connection Pool Exhaustion Risk (Medium)

**Scenario**: If queries hang or take too long, connections might not be released, starving the pool.

**Mitigation**: 
- The `async/await` pattern ensures connections are released after query completion
- Add query timeout to the pool configuration (e.g., `statement_timeout = 5000ms` in PostgreSQL)
- Monitor pool metrics in production to detect exhaustion early

### API Contract Breakage Risk (Low)

**Scenario**: If existing consumers expect a different response format, this implementation could break them.

**Mitigation**: Phase 1.2 requires examining existing API endpoints to confirm response format pattern. The implementation assumes `{ data, pagination }` structure but must be adjusted if pattern differs.

**Verification**: Manual testing with frontend application (if available) before production deployment.

### Performance Degradation Risk (Medium)

**Scenario**: The `COUNT(*) OVER()` window function adds computational overhead that could exceed the 500ms budget on large datasets.

**Mitigation**: 
- Phase 5.3 performance benchmarking must occur before production deployment
- If p95 > 500ms, refactor to execute count query separately (or asynchronously)
- Consider caching total count for common search filters (future orbit)

### Property Type/Status Enum Mismatch Risk (Medium)

**Scenario**: If database schema uses different enum values than hardcoded whitelists, validation will incorrectly reject valid searches.

**Mitigation**: Phase 1.3 database schema verification must confirm enum values. If database uses ENUM types, query `information_schema` to extract valid values dynamically rather than hardcoding.

**Alternative Implementation**:
```javascript
// Query valid enum values from database at module initialization
const { rows } = await pool.query(`
    SELECT unnest(enum_range(NULL::property_type_enum)) AS value
`);
const VALID_PROPERTY_TYPES = rows.map(r => r.value);
```

## Scope Estimate

### Complexity Assessment: Medium

**Factors**:
- **Implementation Complexity**: Low — standard CRUD operation with filtering and pagination
- **Security Complexity**: Medium — requires careful input validation and SQL injection prevention
- **Performance Complexity**: Medium — requires index verification and load testing
- **Integration Complexity**: Low — follows established patterns, minimal cross-service dependencies

### Estimated Orbit Count: 1 Orbit

**Breakdown**:

| Phase | Effort Estimate | Dependencies |
|-------|----------------|--------------|
| Pre-Implementation Verification | 2 hours | Database access, codebase inspection |
| SQL Query Implementation | 1 hour | Database schema confirmation |
| API Endpoint Implementation | 3 hours | SQL query completed, pool module identified |
| Route Registration | 0.5 hours | API endpoint completed |
| Testing and Validation | 4 hours | All implementation completed |
| **Total** | **10.5 hours** | — |

**Assumptions**:
- Database indexes already exist on searchable columns (if not, add 1-2 hours for index creation orbit)
- Database connection pool module is functional and documented (if not, add 2-3 hours for pool setup)
- No significant architectural changes required to existing API framework
- Test database environment is available with representative data (at least 10,000 properties for realistic performance testing)

### Work Phases

**Phase 1**: Pre-Implementation Verification (2 hours) — Can proceed immediately
**Phase 2**: SQL Query Implementation (1 hour) — Blocked by Phase 1 schema verification
**Phase 3**: API Endpoint Implementation (3 hours) — Blocked by Phase 2 SQL completion
**Phase 4**: Route Registration (0.5 hours) — Blocked by Phase 3 endpoint completion
**Phase 5**: Testing and Validation (4 hours) — Blocked by Phase 4 route registration

**Critical Path**: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 (sequential dependencies, no parallelization opportunities)

### Expansion Scenarios

**If Performance Budget Cannot Be Met**:
- Add 2-3 hours for query optimization (remove `COUNT(*) OVER()`, add separate count query)
- Add 1-2 hours for index tuning (composite indexes, index analysis)
- Consider caching layer (separate orbit, 8-10 hours)

**If Database Schema Differs from Assumptions**:
- Add 1-2 hours for schema adapter layer
- Add 1 hour for additional validation logic

**If API Contract Differs from Assumptions**:
- Add 1-2 hours for response format refactoring
- Add 1 hour for frontend compatibility testing

## Human Modifications

Pending human review.