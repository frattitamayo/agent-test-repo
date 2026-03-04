# Context Package — T3-003: Add GitHub Branch Diff Endpoint

**Generated:** 2024-01-XX
**Package Type:** intent-specific
**Intent:** T3-003

---

## Codebase

### Primary (will be modified or created)
- `backend/api/routes/github.py` or `backend/api/github/` — GitHub API endpoints
- `backend/services/github_service.py` — GitHub service layer for diff operations
- `backend/tests/api/test_github_diff.py` — endpoint tests
- `backend/tests/services/test_github_service.py` — service layer tests

### Secondary (dependencies and interfaces)
- `backend/api/middleware/auth.py` — authentication middleware
- `backend/models/repository.py` — repository models
- `backend/services/git_client.py` — Git/GitHub client wrapper
- `backend/config/github.py` — GitHub configuration and credentials
- `backend/api/schemas/github.py` — request/response schemas

### Tests
- Existing GitHub integration tests
- API endpoint test patterns
- Mock patterns for GitHub API calls

---

## Architecture

The endpoint will live in the backend API layer, consume the GitHub service layer to interact with the GitHub API, and return structured diff data. This follows the standard API → Service → External API pattern used throughout Prometheus for third-party integrations.

**Reference docs:**
- Project architecture documentation
- GitHub API integration patterns
- API response format standards

---

## Patterns

### Conventions (follow these)
- **API Endpoint Pattern**: RESTful design with proper HTTP verbs, status codes, and error handling
- **Service Layer Pattern**: Business logic isolated in service classes, dependency injection
- **Authentication**: JWT-based auth middleware on all API routes
- **Response Format**: Consistent JSON structure with `data`, `error`, and `metadata` fields
- **Testing**: Unit tests for services, integration tests for endpoints, mock external API calls

### Anti-patterns (avoid these)
- **Direct API calls in routes**: GitHub API calls must go through the service layer
- **Hardcoded credentials**: Use configuration management for tokens/secrets
- **Missing error handling**: All GitHub API calls can fail — handle rate limits, auth errors, network issues
- **Unbounded responses**: Diff responses must be paginated or size-limited

---

## Dependencies

### Internal
- `backend/services/` — Service layer abstractions
- `backend/api/middleware/` — Auth and request validation
- `backend/models/` — Data models for repository and user context
- `backend/config/` — Configuration management

### External
- **GitHub REST API** — Comparing commits endpoint: `GET /repos/{owner}/{repo}/compare/{base}...{head}`
- **GitHub API Python Library** — PyGithub or similar for API interaction
- **Git Python** — Optional for local Git operations if needed

---

## Prior Art

### Completed
- Existing GitHub integration for repository connection
- Authentication patterns used in other API endpoints
- Error handling patterns for external API calls

### Known Issues
- GitHub API rate limiting must be handled
- Large diffs may cause timeout or memory issues — consider streaming or pagination
- Branch ref resolution (handle tags, commits, branches uniformly)

---

## Constraints

### Build (must pass)
- Backend test suite
- Linting and type checking
- Security scanning for secrets/credentials

### Guardrails (do not violate)
- Never expose GitHub tokens in responses or logs
- All endpoints must require authentication
- Responses must include proper CORS headers
- Rate limiting must be implemented to prevent GitHub API abuse

---

## Risk Assessment

### What Could Go Wrong
1. **GitHub API Rate Limits** — Exceeded rate limits will cause 403 errors
   - *Mitigation*: Cache diff results, implement rate limit tracking, use authenticated requests for higher limits

2. **Large Diff Responses** — Very large diffs could timeout or exhaust memory
   - *Mitigation*: Implement response size limits, paginate if needed, stream large responses

3. **Invalid Branch References** — Users may request diffs for non-existent branches
   - *Mitigation*: Validate refs exist before requesting diff, return clear error messages

4. **Authorization Issues** — Users shouldn't see diffs for repositories they don't have access to
   - *Mitigation*: Verify user permissions against repository before fetching diff

5. **Network/API Failures** — GitHub API may be unavailable
   - *Mitigation*: Implement retry logic with exponential backoff, return graceful error responses

---

## Implementation Notes

### Endpoint Specification
```
GET /api/v1/github/repos/{owner}/{repo}/diff
Query params:
  - base: string (default: main)
  - head: string (required)
  - format: enum(files|patch|unified) (optional)
```

### Response Structure
```json
{
  "data": {
    "base_ref": "main",
    "head_ref": "feature-branch",
    "ahead_by": 5,
    "behind_by": 2,
    "files": [
      {
        "filename": "path/to/file",
        "status": "modified|added|removed",
        "additions": 10,
        "deletions": 5,
        "patch": "..."
      }
    ],
    "total_additions": 50,
    "total_deletions": 20
  },
  "metadata": {
    "repository": "owner/repo",
    "compared_at": "2024-01-XX"
  }
}
```

### Testing Checklist
- [ ] Valid diff request returns 200 with diff data
- [ ] Invalid branch refs return 404
- [ ] Unauthorized requests return 401
- [ ] GitHub API errors are handled gracefully
- [ ] Rate limit headers are respected
- [ ] Large diffs are handled appropriately