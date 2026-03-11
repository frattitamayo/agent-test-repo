# Context Package: T2-003 · Wire Artifact Viewer to Real Backend

**Generated:** 2024-02-17
**Package Type:** intent-specific
**Intent:** T2-003

---

## Codebase References

### Primary (will be modified or created)
- `apps/web/src/components/OrbitalArtifactViewer.tsx` — Artifact viewer component currently using hardcoded mock content
- `apps/web/src/lib/api/artifacts.ts` — API client module (create if not exists) for artifact endpoints
- `apps/web/src/hooks/useArtifactGeneration.ts` — Custom React hook (create) to manage generation lifecycle and polling

### Secondary (dependencies and interfaces)
- `apps/web/src/lib/api/client.ts` — Base API client configuration (assumed to exist for other API calls)
- `apps/web/src/components/ui/` — Existing UI component library (buttons, loading spinners, error states)
- `apps/web/src/types/artifact.ts` — TypeScript types for Artifact domain model (may need extension for status field)
- `packages/shared/src/types/` — Shared type definitions between frontend and backend

### Backend API Contract
- `GET /api/v1/artifacts/:id` — Fetch artifact by ID, returns `{ id, intent_id, type, content, status, metadata }`
- `POST /api/v1/artifacts/:id/generate` — Trigger artifact generation, returns `{ id, status: "generating", job_id }`
- Expected status flow: `pending` → `generating` → `completed` or `failed`

### Tests (to be created)
- `apps/web/src/components/OrbitalArtifactViewer.test.tsx` — Component tests covering loading, success, error states
- `apps/web/src/hooks/useArtifactGeneration.test.ts` — Hook tests for polling logic and state transitions

---

## Architecture Context

Prometheus V1 follows a monorepo structure with separate `apps/web` (Next.js frontend) and `apps/api` (backend API) packages. The frontend uses React with TypeScript, communicating with the backend via REST APIs. Artifact generation is an asynchronous operation: the frontend POSTs to trigger generation, then polls GET endpoint until `status` transitions from `generating` to `completed`.

The artifact viewer lives in the web app's component tree under the ORBITAL workspace UI. It receives an `artifactId` prop from the parent route and is responsible for fetching, displaying, and managing artifact lifecycle. State management follows React patterns (hooks + local state); no global state library for this feature scope.

**Backend Architecture Context:**
The artifact generation flow involves T2-002's API endpoints calling T2-001's Bedrock integration service. Backend handles LLM streaming, prompt assembly, and database persistence. Frontend sees only the artifact record's `status` field changes — generation details are abstracted away.

**Reference docs:**
- `docs/architecture/monorepo-structure.md` (expected)
- `apps/api/docs/api-spec.md` (backend API contract)
- Intent Document for T2-001 (Bedrock integration patterns)
- Intent Document for T2-002 (artifact endpoint implementation)

---

## Pattern Library

### Conventions (follow these)

**API Client Pattern:**
- All API calls go through typed client modules in `apps/web/src/lib/api/`
- Return typed responses, throw on non-2xx status codes
- Use `fetch` with Next.js configuration for base URL and auth headers
- Example structure (infer from existing clients if present):
  ```typescript
  export const artifactsApi = {
    getById: async (id: string): Promise<Artifact> => null,
    generate: async (id: string): Promise<{ job_id: string }> => null
  }
  ```

**React Hook Pattern for Async Operations:**
- Custom hooks for complex async flows (polling, retries)
- Return `{ data, loading, error, trigger }` interface
- Use `useEffect` for polling with cleanup
- Example pattern: `useQuery`-like signature without external dependency

**Loading State UI:**
- Skeleton loaders for content-heavy components
- Inline spinners for button actions
- Must appear within 100ms of user interaction
- Use existing spinner/skeleton components from `apps/web/src/components/ui/`

**Error Handling UI:**
- Non-blocking error messages using toast/banner pattern
- Actionable error messages with retry buttons
- Distinguish between network, server, and application errors
- Follow existing error component patterns in UI library

**TypeScript Typing:**
- All API responses must have explicit TypeScript interfaces
- Use discriminated unions for status-based type narrowing
  ```typescript
  type ArtifactStatus = 'pending' | 'generating' | 'completed' | 'failed';
  interface Artifact {
    id: string;
    status: ArtifactStatus;
    content?: string; // only present when status === 'completed'
  }
  ```

### Anti-patterns (avoid these)

**No Direct Backend Dependencies in Components:**
- Do NOT import backend modules or shared business logic in React components
- Frontend must interact only through API contracts
- Reason: Violates deployment boundary separation; backend types may include Node.js-only code

**No Infinite Polling:**
- Polling loops MUST have a maximum iteration count or timeout
- Do NOT rely solely on status change to stop polling
- Reason: Backend could hang in "generating" state indefinitely; frontend must degrade gracefully

**No Silent Failures:**
- Do NOT catch errors without surfacing them to the user
- Every API failure must update UI state (error message or fallback)
- Reason: Silent failures leave users confused about system state

**No Optimistic Content Updates:**
- Do NOT render artifact content before server confirms `status === 'completed'`
- Wait for authoritative backend response before displaying generated content
- Reason: Prevents showing stale/incorrect content if generation was interrupted

---

## Prior Orbit References

### Completed
- **T2-001 (Orbit 0):** Bedrock client integration
  - Established prompt engineering patterns for artifact generation
  - Defined error handling for LLM API failures (quota exhaustion, timeout, malformed responses)
  - Relevant patterns: Streaming response handling, exponential backoff for retries
  - Key insight: Bedrock calls can take 10-30 seconds; frontend must accommodate long generation times

### In Progress
- **T2-002 (Expected):** Artifact generation endpoints
  - Implements `POST /api/v1/artifacts/:id/generate` and status tracking
  - Establishes artifact status state machine: `pending` → `generating` → `completed`/`failed`
  - Returns `job_id` on generation POST for future tracking/cancellation
  - Error responses: 404 if artifact not found, 409 if already generating, 500 for internal errors

### Related Context
- **Mock Artifact Data:** Current `OrbitalArtifactViewer.tsx` contains hardcoded markdown string
  - Provides reference for expected content shape (markdown with frontmatter)
  - Shows component already handles markdown rendering (identify existing renderer library)
  - UI layout established: header, metadata section, content area

### Known Issues
- **Backend Deployment State:** T2-002 endpoints may not be deployed to dev environment yet
  - Mitigation: Development should include mock API responses for isolated frontend testing
  - Acceptance testing requires backend availability
- **No WebSocket Support Yet:** Initial implementation uses polling
  - Stretch goal mentions real-time updates; defer to future intent if backend adds SSE/WebSocket

---

## Risk Assessment

### 1. Backend API Unavailability
**Risk:** T2-002 endpoints not deployed when frontend work begins; blocks integration testing.
**Severity:** High (blocks orbit completion)
**Mitigation:**
- Create typed API mock responses for local development
- Use environment variable to toggle between real backend and mock mode
- Document expected API contract in TypeScript interfaces as source of truth
- Coordinate with backend team on deployment timeline before starting implementation

### 2. Long Generation Times
**Risk:** Artifact generation takes 20-60 seconds; user perceives hang or abandons page.
**Severity:** Medium (poor UX, may impact user research)
**Mitigation:**
- Show clear loading feedback with progress indication ("Generating artifact...")
- Set reasonable timeout (90 seconds) with graceful degradation
- Consider background generation with notification (stretch goal)
- Provide "cancel" option if backend exposes job cancellation endpoint

### 3. Polling Overhead
**Risk:** Aggressive polling (e.g., every 500ms) creates unnecessary backend load.
**Severity:** Low (performance concern, not functional blocker)
**Mitigation:**
- Start with 2-second polling interval, increase to 5 seconds after 30 seconds
- Stop polling after status transition or timeout
- Clean up polling timers on component unmount to prevent memory leaks
- Consider exponential backoff if backend signals rate limiting

### 4. Error State Recovery
**Risk:** User clicks "Generate" during transient network failure; left with error message and no clear path forward.
**Severity:** Medium (UX degradation)
**Mitigation:**
- All error states include "Retry" button
- Distinguish between retriable errors (network timeout) and permanent failures (quota exhausted)
- Preserve user context across retries (don't reset entire component state)
- Add logging to capture error patterns for monitoring

### 5. Race Conditions on Rapid Clicks
**Risk:** User clicks "Generate" multiple times rapidly; triggers duplicate backend requests.
**Severity:** Low (wasteful but not breaking)
**Mitigation:**
- Disable "Generate" button immediately on click
- Track in-flight requests in component state
- Ignore subsequent clicks while `generating === true`
- Re-enable button only on success, error, or timeout

### 6. Stale Cached Content
**Risk:** Artifact is regenerated externally (e.g., via CLI or other UI); frontend shows outdated content.
**Severity:** Low (acceptable for current scope)
**Mitigation:**
- Accept this limitation in current intent; no cache invalidation strategy yet
- Document known issue for future versioning/refresh intent
- Refresh button in stretch goals would mitigate this
- Backend `updated_at` timestamp could trigger cache invalidation (future enhancement)

### 7. Markdown Rendering XSS
**Risk:** Generated artifact content includes unsanitized user input; could introduce XSS vectors.
**Severity:** High (security concern)
**Mitigation:**
- Verify markdown renderer library sanitizes HTML by default
- Do NOT use `dangerouslySetInnerHTML` directly
- Use established markdown component that handles sanitization (e.g., `react-markdown` with rehype-sanitize)
- Backend should also sanitize LLM outputs (defense in depth)

### 8. Mobile/Flaky Network UX
**Risk:** On slow mobile connections, initial fetch takes >5 seconds; no feedback shown.
**Severity:** Medium (degrades mobile experience)
**Mitigation:**
- Show skeleton loader immediately on mount while fetching cached artifacts
- Set shorter timeout for initial fetch (3 seconds) before showing error
- Consider "Offline" mode detection with friendly message
- Mobile optimization deferred to UX polish intent if needed

---

## Constraints

### Build (must pass)
- `pnpm test` — All component and hook tests pass
- `pnpm lint` — TypeScript and ESLint checks pass
- `pnpm build` — Next.js production build succeeds
- Playwright E2E test covering happy path (generate → poll → display)

### Guardrails (do not violate)
- Do NOT modify backend API contracts — frontend must conform to existing endpoints
- Do NOT introduce new state management libraries (Redux, Zustand, etc.) — use React hooks and local state
- Do NOT bypass existing API client patterns — all calls go through typed client modules
- Do NOT render unsanitized markdown — use established markdown component with sanitization
- Do NOT poll indefinitely — all polling loops must have timeout or max iteration count

### Performance Targets
- Cached artifact fetch: <500ms (p95)
- Loading state appears: <100ms after user action
- Polling interval: 2-5 seconds (configurable)
- No main thread blocking during generation polling

### Browser Support
- Must work in Chrome, Firefox, Safari (latest 2 versions)
- Graceful degradation for older browsers (show error message if fetch unsupported)