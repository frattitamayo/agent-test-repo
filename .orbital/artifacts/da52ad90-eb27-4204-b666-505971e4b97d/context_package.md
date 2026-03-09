# Context Package — INT-T7-002: ORBITAL Metrics Dashboard

**Generated:** 2024-12-19
**Package Type:** intent-specific
**Intent:** INT-T7-002

---

## Codebase

### Primary (will be modified or created)
- `frontend/src/components/dashboards/OrbitalMetricsDashboard.tsx`
- `frontend/src/components/dashboards/MetricCard.tsx`
- `frontend/src/hooks/useOrbitalMetrics.ts`
- `frontend/src/services/metricsWebSocket.ts`
- `backend/src/application/queries/get_orbital_metrics.go`
- `backend/src/application/queries/get_orbital_metrics_test.go`
- `backend/src/domain/metrics/orbital_metrics.go`
- `backend/src/infrastructure/delivery/httphandlers/metrics_handler.go`
- `backend/src/infrastructure/delivery/websocket/metrics_stream.go`

### Secondary (dependencies and interfaces)
- `backend/src/domain/orbit/orbit.go` — orbit aggregate and state definitions
- `backend/src/application/ports/orbit_repository.go` — port for querying orbit logs
- `backend/src/infrastructure/persistence/orbit_repository.go` — implementation of orbit log queries
- `frontend/src/lib/api.ts` — HTTP client configuration
- `frontend/src/lib/websocket.ts` — WebSocket connection management
- `frontend/src/contexts/AuthContext.tsx` — authentication state for permission checks
- `backend/src/domain/auth/permissions.go` — permission definitions for metrics access

### Tests
- `backend/src/application/queries/get_orbital_metrics_test.go`
- `backend/src/domain/metrics/orbital_metrics_test.go`
- `frontend/src/components/dashboards/__tests__/OrbitalMetricsDashboard.test.tsx`

---

## Architecture

Prometheus V1 follows Clean Architecture with CQRS. The metrics dashboard is a query operation that lives in the application layer, aggregates data from the orbit repository through port interfaces, and streams updates via WebSocket for real-time visibility. The frontend consumes both REST endpoints for initial load and WebSocket streams for incremental updates.

**Reference docs:**
- `docs/architecture/clean-architecture.md`
- `docs/architecture/websocket-patterns.md`
- `docs/domain/orbit-lifecycle.md`
- `docs/metrics/orbital-metrics-definitions.md`

---

## Patterns

### Conventions (follow these)
- **CQRS Query Pattern**: See `backend/src/application/queries/get_project_summary.go` — queries define their own port interfaces, accept repository dependencies via constructor, return DTOs
- **Metrics Calculation**: See `backend/src/domain/metrics/` — domain-driven calculations with value objects, pure functions for aggregation logic
- **WebSocket Streaming**: See `backend/src/infrastructure/delivery/websocket/orbit_events.go` — hub-based connection management, filtered event streams per client
- **React Dashboard Component**: See `frontend/src/components/dashboards/ProjectDashboard.tsx` — compound component pattern with metric cards, custom hooks for data fetching
- **Time Range Filtering**: See `frontend/src/hooks/useTimeRangeFilter.ts` — standardized time range selection (24h, 7d, 30d)
- **Table-driven tests**: See `backend/src/domain/metrics/intent_success_rate_test.go` — metrics calculations use table-driven tests with edge cases

### Anti-patterns (avoid these)
- **Computing metrics in handlers**: Handlers must delegate to query/domain layer — no business logic in HTTP/WebSocket handlers
- **Exposing raw orbit logs to frontend**: Always aggregate and filter sensitive data in backend before transmission
- **Synchronous recalculation on every request**: Use event-driven updates or cached aggregations for frequently accessed metrics
- **Blocking WebSocket handlers**: WebSocket message handling must be non-blocking — use goroutines for expensive operations

---

## Dependencies

### Internal
- `backend/src/application/ports/orbit_repository.go` — interface for querying orbit logs with filtering capabilities
- `backend/src/domain/orbit/` — orbit aggregate, state machine, trust tier definitions
- `backend/src/domain/metrics/` — metric calculation domain logic
- `backend/src/infrastructure/persistence/` — orbit log persistence implementation
- `frontend/src/lib/api.ts` — authenticated HTTP client
- `frontend/src/lib/websocket.ts` — WebSocket connection lifecycle management

### External
- **React Query** — frontend data fetching and caching for initial metrics load
- **WebSocket API** — real-time metric updates from backend to frontend
- **Chart.js / Recharts** — visualization library for metric displays `[to be determined]`
- **PostgreSQL / DynamoDB** — orbit log storage `[verify actual datastore]`

---

## Prior Art

### Completed
- **T7-001** — WebSocket infrastructure for real-time events (provides WebSocket hub pattern and connection management)
- **Orbit lifecycle tracking** — orbit state transitions already logged with timestamps (provides raw data for Orbit Cycle Time)
- **Trust tier assignment** — intents already tagged with trust tiers 0-4 (provides data for Trust Tier Distribution)
- **Verification phase tracking** — orbit verification outcomes already recorded (provides data for Verification Escape Rate)

### Known Issues
- Orbit log schema may not include all fields needed for Intent Clarity Score calculation (need to verify presence of "first_orbit_success" flag or ability to derive it from orbit_number and verification_status)
- Existing WebSocket infrastructure may need filtering logic extension to support metrics-specific subscriptions
- Performance of aggregating metrics across large orbit log datasets not yet profiled — may need query optimization or pre-aggregation

---

## Constraints

### Build (must pass)
- `make test` — all Go tests including new metrics calculation tests
- `make lint` — Go and TypeScript linting
- `npm test` — frontend unit tests for dashboard component
- `make integration-test` — WebSocket connection stability under load

### Guardrails (do not violate)
- Metrics queries must use indexed fields on orbit logs to avoid full table scans
- Dashboard must not expose project-specific details or code snippets in aggregated views
- Metrics calculations must be read-only — never modify orbit log data
- WebSocket subscriptions must enforce authentication and permission checks before streaming metrics
- Frontend must gracefully handle WebSocket disconnections and reconnect automatically
- Metrics definitions must align exactly with ORBITAL framework specifications in `docs/metrics/orbital-metrics-definitions.md`