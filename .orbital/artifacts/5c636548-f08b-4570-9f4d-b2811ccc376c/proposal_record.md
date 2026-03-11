# Proposal Record: T2-003 · Wire Artifact Viewer to Real Backend

**Proposal ID:** PROP-T2-003-1
**Generated:** 2024-02-17
**Intent:** T2-003
**Context Package:** CTX-INT-T2-003
**Trust Tier:** 2 — supervised

---

## Interpreted Intent

The ORBITAL artifact viewer currently displays hardcoded sample content, disconnected from the actual artifact generation system. This orbit transforms it into a functional interface where users can trigger real LLM-powered artifact creation and see the results.

When a user opens an artifact that hasn't been generated yet, they'll see a "Generate" button. Clicking it starts an asynchronous process: the frontend calls the backend API to initiate generation, then polls for status updates while showing loading feedback. Once generation completes (typically 10-30 seconds based on T2-001's Bedrock integration), the markdown content renders in the viewer. If anything fails—network issues, server errors, generation timeouts—the user sees a clear error message with a retry option.

This isn't about building a full artifact management system. It's about proving the end-to-end flow works: a user action triggers AI generation, the system provides feedback during processing, and the result displays correctly. No versioning, no editing, no streaming updates yet—those are separate intents. This is the minimal viable integration that lets us validate the ORBITAL AI loop's artifact generation capability with real user interaction patterns.

The success criteria is simple: someone can open an empty artifact, click generate, wait through the loading state without confusion, and see either the completed markdown or a helpful error they can act on.

---

## Implementation Plan

### Files to Create

1. **`apps/web/src/lib/api/artifacts.ts`** — Typed API client for artifact endpoints
   - `getArtifact(id: string): Promise<Artifact>` — GET fetch with error handling
   - `generateArtifact(id: string): Promise<{ job_id: string }>` — POST trigger
   - Wraps `fetch` with base URL configuration and consistent error mapping
   - Throws typed errors for 404, 500, timeout scenarios

2. **`apps/web/src/hooks/useArtifactGeneration.ts`** — React hook managing generation lifecycle
   - Manages polling loop with configurable interval (starts 2s, scales to 5s after 30s)
   - Returns `{ artifact, isLoading, error, generateArtifact, retry }`
   - Handles automatic polling when status is "generating"
   - Cleans up timers on unmount and on status transitions
   - Implements 90-second timeout with graceful degradation
   - Tracks button disabled state to prevent duplicate triggers

3. **`apps/web/src/types/artifact.ts`** — Extended TypeScript interfaces
   - Adds `ArtifactStatus` discriminated union: `'pending' | 'generating' | 'completed' | 'failed'`
   - Updates `Artifact` interface to include `status`, `job_id`, `updated_at`
   - Ensures type safety for status-based conditional rendering

4. **`apps/web/src/components/OrbitalArtifactViewer.test.tsx`** — Component test suite
   - Tests loading state appearance within 100ms
   - Tests successful generation flow with mocked API responses
   - Tests error scenarios: network failure, 404, 500, timeout
   - Tests button disabled during generation
   - Tests retry button functionality

5. **`apps/web/src/hooks/useArtifactGeneration.test.ts`** — Hook unit tests
   - Tests polling interval scaling behavior
   - Tests cleanup on unmount (no memory leaks)
   - Tests timeout enforcement
   - Tests status transition detection

### Files to Modify

1. **`apps/web/src/components/OrbitalArtifactViewer.tsx`** — Main component refactor
   - Remove hardcoded mock content string
   - Import and use `useArtifactGeneration` hook
   - Add conditional rendering:
     - `status === 'pending'`: Show "Generate" button
     - `status === 'generating'`: Show loading spinner with progress text
     - `status === 'completed'`: Render markdown content (existing renderer)
     - `status === 'failed'`: Show error message with retry button
   - Add `useEffect` to fetch artifact on mount using `artifactsApi.getArtifact()`
   - Add skeleton loader for initial fetch state
   - Maintain existing markdown rendering component (identify in current code)

2. **`apps/web/src/lib/api/client.ts`** — Base API client configuration (if exists)
   - Verify base URL configuration includes `/api/v1` prefix
   - Ensure auth headers are passed through (if applicable)
   - Add any missing error response typing
   - If this file doesn't exist, create minimal version for artifact endpoints only

### Approach

This implementation follows React's unidirectional data flow with a custom hook encapsulating the async complexity:

1. **Separation of Concerns:** The component handles UI rendering and user interaction. The hook manages API calls, polling logic, and state transitions. The API client module provides typed fetch wrappers.

2. **Progressive Enhancement:** Initial load shows skeleton, then either content (if cached) or a generate button (if pending). Generation adds a loading layer without blocking the UI.

3. **Error Boundaries:** All API calls are wrapped in try-catch at the hook level. Errors update state that the component renders as user-friendly messages. Network timeouts use AbortController for proper cleanup.

4. **Polling Strategy:** Start aggressive (2s interval) for immediate feedback, scale back (5s) after 30 seconds to reduce server load. Stop on status transition or 90s timeout. Track iteration count to prevent infinite loops.

5. **Type Safety:** TypeScript discriminated unions ensure the component can't render `artifact.content` when `status !== 'completed'`. Compiler catches invalid state access at build time.

### Order of Operations

1. **Phase 1: API Foundation** (create before component work)
   - Create `artifacts.ts` API client with typed interfaces
   - Create/update base `client.ts` for shared configuration
   - Create `artifact.ts` types with status discriminated unions
   - Write API client tests with mocked fetch responses

2. **Phase 2: Hook Implementation** (async logic isolation)
   - Implement `useArtifactGeneration` hook with polling
   - Implement timeout and cleanup logic
   - Write hook tests covering all state transitions
   - Verify no memory leaks with mount/unmount cycles

3. **Phase 3: Component Integration** (UI layer)
   - Refactor `OrbitalArtifactViewer.tsx` to use hook
   - Add conditional rendering for all status states
   - Add skeleton loader for initial fetch
   - Verify existing markdown renderer handles generated content

4. **Phase 4: Error Handling** (resilience)
   - Implement error state UI with retry button
   - Add error type discrimination (network vs server vs timeout)
   - Test all failure scenarios manually
   - Add error logging for monitoring

5. **Phase 5: Polish & Testing** (acceptance validation)
   - Write component tests for all user flows
   - Run Playwright E2E test with real backend (if available)
   - Verify performance targets with browser dev tools
   - Cross-browser testing (Chrome, Firefox, Safari)

### Dependencies

**Must Complete Before Starting:**
- T2-002 artifact endpoints deployed to dev environment (or mock API server available)
- At least one test artifact with known ID exists in database
- Backend API specification document reviewed for contract alignment

**Required During Development:**
- Access to dev environment for integration testing
- Ability to trigger artifact generation from backend for E2E validation
- Sample generated markdown content for renderer testing

**External:**
- Network connectivity for API calls (dev environment must be reachable)
- AWS Bedrock quota available for generation testing (coordinated with backend team)

---

## Risk Surface

### Edge Cases & Handling

1. **Rapid Repeated Clicks on Generate Button**
   - **Risk:** User clicks "Generate" multiple times before button disables, triggering duplicate backend requests.
   - **Mitigation:** Disable button synchronously on first click (before async call). Track `isGenerating` state in hook. Ignore subsequent clicks while true. Re-enable only on completion/error.

2. **Component Unmounts During Active Polling**
   - **Risk:** Polling timer continues after user navigates away, causing setState on unmounted component warnings and potential memory leaks.
   - **Mitigation:** `useEffect` cleanup function cancels AbortController and clears polling interval. Hook tracks mounted state, skips setState if unmounted.

3. **Backend Returns "Generating" Status Indefinitely**
   - **Risk:** Bug in backend or stuck LLM job leaves status as "generating" forever. Frontend polls infinitely.
   - **Mitigation:** 90-second hard timeout in hook. After timeout, stop polling and show error: "Generation is taking longer than expected. Please try again or contact support."

4. **Network Timeout During Initial Fetch**
   - **Risk:** User opens artifact viewer but network is slow/flaky. No feedback shown, user sees blank screen.
   - **Mitigation:** Show skeleton loader immediately on mount. Set 3-second timeout for initial fetch (shorter than generation timeout). Display connection error with retry if exceeded.

5. **Artifact Re-Generated Externally While Viewing**
   - **Risk:** User views artifact A. Backend regenerates A via CLI. User sees stale cached content.
   - **Mitigation:** Accept as known limitation for this orbit scope. Document in comments. Future intent will add cache invalidation via `updated_at` timestamp comparison or manual refresh button.

6. **Backend Returns 409 Conflict (Already Generating)**
   - **Risk:** User triggers generation while another session/process already generating same artifact. Unclear what frontend should do.
   - **Mitigation:** Treat 409 as "already in progress" — transition to polling mode automatically. Show message: "Generation already in progress, waiting for completion..."

7. **Malformed Markdown in Generated Content**
   - **Risk:** LLM outputs invalid markdown syntax. Renderer crashes or displays broken content.
   - **Mitigation:** Wrap markdown renderer in Error Boundary. If render fails, show error: "Generated content could not be displayed. Please regenerate." Log malformed content for backend team analysis.

8. **Status Transitions Out of Order**
   - **Risk:** Polling returns `completed`, then next poll returns `generating` (rare race condition in backend).
   - **Mitigation:** Hook ignores backward status transitions. Once `completed` or `failed` reached, stop polling permanently. Log anomaly for monitoring.

### Security Considerations

1. **Markdown XSS Attack Surface**
   - **Concern:** Generated artifact content could include malicious HTML/JavaScript if LLM is compromised or backend fails to sanitize.
   - **Mitigation:** Use `react-markdown` with `rehype-sanitize` plugin (verify this is current renderer). Never use `dangerouslySetInnerHTML`. Backend should also sanitize (defense in depth).

2. **API Endpoint Authorization**
   - **Concern:** User could craft requests to generate/view artifacts they don't have permission for.
   - **Mitigation:** This orbit assumes backend enforces auth. Frontend includes auth tokens in requests via base client config. Do NOT implement client-side permission checks (easily bypassed).

3. **CORS and Request Forgery**
   - **Concern:** Malicious site could trigger artifact generation on behalf of logged-in user.
   - **Mitigation:** Rely on backend CORS configuration and SameSite cookie settings. Frontend does not implement CSRF protection (backend responsibility).

### Performance Implications

1. **Polling Overhead**
   - **Measurement:** 2-5 second polling for 30-90 seconds = 10-45 requests per generation.
   - **Impact:** Acceptable for low-concurrency (1-10 users). Will need optimization (WebSocket/SSE) if >100 concurrent generations.
   - **Mitigation:** Exponential backoff implemented (2s → 5s scaling). Backend should cache status responses. Monitor server load during user testing.

2. **Main Thread Blocking**
   - **Measurement:** Markdown rendering and large content parsing could freeze UI.
   - **Impact:** Artifacts expected to be <50KB markdown. Not a concern for current scope.
   - **Mitigation:** If future artifacts exceed 500KB, defer to Web Worker for markdown parsing.

3. **Memory Leaks from Timers**
   - **Measurement:** Each active viewer consumes one polling interval. Unmounted components must clean up.
   - **Impact:** Memory leak if 10+ artifacts opened and navigated away without cleanup.
   - **Mitigation:** Strict cleanup in `useEffect` return function. Verify in tests with mount/unmount cycles.

4. **Initial Load Performance**
   - **Measurement:** Cached artifact fetch target is <500ms p95.
   - **Impact:** First paint delayed if API call blocks render.
   - **Mitigation:** Skeleton loader shows immediately. Actual content waits for API response. No blocking render.

### Potential Regressions

1. **Existing Markdown Renderer Compatibility**
   - **Risk:** Current mock content uses features (tables, code blocks) that generated content doesn't, or vice versa.
   - **Test:** Generate sample artifact covering all markdown features (headers, lists, code, tables, links). Verify renderer handles all.

2. **Component Mount/Remount Cycles**
   - **Risk:** Parent route or state change causes remount, re-triggering fetch unnecessarily.
   - **Test:** Navigate to artifact viewer, then to different artifact, then back to first. Verify content cached appropriately or refetches cleanly.

3. **TypeScript Build Breaks**
   - **Risk:** New discriminated union types conflict with existing Artifact usage elsewhere.
   - **Test:** Run `pnpm build` after type changes. Fix any type errors in other components consuming Artifact type.

---

## Scope Estimate

### Complexity Assessment: **Medium**

**Justification:**
- Not a simple CRUD operation — requires async state management with polling, timeouts, and error recovery.
- Introduces first real frontend-backend integration for ORBITAL AI features — unknowns in error characteristics and latency distribution.
- However, follows established React patterns (custom hooks, typed API clients). No new architectural paradigms.
- No data persistence layer changes. No auth/authz implementation. Isolated to single feature.

### Estimated Work Breakdown

| Phase | Estimated Time | Risk Level |
|-------|---------------|------------|
| API client + types | 2-3 hours | Low — straightforward fetch wrappers |
| Custom hook implementation | 4-6 hours | Medium — polling logic requires careful testing |
| Component refactor | 2-3 hours | Low — UI patterns already established |
| Error handling + UX polish | 2-3 hours | Medium — comprehensive error scenarios |
| Testing (unit + component) | 3-4 hours | Medium — mocking async behavior |
| E2E testing + validation | 2-3 hours | High — depends on backend availability |
| **Total** | **15-22 hours** | **Medium overall** |

### Assumptions
- Backend API is available and stable during development (if not, +4 hours for mocking)
- Existing UI component library has required primitives (spinner, error banner, button)
- No major markdown renderer changes needed (if needed, +2-3 hours)
- Design review adds <1 hour of iteration (if major UX changes requested, re-orbit)

### Orbit Count Estimate
**Single orbit** (this proposal) — Implementation, testing, and validation can complete in one focused development session with the constraints defined. No architectural unknowns requiring exploration orbits.

If backend API is not available, split into:
- Orbit 1: Implementation with mocked API (this proposal)
- Orbit 2: Integration testing with real backend (separate proposal after T2-002 completes)

### Test Coverage Target
- API client: 90%+ coverage (straightforward to test with mocked fetch)
- Custom hook: 85%+ coverage (polling edge cases harder to simulate)
- Component: 75%+ coverage (focus on user-facing flows, skip trivial render tests)
- E2E: 1 happy path scenario (generate → poll → display)

---

## Human Modifications

Pending human review.

**Review Checklist for Approver:**
- [ ] Implementation plan aligns with codebase conventions from context package
- [ ] Risk surface adequately addresses security and UX concerns
- [ ] Dependencies are achievable (T2-002 backend status confirmed)
- [ ] Scope estimate is realistic for team's frontend velocity
- [ ] Testing strategy covers acceptance boundaries from intent
- [ ] No architectural decisions that require broader team input

**Expected Modifications:**
- Polling interval tuning based on observed backend latency
- Additional error scenarios from production monitoring insights
- UI component choices if design system has changed
- Test strategy adjustments based on current testing infrastructure