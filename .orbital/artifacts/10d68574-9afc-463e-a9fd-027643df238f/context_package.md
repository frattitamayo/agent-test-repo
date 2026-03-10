# Context Package: Implement Artifact Generation Endpoints

## Codebase References

### Core Services (will be modified or created)
- `internal/application/services/artifact_generator.go` — new service for orchestrating artifact generation workflow
- `internal/application/services/context_assembler.go` — new service for building entity hierarchy context from database
- `internal/infrastructure/delivery/http/handlers/artifact_handler.go` — new HTTP handlers for artifact endpoints
- `internal/infrastructure/storage/s3_artifact_store.go` — new S3 storage adapter for artifact persistence
- `internal/domain/artifact/` — new domain package defining artifact aggregate, value objects, and repository interface

### Dependencies and Integration Points
- `internal/application/services/llm_service.go` — existing LLM abstraction from T2-001, provides `GenerateText(prompt, systemPrompt string) (string, error)`
- `internal/infrastructure/llm/bedrock_client.go` — existing Bedrock implementation from T2-001, handles API calls and token counting
- `internal/infrastructure/database/aurora/` — existing Aurora DSQL connection pooling and transaction utilities from T1-002
- `internal/domain/orbit/` — existing orbit aggregate with phase transitions and status management
- `internal/domain/intent/` — existing intent aggregate with metadata and constraint definitions
- `internal/domain/trajectory/` — existing trajectory aggregate for project organization
- `internal/domain/project/` — existing project aggregate as hierarchy root

### Configuration and Routing
- `internal/infrastructure/delivery/http/router.go` — add new artifact routes to existing API router
- `cmd/api/main.go` — wire artifact services into dependency injection container
- `config/config.yaml` — add artifact generation configuration (S3 bucket, token budget limits, timeout settings)

### Schema and Data Models
- `migrations/` — new migration for `artifacts` table schema in Aurora DSQL with columns: id (UUID), orbit_id (UUID FK), artifact_type (enum), version (int), s3_key (text), token_count (int), generation_duration_ms (int), metadata (JSONB), created_at (timestamp)
- `internal/infrastructure/database/aurora/models/artifact.go` — database model matching schema

### Testing
- `internal/application/services/artifact_generator_test.go` — unit tests with mocked LLM and storage
- `internal/infrastructure/delivery/http/handlers/artifact_handler_test.go` — HTTP handler tests
- `test/integration/artifact_generation_test.go` — end-to-end integration tests with real Bedrock and S3 (skipped in CI, runs in staging)

## Architecture Context

Prometheus V1 follows Clean Architecture with distinct layers: domain (entities and business logic), application (use cases and orchestration), infrastructure (external integrations), and delivery (HTTP handlers). Artifact generation sits in the application layer as a use case that orchestrates multiple concerns.

### Data Flow
1. **Request Entry**: HTTP handler receives generation request with orbit_id and artifact_type
2. **Context Assembly**: Context assembler queries Aurora DSQL to load full entity hierarchy (project → trajectory → intent → orbit) with all metadata
3. **Prompt Construction**: Artifact generator selects appropriate system prompt based on artifact_type (Intent Document, Context Package, etc.) from embedded prompt templates
4. **LLM Invocation**: Calls existing LLM service abstraction with assembled context and system prompt; LLM service handles Bedrock API communication, retries, and token counting
5. **Artifact Storage**: Generated markdown stored in S3 at path `artifacts/{project_id}/{trajectory_id}/{intent_id}/{orbit_id}/{artifact_type}/v{version}.md`
6. **Metadata Persistence**: Aurora DSQL transaction creates artifact record with s3_key, token_count, generation_duration_ms
7. **Response**: Returns artifact_id and presigned S3 URL (15min expiry) to caller

### Service Boundaries
- **Artifact Generator Service**: Owns generation workflow orchestration but delegates LLM calls and storage operations
- **Context Assembler Service**: Responsible for entity hierarchy queries and context construction; implements token budget enforcement by truncating context if needed
- **LLM Service Interface**: Abstract interface (already exists from T2-001) — artifact generator depends on interface, not concrete Bedrock implementation
- **S3 Artifact Store**: Repository pattern for artifact persistence; generates presigned URLs for secure retrieval

### Infrastructure Constraints
- AWS Bedrock Claude Sonnet 4 has 200K token context window; context assembler MUST track token count and prune if exceeded
- S3 bucket uses server-side encryption with AWS KMS; all PutObject calls must include encryption headers
- Aurora DSQL provides ACID transactions; artifact metadata writes use transactions to maintain consistency with version increments
- API gateway timeout is 30 seconds; LLM calls configured with 28-second timeout to allow for response marshalling

### Deployment Context
- API runs on ECS Fargate with IAM task role granting Bedrock, S3, and KMS permissions
- S3 bucket lifecycle policy archives artifacts >90 days to Glacier
- Aurora DSQL auto-scales; artifact metadata queries use read replicas for retrieval endpoints

## Pattern Library

### Request/Response Patterns
- **HTTP Handlers**: Thin handlers that validate input, call application service, return JSON response with error codes
  - Example: Existing orbit handlers in `internal/infrastructure/delivery/http/handlers/orbit_handler.go` show pattern: parse request → call service method → wrap response in standard envelope `{"data": {...}, "meta": {...}}`
  - Error responses follow RFC 7807 Problem Details: `{"type": "...", "title": "...", "status": 400, "detail": "..."}`

### Service Layer Patterns
- **Constructor Dependency Injection**: Services receive dependencies via constructor, stored as private fields
  - Example from T2-001: `func NewLLMService(bedrockClient BedrockClient, logger Logger) *LLMService`
- **Error Wrapping**: Use `fmt.Errorf("context: %w", err)` to wrap errors with context at each layer boundary
- **Context Propagation**: All service methods accept `context.Context` as first parameter for timeout/cancellation

### Repository Pattern
- **Interface Definition**: Domain layer defines repository interfaces; infrastructure layer implements them
  - Example: `internal/domain/orbit/repository.go` defines `OrbitRepository` interface; `internal/infrastructure/database/aurora/orbit_repository.go` implements it
- **Transactional Operations**: Use `BeginTx(ctx)` pattern from existing Aurora integration for atomic multi-step operations

### LLM Integration Patterns (from T2-001)
- **Prompt Templates**: System prompts stored as embedded files in `internal/application/prompts/` directory using `//go:embed` directive
- **Token Counting**: LLM service returns token count in response; caller logs and persists for cost tracking
- **Retry Logic**: Exponential backoff (3 attempts) for transient Bedrock errors (throttling, timeouts); fail fast on validation errors

### S3 Storage Patterns
- **Key Convention**: Hierarchical keys with entity IDs for organization and lifecycle policies: `{resource_type}/{parent_id}/{child_id}/{item}.ext`
- **Presigned URLs**: 15-minute expiry for read URLs; include `Content-Disposition: attachment` header to force download
- **Versioning**: S3 bucket has versioning disabled; application-level versioning through key naming (v1, v2, v3)

### Configuration Management
- **Environment-Specific Config**: YAML files per environment (dev, staging, prod) in `config/` directory
- **Secret Management**: AWS Secrets Manager for sensitive values (database passwords, API keys); loaded at startup via AWS SDK
- **Feature Flags**: No feature flag system yet; use environment variables for toggles (e.g., `ENABLE_ARTIFACT_GENERATION=true`)

### Testing Patterns
- **Table-Driven Tests**: Use subtests with table of test cases for comprehensive coverage
  - Example: Existing tests in `internal/domain/orbit/orbit_test.go` show pattern: `tests := []struct { name string; input X; want Y }{...}`
- **Mock Generation**: Use `mockgen` (already in `go.mod` from T1-002) to generate mocks for interfaces
- **Integration Test Tags**: Mark integration tests with `//go:build integration` to exclude from unit test runs

## Prior Orbit References

### T2-001 Orbit 1 (Completed): Integrate AWS Bedrock via Converse API
**Key Outcomes:**
- Established `LLMService` interface as abstraction over Bedrock API
- Implemented `BedrockClient` with Converse API integration, token counting, and error handling
- Created retry logic for transient Bedrock errors (throttling, timeouts)
- Validated 200K token context window capacity with test prompts

**Relevant Patterns to Reuse:**
- System prompt loading via `//go:embed` directive (see `internal/application/services/llm_service.go`)
- Error classification: permanent errors (400, 403) vs. transient errors (429, 503, 504)
- Token budget enforcement: Bedrock API returns token counts in response metadata; log and persist for cost tracking

**Known Issues:**
- Bedrock throttling limits not documented; implemented exponential backoff defensively
- Context window overflow (>200K tokens) returns cryptic error; need explicit pre-flight token count validation

### T1-002 Orbit 1 (Completed): Integrate Aurora DSQL
**Key Outcomes:**
- Connection pooling configured with PgBouncer-compatible settings (max 100 connections, idle timeout 5min)
- Transaction utilities in `internal/infrastructure/database/aurora/tx.go` for atomic operations
- Database migrations use `golang-migrate` tool; migration files in `migrations/` directory

**Relevant Patterns to Reuse:**
- Repository implementations use `sqlx` for query building (see `internal/infrastructure/database/aurora/orbit_repository.go`)
- Transactions wrapped in helper: `WithTransaction(ctx, db, func(tx *sqlx.Tx) error { ... })`
- JSONB columns mapped to `map[string]interfacenull` in Go structs; use `json.Marshal/Unmarshal` for serialization

**Known Issues:**
- Aurora DSQL lacks `RETURNING` clause support; must query after INSERT to get generated ID
- Connection pool exhaustion under load; monitor `pg_stat_activity` in production

### T1-001 Orbit 1 (Completed): Define ORBITAL Entity Model
**Key Outcomes:**
- Established entity hierarchy: Project → Trajectory → Intent → Orbit → Artifact
- Orbit phase enum values: `intent`, `context`, `proposal`, `implementation`, `verification`, `completion`
- Artifact type enum values: `intent_document`, `context_package`, `proposal_record`, `implementation_artifact`, `verification_protocol`, `orbit_log`, `trust_tier_policy`

**Relevant Patterns to Reuse:**
- Enum types defined as string constants in domain packages (e.g., `const PhaseIntent Phase = "intent"`)
- Entity IDs use UUIDs (v4) generated at creation time; database columns are `UUID` type

**Known Issues:**
- Artifact type to orbit phase mapping not formalized; need explicit mapping function (e.g., `intent` phase → `intent_document` artifact type)

### Prometheus V1 Initial Release (Foundation)
**Key Outcomes:**
- HTTP API framework uses Gorilla Mux for routing (see `internal/infrastructure/delivery/http/router.go`)
- Middleware chain includes: request ID injection, logging, CORS, panic recovery
- Structured logging with `zerolog` library; log format is JSON with context fields

**Relevant Patterns to Reuse:**
- API versioning via URL path prefix (`/api/v1/`)
- Error response envelope matches existing handlers: `{"error": {"type": "...", "message": "..."}}`
- Request validation using `validator/v10` library with struct tags (e.g., `validate:"required,uuid"`)

## Risk Assessment

### LLM Output Validity Risk
**Concern:** Bedrock generates malformed artifacts that don't match ORBITAL specifications (missing sections, hallucinated content, wrong structure).

**Blast Radius:** High — malformed artifacts become source of truth for downstream orbits; corrupt artifacts cascade into broken proposals, failed verifications, and incorrect decisions across the entire development lifecycle.

**Mitigation:**
- Implement post-generation validation: parse generated markdown, verify all required sections present, check section headings match specification exactly
- Store validation errors in artifact metadata JSONB column; surface in API response with 422 status if validation fails
- Create golden artifact examples in test suite; compare generated structure against known-good templates
- Add `/api/v1/artifacts/{artifact_id}/validate` endpoint for manual validation by engineers before using artifact

### Context Budget Overflow Risk
**Concern:** Entity hierarchy context exceeds Bedrock's 200K token limit, causing generation requests to fail with cryptic errors.

**Blast Radius:** Medium — blocks artifact generation for large projects/trajectories; no fallback mechanism; engineers must manually prune context or split intents.

**Mitigation:**
- Implement pre-flight token counting in context assembler before calling LLM service
- Define pruning strategy: truncate least-relevant entities first (older sibling intents, completed orbits beyond direct parents)
- Return 413 Payload Too Large with explicit token count (e.g., "Context requires 250K tokens, limit is 200K; prune 50K tokens")
- Log context size metrics (token count, entity depth) to CloudWatch for monitoring and alerting

### S3 Storage Failure Risk
**Concern:** S3 PutObject fails after LLM generates artifact (network error, permissions issue, bucket quota); artifact content lost but token cost already incurred.

**Blast Radius:** Low — single artifact generation fails; retry possible; token cost <$1 per artifact.

**Mitigation:**
- Implement 3-retry backoff for S3 uploads before failing request
- Store generated artifact content in Aurora DSQL `artifacts.metadata` JSONB column as backup if S3 fails (trim to 1MB max for JSONB size limit)
- Surface S3 failure in API response with 500 status and include artifact content in response body so caller can manually store
- Alert on S3 failure rate >1% via CloudWatch alarm

### Cost Runaway Risk
**Concern:** Unbounded artifact generation requests exhaust AWS Bedrock quotas or generate unexpected costs (e.g., malicious actor spamming generation endpoint, infinite retry loops).

**Blast Radius:** High — service-wide Bedrock throttling affects all LLM features; unpredictable AWS bill; production outage.

**Mitigation:**
- Implement rate limiting per orbit: max 5 artifact generations per hour per orbit (use Redis counter or Aurora DSQL table)
- Add cost tracking table in Aurora DSQL: `llm_usage` with columns (request_id, orbit_id, model, token_count, cost_usd, timestamp)
- Set up CloudWatch billing alarm: alert if daily Bedrock cost exceeds $100 threshold
- Require authentication on generation endpoint; audit log all requests with user ID and orbit ID

### Artifact Version Collision Risk
**Concern:** Concurrent generation requests for same orbit/artifact_type create race condition; two versions claim to be "v2"; S3 overwrites or Aurora DSQL violates unique constraint.

**Blast Radius:** Low — rare edge case (requires simultaneous requests); data corruption limited to single artifact version.

**Mitigation:**
- Add unique constraint on `(orbit_id, artifact_type, version)` in Aurora DSQL schema; database enforces version uniqueness
- Handle unique violation error (PostgreSQL error code 23505) by retrying with incremented version number (max 3 retries)
- Use database transaction to atomically: query max version, insert new version, commit
- Log version collision events to CloudWatch for monitoring race condition frequency

### Backward Compatibility Break Risk
**Concern:** New artifact endpoints or schema changes break existing Prometheus V1 API contracts or database queries.

**Blast Radius:** High — production API outage; existing clients (frontend, CLI, integrations) fail; rollback required.

**Mitigation:**
- Add new routes only (`/api/v1/orbits/{orbit_id}/artifacts/*`); no modifications to existing orbit endpoints
- Artifacts table is new (no existing columns modified); foreign key to orbits table uses standard `orbit_id` column already present
- Run integration test suite against staging environment before production deployment; verify existing orbit CRUD operations still work
- Use database migration tool to apply schema change with down-migration script for rollback capability