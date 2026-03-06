# Property Search API Enhancement

## Desired Outcome

Users can discover properties through a fast, reliable search API that returns relevant results based on location, price range, and property characteristics. The search experience is responsive (sub-500ms p95 latency) and supports common real estate search patterns without requiring users to understand database schemas or complex query syntax.

## Constraints

- **Performance Budget:** API response time must not exceed 500ms at p95 under normal load (up to 100 concurrent requests)
- **Backward Compatibility:** Existing `/api/properties/search` endpoint contract must remain unchanged; new functionality must be additive
- **Data Privacy:** Must not expose internal property IDs, owner PII, or unpublished listings in any response
- **Technology Stack:** Must work within the existing Node.js/SQL stack; no new database engines or architectural patterns
- **Non-Goals:** This intent does NOT cover authentication/authorization, property detail views, saved searches, or map-based interfaces

## Acceptance Boundaries

### Minimum Viable
- API returns valid JSON for all search requests with HTTP 200
- Search supports at minimum: location (city/zip), price range (min/max), and property type filters
- Results include: property address, price, bedrooms, bathrooms, square footage
- No runtime errors or 500 responses under normal query conditions
- Basic input validation prevents SQL injection and malformed requests

### Target
- p95 latency ≤ 500ms for searches returning up to 100 results
- Results sorted by relevance (price proximity to user's range, distance from location center)
- Pagination support (page size configurable, default 20 items)
- At least 3 filter dimensions working simultaneously (e.g., location + price + type)
- Empty result sets return meaningful messages (not generic errors)

### Stretch
- p95 latency ≤ 200ms
- Fuzzy location matching (e.g., neighborhood names, nearby cities)
- 5+ filter dimensions (add: beds/baths min/max, year built, lot size)
- Search query validation returns specific field-level error messages
- Response includes result count and query execution time for observability

## Trust Tier Assignment

**Tier 1 — Autonomous**

**Rationale:** This intent operates on an existing read-only API endpoint with low blast radius. The search functionality does not modify data, handle payments, or touch authentication flows. Performance regressions are observable through monitoring and easily reversible. The constraints explicitly bound the scope to non-sensitive operations (no PII exposure, no architectural changes). While the API is user-facing, failures result in degraded search experience rather than data loss or security incidents. The minimum viable acceptance criteria ensure basic correctness, making autonomous execution with post-deployment monitoring appropriate.

## Dependencies

### Code Dependencies
- **backend/api/properties/search.js** — Current API endpoint implementation; must be extended, not replaced
- **backend/database/queries/property-search.sql** — Existing query logic; may need optimization or parameterization for new filters

### Data Dependencies
- Property database schema (assumed to exist based on current SQL query)
- Property records must include fields referenced in acceptance criteria (address, price, beds, baths, sqft, type)
- No dependency on external geocoding services or third-party APIs (location matching uses database fields)

### System Dependencies
- Node.js runtime environment
- SQL database connection (type inferred from .sql file presence)
- No new infrastructure provisioning required

### Prior Orbit Context
- This is Orbit 1 — no prior orbit dependencies
- Orbit summary indicates "testing" phase; this intent establishes the foundational search capability for the trajectory