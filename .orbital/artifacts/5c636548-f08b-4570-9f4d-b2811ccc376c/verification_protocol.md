# Verification Protocol — T2-003: Wire Artifact Viewer to Real Backend

**Protocol ID:** VP-T2-003-1
**Generated:** 2024-02-17
**Intent:** T2-003
**Proposal:** PROP-T2-003-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Clicking "Generate" triggers POST endpoint and displays loading spinner | Generate button click calls `artifactsApi.generateArtifact()` and updates component state to loading | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestGenerateButton/triggers_api_call` | Test passes with mocked API call verification | Yes |
| AG-02 | When generation completes, artifact markdown renders in viewer | Component transitions from loading to displaying content when hook returns `status === 'completed'` | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestGenerateFlow/renders_completed_artifact` | Test passes with markdown content visible in DOM | Yes |
| AG-03 | Network errors display error message with retry option | Hook catches fetch errors and updates state; component renders error UI with retry button | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestErrorHandling/network_timeout` | Test passes with error message and retry button present | Yes |
| AG-04 | Existing hardcoded mock artifact is replaced with API-fetched content | Component calls `artifactsApi.getArtifact()` on mount instead of using hardcoded string | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestInitialLoad/fetches_from_api` | Test passes with API call made on mount; no hardcoded content references | Yes |
| AG-05 | Loading state appears <100ms after button click | Button click immediately sets `isLoading` state before async operation | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestPerformance/loading_appears_immediately` | Test passes with loading state visible in <100ms (synchronous state update) | Yes |
| AG-06 | Polling interval is 2-5 seconds configurable | Hook implements polling with `setInterval` starting at 2000ms, scaling to 5000ms after 30s | Unit test: `useArtifactGeneration.test.ts` — `TestPolling/interval_scaling` | Test passes with interval measurements matching spec | Yes |
| AG-07 | Error messages distinguish between network, server, and generation timeouts | Hook maps error types (NetworkError, HTTP 500, timeout) to distinct error messages | Unit test: `useArtifactGeneration.test.ts` — `TestErrorTypes/discriminated_messages` | Test passes with unique error message for each scenario | Yes |
| AG-08 | Generate button disabled during active generation | Component disables button when `isLoading === true` | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestButtonState/disabled_while_generating` | Test passes with button disabled attribute present during loading | Yes |
| AG-09 | Cached artifacts load in <500ms | Initial fetch completes within performance budget | Integration test: `OrbitalArtifactViewer.e2e.ts` — `TestPerformance/cached_fetch_latency` | Test passes with p95 latency <500ms over 10 requests | Yes |
| AG-10 | Polling stops after status transitions to completed/failed | Hook clears interval when status changes from "generating" | Unit test: `useArtifactGeneration.test.ts` — `TestPolling/stops_on_completion` | Test passes with no additional API calls after status transition | Yes |
| AG-11 | Polling implements 90-second timeout | Hook stops polling after 90 seconds even if status remains "generating" | Unit test: `useArtifactGeneration.test.ts` — `TestPolling/enforces_timeout` | Test passes with timeout error shown after 90s | Yes |
| AG-12 | Component cleans up timers on unmount | Hook's `useEffect` cleanup cancels AbortController and clears intervals | Unit test: `useArtifactGeneration.test.ts` — `TestCleanup/no_memory_leaks` | Test passes with no warnings about setState on unmounted component | Yes |
| AG-13 | API client throws typed errors for 404, 500 responses | `artifactsApi` methods map HTTP status codes to specific error types | Unit test: `artifacts.test.ts` — `TestErrorMapping/typed_exceptions` | Test passes with correct error type thrown for each status code | Yes |
| AG-14 | TypeScript build completes without errors | All new types compile and integrate with existing codebase | `pnpm build` in CI pipeline | Build succeeds with zero TypeScript errors | Yes |
| AG-15 | ESLint and format checks pass | Code follows project conventions | `pnpm lint && pnpm fmt:check` | Zero lint errors or format violations | Yes |
| AG-16 | Error recovery works for 404, 500, timeout | Component renders appropriate error UI for each failure mode | Unit test: `OrbitalArtifactViewer.test.tsx` — `TestErrorScenarios/all_failure_modes` | Test passes with correct error UI for 404 (not found), 500 (server), timeout | Yes |
| AG-17 | Retry mechanism includes exponential backoff for transient failures (stretch) | Hook implements backoff between retry attempts | Unit test: `useArtifactGeneration.test.ts` — `TestRetry/exponential_backoff` | Test passes with increasing delays between retries | No |
| AG-18 | Backend returns 409 handled gracefully | Treat 409 as "already generating" and transition to polling mode | Unit test: `useArtifactGeneration.test.ts` — `TestErrorHandling/conflict_response` | Test passes with automatic polling start on 409 | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Functional: All three states (loading, success, error) demonstrable | Verify loading spinner, completed content, and error message all display correctly in real browser | Manual test in dev environment: trigger each state and inspect visual rendering | Verification Engineer |
| HV-02 | UX: Loading and error states follow existing component patterns | Review component code against existing UI library usage — confirm spinner, error banner, button patterns match conventions | Code review comparing new components to existing patterns in `apps/web/src/components/ui/` | System Architect |
| HV-03 | Performance: Median API response time <500ms for cached artifacts | Measure actual latency in dev environment with browser DevTools Network tab over 10 requests | Manual performance test: open 10 different cached artifacts, record latency, verify p95 <500ms | Verification Engineer |
| HV-04 | UX: Error messages are helpful and actionable | Review error text for clarity — do messages guide user toward resolution? | Manual test: trigger each error scenario, assess message quality (clear, non-technical, actionable) | Intent Architect |
| HV-05 | Markdown rendering handles generated content correctly | Generate real artifact via backend, verify all markdown features render (headers, lists, code blocks, tables, links) | End-to-end test with real backend: trigger generation, inspect rendered output for formatting issues | Verification Engineer |
| HV-06 | Component integrates cleanly with parent route/navigation | Navigate to artifact viewer from different entry points, verify no state persistence bugs or remount issues | Manual navigation test: access viewer from project page, trajectory page, direct URL; verify behavior consistent | Verification Engineer |
| HV-07 | No race conditions from rapid user interactions | Rapidly click generate button, navigate away during polling, return during polling — verify no crashes or inconsistent state | Stress test: aggressive user interactions to expose timing bugs | Verification Engineer |
| HV-08 | Markdown renderer sanitizes HTML safely (security) | Verify markdown rendering library includes sanitization; review implementation for `dangerouslySetInnerHTML` usage | Security code review: confirm `react-markdown` with `rehype-sanitize` plugin used, no unsafe HTML rendering | System Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Clicking "Generate" on empty artifact triggers POST endpoint and displays loading spinner | AG-01, AG-05, HV-01 |
| When generation completes, artifact markdown renders in viewer | AG-02, HV-01, HV-05 |
| Network errors display error message with retry option | AG-03, AG-16, HV-01, HV-04 |
| Existing hardcoded mock artifact replaced with API-fetched content | AG-04 |
| Loading state appears <100ms after button click | AG-05, HV-01 |
| Polling interval 2-5 seconds (configurable) | AG-06 |
| Error messages distinguish network failures, server errors, generation timeouts | AG-07, AG-16, HV-04 |
| Generate button disabled during active generation | AG-08, HV-01 |
| Cached artifacts load in <500ms | AG-09, HV-03 |
| All three states (loading, success, error) demonstrable in manual testing | HV-01 |
| Median API response <500ms measured over 10 requests to cached artifacts | AG-09, HV-03 |
| Error recovery works for disconnected network, 500 error, 404 not found | AG-03, AG-16, HV-01 |
| Loading and error states follow existing component patterns | HV-02 |
| Optimistic progress indicators (stretch) | AG-17 |
| Client-side session caching (stretch) | AG-17 |
| Exponential backoff for retries (stretch) | AG-17 |
| Real-time updates via WebSocket/SSE (stretch) | AG-17 |

**Orphan checks:** None
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01 through AG-08, AG-10 through AG-18) | re-orbit — fix implementation, re-run tests | AI Agent |
| TypeScript build failure (AG-14) | re-orbit — resolve type conflicts, ensure compatibility with existing types | AI Agent |
| Lint/format failure (AG-15) | re-orbit — run `pnpm fmt`, fix lint issues | AI Agent |
| Performance target missed (AG-09, HV-03) | re-orbit — profile and optimize; if architectural bottleneck (e.g., backend latency), escalate | AI Agent → System Architect |
| Manual UX validation fails (HV-01, HV-02, HV-04) | re-orbit — revise error messages, loading states, or component patterns per feedback | AI Agent |
| Integration test with real backend unavailable | modify-intent — split orbit: complete with mocked backend (current orbit), defer real integration to dependent orbit after T2-002 deploys | Intent Architect |
| Security review identifies XSS risk (HV-08) | re-orbit — security-critical, must not ship without proper sanitization | System Architect |
| Markdown rendering breaks on generated content (HV-05) | re-orbit — renderer must handle all LLM output formats; investigate markdown library compatibility | AI Agent |
| Race conditions or memory leaks detected (AG-12, HV-07) | re-orbit — async state management is foundational, must be leak-free | AI Agent |
| Backend API contract mismatch discovered | escalate — API contract is external dependency; coordinate with T2-002 owner to align | System Architect |