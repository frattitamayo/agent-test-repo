# Proposal Record — INT-T7-002: ORBITAL Metrics Dashboard

**Proposal ID:** PROP-INT-T7-002-1
**Generated:** 2024-12-19
**Intent:** INT-T7-002
**Context Packages:**
- Architectural: none
- Intent-specific: CTX-INT-T7-002
**Trust Tier:** 2 — supervised (system-wide operational metrics)

---

## Interpreted Intent

Platform operators need a live pulse on how well the ORBITAL system is performing. This dashboard surfaces five critical metrics that tell the story of system health: how often intents succeed on the first try, how long orbits take from start to finish, how often verification misses problems, how trust is distributed across the work, and how often teams need multiple attempts. All data comes from real orbit logs, not mocks, and updates flow through WebSockets so operators see changes as they happen. This is the control panel for understanding whether the system is getting better or accumulating debt.

---

## Implementation Plan

### Files to Create
- `backend/src/domain/metrics/orbital_metrics.go` — domain types for the five core metrics (Intent Clarity Score, Orbit Cycle Time, Verification Escape Rate, Trust Tier Distribution, Re-orbit Rate)
- `backend/src/domain/metrics/orbital_metrics_test.go` — table-driven tests for metric calculation logic with edge cases
- `backend/src/application/queries/get_orbital_metrics.go` — CQRS query handler aggregating orbit logs into metrics DTOs
- `backend/src/application/queries/get_orbital_metrics_test.go` — query handler tests with mocked repository
- `backend/src/infrastructure/delivery/httphandlers/metrics_handler.go` — thin HTTP handler for initial metrics load
- `backend/src/infrastructure/delivery/websocket/metrics_stream.go` — WebSocket stream handler for real-time metric updates
- `frontend/src/domain/metrics/types.ts` — TypeScript types matching backend metric DTOs
- `frontend/src/components/dashboards/OrbitalMetricsDashboard.tsx` — main dashboard component with five metric cards
- `frontend/src/components/dashboards/MetricCard.tsx` — reusable metric display component
- `frontend/src/hooks/useOrbitalMetrics.ts` — custom hook managing HTTP initial load + WebSocket updates
- `frontend/src/services/metricsWebSocket.ts` — WebSocket client for metrics subscriptions
- `frontend/src/components/dashboards/__tests__/OrbitalMetricsDashboard.test.tsx` — dashboard component tests

### Files to Modify
- `backend/src/application/ports/orbit_repository.go` — add query methods for metrics aggregation (GetOrbitsByTimeRange, GetFirstOrbitSuccessRate, GetVerificationEscapeOrbits)
- `backend/src/infrastructure/persistence/orbit_repository.go` — implement new query methods with optimized indexed queries
- `backend/src/domain/auth/permissions.go` — add METRICS_VIEW permission constant
- `frontend/src/lib/websocket.ts` — extend connection manager to support metrics event subscriptions

### Approach

Follow established CQRS query pattern where the query defines its own port interfaces for orbit log access. Domain layer calculates metrics using pure functions over orbit aggregates. Query handler orchestrates data retrieval and metric calculation, returning DTOs. HTTP handler provides initial load for dashboard mount. WebSocket stream listens to orbit state change events and pushes recalculated metrics to subscribed clients. Frontend uses React Query for initial load and a custom hook that merges HTTP response with WebSocket updates, managing reconnection automatically. Time range filter (24h/7d/30d) implemented as query parameter on both HTTP and WebSocket subscription.

### Order of Operations
1. Extend orbit repository port with metrics-specific queries
2. Implement domain metric calculation logic with value objects (e.g., `IntentClarityScore`, `OrbitCycleTime`)
3. Implement CQRS query handler consuming repository port
4. Implement HTTP handler for initial metrics load
5. Implement WebSocket metrics stream with event-driven updates
6. Create frontend types and API client functions
7. Build reusable MetricCard component
8. Build OrbitalMetricsDashboard composite component
9. Implement useOrbitalMetrics hook merging HTTP + WebSocket data
10. Write tests at each layer (domain, application, infrastructure, frontend)
11. Wire handlers into router and ensure METRICS_VIEW permission enforcement

### Dependencies
- T7-001 (WebSocket infrastructure) must be complete — provides hub pattern and connection management
- Orbit logs must contain timestamps for `started_at`, `completed_at`, `verified_at` fields
- Orbit logs must contain `orbit_number`, `verification_status`, `requires_reorbit` fields
- Authentication context must expose user permissions for METRICS_VIEW checks
- Indexed queries on orbit logs (by `created_at`, `trust_tier`, `verification_status`) to avoid full scans

---

## Risk Surface

### Edge Cases
- **Zero intents in time range**: Metrics calculations must handle division by zero (e.g., 0 intents means 0% clarity score, not NaN)
- **In-progress orbits**: Orbit Cycle Time calculation must exclude orbits with null `completed_at` timestamps to avoid skewing averages
- **Concurrent orbit updates**: WebSocket clients may receive metric update events faster than they can process — must batch or debounce recalculations
- **Time zone handling**: Time range filtering (24h/7d/30d) must use consistent UTC reference to avoid off-by-one errors across server/client
- **Missing orbit_number field**: Intent Clarity Score depends on identifying "first orbit" — if orbit logs lack `orbit_number`, must derive from chronological ordering

### Regressions
- Adding metrics queries to orbit repository could slow down existing orbit CRUD operations if indexes are not properly set
- WebSocket hub broadcasting metrics to all connected clients could overwhelm the hub if metrics update frequency is too high
- Frontend dashboard auto-refresh could trigger excessive HTTP requests if React Query cache invalidation is misconfigured

### Security
- Metrics dashboard aggregates data across all projects — must not leak project-specific names, intent text, or code snippets in aggregated views
- METRICS_VIEW permission must be enforced on both HTTP endpoint and WebSocket subscription to prevent unauthorized access
- WebSocket subscriptions must validate authentication token before streaming metrics
- Metrics queries must be read-only — no mutation operations exposed through metrics endpoints

### Performance
- Aggregating metrics across large orbit log datasets (e.g., 10,000+ orbits for 30d range) could exceed 5-second initial load target without query optimization
- WebSocket broadcast of metric updates on every orbit state change could create thundering herd if hundreds of clients are subscribed
- Frontend rendering five metric calculations simultaneously may cause UI jank if calculations are synchronous — consider web workers or memoization
- Orbit Cycle Time p95 calculation requires sorting duration arrays — O(n log n) complexity for large n could be slow

---

## Scope Estimate

| Metric | Value |
|--------|-------|
| Files affected | 16 (12 create + 4 modify) |
| Complexity | Medium — aggregates existing orbit log data using established query patterns, but introduces five distinct metric calculations with different aggregation logic; WebSocket integration adds real-time layer; performance tuning for large datasets required |
| Estimated test cases | 18 (5 domain metric calculation tests covering edge cases, 3 query handler tests, 2 repository implementation tests, 2 HTTP handler tests, 2 WebSocket stream tests, 4 frontend component tests) |

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by |  |
| Timestamp |  |

---

## Human Modifications

_(No modifications yet — awaiting human review)_