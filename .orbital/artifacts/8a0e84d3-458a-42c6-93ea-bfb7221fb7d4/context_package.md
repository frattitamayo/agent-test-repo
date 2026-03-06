# Context Package: Property Search API Enhancement

## Codebase References

### Primary Implementation Surface
- **`backend/api/properties/search.js`** — Current API endpoint; this is the main file to be modified. Contains the HTTP handler for `/api/properties/search`. Must be extended to support new filters and performance requirements while maintaining backward compatibility.
- **`backend/database/queries/property-search.sql`** — Existing SQL query logic. Will likely need parameterization for new filter dimensions (price range, property type, beds/baths). Optimization for p95 < 500ms latency requirement may require indexing strategy or query restructuring.

### Supporting Files
- **`README.md`** — Documents the current API running instructions and structure. May need updates to reflect new query parameters and usage examples once implementation is complete.

### Infrastructure Context
- Node.js runtime environment (confirmed by `node backend/api/properties/search.js` command in README)
- SQL database (type not explicitly stated; inferred from `.sql` file extension)
- HTTP server implementation (implied by localhost:3000 endpoint reference)

### Missing Context
- Database connection configuration (not visible in provided structure)
- Database schema for properties table (structure must be inferred from implementation or queried)
- Test files (none present in repository structure)
- Environment configuration (database credentials, connection strings)

## Architecture Context

### Current System State
Based on the repository structure, this is a lightweight Node.js backend with:
- **Single-file API handlers** under `backend/api/properties/` — suggests a simple, route-per-file organization
- **SQL query storage** in `backend/database/queries/` — queries are stored as separate `.sql` files, indicating a separation between API logic and data access
- **No visible ORM or query builder** — raw SQL execution is likely the current pattern

### Data Flow
1. HTTP request → `backend/api/properties/search.js` handler
2. Handler reads/compiles SQL from `backend/database/queries/property-search.sql`
3. Query executes against properties database
4. Results formatted as JSON and returned to client

### Design Constraints
- **Read-only operation:** Search does not mutate data (low-risk for data corruption)
- **Existing endpoint contract:** `/api/properties/search` must maintain current response structure; new parameters must be optional (default behavior unchanged)
- **No architectural changes allowed:** Must work within Node.js/SQL stack (no Redis, Elasticsearch, or new database engines)

### Integration Points
- HTTP server (port 3000, per README)
- SQL database connection (unknown connection pooling strategy)
- No external API dependencies (per intent "Non-Goals")

## Pattern Library

### File Organization Pattern
The repository follows a domain-grouped structure:
- API handlers: `backend/api/{domain}/{action}.js`
- Database artifacts: `backend/database/{type}/{name}.sql`

New files should follow this convention. If additional query files are needed (e.g., separate queries for filtered vs. unfiltered search), place them in `backend/database/queries/`.

### SQL Query Pattern
SQL queries are stored as static `.sql` files rather than inline strings or query builder DSLs. This suggests:
- **Parameterized queries** should use the database driver's native parameter binding (e.g., `$1`, `$2` for PostgreSQL or `?` for MySQL)
- **Query composition** may require reading the SQL file and programmatically adding WHERE clauses for optional filters
- **SQL injection prevention** must use parameterized queries, never string concatenation

### API Response Pattern
From the README reference to "sample JSON response," the API returns JSON directly. Expected pattern:
- HTTP 200 with JSON body on success
- Content-Type: application/json header
- Array of property objects in response body

No schema validation library is evident, so input validation must be implemented manually.

### Error Handling Pattern
Not explicitly visible in the current structure. The agent should:
- Return HTTP 400 for invalid query parameters with descriptive error messages
- Return HTTP 500 only for unrecoverable server errors
- Return HTTP 200 with empty array `[]` for searches with no results (per acceptance: "meaningful messages," but maintain backward compatibility)

### Performance Pattern
No caching layer or rate limiting is evident. The 500ms p95 latency target must be achieved through:
- Database query optimization (indexes, efficient JOIN structures)
- Connection pooling configuration
- Possibly result set limiting (pagination)

## Prior Orbit References

**None.** This is Orbit 1 of the trajectory. No prior work exists in this codebase for this feature.

### Cold Start Considerations
- No established testing patterns to follow
- No existing filter implementation to extend
- No performance baselines from previous orbits
- No deployment or rollback history to learn from

The agent must establish these patterns as part of this orbit. Recommendations:
- Add basic unit tests for input validation logic
- Add integration tests for SQL query correctness
- Document query performance (execution time) in response or logs for observability (aligns with "Stretch" goal)

## Risk Assessment

### Data Privacy Risk (HIGH)
**Risk:** SQL query could inadvertently expose internal IDs, owner PII, or unpublished listings if SELECT statement is not carefully scoped.

**Mitigation:**
- Review `property-search.sql` for any columns that should be excluded (owner names, phone numbers, internal IDs, status flags indicating "draft" or "unpublished")
- Explicitly SELECT only the columns listed in acceptance criteria: address, price, bedrooms, bathrooms, square footage, property type
- Add WHERE clause filtering for published status (if applicable)

### SQL Injection Risk (HIGH)
**Risk:** Adding dynamic filter parameters (price range, location, type) through string concatenation introduces SQL injection vulnerability.

**Mitigation:**
- NEVER concatenate user input into SQL strings
- Use database driver's parameterized query interface for all user-supplied values
- Validate and whitelist allowed property types if that field accepts enumerated values
- Validate numeric inputs (price, beds, baths) are actually numbers before passing to query

### Performance Regression Risk (MEDIUM)
**Risk:** Adding multiple filter dimensions without proper indexing could push p95 latency beyond 500ms, degrading user experience.

**Mitigation:**
- Profile current query execution time before changes (establish baseline)
- Add database indexes on filterable columns: location fields (city, zip), price, property_type, bedrooms, bathrooms
- Implement pagination to limit result set size (prevents large result serialization overhead)
- Test under simulated load (100 concurrent requests per constraint)
- If latency degrades, consider query optimization (avoid SELECT *, use covering indexes, reduce JOIN complexity)

### Backward Compatibility Risk (MEDIUM)
**Risk:** Changes to endpoint behavior could break existing API consumers if default behavior changes.

**Mitigation:**
- All new query parameters must be OPTIONAL
- Endpoint with no parameters should return same results as before (or document intentional change)
- Do not remove or rename existing response fields
- Validate changes by running current query both before and after modifications
- Consider adding API version header (e.g., `X-API-Version: 1`) if future breaking changes are anticipated

### Empty Result UX Risk (LOW)
**Risk:** Users may receive empty arrays without understanding why (no results vs. error).

**Mitigation:**
- Per acceptance "Target" goal: return meaningful messages for empty result sets
- Consider response structure: `{ results: [], count: 0, message: "No properties match your search criteria" }`
- Balance between helpful UX and maintaining backward compatibility (existing clients may expect bare array)

### Missing Schema Risk (LOW)
**Risk:** Assumptions about database schema (available columns, data types) may be incorrect.

**Mitigation:**
- Inspect actual SQL in `property-search.sql` to confirm table structure
- Query database metadata (DESCRIBE table or information_schema) before implementation
- Fail gracefully if expected columns don't exist
- Document discovered schema in code comments for future maintainers

### No Test Coverage Risk (LOW)
**Risk:** Changes cannot be validated programmatically; regressions won't be caught.

**Mitigation:**
- Add minimal test suite as part of this orbit (not a constraint, but recommended)
- At minimum: test input validation edge cases (negative prices, invalid types)
- Consider adding README section with manual testing steps if automated tests aren't feasible