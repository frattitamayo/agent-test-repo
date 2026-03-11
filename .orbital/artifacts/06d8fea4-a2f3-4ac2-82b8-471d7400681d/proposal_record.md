# Proposal Record: T2-003 · Wire artifact viewer to real backend

**Proposal ID:** PROP-T2-003-1  
**Generated:** 2024-12-19  
**Intent:** T2-003  
**Context Packages:** CTX-T2-003  
**Trust Tier:** 2 — supervised

---

## Interpreted Intent

When users navigate to an orbit's artifact view, they should see real AI-generated content fetched from the backend artifact service, not hardcoded mock text. If the artifact hasn't been generated yet, they should see a clear Generate button that triggers creation through the LLM pipeline established in T2-001 and T2-002. During both fetch and generation operations, the UI must provide immediate feedback through loading states and handle failures gracefully with actionable error messages. The experience must feel responsive even when generation takes 30-60 seconds, and errors must never expose technical details that confuse users.

The core behavior change: OrbitalArtifactViewer.tsx transitions from displaying static mock markdown to orchestrating async API calls with proper state management for loading, success, error, and generation-in-progress scenarios.

---

## Implementation Plan

### Files to Create

**`frontend/src/api/artifacts.ts`**  
Purpose: Centralized API client for artifact operations. Exports two functions: `getArtifact()` for fetching existing artifacts and `generateArtifact()` for triggering LLM creation. Handles authentication token injection, response parsing, and error standardization.

**`frontend/src/types/artifacts.ts`**  
Purpose: TypeScript interfaces for artifact data structures matching backend schema. Defines `Artifact`, `ArtifactMetadata`, `GenerateArtifactRequest`, and `ApiError` types.

**`frontend/src/components/orbital/OrbitalArtifactViewer.test.tsx`**  
Purpose: Unit tests covering async state management, error scenarios, and user interactions. Tests mock API responses and verify UI behavior for loading, success, 404-not-found, 500-server-error, and generation lifecycle states.

### Files to Modify

**`frontend/src/components/orbital/OrbitalArtifactViewer.tsx`**  
Changes:
- Replace mock content constant with stateful artifact data
- Add loading, error, and generating state management using useState
- Implement useEffect hook to fetch artifact on mount
- Add Generate button with disabled state during generation
- Integrate error boundary fallback for markdown rendering failures
- Add conditional rendering: loading spinner → error message → generate prompt → artifact content
- Wrap markdown renderer with error handling

**`frontend/src/hooks/useApi.ts`** (if exists, otherwise create)  
Changes: Add or verify reusable authenticated fetch wrapper that injects auth token from AuthContext and standardizes error responses.

### Approach

Follow Prometheus frontend patterns for async data fetching established in similar components. Use React's useState for loading/error/data state, useEffect for fetch-on-mount, and the existing authentication context for API credentials. The implementation prioritizes clear user feedback over clever optimizations—every state transition should be immediately visible.

The artifact fetch happens in componentDidMount equivalent (useEffect with empty dependency array). If the API returns 404, this is the expected "artifact not yet generated" state that renders the generate prompt. Any other error (network, 500, timeout) displays a retry-focused error message.

When the user clicks Generate, disable the button, display "Generating artifact..." text, and call the generation endpoint with full intent context from route params. Poll for completion (or use the response body if generation is synchronous in T2-002's implementation) and update the component state when content arrives.

Error handling differentiates between error classes: 404 → "Artifact not created yet. Click Generate to create it.", network error → "Connection failed. Check your internet connection and retry.", 500 → "Generation failed. Please try again or contact support if the problem persists.", timeout → "Generation is taking longer than expected. The artifact may still be processing."

### Order of Operations

1. **Create type definitions** (`frontend/src/types/artifacts.ts`) — Establish TypeScript contracts for artifact shape, matching backend schema from T2-002
2. **Create API client** (`frontend/src/api/artifacts.ts`) — Implement getArtifact() and generateArtifact() with proper auth header injection and error handling
3. **Modify OrbitalArtifactViewer component** — Replace mock content with API integration:
   - Add state: `artifact`, `loading`, `error`, `generating`
   - Add fetch logic in useEffect
   - Add generate handler
   - Update render logic with conditional branches for each state
4. **Add error boundaries** — Wrap markdown renderer to catch rendering failures
5. **Write tests** — Cover fetch success, fetch 404, fetch error, generate success, generate error, loading states
6. **Manual verification** — Test in dev environment with real backend from T2-002, verify timeout scenarios, check error messages

### Dependencies

**Must be complete:**
- T2-002 Orbit 1: Artifact generation REST API (deployed and accessible at expected endpoints)
- AuthContext providing valid JWT tokens
- Environment variable `VITE_API_BASE_URL` configured for API host

**Must exist or be created:**
- `LoadingSpinner` component in shared library (or implement inline if missing)
- `ErrorMessage` component in shared library (or implement inline if missing)
- Markdown rendering library (`react-markdown`) installed as dependency

**External services:**
- AWS Bedrock LLM service operational (transitive dependency via T2-001/T2-002)

---

## Risk Surface

### Edge Cases

**Scenario: Artifact not found (404 response)**  
Handling: This is the primary trigger for showing the Generate button. Component should recognize 404 as a valid state, not an error. Display: "This artifact hasn't been generated yet. Click Generate to create it with AI."  
Mitigation: Explicitly check `response.status === 404` before setting error state.

**Scenario: User clicks Generate multiple times rapidly**  
Handling: Disable the Generate button immediately on first click. Track generation state separately from fetch loading state to prevent re-triggering.  
Mitigation: `const [generating, setGenerating] = useState(false)` and `<button disabled={generating || loading} onClick={handleGenerate}>`.

**Scenario: Generation request times out after 90 seconds**  
Handling: Show specific timeout message: "Generation is taking longer than expected. Please refresh the page in a moment to see if it completed." Allow user to manually retry.  
Mitigation: Set `AbortController` timeout on generateArtifact() call. Clean up on component unmount.

**Scenario: Markdown content contains malformed syntax breaking renderer**  
Handling: Wrap markdown renderer in error boundary. Display fallback: "Artifact content could not be displayed. Please report this issue."  
Mitigation: Add `<ErrorBoundary>` around `<ReactMarkdown>` with fallback UI.

**Scenario: Route params missing artifactId**  
Handling: Component should validate params on mount. If artifactId is undefined, display error: "Invalid artifact reference" and do not attempt API call.  
Mitigation: Early return in useEffect if `!artifactId`.

**Scenario: Auth token expires during long generation**  
Handling: Backend returns 401. Frontend's existing AuthContext handles token refresh. Retry the generation request automatically with new token.  
Mitigation: Verify API client uses auth interceptor that handles 401 and retries. Log retry attempt for debugging.

### Regressions

**Existing routing behavior**  
Risk: Adding async operations could break React Router navigation if component unmounts mid-fetch.  
Mitigation: Use cleanup function in useEffect to cancel pending requests: `return () => controller.abort();`. Test navigation away during loading state.

**Markdown rendering for other artifact types**  
Risk: Changes to markdown renderer wrapper could affect other components using the same renderer (if shared).  
Mitigation: Keep renderer configuration local to OrbitalArtifactViewer. Do not modify global markdown settings.

**Test suite integrity**  
Risk: Changing component from synchronous to asynchronous requires updating all existing tests or they will fail.  
Mitigation: Review existing test file, convert all assertions to use `waitFor()` and `findBy()` queries from React Testing Library.

### Security

**XSS via artifact content**  
Concern: Malicious LLM output could contain script tags or event handlers that execute in user's browser.  
Mitigation: Use `react-markdown` with default sanitization enabled (strips HTML by default). Never use `dangerouslySetInnerHTML`. Verify Content-Security-Policy headers block inline scripts.

**Token exposure in logs or error messages**  
Concern: API client error handling could accidentally log authorization headers containing JWT tokens.  
Mitigation: Strip sensitive headers from error objects before logging. Never include full response headers in user-facing error messages.

**CORS misconfiguration allowing unauthorized origins**  
Concern: If CORS is too permissive, malicious sites could trigger artifact generation on user's behalf.  
Mitigation: Backend validates origin header (already implemented in T2-002). Frontend should not bypass CORS with proxies or credential hacks.

### Performance

**Repeated fetches on component remount**  
Concern: If parent component re-renders frequently, OrbitalArtifactViewer could refetch artifact content unnecessarily.  
Mitigation: Memoize component with `React.memo()` or stable route configuration. Do not add unnecessary dependencies to useEffect array.

**Large artifact content blocking render**  
Concern: 100KB+ markdown documents could cause UI lag during parsing and rendering.  
Mitigation: Monitor production artifact sizes. If this becomes an issue in future orbits, consider virtualized rendering or pagination. For now, accept the tradeoff—artifact documents are expected to be <50KB based on T2-001 output samples.

**Timeout configuration**  
Concern: 90-second timeout for generation may be too aggressive if LLM is under heavy load.  
Mitigation: Use 90 seconds as initial value. Monitor timeout rate in production. Adjust to 120 seconds if >5% of requests timeout.

---

## Scope Estimate

### Files Affected

| Action | Count | Files |
|--------|-------|-------|
| Create | 3 | `artifacts.ts` (API), `artifacts.ts` (types), `OrbitalArtifactViewer.test.tsx` |
| Modify | 2 | `OrbitalArtifactViewer.tsx`, `useApi.ts` (or create if missing) |
| **Total** | **5** | |

### Complexity Assessment

**Medium** — This is a standard async data integration pattern, but the multiple state branches (loading, error types, generating, success) and error handling specificity elevate it beyond trivial. The integration itself follows established patterns from the Prometheus frontend codebase. No novel algorithms or complex state machines required.

Complexity factors:
- Async state management (standard React pattern, well-documented)
- Multiple conditional render branches (loading → error → generate → content)
- API client with auth integration (follows existing useApi pattern)
- Error categorization and user-facing message mapping (requires careful testing)

Not high complexity because:
- No new backend changes required
- No data transformation or business logic in frontend
- No performance optimization needed beyond basic timeout handling
- Established test patterns exist for async components

### Estimated Test Count

| Test Category | Count | Coverage |
|---------------|-------|----------|
| API client unit tests | 4 | `getArtifact()` success, 404, error; `generateArtifact()` success, error |
| Component integration tests | 6 | Initial load success, initial load 404, fetch error, generate success, generate error, loading states |
| Edge case tests | 3 | Rapid duplicate generate clicks, component unmount during fetch, markdown render error |
| **Total** | **13** | |

### Work Breakdown

**Phase 1: Foundation (30% of effort)**
- Create type definitions
- Create API client with auth integration
- Write API client unit tests

**Phase 2: Component Integration (50% of effort)**
- Modify OrbitalArtifactViewer with state management
- Add conditional rendering logic
- Implement fetch and generate handlers
- Add error boundaries

**Phase 3: Testing and Verification (20% of effort)**
- Write component integration tests
- Manual testing with real backend
- Error scenario verification
- Loading state UX validation

### Orbit Count Estimate

**Single orbit** — All work is cohesive and interdependent. Splitting into multiple orbits would create partially functional states. The component either works with real API integration or it doesn't; intermediate states (e.g., "fetch works but generate doesn't") have no production value.

---

## Human Modifications

Pending human review.