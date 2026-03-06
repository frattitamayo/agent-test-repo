# Context Package: Property Search API Enhancement

**Generated:** 3/6/2026
**Package Type:** intent-specific
**Intent:** hola

---

## Codebase

### Primary (will be modified or created)
- `backend/api/properties/search.js` — Current API endpoint; this is the main file to be modified. Contains the HTTP handler for `/api/properties/search`. Must be extended to support new filters and performance requirements while maintaining backward compatibility.
- `backend/database/queries/property-search.sql` — Existing SQL query logic. Will likely need parameterization for new filter dimensions (price range, property type, beds/baths). Optimization for p95 < 500ms latency requirement may require indexing strategy or query restructuring.

### Secondary (dependencies and interfaces)
- `README.md` — Documents the current API running instructions and structure. May need updates to reflect new query parameters and usage examples once implementation is complete.

### Tests
- None present in repository structure

---

## Architecture

Based on the repository structure, this is a lightweight Node.js backend with single-file API handlers under `backend/api/properties/` and SQL query storage in `backend/database/queries/`. The data flow is: HTTP request → handler → SQL file execution → JSON response. This is a read-only search operation with no architectural changes allowed (must work within Node.js/SQL stack).

**Reference docs:**
- `README.md` — Current running instructions and structure

**Missing Context:**
- Database connection configuration (not visible in provided structure)
- Database schema for properties table (structure must be inferred from implementation or queried)
- Environment configuration (database credentials, connection strings)

---

## Patterns

### Conventions (follow these)
- **File Organization**: API handlers follow `backend/api/{domain}/{action}.js` pattern; database artifacts follow `backend/database/{type}/{name}.sql` pattern
- **SQL Query Storage**: Queries stored as static `.sql` files rather than inline strings. Use database driver's native parameter binding (e.g., `$1`, `$2` for PostgreSQL or `?` for MySQL) for parameterized queries
- **API Response Format**: Return JSON directly with HTTP 200 on success, Content-Type: application/json header, array of property objects in response body
- **Input Validation**: No schema validation library evident; implement manual validation for query parameters

### Anti-patterns (avoid these)
- **SQL Injection**: NEVER concatenate user input into SQL strings; always use parameterized queries
- **String Concatenation for Queries**: Do not build dynamic SQL through string concatenation
- **Breaking Backward Compatibility**: All new query parameters must be OPTIONAL; do not remove or rename existing response fields

---

## Dependencies

### Internal
- Node.js runtime environment (confirmed by `node backend/api/properties/search.js` command in README)
- SQL database (type not explicitly stated; inferred from `.sql` file extension)
- HTTP server implementation (implied by localhost:3000 endpoint reference)

### External
- Database driver (connection pooling strategy unknown)
- No external API dependencies (per intent "Non-Goals")

---

## Prior Art

### Completed
- None. This is Orbit 1 of the trajectory. No prior work exists in this codebase for this feature.

### Known Issues
- No established testing patterns to follow
- No existing filter implementation to extend
- No performance baselines from previous orbits
- No deployment or rollback history to learn from

**Cold Start Recommendations:**
- Add basic unit tests for input validation logic
- Add integration tests for SQL query correctness
- Document query performance (execution time) in response or logs for observability

---

## Constraints

### Build (must pass)
- `node backend/api/properties/search.js` — API must start without errors
- Manual API testing at http://localhost:3000/api/properties/search

### Guardrails (do not violate)
- **Performance Budget**: API response time must not exceed 500ms at p95 under normal load (up to 100 concurrent requests)
- **Backward Compatibility**: Existing `/api/properties/search` endpoint contract must remain unchanged; new functionality must be additive
- **Data Privacy**: Must not expose internal property IDs, owner PII, or unpublished listings in any response
- **Technology Stack**: Must work within existing Node.js/SQL stack; no new database engines or architectural patterns
- **SQL Injection Prevention**: All user inputs must use parameterized queries, never string concatenation

---

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