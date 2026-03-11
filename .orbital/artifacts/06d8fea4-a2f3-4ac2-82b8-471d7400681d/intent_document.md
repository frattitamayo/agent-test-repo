# T2-003 · Wire artifact viewer to real backend

## Desired Outcome

Users can view AI-generated artifacts (Intent Documents, Context Packages, etc.) that are created on-demand from real backend services, not static mock data. When a user navigates to an orbit's artifact view, they see either the existing artifact content fetched from the API or a clear path to generate it if it doesn't exist yet. The system provides immediate feedback during generation and gracefully handles failures without breaking the UI experience.

## Constraints

- **API contract adherence**: Must use existing artifact endpoints (`GET /api/artifacts/{artifactId}`, `POST /api/artifacts/generate`) without modification
- **UI framework boundaries**: Must remain within established React/TypeScript patterns used across the Prometheus frontend
- **Error surface area**: Cannot expose raw error details or stack traces to users; all error states must be user-facing messages
- **Loading state duration**: Generation operations may take 10-60 seconds; UI must remain responsive and informative throughout
- **Navigation integrity**: Must preserve existing routing behavior; artifact viewer remains accessible via `/projects/{projectId}/trajectories/{trajectoryId}/intents/{intentId}/orbits/{orbitNumber}/artifacts/{artifactId}`
- **Data consistency**: Must not cache artifact content that could become stale; each view should fetch fresh data
- **Authentication pass-through**: Must respect existing auth context without implementing new auth logic

## Acceptance Boundaries

### Minimal Acceptable Outcome
- Artifact viewer successfully fetches and displays existing artifacts from `GET /api/artifacts/{artifactId}`
- Loading spinner appears during fetch operations
- Generic error message displays when API calls fail (network errors, 500s)
- Generate button exists and calls `POST /api/artifacts/generate` with correct intent context
- Markdown content renders without breaking page layout

### Target Outcome
- All functionality from minimal outcome, plus:
- Loading states show progress indication (not just spinner) during generation
- Error states distinguish between "not found" (shows generate prompt) and "failed to load" (shows retry option)
- Generate button is disabled during generation with clear "Generating..." state
- Generated content appears immediately upon completion without requiring page refresh
- Artifact metadata (type, phase, timestamps) displays alongside content

### Exceptional Outcome
- All functionality from target outcome, plus:
- Streaming progress updates during generation (e.g., "Analyzing requirements...", "Synthesizing document...")
- Optimistic UI updates: content streams in as it generates
- Error recovery suggests specific next actions based on failure type
- Generate button pre-validates requirements (e.g., checks that intent has sufficient context)
- Auto-retry with exponential backoff for transient failures

## Trust Tier Assignment

**Tier 2: Supervised** — This integration touches the critical path for AI artifact generation, which is the core value proposition of Prometheus. While the changes are contained to the frontend and don't modify backend services, the blast radius includes:

1. **User workflow impact**: Failures here block users from viewing or generating any AI artifacts, effectively disabling the main feature of the LLM integration trajectory
2. **Error propagation risk**: Improper error handling could expose sensitive internal details or create confusing failure modes that erode trust in the AI system
3. **API contract dependency**: Changes assume stability of artifact endpoints; misalignment could cause silent failures or data corruption
4. **State management complexity**: Introducing real async operations replaces deterministic mock behavior with non-deterministic network timing and failure modes

The tier is not higher (Gated) because:
- No data persistence logic changes in the frontend
- No new API endpoints or backend modifications
- Failures are contained to the UI layer and don't cascade to other system components
- Changes are reversible by rolling back the frontend deployment

Human review should verify: error state coverage, loading experience quality, API request correctness, and graceful degradation behavior.

## Dependencies

### Internal Dependencies
- **Artifact API endpoints**: Both `GET /api/artifacts/{artifactId}` and `POST /api/artifacts/generate` must be operational and return expected schemas
- **Intent context availability**: OrbitalArtifactViewer component must receive valid `projectId`, `trajectoryId`, `intentId`, `orbitNumber`, and `artifactId` from route parameters or props
- **Authentication context**: Existing auth provider must supply valid credentials for API requests
- **Markdown rendering library**: Current markdown renderer (likely `react-markdown` or similar) must handle artifact document format

### External Dependencies
- **AWS Bedrock availability** (via T2-001, T2-002): Artifact generation calls will fail if LLM service is unavailable or misconfigured
- **Network connectivity**: Both development and production environments require stable connection to backend services

### Prior Orbit References
- **T2-001 Orbit 1**: Established the artifact generation service contract
- **T2-002 Orbit 1**: Implemented the `/api/artifacts/generate` endpoint that this UI will call

### Risk Mitigation
If artifact endpoints are not yet deployed or unstable, implement feature flag to toggle between mock and real backend behavior, allowing UI development to proceed independently.