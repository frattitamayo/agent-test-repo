# T2-003 · Wire Artifact Viewer to Real Backend

## Desired Outcome

The ORBITAL UI artifact viewer becomes a functional interface to the artifact generation system. When a user navigates to an artifact that doesn't yet have generated content, they see a "Generate" button. Clicking it triggers real LLM-powered artifact creation via the backend API, displays loading feedback during generation, and renders the completed artifact markdown with proper error recovery if generation fails.

This transforms the artifact viewer from a static prototype into a working demonstration of the ORBITAL AI loop's artifact generation capability, enabling the team to validate the end-to-end flow and gather real performance data.

## Constraints

- **UI Framework Boundaries:** Must use existing React patterns and component structure in `OrbitalArtifactViewer.tsx`. No new UI libraries or major architectural changes.
- **API Contract:** Must call the artifact endpoints as documented in the backend API specification (GET `/api/v1/artifacts/:id`, POST `/api/v1/artifacts/:id/generate`). No inventing new endpoints or changing the contract.
- **Error Handling:** Must gracefully handle all failure modes (network timeout, 4xx/5xx responses, malformed responses) without crashing the UI. User must always have a path forward.
- **Performance Budget:** Initial artifact fetch must complete in <500ms for cached artifacts. Loading state must appear within 100ms of user action. No blocking the main thread during generation polling.
- **UX Consistency:** Loading indicators, error messages, and button states must follow existing ORBITAL UI patterns. No introducing new design paradigms.
- **Non-Goals:** This orbit does NOT implement streaming artifact generation, artifact versioning UI, or editing capabilities. Those are separate intents.

## Acceptance Boundaries

### Minimal Acceptable
- Clicking "Generate" on an empty artifact triggers the POST endpoint and displays a loading spinner
- When generation completes, artifact markdown renders in the viewer
- Network errors display an error message with a retry option
- Existing hardcoded mock artifact is replaced with API-fetched content

### Target
- Loading state appears <100ms after button click
- Polling interval for generation status is 2-5 seconds (configurable)
- Error messages distinguish between network failures, server errors, and generation timeouts
- Generate button is disabled during active generation
- Cached artifacts load in <500ms with no intermediate loading state

### Stretch
- Optimistic updates show generation progress indicators (e.g., "Analyzing intent...", "Generating content...")
- Generated artifacts are cached client-side for session duration
- Retry mechanism includes exponential backoff for transient failures
- Real-time generation status updates via WebSocket or SSE (if backend supports)

### Measurement Criteria
- **Functional:** All three states (loading, success, error) are demonstrable in manual testing
- **Performance:** Median API response time <500ms measured over 10 consecutive requests to cached artifacts
- **Reliability:** Error recovery works for disconnected network, 500 server error, and 404 artifact not found
- **UX:** Loading and error states follow existing component patterns (verify via team design review)

## Trust Tier Assignment

**Tier 2: Supervised** — This orbit modifies a core user-facing flow and introduces external API dependencies that could fail in user-visible ways. While it doesn't touch data persistence or auth boundaries, the blast radius includes:

- **User Experience Risk:** Broken artifact loading affects the primary demo flow for ORBITAL's AI capabilities
- **Integration Risk:** First real integration between frontend and LLM backend — failure modes are not yet well-characterized
- **Error Propagation:** Poor error handling could leave users in unrecoverable states

Autonomous (Tier 1) would be appropriate if this were a purely additive feature or isolated component. Gated (Tier 3) would apply if it touched auth, billing, or multi-tenant data boundaries. Supervised requires AI to generate a complete implementation proposal including error handling strategy and test scenarios, with human review before execution.

## Dependencies

### Internal Dependencies
- **Backend API:** Requires artifact endpoints (`GET /api/v1/artifacts/:id`, `POST /api/v1/artifacts/:id/generate`) to be deployed and operational (provided by T2-002 orbit)
- **Database State:** Assumes artifacts exist in the database with `status` field that transitions from `pending` → `generating` → `completed`
- **LLM Integration:** Backend must have working Bedrock integration to actually generate content (provided by T2-001)

### External Dependencies
- **AWS Bedrock Quota:** Generation requests will hit AWS Bedrock API; must respect rate limits and handle quota exhaustion gracefully
- **Network Stability:** UI assumes reliable network connection; mobile/flaky network scenarios are degraded but not primary

### Prior Orbit Context
- **T2-001 (Orbit 0):** Established Bedrock client and prompt engineering patterns — informs error handling approach
- **T2-002 (Expected):** Implements the artifact generation endpoints this orbit will call — must validate API contract alignment

### Sequencing
This orbit CANNOT proceed until:
1. T2-002 artifact endpoints are deployed to a reachable environment (dev/staging)
2. At least one test artifact exists in the database with a known ID for integration testing