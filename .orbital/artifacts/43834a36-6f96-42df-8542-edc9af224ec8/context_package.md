# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** T6-003

---

## Codebase References

### Primary (will be modified or created)

**Infrastructure (CDK)**
- `infra/lib/stacks/fargate-llm-stack.ts` — new stack for Fargate task definitions, ECS cluster, SQS queue
- `infra/lib/constructs/fargate-task.ts` — reusable construct for LLM task definition with IAM roles, CloudWatch logging
- `infra/lib/constructs/llm-queue.ts` — SQS queue construct with DLQ, visibility timeout, encryption

**Lambda API Layer**
- `src/lambda/api/artifacts/generate.ts` — modify to enqueue SQS message instead of synchronous Bedrock invocation
- `src/lambda/api/chat/send-message.ts` — modify to enqueue SQS message for LLM response generation
- `src/lambda/api/shared/queue-client.ts` — new module for SQS message publishing with typed message schemas

**Fargate Task Handler**
- `src/fargate/llm-processor/index.ts` — new entrypoint for Fargate task; polls SQS, dispatches to handlers
- `src/fargate/llm-processor/handlers/artifact-generator.ts` — extract existing artifact generation logic from Lambda
- `src/fargate/llm-processor/handlers/chat-responder.ts` — extract existing chat response logic from Lambda
- `src/fargate/llm-processor/lib/bedrock-client.ts` — shared Bedrock invocation logic with retry/timeout handling
- `src/fargate/llm-processor/lib/websocket-notifier.ts` — client for posting events to WebSocket API
- `src/fargate/llm-processor/lib/result-persister.ts` — S3 upload and DSQL write logic

**Docker**
- `src/fargate/llm-processor/Dockerfile` — multi-stage build for Node.js runtime with AWS SDK, minimal dependencies
- `.dockerignore` — exclude dev dependencies, tests from image

### Secondary (dependencies and interfaces)

**Shared Libraries**
- `src/shared/types/queue-messages.ts` — TypeScript interfaces for SQS message payloads (artifact request, chat request)
- `src/shared/types/websocket-events.ts` — existing WebSocket event schemas that Fargate must emit
- `src/shared/lib/db/dsql-client.ts` — existing DSQL connection pool configuration
- `src/shared/lib/storage/s3-client.ts` — existing S3 client with bucket configuration
- `src/shared/lib/observability/logger.ts` — structured logging utility for CloudWatch
- `src/shared/lib/observability/tracer.ts` — AWS X-Ray tracing configuration

**Lambda Layer**
- `layers/bedrock-sdk/nodejs/package.json` — existing Bedrock SDK dependencies that Fargate will reuse

**Database Schema**
- `src/shared/types/db/artifacts.ts` — TypeScript types for `artifacts` table
- `src/shared/types/db/chat_messages.ts` — TypeScript types for `chat_messages` table
- `migrations/` — existing Flyway migrations defining DSQL schema

**WebSocket Infrastructure**
- `src/lambda/websocket/connection-manager.ts` — existing connection manager that Fargate will invoke via API Gateway Management API

### Tests

**Unit Tests**
- `src/fargate/llm-processor/handlers/__tests__/artifact-generator.test.ts` — table-driven tests for artifact generation logic
- `src/fargate/llm-processor/handlers/__tests__/chat-responder.test.ts` — table-driven tests for chat response logic
- `src/lambda/api/artifacts/__tests__/generate.test.ts` — update existing tests to verify SQS enqueue behavior

**Integration Tests**
- `tests/integration/fargate-llm-flow.test.ts` — end-to-end test: API → SQS → Fargate → S3/DSQL → WebSocket
- `tests/integration/helpers/fargate-test-harness.ts` — helper to spin up local SQS + mock Bedrock for integration tests

---

## Architecture Context

Prometheus V1 follows a **serverless-first architecture** with Lambda handling synchronous API requests, DynamoDB/DSQL for persistence, and S3 for large object storage. WebSocket connections are managed via API Gateway WebSocket API for real-time updates.

**Current state:** Artifact generation and AI chat operations execute synchronously in Lambda functions behind API Gateway. Lambda invokes Bedrock (`anthropic.claude-3-5-sonnet-20241022`) and waits for the response, which can take 30-180 seconds for complex prompts. This frequently triggers Lambda timeout failures (15 min max) and incurs cold-start penalties for bursty traffic.

**Target state:** API Lambda functions accept HTTP requests, validate inputs, enqueue a message to SQS with request metadata, and return HTTP 202 Accepted. Fargate tasks poll SQS, process LLM operations with no timeout constraints, store results in S3/DSQL, and emit WebSocket events to notify the frontend. The API layer becomes stateless and responsive; Fargate provides elastic compute for variable LLM workloads.

**Data flow:**
1. API Gateway → Lambda (HTTP POST /artifacts or /chat)
2. Lambda → SQS (enqueue message with request payload + user context)
3. Lambda → Client (HTTP 202 + operation ID)
4. SQS → Fargate ECS Task (long-poll, visibility timeout 15 min)
5. Fargate → Bedrock (invoke model with prompt)
6. Fargate → S3 (upload artifact JSON/Markdown)
7. Fargate → DSQL (insert/update artifact or chat_message record)
8. Fargate → WebSocket API (postToConnection with event payload)
9. WebSocket → Frontend (real-time event delivery)

**Infrastructure boundaries:**
- **VPC:** Fargate tasks run in private subnets with NAT Gateway for Bedrock egress; VPC endpoint for WebSocket API Management required if tasks are fully private
- **IAM:** Separate task execution role (ECR pull, CloudWatch logs) and task role (DSQL, S3, SQS, WebSocket, Bedrock)
- **Regions:** Primary deployment in `us-east-1`; SQS and Fargate must be co-located to minimize cross-AZ data transfer costs

**Reference docs:**
- `docs/architecture/serverless-patterns.md` — existing Lambda + DynamoDB patterns
- `docs/architecture/websocket-events.md` — event schema contracts
- `.github/copilot-instructions.md` — project-wide patterns and conventions

---

## Pattern Library

### Conventions (follow these)

**CDK Infrastructure Patterns**
- **Construct composition:** See `infra/lib/constructs/api-lambda.ts` — all infrastructure defined as L3 constructs that encapsulate resources + IAM + observability
- **Stack organization:** See `infra/lib/stacks/` — one stack per logical domain (api, auth, storage); cross-stack references via exports, not hard-coded ARNs
- **IAM least-privilege:** See `infra/lib/constructs/lambda-function.ts` — grant specific actions on specific resources; never use `iam:*` or wildcard resource ARNs
- **Tagging:** All resources tagged with `project: prometheus`, `trajectory: <name>`, `cost-center: dev|prod`

**Lambda Handler Patterns**
- **Typed handlers:** See `src/lambda/api/orbits/create.ts` — handlers import shared types, validate input with Zod schemas, return structured responses
- **Error handling:** See `src/lambda/api/shared/error-handler.ts` — all errors caught by middleware, logged with correlation ID, mapped to HTTP status codes
- **SQS client usage:** New pattern for this orbit — client must batch messages for cost efficiency, include message attributes for X-Ray tracing

**Database Access Patterns**
- **Connection pooling:** See `src/shared/lib/db/dsql-client.ts` — single connection pool per Lambda/Fargate instance, configured with `max: 10` connections for Fargate
- **Query builders:** See `src/lambda/api/orbits/queries.ts` — use Kysely query builder for type-safe SQL; no raw SQL strings outside migrations
- **Transactions:** See `src/lambda/api/artifacts/update.ts` — use `db.transaction()` when updating multiple tables; Fargate must handle transaction retries on deadlock

**WebSocket Event Patterns**
- **Event schema:** See `src/shared/types/websocket-events.ts` — all events include `type`, `timestamp`, `data`, `correlationId`
- **Connection lookup:** See `src/lambda/websocket/connection-manager.ts` — query DynamoDB `websocket_connections` table by `userId` to get `connectionId` before posting
- **Error handling:** WebSocket postToConnection failures (410 Gone) trigger connection cleanup; do not fail the entire Fargate task

**Testing Patterns**
- **Table-driven tests:** See `tests/unit/lambda/api/orbits/create.test.ts` — use `describe.each()` for input variations, assert on output shape + side effects
- **Integration test setup:** See `tests/integration/helpers/test-db.ts` — use Testcontainers for local Postgres, seed with minimal fixture data
- **Mocking external services:** See `tests/unit/lambda/api/__mocks__/bedrock.ts` — mock AWS SDK clients with `aws-sdk-client-mock`, assert on invocation parameters

**Docker Image Patterns**
- **Multi-stage builds:** Use `node:18-alpine` base, separate build stage for TypeScript compilation, final stage with only runtime dependencies
- **Security:** Run as non-root user, scan image with Trivy in CI, store in private ECR with lifecycle policy (keep last 10 images)
- **Size optimization:** Use `.dockerignore` to exclude tests, source maps, devDependencies; aim for <200MB final image

### Anti-patterns (avoid these)

- **Synchronous LLM calls in Lambda:** The entire point of this orbit is to eliminate synchronous Bedrock invocations from API handlers
- **Inline IAM policies:** Never define IAM policies as inline JSON in CDK — use `grant*()` methods or `PolicyStatement` with explicit actions/resources
- **Hardcoded ARNs or IDs:** Use CDK references (`queue.queueArn`) or SSM Parameter Store lookups; never hardcode production resource identifiers
- **Missing X-Ray tracing:** All Fargate tasks must enable AWS X-Ray; Lambda already has it enabled via layer
- **Silent failures:** If Fargate cannot post to WebSocket or persist to DSQL, it MUST log error + send message to DLQ; never swallow exceptions
- **Unbounded retries:** SQS visibility timeout is 15 minutes; Fargate tasks must complete or fail within 14 minutes to avoid duplicate processing
- **Shared mutable state:** Fargate tasks are ephemeral; do not rely on local filesystem or in-memory state across invocations

---

## Prior Orbit References

### Completed

**T6-001 (Orbit 3) — Bedrock Integration for Artifact Generation**
- Established the prompt engineering patterns for Claude 3.5 Sonnet
- Defined the `generateArtifact()` function signature that this orbit will extract and migrate to Fargate
- Stored generated artifacts in S3 with `Content-Type: application/json` and MIME type detection for Markdown
- Created the `artifacts` table in DSQL with columns: `id`, `orbit_id`, `type`, `content_s3_uri`, `status`, `created_at`, `updated_at`
- **Reuse:** The Bedrock invocation logic, prompt templates, and S3 storage patterns are fully transferable to Fargate; no changes needed to the LLM interaction layer

**T2-004 (Orbit 2) — WebSocket Real-Time Updates**
- Defined the `artifact.completed` event schema: `{ type, artifactId, orbitId, s3Uri, timestamp }`
- Defined the `chat.response` event schema: `{ type, messageId, chatId, content, timestamp }`
- Implemented `ConnectionManager.postToConnection()` in Lambda for sending events
- **Reuse:** Fargate must emit the exact same event schemas; frontend expects no changes. The `ConnectionManager` can be extracted into a shared library that both Lambda and Fargate import.

**T6-002 (Orbit 4) — Lambda Async Refactor with Feature Flags**
- Introduced `FeatureFlags` table in DSQL with per-tenant or global toggle support
- Established the pattern: API handlers check feature flag → route to new or legacy implementation
- Deployed `fargateEnabled` flag (default: `false`) to control rollout
- **Dependency:** This orbit assumes T6-002 is complete; API handlers can check `fargateEnabled` to route requests to SQS vs synchronous Bedrock call

### Known Issues

- **Bedrock throttling:** Claude 3.5 Sonnet has a 200 requests/minute soft limit in `us-east-1`; Fargate tasks must implement exponential backoff with jitter on `ThrottlingException`
- **WebSocket connection expiry:** Connections expire after 2 hours of inactivity; if a Fargate task takes >2 hours, the WebSocket event will fail with 410 Gone. Mitigation: Add connection age check before posting; log warning if connection is stale.
- **S3 eventual consistency:** Although S3 is now strongly consistent for PUTs, there's a race condition if the frontend immediately reads S3 after receiving the WebSocket event. Mitigation: Include the S3 ETag in the event payload so frontend can verify it fetched the correct version.

---

## Risk Assessment

### Architectural Risks

**Risk:** Fargate cold-start latency violates the "begin processing within 30 seconds" acceptance boundary  
**Impact:** High — user-facing delay in artifact generation  
**Likelihood:** Medium — ECS Fargate typically starts tasks in 10-20 seconds, but scaling from 0 tasks can take longer  
**Mitigation:**
- Configure ECS Service with `desiredCount: 1` minimum to keep one warm task always running
- Use SQS long-polling (20 seconds) to reduce idle task cost while maintaining responsiveness
- Add CloudWatch alarm on SQS `ApproximateAgeOfOldestMessage` metric; alert if >30 seconds

**Risk:** SQS message duplication causes duplicate artifact generation or chat responses  
**Impact:** Medium — wasted compute cost, duplicate S3 objects, confused users  
**Likelihood:** Low — SQS Standard Queue has at-least-once delivery; exact-once is not guaranteed  
**Mitigation:**
- Use idempotency keys: store request ID in DSQL with `UNIQUE` constraint; Fargate checks if request already processed before invoking Bedrock
- SQS message deduplication ID set to request correlation ID
- Consider switching to SQS FIFO queue if exact-once delivery is required (Intent says `.fifo` but also says "Standard Queue" — clarify with human)

**Risk:** Fargate task OOM kill during large LLM response streaming  
**Impact:** High — task failure, message returns to SQS, retry loop  
**Likelihood:** Medium — Claude responses can be 100k+ tokens  
**Mitigation:**
- Start with 4GB memory allocation; monitor `ECS/ContainerInsights` memory usage metrics
- Implement streaming response handling: write chunks to S3 as they arrive, not buffering entire response in memory
- Add circuit breaker: if task fails 3 times with OOM, route to DLQ and alert

### Security Risks

**Risk:** Fargate task role over-permissioned, allowing cross-tenant data access  
**Impact:** Critical — tenant data leakage  
**Likelihood:** Low — IAM policies reviewed in pre-deploy gate  
**Mitigation:**
- Task role scoped to specific S3 prefix per tenant: `s3:PutObject` on `prometheus-artifacts-prod/${tenantId}/*`
- DSQL queries must always filter by `tenant_id` column; add row-level security (RLS) policy if Aurora supports it
- Tag all S3 objects with `tenant_id` tag; use S3 Bucket Policies to enforce tag-based access control

**Risk:** SQS message contains PII or sensitive prompt data, persisted in CloudWatch Logs  
**Impact:** Medium — compliance violation, data retention issues  
**Likelihood:** Medium — prompts may include user-generated content with PII  
**Mitigation:**
- Redact message bodies in CloudWatch logs; only log message ID, timestamp, tenant ID
- Enable SQS encryption at rest with KMS key
- Set SQS message retention to 4 hours (Intent specifies this); no longer than necessary

**Risk:** Malicious actor sends crafted SQS message bypassing Lambda validation  
**Impact:** High — code injection, resource exhaustion  
**Likelihood:** Low — SQS queue policy restricts SendMessage to Lambda execution role only  
**Mitigation:**
- Validate message schema in Fargate handler using Zod before processing
- Set SQS `ReceiveMessageWaitTimeSeconds` to 20 for long-polling, reducing API call costs
- Implement rate limiting at the API layer (already exists); SQS is not externally accessible

### Operational Risks

**Risk:** Cost overrun due to Fargate tasks running longer than expected  
**Impact:** High — exceeds $0.50/hour constraint  
**Likelihood:** Medium — LLM response times are variable  
**Mitigation:**
- Set task timeout at 14 minutes (1 minute buffer before SQS visibility timeout); if not complete, send to DLQ and notify user
- Monitor `ECS/ContainerInsights` task duration metrics; alert if p95 >10 minutes
- Implement cost tracking: tag Fargate tasks with `requestId`, use Cost Explorer to analyze per-request cost breakdown

**Risk:** DLQ fills up with failed messages, no alerting configured  
**Impact:** Medium — user requests lost, no visibility into failures  
**Likelihood:** Medium — Bedrock throttling or DSQL deadlocks could cause sustained failures  
**Mitigation:**
- Configure CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible` >10
- Create Lambda trigger on DLQ to send failure event to WebSocket API: `{ type: "artifact.failed", errorCode: "llm_failure" }`
- Set up weekly review of DLQ messages to identify systemic issues

**Risk:** Rollback to synchronous Lambda pattern fails due to API contract drift  
**Impact:** High — cannot revert changes if Fargate pattern has issues  
**Likelihood:** Low — Intent specifies feature flag control for ≥7 days  
**Mitigation:**
- Keep legacy synchronous Lambda handlers in codebase for 30 days post-rollout
- Feature flag stored in DSQL `feature_flags` table, toggled via admin API (no redeployment required)
- Integration tests cover both synchronous and async flows to catch contract drift

### Performance Risks

**Risk:** SQS polling introduces latency spikes in p95 task startup time  
**Impact:** Medium — violates "begin processing within 30 seconds"  
**Likelihood:** Low — SQS long-polling with 20-second wait time should minimize idle time  
**Mitigation:**
- Use ECS Service with target tracking scaling on SQS `ApproximateNumberOfMessagesVisible` metric: scale up when >5 messages in queue
- Monitor SQS `ApproximateAgeOfOldestMessage`; if consistently >10 seconds, increase desired task count

**Risk:** Concurrent Fargate tasks exhaust DSQL connection pool  
**Impact:** High — database errors, failed artifact writes  
**Likelihood:** Medium — Intent specifies ≥10 concurrent tasks; DSQL connection pool max is 100  
**Mitigation:**
- Configure Fargate task connection pool with `max: 10` connections per task (10 tasks × 10 = 100 connections at peak)
- Implement connection retry with exponential backoff if pool is exhausted
- Monitor Aurora `DatabaseConnections` metric; alert if >80% utilization

---

## Dependencies

### Internal

- **DSQL Connection Pool:** `src/shared/lib/db/dsql-client.ts` — Fargate must import and configure with higher connection limit than Lambda
- **WebSocket Connection Manager:** `src/lambda/websocket/connection-manager.ts` — extract into `src/shared/lib/websocket-client.ts` for use in Fargate
- **S3 Client:** `src/shared/lib/storage/s3-client.ts` — reuse existing client configuration with bucket name from environment variable
- **Logger:** `src/shared/lib/observability/logger.ts` — structured logging for CloudWatch
- **Tracer:** `src/shared/lib/observability/tracer.ts` — X-Ray integration for distributed tracing

### External

- **AWS Bedrock Runtime:** `bedrock-runtime:InvokeModel` — existing IAM policy from Lambda applies to Fargate task role
- **SQS Standard Queue:** New `prometheus-llm-tasks-prod.fifo` (or `.standard` if FIFO not required) with KMS encryption, 4-hour retention
- **ECS Fargate:** Task definition with 2 vCPU, 4GB memory, `awslogs` log driver to CloudWatch
- **ECR:** Private repository `prometheus/llm-processor` for Docker image storage
- **API Gateway Management API:** `execute-api:ManageConnections` permission for Fargate task role to post WebSocket events

### Ordering Constraints

- **Must complete before T6-004:** This orbit establishes the SQS + Fargate pattern that T6-004 (Background Processing) will extend
- **Requires T6-002 completion:** Assumes API handlers have feature flag logic already in place
- **Requires T2-004 completion:** Assumes WebSocket event schemas are stable and frontend expects them