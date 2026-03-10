# Context Package: T2-004 · Add artifact chat (AI assistant) integration

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** T2-004  
**Trust Tier:** tier_3 (gated)

---

## Codebase References

### Primary (will be modified or created)

**Frontend**
- `src/components/artifacts/OrbitalArtifactChat.tsx` — existing chat UI component, needs message handling and streaming updates
- `src/components/artifacts/OrbitalArtifactChat.module.css` — styling for chat panel
- `src/hooks/useArtifactChat.ts` — new hook for managing chat state, LLM streaming, and artifact updates
- `src/services/chat.service.ts` — new service for chat API calls and WebSocket/SSE streaming

**Backend**
- `src/routes/chat.routes.ts` — new chat endpoint routes
- `src/controllers/chat.controller.ts` — chat message handling and LLM orchestration
- `src/services/llm.service.ts` — AWS Bedrock integration, streaming inference, prompt engineering
- `src/services/artifact.service.ts` — existing service, add methods for AI-driven updates with validation
- `src/middleware/streaming.middleware.ts` — SSE or WebSocket middleware for real-time response streaming

**Configuration**
- `src/config/bedrock.config.ts` — AWS Bedrock client initialization, model selection, credential management
- `.env.example` — add required environment variables for AWS credentials

### Secondary (dependencies and interfaces)

**Frontend**
- `src/components/artifacts/ArtifactEditor.tsx` — artifact display and edit interface that chat panel modifies
- `src/contexts/AuthContext.tsx` — user authentication state for securing chat requests
- `src/types/artifact.types.ts` — artifact schema definitions for validation

**Backend**
- `src/middleware/auth.middleware.ts` — authentication verification for chat endpoints
- `src/middleware/error.middleware.ts` — standardized error response formatting
- `src/models/artifact.model.ts` — artifact data model with validation rules
- `src/utils/validation.util.ts` — schema validation helpers
- `src/utils/logger.util.ts` — structured logging for LLM requests and responses

**Infrastructure**
- `src/config/aws.config.ts` — AWS SDK configuration and credential provider
- `package.json` — will need `@aws-sdk/client-bedrock-runtime` dependency

### Tests

- `src/components/artifacts/__tests__/OrbitalArtifactChat.test.tsx` — existing component tests, extend for streaming and modification flows
- `src/services/__tests__/llm.service.test.ts` — new tests for Bedrock integration, mocked responses
- `src/controllers/__tests__/chat.controller.test.ts` — new tests for chat endpoint logic
- `src/hooks/__tests__/useArtifactChat.test.ts` — new tests for chat hook state management

---

## Architecture Context

Prometheus V1 follows a **Clean Architecture** pattern with clear separation between presentation (React frontend), application logic (controllers/services), and infrastructure (AWS integrations). The artifact chat feature spans all three layers:

**Data Flow:**
1. User sends message via `OrbitalArtifactChat` component
2. Frontend `useArtifactChat` hook calls `chat.service` API
3. Backend `chat.controller` validates user permissions against artifact ownership
4. `llm.service` constructs prompt with artifact context and streams response from AWS Bedrock
5. Controller pipes streaming response back to frontend via SSE (Server-Sent Events)
6. Frontend displays incremental tokens in chat panel
7. On user acceptance, frontend calls artifact update endpoint with AI-generated modifications
8. `artifact.service` validates changes against schema before persisting

**Service Boundaries:**
- **Frontend:** Owns UI state, streaming consumption, user interaction flows
- **Chat Controller:** Orchestrates LLM calls, manages streaming lifecycle, enforces rate limits
- **LLM Service:** Encapsulates all Bedrock-specific logic (SDK calls, prompt engineering, error translation)
- **Artifact Service:** Owns artifact data integrity, schema validation, persistence

**Infrastructure Constraints:**
- AWS Bedrock accessed via Bedrock Runtime API (streaming inference)
- Authentication tokens passed via `Authorization` header, validated on every request
- Streaming responses use SSE for simplicity (WebSocket overkill for unidirectional data)
- No session storage on backend — chat history lives in frontend state only (per intent constraint)

**Reference Docs:**
- `docs/architecture/clean-architecture.md` — overall system design
- `docs/architecture/frontend-patterns.md` — React hook conventions, service layer patterns
- `docs/security/authentication.md` — JWT validation, session management

---

## Pattern Library

### Conventions (follow these)

**Frontend React Patterns**
- **Custom Hooks for Complex State:** See `src/hooks/useTrajectoryForm.ts` — encapsulate API calls, loading states, and error handling in reusable hooks
- **Service Layer for API Calls:** See `src/services/trajectory.service.ts` — centralize HTTP requests, handle retries, parse responses
- **CSS Modules for Component Styling:** See `src/components/layouts/MainLayout.module.css` — avoid global CSS, scope styles to components
- **TypeScript Strict Mode:** All new code must satisfy strict type checking, no `any` types except in integration boundaries

**Backend API Patterns**
- **Controller → Service Separation:** See `src/controllers/trajectory.controller.ts` and `src/services/trajectory.service.ts` — controllers handle HTTP concerns (parsing, validation, response formatting), services handle business logic
- **Middleware Chains:** See `src/routes/trajectory.routes.ts` — authentication, validation, error handling applied via Express middleware
- **Async/Await with Try-Catch:** See `src/controllers/intent.controller.ts` — never expose raw errors to clients, always wrap in standardized error responses
- **Structured Logging:** See `src/utils/logger.util.ts` — use Winston logger with request IDs, user IDs, and contextual metadata

**AWS SDK Integration**
- **Client Initialization in Config:** See `src/config/aws.config.ts` — initialize AWS SDK clients once at startup, reuse across requests
- **Credential Provider Chain:** Use environment variables → IAM roles → shared credentials file in that order
- **Error Translation:** See `src/services/storage.service.ts` — catch SDK errors, translate to application-specific error types, log with original error for debugging

**Streaming Responses**
- **SSE Format:** Use Express response `res.write()` with `data: <json>

` format, set `Content-Type: text/event-stream`
- **Graceful Stream Termination:** Send `data: [DONE]

` as final event, close connection cleanly
- **Client Reconnection:** Frontend should retry connection with exponential backoff on disconnect

### Anti-patterns (avoid these)

- **Storing API Keys in Code:** All AWS credentials must come from environment variables or IAM roles, never hardcoded
- **Synchronous LLM Calls Without Timeout:** Bedrock inference can take 10+ seconds; always set request timeout and handle gracefully
- **Direct Database Access from Controllers:** Controllers call services, services call models/repositories — no skipping layers
- **Unvalidated User Input in LLM Prompts:** Sanitize and validate all user messages before constructing prompts to prevent injection attacks
- **Auto-Saving AI Modifications:** Never persist artifact changes without explicit user acceptance (per intent constraint)
- **Exposing Raw Provider Errors:** Translate Bedrock error codes (ThrottlingException, ValidationException) to user-friendly messages

---

## Prior Orbit References

### Completed Intents

**T2-001 · AWS Bedrock Setup**
- Established AWS account configuration, IAM roles, and SDK initialization patterns
- Created `src/config/bedrock.config.ts` for client setup
- Documented credential management in `docs/infrastructure/aws-setup.md`
- **Key Takeaway:** Use credential provider chain, never inline secrets

**T2-002 · Artifact Generation via LLM**
- First LLM integration in the system, used Bedrock to generate artifact content from user prompts
- Established prompt engineering patterns in `src/services/llm.service.ts`
- Demonstrated schema validation flow: LLM output → parse → validate → persist
- **Key Takeaway:** AI-generated content must pass the same validation as manually created content
- **Reusable Code:** Prompt construction logic, Bedrock client usage, error handling

**T1-003 · Artifact Editor UI**
- Built the artifact view and edit interface that chat panel will integrate with
- Defined `ArtifactEditor` component API, including `onUpdate` callback for external modifications
- Established artifact state management patterns (local state + debounced API updates)
- **Integration Point:** Chat panel will trigger `onUpdate` when user accepts AI modifications

### Known Issues

- **Rate Limiting:** AWS Bedrock enforces per-model rate limits (tokens/minute, requests/minute). Current setup has no client-side throttling or queue management. If multiple users generate artifacts simultaneously, requests may fail with ThrottlingException.
  - **Mitigation for This Intent:** Implement exponential backoff retry in `llm.service.ts`, display queue position to users if rate limited
  
- **Schema Validation Performance:** Artifact validation for large documents (>50KB) can take 500ms+. If AI generates large modifications, validation delay will block user acceptance flow.
  - **Mitigation:** Run validation asynchronously, show loading state during validation
  
- **No Multi-Tenant Isolation:** Current architecture assumes single-tenant deployment. User permissions checked at controller layer but no resource-level isolation in AWS calls.
  - **Mitigation:** Ensure artifact ownership validation happens before any LLM calls that include artifact content

---

## Risk Assessment

### Security Risks

**Risk:** Prompt Injection via User Messages  
**Impact:** Malicious users craft messages that manipulate LLM into ignoring instructions, leaking system prompts, or generating harmful content  
**Likelihood:** Medium (prompt injection techniques are well-documented)  
**Mitigation:**
- Prefix all user messages with clear role boundaries: "User input: <message>"
- Validate message length (max 2000 characters) and block known injection patterns
- Never include system-level instructions in user-controllable prompt sections
- Log suspicious prompt patterns for security review

**Risk:** Sensitive Data Leakage in LLM Prompts  
**Impact:** Artifact content includes API keys, credentials, or PII that gets sent to AWS Bedrock, potentially logged by provider  
**Likelihood:** Low (artifacts are code/config, not production data)  
**Mitigation:**
- Scan artifact content for common secret patterns (API key regex, AWS access keys) before including in prompt
- Redact detected secrets, replace with `[REDACTED]` placeholder
- Document artifact content guidelines in user-facing docs

**Risk:** Unauthorized Artifact Modification  
**Impact:** User exploits chat API to modify artifacts they don't own, corrupting other users' work  
**Likelihood:** Low (existing auth middleware should prevent)  
**Mitigation:**
- Reuse existing `auth.middleware.ts` to validate JWT tokens
- Add artifact ownership check in `chat.controller.ts` before processing messages
- Return 403 Forbidden if user lacks write permission on artifact

### Functional Risks

**Risk:** LLM Generates Invalid Artifact Modifications  
**Impact:** AI proposes changes that violate artifact schema, causing validation errors when user accepts  
**Likelihood:** High (LLMs are non-deterministic, occasionally produce malformed output)  
**Mitigation:**
- Validate AI-generated modifications against artifact schema before returning to user
- If validation fails, regenerate response with corrected instructions or return error to user
- Log validation failures with prompt and response for prompt engineering improvements

**Risk:** Concurrent Chat Sessions Cause State Pollution  
**Impact:** User opens multiple artifacts, sends messages to both; responses get mixed up or applied to wrong artifact  
**Likelihood:** Medium (users commonly open multiple tabs)  
**Mitigation:**
- Include artifact ID in every chat request and response
- Frontend `useArtifactChat` hook maintains separate state per artifact instance (keyed by artifact ID)
- Backend stateless — no session storage that could leak across requests

**Risk:** Streaming Response Interruption  
**Impact:** Network drops during LLM response, user sees partial message, system unclear if modification proposal was complete  
**Likelihood:** Medium (mobile networks, VPN disconnects)  
**Mitigation:**
- Send `[DONE]` marker as final SSE event to signal completion
- Frontend detects connection close without `[DONE]`, shows "Response interrupted, retry?" UI
- Store partial response in frontend state, allow retry without re-sending original message

### Performance Risks

**Risk:** LLM Response Latency Exceeds User Patience  
**Impact:** P90 latency >10 seconds (per acceptance boundary), users abandon chat flow, poor experience  
**Likelihood:** Medium (Bedrock p90 latency ~8s for Claude 3.5 Sonnet)  
**Mitigation:**
- Display "AI is thinking..." spinner immediately on message send
- Stream response token-by-token to provide perceived progress
- Set 15-second timeout on Bedrock calls, return "Response timed out, please try again" if exceeded
- Monitor P95/P99 latency, adjust timeout thresholds based on telemetry

**Risk:** UI Freezes During Artifact Update  
**Impact:** Applying large AI modifications blocks React render cycle, UI unresponsive for 2+ seconds  
**Likelihood:** Low (artifacts typically <50KB per intent assumption)  
**Mitigation:**
- Use React `useTransition` hook to wrap artifact update as non-blocking state change
- Show loading overlay during update if content exceeds 50KB
- Debounce re-render until update completes

**Risk:** Backend Saturates Under Concurrent Chat Load  
**Impact:** 10+ simultaneous chat sessions (per acceptance boundary) cause memory exhaustion or CPU saturation, service degrades  
**Likelihood:** Low (early deployment, limited users)  
**Mitigation:**
- Monitor backend memory and CPU usage under load testing (simulate 20 concurrent sessions)
- Set per-user rate limit (max 5 messages/minute) to prevent single-user abuse
- Add request queuing if load exceeds capacity, return 503 with Retry-After header

### Operational Risks

**Risk:** AWS Bedrock Service Outage  
**Impact:** All chat functionality unavailable, users cannot interact with AI, dependent workflows blocked  
**Likelihood:** Low (AWS SLA 99.9%)  
**Mitigation:**
- Detect Bedrock service errors (500 responses, connection timeouts), return clear "AI service temporarily unavailable" message to users
- Display fallback UI: "Chat unavailable — artifact editing still works manually"
- Monitor Bedrock health via AWS Health Dashboard, set up alerting for service events

**Risk:** Insufficient LLM Request Logging  
**Impact:** Production issues difficult to debug, no visibility into user interaction patterns or AI behavior  
**Likelihood:** High (logging often overlooked in initial implementation)  
**Mitigation:**
- Log every LLM request with: request ID, user ID, artifact ID, message content (sanitized), timestamp
- Log every LLM response with: request ID, response length, latency, completion status
- Log user acceptance/rejection of AI modifications with modification type and artifact ID
- Ship logs to centralized logging (CloudWatch, Datadog) for queryability