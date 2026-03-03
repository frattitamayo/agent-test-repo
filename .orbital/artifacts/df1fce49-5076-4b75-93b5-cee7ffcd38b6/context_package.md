# Context Package — T3-001: Add GitHub Repository Tree Endpoint

**Generated:** 2024-12-19  
**Package Type:** intent-specific  
**Intent:** T3-001  
**Trust Tier:** tier_2 (automated with review)

---

## Codebase

### Primary (will be modified or created)
- `backend/src/api/routes/github.routes.ts` — new route for repository tree endpoint
- `backend/src/services/github.service.ts` — service method for fetching tree data
- `backend/src/types/github.types.ts` — TypeScript interfaces for tree response
- `backend/src/controllers/github.controller.ts` — controller handling the tree request

### Secondary (dependencies and interfaces)
- `backend/src/config/github.config.ts` — GitHub API configuration and credentials
- `backend/src/middleware/auth.middleware.ts` — authentication middleware for route protection
- `backend/src/middleware/error.middleware.ts` — error handling for API failures
- `backend/src/utils/api-response.ts` — standardized API response helpers
- `backend/src/api/routes/index.ts` — main routes registry

### Tests
- `backend/tests/services/github.service.test.ts` — unit tests for GitHub service
- `backend/tests/api/github.routes.test.ts` — integration tests for the endpoint
- `backend/tests/mocks/github-api.mock.ts` — mock GitHub API responses

---

## Architecture

Prometheus V1 follows a layered backend architecture with routes → controllers → services → external APIs. The GitHub repository tree endpoint will follow this pattern: an authenticated route in the API layer calls a controller that delegates to a GitHub service, which interfaces with GitHub's Git Trees API via Octokit. The service layer handles API client configuration, error transformation, and response normalization.

**Reference docs:**
- `docs/architecture/backend-layers.md`
- `docs/api/github-integration.md`
- `.github/copilot-instructions.md`

---

## Patterns

### Conventions (follow these)
- **Service Layer Pattern**: See `backend/src/services/github.service.ts` — services encapsulate external API calls, use Octokit client, handle rate limiting and errors
- **Route Definition**: See `backend/src/api/routes/*.routes.ts` — routes use Express Router, apply auth middleware, validate params with Zod schemas
- **API Response Format**: See `backend/src/utils/api-response.ts` — use `successResponse()` and `errorResponse()` helpers for consistent JSON structure
- **TypeScript Types**: See `backend/src/types/*.types.ts` — define explicit interfaces for API request/response shapes, avoid `any`
- **Error Handling**: See `backend/src/middleware/error.middleware.ts` — throw custom error classes that get transformed by error middleware

### Anti-patterns (avoid these)
- **Inline API calls in routes**: Never call external APIs directly from route handlers — always delegate to service layer
- **Exposing raw GitHub responses**: Transform GitHub API responses to match Prometheus domain model before returning
- **Missing rate limit handling**: GitHub API has rate limits — service must handle 403/rate-limit errors gracefully
- **Hardcoded credentials**: Never hardcode GitHub tokens — use environment variables via config layer

---

## Dependencies

### Internal
- `backend/src/config/` — configuration management for GitHub API credentials
- `backend/src/middleware/` — auth and error handling middleware
- `backend/src/utils/` — API response formatting utilities
- `backend/src/types/` — shared TypeScript type definitions

### External
- **GitHub REST API** — Git Trees API endpoint: `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1`
- **Octokit (@octokit/rest)** — Official GitHub API client library (already in use)
- **Zod** — Request validation schemas (established pattern in the codebase)

---

## Prior Art

### Completed
- Similar GitHub integration patterns exist in `backend/src/services/github.service.ts` for repository connection and metadata fetching
- Authentication middleware pattern established in `backend/src/middleware/auth.middleware.ts`
- API response format standardized across existing endpoints

### Known Issues
- GitHub API rate limits (5,000 requests/hour for authenticated users) — service should cache tree data or implement request throttling for repeated calls
- Large repositories may have deeply nested tree structures — consider pagination or depth limits
- Tree API requires a tree SHA or branch name — endpoint must handle ref resolution (branch → commit → tree SHA)

---

## Constraints

### Build (must pass)
- `npm test` — all unit and integration tests
- `npm run lint` — ESLint with no errors
- `npm run type-check` — TypeScript compilation with no errors
- `npm run build` — production build succeeds

### Guardrails (do not violate)
- All API routes MUST be protected by authentication middleware
- All external API calls MUST be made through the service layer, not in routes or controllers
- All GitHub API credentials MUST be loaded from environment variables via config module
- All API responses MUST use the standardized response format from `api-response.ts`
- TypeScript `strict` mode is enabled — no `any` types, explicit return types required

---

## External References

### GitHub Git Trees API
- **Documentation**: https://docs.github.com/en/rest/git/trees#get-a-tree
- **Endpoint**: `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`
- **Parameters**:
  - `recursive=1` — fetch entire tree structure in one call
  - `tree_sha` — commit SHA, branch name, or tag
- **Response Structure**:
  ```json
  {
    "sha": "abc123...",
    "url": "https://api.github.com/...",
    "tree": [
      {
        "path": "path/to/file.ts",
        "mode": "100644",
        "type": "blob",
        "size": 1234,
        "sha": "def456...",
        "url": "https://api.github.com/..."
      }
    ],
    "truncated": false
  }
  ```

### Octokit Git Methods
- **Method**: `octokit.rest.git.getTree()`
- **Documentation**: https://octokit.github.io/rest.js/v19#git-get-tree

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Rate limit exceeded** | Medium | High | Implement response caching with TTL; add retry logic with exponential backoff; surface rate limit info in response headers |
| **Large repository timeouts** | Medium | Medium | Set request timeout; document size limitations; consider streaming response for very large trees |
| **Invalid ref/branch name** | High | Low | Validate input with Zod schema; return clear 404 error with helpful message; handle GitHub API 404s gracefully |
| **Missing GitHub permissions** | Low | High | Verify required OAuth scopes during connection setup; return 403 with scope requirements if permission denied |
| **Truncated tree response** | Low | Medium | Check `truncated` field in GitHub response; return warning in response; document limitations for repos >100k files |

### Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Unauthorized access** | Medium | High | Enforce authentication middleware on route; verify user owns/has access to requested repository |
| **Token exposure in logs** | Low | Critical | Ensure GitHub tokens never logged; use sanitized error messages; audit logging configuration |
| **Excessive API usage** | Medium | Medium | Implement per-user rate limiting; cache responses; monitor usage patterns |

### Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Breaking existing GitHub service** | Low | High | Add new method alongside existing ones; maintain backward compatibility; comprehensive test coverage |
| **Inconsistent response format** | Medium | Low | Follow established API response pattern; use existing TypeScript interfaces; code review against standards |
| **Missing error handling** | Medium | Medium | Test all error paths; handle network failures, timeouts, GitHub API errors; use try/catch with proper error transformation |

---

## Acceptance Criteria Mapping

From intent T3-001, verify the implementation addresses:

1. ✓ **Endpoint exists** → Create route at `GET /api/github/repos/:owner/:repo/tree?ref={branch}`
2. ✓ **GitHub API integration** → Use Octokit `git.getTree()` with `recursive=1`
3. ✓ **Structured response** → Return JSON with `files[]` array containing path, type, size, sha
4. ✓ **Branch/ref support** → Accept `ref` query parameter, default to `main` or `master`
5. ✓ **Error handling** → Transform GitHub errors to user-friendly messages with proper status codes
6. ✓ **Authentication** → Protect route with auth middleware, use user's GitHub connection

---

## Implementation Notes

- Start with the service layer method before creating the route — easier to unit test in isolation
- Use existing GitHub service instance; don't create new Octokit client
- The GitHub API returns `tree` (directory) and `blob` (file) types — map these to frontend-friendly names
- Consider adding a `maxDepth` parameter for very large repositories to prevent timeout
- Include the commit SHA in the response so frontend can cache based on content, not just branch name
- Add integration tests that use the mock GitHub API client to avoid rate limit consumption during CI