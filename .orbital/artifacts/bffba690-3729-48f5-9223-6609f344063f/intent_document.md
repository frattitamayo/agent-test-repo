# Implement User Authentication System

## Desired Outcome

Engineers can authenticate users securely through a JWT-based system integrated with the existing property search API. When complete, the API endpoints require valid authentication tokens, user sessions persist across requests, and unauthorized access attempts are rejected with appropriate HTTP responses. The property search functionality remains fully operational for authenticated users while gaining protection against unauthorized access.

## Constraints

- **Technology Stack:** Must use Node.js with Express framework to match existing backend/api structure. JWT implementation must use industry-standard libraries (jsonwebtoken, bcrypt).
- **Database:** Authentication tables must integrate with existing SQL database infrastructure visible in backend/database/queries pattern. No MongoDB or external auth services.
- **API Compatibility:** Existing property search endpoint (backend/api/properties/search.js) must remain functional with minimal breaking changes. Response schemas cannot change.
- **Security Baseline:** Passwords must be hashed with bcrypt (minimum 10 rounds). JWTs must expire within 24 hours. No plaintext credential storage. No authentication logic in frontend until backend is proven stable.
- **Performance Budget:** Authentication middleware must add less than 50ms latency to existing API calls. Token validation must not require database queries for every request.
- **Non-Goals:** User registration UI, password reset flows, OAuth integration, role-based access control beyond basic authenticated/unauthenticated states.

## Acceptance Boundaries

**Minimum Viable (Must Have):**
- JWT token generation endpoint accepting username/password returns valid tokens
- Token validation middleware successfully blocks unauthenticated requests to /api/properties/search
- Valid tokens allow full access to property search with identical response format
- User credentials table created with hashed passwords
- Authentication failures return 401 status with error messages
- Token expiration enforced (24-hour window)

**Target State (Should Have):**
- Token refresh mechanism to extend sessions without re-authentication
- Authentication middleware response time under 20ms (P95)
- Login endpoint rate limiting (max 5 attempts per minute per IP)
- Graceful error handling for expired, malformed, or missing tokens with distinct error codes
- Basic audit logging for authentication events (login, logout, token refresh)

**Stretch (Nice to Have):**
- Token revocation capability for logout/security events
- Multiple concurrent sessions per user with session tracking
- Authentication metrics endpoint showing active sessions and auth rate
- Integration tests covering happy path and edge cases with >80% coverage

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:** Authentication systems have high blast radius affecting all API consumers and introduce security attack surfaces (token forgery, session hijacking, credential exposure). While the implementation pattern is well-established, integration with the existing codebase requires careful review of:

- Middleware injection points that don't break existing functionality
- Database schema changes that align with current query patterns
- Error handling that doesn't leak sensitive information
- Token generation/validation logic that follows security best practices

The supervised tier allows autonomous execution with mandatory human review before deployment. A junior-to-mid level engineer should verify the implementation matches security standards and doesn't introduce vulnerabilities. This is not tier 3 (gated) because the patterns are standard and testable, but requires more scrutiny than routine feature work.

## Dependencies

**Codebase Dependencies:**
- Existing backend/api structure and routing patterns
- Current SQL database connection configuration (referenced by backend/database/queries pattern)
- Express server initialization and middleware chain (inferred from search.js structure)

**External Dependencies:**
- npm packages: jsonwebtoken (^9.0.0), bcrypt (^5.1.0), express-rate-limit (^6.0.0)
- SQL database engine compatible with existing property-search.sql patterns (PostgreSQL or MySQL assumed)

**Knowledge Dependencies:**
- Database connection string and credentials for schema migration
- Current API deployment process and environment configuration
- Existing logging infrastructure to integrate auth events

**Prior Orbit References:**
- None identified in current repository structure. This appears to be the first authentication implementation.