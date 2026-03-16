# Add Property Filtering to Search API

## Desired Outcome

Users can narrow property search results by applying filters for price range, location, and property type through query parameters. When complete, the property search endpoint accepts optional filter parameters and returns only properties matching all specified criteria. The API maintains backward compatibility for clients not using filters (returns all properties as before). Response times remain under 200ms for filtered queries against datasets up to 10,000 properties.

## Constraints

- **API Compatibility:** Existing `/api/properties/search` endpoint must continue to work without query parameters (returns all results). Clients using the endpoint today must experience zero breaking changes.
- **Query Parameter Format:** Use standard REST conventions: `?minPrice=100000&maxPrice=500000&location=Seattle&propertyType=apartment`. No custom parameter encoding or JSON in query strings.
- **Database Layer:** Filtering logic must be implemented in SQL (backend/database/queries/property-search.sql) using parameterized queries. No in-memory filtering of full result sets in JavaScript.
- **Security Baseline:** All query parameters must be validated and sanitized. SQL injection prevention through parameterized queries only. No dynamic SQL string concatenation.
- **Performance Budget:** Filtered queries must return results in under 200ms (P95) for datasets up to 10,000 properties. Database queries must use indexes on filterable columns.
- **Authentication:** All requests must pass through existing JWT authentication middleware (established in prior orbit). No changes to authentication logic.
- **Response Schema:** Property object structure in response must remain identical to current format. Only the array of returned properties changes based on filters.
- **Non-Goals:** Advanced search features (full-text search, fuzzy matching, geospatial radius queries), pagination, sorting options, filter presets/saved searches.

## Acceptance Boundaries

**Minimum Viable (Must Have):**
- GET /api/properties/search accepts optional query parameters: minPrice, maxPrice, location, propertyType
- Missing parameters treated as "no filter" for that dimension (e.g., no minPrice means no lower bound)
- Invalid parameter values return 400 status with descriptive error messages (e.g., minPrice not a number)
- SQL query uses WHERE clause with parameterized conditions for all present filters
- Response contains only properties matching ALL specified filters (AND logic, not OR)
- Endpoint works without parameters (backward compatibility verified)
- Database query execution time under 500ms for 10,000 property dataset

**Target State (Should Have):**
- Query execution time under 200ms P95 for filtered queries
- Database indexes created on price, location, and property_type columns
- Parameter validation rejects out-of-range values (e.g., minPrice > maxPrice returns 400)
- Error responses include field-level validation messages (e.g., "minPrice must be a positive number")
- Request logging captures filter parameters for analytics
- API documentation updated with filter parameter examples

**Stretch (Nice to Have):**
- Case-insensitive location matching with trimmed whitespace
- Multiple location values supported (comma-separated: `location=Seattle,Portland`)
- Property type accepts standardized enum values with validation
- Query result caching for common filter combinations (5-minute TTL)
- Performance metrics endpoint showing filter usage statistics

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:** This orbit modifies a production API endpoint with established authentication and touches the database query layer. While the implementation pattern (parameterized SQL queries with optional WHERE clauses) is standard, the integration requires careful review of:

- SQL query construction to ensure parameterized queries prevent injection despite dynamic WHERE clause building
- Backward compatibility validation that existing clients continue to function
- Performance impact assessment through load testing with realistic filter combinations
- Input validation logic that rejects malicious or malformed parameters without leaking system information

The supervised tier allows autonomous implementation with mandatory human review before deployment. A mid-level engineer should verify the SQL queries are safe, performance is acceptable, and backward compatibility is maintained. This is not tier 3 (gated) because query filtering is a routine feature with established patterns, but requires more scrutiny than tier 1 due to the security and performance considerations of database query modification.

## Dependencies

**Prior Orbit Dependencies:**
- **Authentication System (Prior Orbit):** This orbit assumes JWT authentication middleware is active on /api/properties/search. All filtering logic executes only for authenticated requests. The authentication implementation from the previous orbit must be complete and deployed before this work begins.

**Codebase Dependencies:**
- **backend/api/properties/search.js:** Current endpoint implementation that must be extended to parse and validate query parameters
- **backend/database/queries/property-search.sql:** Existing SQL query that must be modified to support conditional WHERE clauses
- **backend/database/connection.js:** Database connection pool (established in auth orbit) for executing filtered queries

**Database Dependencies:**
- **properties table schema:** Must include columns for price (numeric), location (text/varchar), and property_type (text/varchar). Exact column names and types must be confirmed from actual schema.
- **Database indexes:** Target state requires indexes on filterable columns. If indexes don't exist, migration must create them without blocking production queries.

**External Dependencies:**
- **SQL database engine:** PostgreSQL or MySQL (consistent with auth orbit assumptions) must support parameterized queries with optional parameters
- **Node.js environment:** Query parameter parsing via Express (req.query) or equivalent framework

**Knowledge Dependencies:**
- **Current properties table schema:** Column names, data types, and existing indexes
- **Expected property object structure:** Response format that must remain unchanged
- **Typical filter value distributions:** Expected ranges for price, common location values, valid property types (for validation logic)
- **Production dataset size:** Current property count to calibrate performance testing

**Coordination Dependencies:**
- **No concurrent database migrations:** This orbit should not run simultaneously with other orbits modifying the properties table schema
- **API documentation ownership:** Clarify who updates API docs (if separate from code repository)