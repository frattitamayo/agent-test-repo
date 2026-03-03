# Intent Document — Prometheus V1

**Generated:** 2024-07-12
**Source:** Repository Viewer trajectory
**Intent Count:** 1

---

## T3-001: Add GitHub repository tree endpoint

- **Objective:** Add a backend endpoint that returns the file tree of a GitHub repository at a given branch/ref. Use the GitHub Git Trees API (recursive) to fetch the full tree. Return a structured JSON response with file paths, types (blob/tree), sizes, and SHAs.
- **Constraints:** 
  - Must use the GitHub Git Trees API (recursive) to fetch the full tree.
  - Must return a structured JSON response with file paths, types (blob/tree), sizes, and SHAs.
  - Must handle rate limiting and authentication with GitHub API.
  - Must not expose sensitive information such as private repository data.
- **Acceptance Criteria:**
  - Endpoint responds within 500ms for repositories with up to 10,000 files.
  - JSON response includes all file paths, types, sizes, and SHAs.
  - Endpoint handles rate limiting gracefully, returning a 429 status code with a retry-after header.
  - Endpoint requires valid GitHub authentication token for private repositories.
- **Trust Tier Rationale:** Tier 2 (supervised) is appropriate because the endpoint touches sensitive flows (GitHub API authentication) and requires human approval before deployment due to its impact on repository data access.
- **Dependencies:** 
  - GitHub API access and authentication.
  - Backend service capable of handling API requests and responses.