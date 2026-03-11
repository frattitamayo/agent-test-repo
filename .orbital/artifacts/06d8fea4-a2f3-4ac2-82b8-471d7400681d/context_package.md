# Context Package: T2-003 · Wire artifact viewer to real backend

**Generated:** 2024
**Package Type:** intent-specific
**Intent:** T2-003

## Codebase References

### Primary (will be modified)
- `frontend/src/components/orbital/OrbitalArtifactViewer.tsx` — Current component with mock data that needs real API integration
- `frontend/src/api/artifacts.ts` — API client functions for artifact operations (may need to be created or extended)

### Secondary (dependencies and interfaces)
- `frontend/src/hooks/useApi.ts` — Standard hook for authenticated API calls (if exists, or create following project patterns)
- `frontend/src/components/shared/LoadingSpinner.tsx` — Loading state component (reference existing loading UI pattern)
- `frontend/src/components/shared/ErrorMessage.tsx` — Error display component (reference existing error UI pattern)
- `frontend/src/types/artifacts.ts` — TypeScript interfaces for artifact data structures
- `frontend/src/contexts/AuthContext.tsx` — Authentication context providing credentials for API calls
- `frontend/src/lib/markdown.tsx` — Markdown rendering utilities (likely using react-markdown)

### API Contracts
- `backend/src/api/routes/artifacts.ts` — Backend endpoint definitions established in T2-001
  - `GET /api/artifacts/:artifactId` — Returns artifact content and metadata
  - `POST /api/artifacts/generate` — Triggers artifact generation with intent context
- `backend/src/types/artifacts.ts` — Backend type definitions for artifact schemas

### Tests
- `frontend/src/components/orbital/OrbitalArtifactViewer.test.tsx` — Existing tests that need updating for async behavior
- `frontend/src/api/artifacts.test.ts` — Unit tests for API client functions

## Architecture Context

Prometheus follows a clean separation between frontend (React/TypeScript SPA) and backend (Node.js/Express API services). The artifact viewer component sits in the ORBITAL visualization layer, consuming data from the artifact generation service (established in T2-001, T2-002).

**Data Flow:**
1. User navigates to orbit artifact view → React Router provides route params (projectId, trajectoryId, intentId, orbitNumber, artifactId)
2. OrbitalArtifactViewer mounts → Calls `GET /api/artifacts/{artifactId}` via authenticated fetch
3. If artifact exists → Display content in markdown renderer
4. If artifact doesn't exist (404) → Show generate prompt
5. User clicks Generate → Calls `POST /api/artifacts/generate` with intent context
6. Backend triggers LLM via AWS Bedrock (T2-001 infrastructure) → Returns generated content
7. Frontend updates component state → Displays new artifact

**Service Boundaries:**
- Frontend responsibility: UI state, loading indicators, error display, user interaction
- Backend responsibility: Business logic, LLM orchestration, data persistence
- No caching layer currently exists; each view fetches fresh data

**Infrastructure Constraints:**
- API requests must include JWT token from AuthContext
- CORS is configured for frontend origin (dev: localhost:3000, prod: TBD)
- API base URL comes from environment variables (VITE_API_BASE_URL)

**Reference Docs:**
- `docs/architecture.md` — Overall system architecture
- `docs/frontend-patterns.md` — React component patterns and conventions
- `docs/api-design.md` — API contract standards

## Pattern Library

### Conventions (follow these)

**API Client Pattern:**
```typescript
// frontend/src/api/artifacts.ts expected pattern
export async function getArtifact(artifactId: string): Promise<Artifact> {
  const response = await fetch(`${API_BASE_URL}/api/artifacts/${artifactId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json();
}
```

**Component State Management:**
```typescript
// Standard async data fetching pattern used in Prometheus
const [data, setData] = useState<T | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  async function fetchData() {
    try {
      setLoading(true);
      const result = await apiCall();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  fetchData();
}, [dependencies]);
```

**Error Handling:**
- All API errors must be caught and converted to user-facing messages
- Never expose stack traces or raw error objects to UI
- Distinguish between error types: network failures (retry), 404 (show generate), 500 (contact support)

**Loading States:**
- Use existing `LoadingSpinner` component from shared library
- Disable interactive elements during async operations
- Show operation-specific text: "Loading artifact...", "Generating document..."

**Markdown Rendering:**
```typescript
// See existing orbital document viewers for pattern
import ReactMarkdown from 'react-markdown';
<ReactMarkdown className="prose">{content}</ReactMarkdown>
```

**TypeScript Interfaces:**
```typescript
// Expected artifact structure from backend
interface Artifact {
  id: string;
  type: 'intent_document' | 'context_package' | 'implementation_plan' | 'verification_report';
  phase: 'context' | 'planning' | 'execution' | 'verification';
  content: string; // Markdown
  metadata: {
    orbitId: string;
    intentId: string;
    generatedAt: string;
    llmModel: string;
  };
}
```

### Anti-patterns (avoid these)

- **Inline error messages**: Do not hardcode error text in components; use centralized error message mapping
- **Missing loading states**: Never display stale data during refetch; always show loading indicator
- **Synchronous state updates after async**: Do not assume state updates happen immediately after setX() calls
- **Unguarded navigation**: Do not navigate away or update URL during pending async operations
- **Raw fetch without auth**: Always use authenticated API client; never bypass auth context

## Prior Orbit References

### Completed Work

**T2-001 Orbit 1: AWS Bedrock Integration Foundation**
- Established artifact generation service architecture
- Implemented LLM client wrapper for AWS Bedrock
- Defined artifact type schema and storage strategy
- Current state: Backend infrastructure operational, not yet exposed via HTTP endpoints

**T2-002 Orbit 1: Artifact Generation REST API**
- Created `POST /api/artifacts/generate` endpoint
- Created `GET /api/artifacts/:artifactId` endpoint
- Implemented request validation and error handling
- Established artifact persistence in database
- Current state: Endpoints deployed but not consumed by any UI

**Current Frontend State:**
- OrbitalArtifactViewer.tsx exists with hardcoded mock content:
  ```typescript
  const mockContent = "# Mock Artifact

This is placeholder content...";
  ```
- Component receives correct route parameters via React Router
- Markdown rendering works correctly with mock data
- No loading states, error handling, or API calls present

### Lessons from Prior Work

**T2-001 Learning:**
- Artifact generation can take 30-60 seconds for complex documents
- LLM failures are non-deterministic; retry logic is essential
- Tokens and rate limits from Bedrock require graceful degradation

**T2-002 Learning:**
- API returns 404 for non-existent artifacts (intended behavior, not error)
- Generate endpoint is idempotent; safe to retry
- Request body requires full intent context: `{ projectId, trajectoryId, intentId, orbitNumber, artifactType, phase }`

## Risk Assessment

### High Risk: Silent Failures
**Concern:** API errors caught but not surfaced to user; component appears to load forever or displays stale mock data.

**Mitigation:**
- Always update error state in catch blocks
- Clear previous data when fetching starts (prevent showing old content during new load)
- Set timeout on API calls (fail explicitly after 90 seconds)
- Add request/response logging in development

### Medium Risk: Rapid Repeated Generation Requests
**Concern:** User clicks Generate button multiple times, triggering concurrent LLM calls that waste resources and create race conditions.

**Mitigation:**
- Disable Generate button immediately on click
- Track generation state separately from loading state
- Show progress indication: "Generating artifact... (this may take up to 60 seconds)"
- Prevent component remounting by using React.memo or stable routing

### Medium Risk: Incomplete Artifact Data
**Concern:** Backend returns 200 but artifact content is empty or malformed, breaking markdown renderer.

**Mitigation:**
- Validate artifact structure before setting state: `if (!artifact.content) throw new Error('Empty artifact')`
- Wrap markdown renderer in error boundary
- Show fallback content if markdown parsing fails: "Artifact content could not be displayed"

### Low Risk: Route Parameter Missing
**Concern:** Component renders without required artifactId, causing undefined API call.

**Mitigation:**
- Validate route params at component mount: `if (!artifactId) return <ErrorMessage text="Invalid artifact reference" />`
- TypeScript strict mode ensures type checking on params
- React Router configuration ensures path pattern match

### Low Risk: Auth Token Expiry During Long Generation
**Concern:** User starts 60-second artifact generation, token expires mid-request.

**Mitigation:**
- Backend must handle token expiry and return 401 (already implemented in T2-002)
- Frontend catches 401, triggers auth refresh flow (existing behavior in AuthContext)
- Retry generation request with new token automatically

### Security: Artifact Content Injection
**Concern:** Malicious artifact content contains XSS vectors rendered via markdown.

**Mitigation:**
- Use react-markdown with default XSS protection enabled
- Backend sanitizes LLM output before persistence (assumed in T2-001)
- Do not use dangerouslySetInnerHTML for artifact content
- Content-Security-Policy headers prevent inline script execution (verify in deployment config)