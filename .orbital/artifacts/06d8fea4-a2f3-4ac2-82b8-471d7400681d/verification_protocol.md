# Verification Protocol: T2-003 · Wire artifact viewer to real backend

**Protocol ID:** VP-T2-003-1  
**Generated:** 2024-12-19  
**Intent:** T2-003  
**Proposal:** PROP-T2-003-1  
**Trust Tier:** 2 — supervised

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Artifact viewer successfully fetches and displays existing artifacts from GET /api/artifacts/{artifactId} | API client fetches artifact with valid ID and returns parsed data | Unit test: `artifacts.test.ts` → `getArtifact() returns artifact on 200 response` | Test passes with mock artifact containing id, type, content, metadata | Yes |
| AG-02 | Loading spinner appears during fetch operations | Component shows loading state while fetch is pending | Integration test: `OrbitalArtifactViewer.test.tsx` → `renders loading spinner on mount before data loads` | Loading indicator visible before API resolves | Yes |
| AG-03 | Generic error message displays when API calls fail (network errors, 500s) | Component displays user-facing error on API failure | Integration test: `OrbitalArtifactViewer.test.tsx` → `displays error message when fetch fails with 500` | Error message contains "failed" or "try again", no stack traces or technical details exposed | Yes |
| AG-04 | Generate button exists and calls POST /api/artifacts/generate with correct intent context | Generate button triggers API call with proper payload | Integration test: `OrbitalArtifactViewer.test.tsx` → `clicking Generate calls generateArtifact with intent context` | API called with `{ projectId, trajectoryId, intentId, orbitNumber, artifactType, phase }` from route params | Yes |
| AG-05 | Markdown content renders without breaking page layout | Markdown renders successfully for valid artifact content | Integration test: `OrbitalArtifactViewer.test.tsx` → `renders markdown content when artifact loaded` | Component contains parsed markdown elements (headings, paragraphs) without layout errors | Yes |
| AG-06 | Error states distinguish between "not found" and "failed to load" | 404 response shows generate prompt, other errors show retry option | Integration test: `OrbitalArtifactViewer.test.tsx` → `displays generate prompt on 404 response` + `displays retry option on network error` | 404 → "Click Generate", network/500 error → "Retry" or "Try again" message | Yes |
| AG-07 | Generate button is disabled during generation with clear "Generating..." state | Button disabled and text updates during generation | Integration test: `OrbitalArtifactViewer.test.tsx` → `disables Generate button while generating` | Button has `disabled` attribute and displays "Generating..." text | Yes |
| AG-08 | Generated content appears immediately upon completion without requiring page refresh | Component state updates with new artifact after generation completes | Integration test: `OrbitalArtifactViewer.test.tsx` → `displays generated content after generation succeeds` | Artifact content visible in DOM after generateArtifact resolves, no page reload | Yes |
| AG-09 | API client includes authentication token in requests | Fetch calls include Authorization header | Unit test: `artifacts.test.ts` → `getArtifact includes Bearer token in headers` | API request contains `Authorization: Bearer <token>` header from AuthContext | Yes |
| AG-10 | Component handles rapid duplicate Generate clicks | Multiple clicks do not trigger concurrent generation requests | Integration test: `OrbitalArtifactViewer.test.tsx` → `prevents duplicate generation calls` | Only one API call made despite multiple button clicks during generation | Yes |
| AG-11 | Component cleans up pending requests on unmount | AbortController cancels fetch when component unmounts | Integration test: `OrbitalArtifactViewer.test.tsx` → `cancels fetch on unmount` | Unmounting component calls `controller.abort()`, no memory leaks or pending promises | Yes |
| AG-12 | Markdown renderer handles malformed content gracefully | Error boundary catches markdown rendering failures | Integration test: `OrbitalArtifactViewer.test.tsx` → `displays fallback on markdown render error` | Malformed markdown triggers error boundary, displays "content could not be displayed" message | Yes |
| AG-13 | TypeScript type checking passes | No type errors in modified files | CI: `npm run type-check` | Zero TypeScript errors, all artifact types properly defined | Yes |
| AG-14 | Code passes linting rules | No linting violations | CI: `npm run lint` | Zero ESLint errors in modified files | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Loading states show progress indication during generation | Verify loading UX is clear and prevents user confusion during 30-60 second generation | Manual test: Trigger artifact generation in dev environment, observe loading state for full duration | Frontend Engineer / UX Reviewer |
| HV-02 | Error recovery suggests specific next actions based on failure type | Review error messages for each failure mode — network, 404, 500, timeout — confirm they guide user to correct action | Code review: Inspect error handling logic in OrbitalArtifactViewer.tsx and test each error state manually | System Architect / Frontend Engineer |
| HV-03 | Generated content appears with proper formatting and metadata | Verify artifact renders with type, phase, timestamp metadata visible alongside markdown content | Manual test: Generate artifact via UI, inspect rendered output matches expected artifact structure from backend schema | Frontend Engineer |
| HV-04 | Component integrates with existing routing without breaking navigation | Navigate to/from artifact viewer during various states (loading, error, generating) — confirm no route conflicts or broken back button | Manual test: Exercise full navigation flow through project → trajectory → intent → orbit → artifact while monitoring React Router state | Frontend Engineer |
| HV-05 | Authentication context integration is correct | Verify auth token injection works in both authenticated and unauthenticated scenarios | Manual test: Test with valid token, expired token (trigger refresh), and logged-out state — confirm API calls handle each case correctly | Security Reviewer / Frontend Engineer |
| HV-06 | API client error handling matches Prometheus frontend patterns | Review `artifacts.ts` API client code — confirm it follows established error handling, logging, and response parsing patterns from other API clients | Code review: Compare against reference implementations (e.g., existing API clients for projects, trajectories) | System Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Artifact viewer successfully fetches and displays existing artifacts from GET /api/artifacts/{artifactId} | AG-01, AG-09, HV-03 |
| Loading spinner appears during fetch operations | AG-02, HV-01 |
| Generic error message displays when API calls fail (network errors, 500s) | AG-03, HV-02 |
| Generate button exists and calls POST /api/artifacts/generate with correct intent context | AG-04, AG-09 |
| Markdown content renders without breaking page layout | AG-05, AG-12, HV-03 |
| Loading states show progress indication (not just spinner) during generation | AG-02, AG-07, HV-01 |
| Error states distinguish between "not found" (shows generate prompt) and "failed to load" (shows retry option) | AG-06, HV-02 |
| Generate button is disabled during generation with clear "Generating..." state | AG-07 |
| Generated content appears immediately upon completion without requiring page refresh | AG-08, HV-03 |
| Artifact metadata (type, phase, timestamps) displays alongside content | HV-03 |

**Orphan checks:** None  
**Uncovered criteria (from exceptional outcome):** Streaming progress updates, optimistic UI updates, auto-retry with exponential backoff — these are explicitly deferred per trust tier scope; target outcome is sufficient for Tier 2

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01, AG-09) | re-orbit — fix API client implementation and verify auth header injection | AI Agent |
| Integration test failure (AG-02 through AG-08, AG-10 through AG-12) | re-orbit — fix component state management, error handling, or rendering logic | AI Agent |
| TypeScript type check failure (AG-13) | re-orbit — correct type definitions in artifacts.ts or component props | AI Agent |
| Linting failure (AG-14) | re-orbit — run `npm run lint --fix` and resolve remaining violations | AI Agent |
| Loading UX inadequate (HV-01) | re-orbit — improve loading state UI based on reviewer feedback; if requires design changes beyond implementation, escalate to Product/UX | Frontend Engineer → Product (if design issue) |
| Error messages unclear or misleading (HV-02) | re-orbit — revise error message mapping to be more actionable; if error categories are ambiguous, escalate for clarification of failure handling strategy | System Architect |
| Artifact rendering incorrect (HV-03) | re-orbit — if frontend issue, fix rendering logic; if backend schema mismatch, escalate to T2-002 orbit owner | Frontend Engineer → Backend Engineer (if schema issue) |
| Navigation regression (HV-04) | re-orbit — fix routing integration, verify React Router state management | Frontend Engineer |
| Authentication integration broken (HV-05) | escalate — auth failures indicate broader AuthContext issue or backend token validation problem; requires system-level diagnosis | Security Reviewer → System Architect |
| API client pattern deviation (HV-06) | re-orbit — refactor to match established patterns; if patterns are unclear, escalate for frontend architecture guidance | Frontend Engineer → System Architect (if pattern ambiguity) |
| Backend artifact endpoints unavailable during verification | escalate — cannot verify without deployed T2-002 dependencies; requires coordination with backend deployment | Frontend Engineer → DevOps / Backend Engineer |
| Performance degradation with large artifacts (discovered during manual test) | modify-intent — if artifacts >100KB cause UI lag, this requires pagination or virtualized rendering (new intent); document finding and defer optimization | Frontend Engineer → Product (intent negotiation) |