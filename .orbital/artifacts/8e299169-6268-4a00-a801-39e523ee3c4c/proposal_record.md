# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Context Package:** CTX-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

When users initiate artifact generation or AI chat operations that invoke Bedrock APIs for extended durations, the system currently blocks Lambda execution until completion, hitting 15-minute timeouts and producing 504 errors. This orbit transforms those synchronous operations into asynchronous workflows: Lambda handlers immediately accept the request, generate a correlation ID, place a structured message on an SQS queue, and return HTTP 202 Accepted with a tracking reference. Fargate tasks running in the same VPC poll that queue, execute the LLM operation with whatever time it needs, store results in S3 for artifacts or DSQL for chat history, and emit WebSocket events notifying the frontend of completion. Users see responsive initial acceptance, real-time progress updates via WebSocket, and eventual result delivery without any timeout failures — even for operations exceeding 15 minutes.

The core outcome: **no more timeout-driven failures for LLM operations, with maintained UX responsiveness through asynchronous feedback.**

---

## Implementation Plan

### Files to Create

**Fargate Worker Core:**
- `src/fargate/workers/llm-task-processor.ts` — Main entrypoint implementing SQS long-polling loop, message deserialization, task routing to handlers, visibility timeout management, graceful SIGTERM handling
- `src/fargate/workers/handlers/artifact-generation.ts` — Extracted artifact generation logic consuming `ArtifactGenerationPayload`, invoking Bedrock, storing to S3, writing metadata to DSQL
- `src/fargate/workers/handlers/chat-processing.ts` — Chat message processing logic consuming `ChatMessagePayload`, invoking Bedrock for conversational response, appending to DSQL chat history
- `src/fargate/workers/services/bedrock-client.ts` — Fargate-optimized Bedrock SDK wrapper with connection pooling, token counting, retry backoff
- `src/fargate/workers/services/result-storage.ts` — Abstraction layer for S3 PutObject with ETag capture and DSQL writes with correlation ID tracking
- `src/fargate/workers/services/websocket-notifier.ts` — WebSocket event emission service querying connection table for user's active connection, sending structured events via API Gateway WebSocket endpoint

**Shared Type Definitions:**
- `src/shared/types/task-messages.ts` — TypeScript interfaces for `LLMTaskMessage`, `ArtifactGenerationPayload`, `ChatMessagePayload` matching SQS message schema
- `src/shared/types/websocket-events.ts` — Interfaces for `TaskStartedEvent`, `TaskProgressEvent`, `TaskCompletedEvent`, `TaskFailedEvent` with correlation ID, task type, timestamp, payload fields
- `src/shared/services/sqs-publisher.ts` — Lambda-side helper for enqueuing messages with automatic JSON serialization, error handling, retry logic

**Infrastructure as Code:**
- `infrastructure/fargate/task-definition.ts` — Update existing ECS task definition to include environment variables for `LLM_TASK_QUEUE_URL`, `ARTIFACT_BUCKET_NAME`, `DSQL_CONNECTION_STRING`, `WEBSOCKET_API_ENDPOINT`
- `infrastructure/fargate/service-scaling.ts` — ECS service autoscaling policy targeting `ApproximateNumberOfMessagesVisible` SQS metric, scale-in protection configuration
- `infrastructure/iam/fargate-task-role.ts` — IAM policy granting `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` on LLM task queue, `s3:PutObject` on artifact bucket with encryption condition, `dsql:ExecuteStatement` on artifact and task tables, `execute-api:ManageConnections` for WebSocket API
- `infrastructure/cloudwatch/dashboards/llm-pipeline.ts` — Dashboard with widgets for SQS queue depth, Fargate task count, Bedrock invocation latency, WebSocket notification success rate, end-to-end correlation ID traces

**Database Migrations:**
- `database/migrations/008_add_task_tracking.sql` — DSQL schema adding `tasks` table with columns: `id UUID PRIMARY KEY`, `correlation_id UUID NOT NULL UNIQUE`, `task_type TEXT`, `user_id TEXT`, `organization_id TEXT`, `status TEXT`, `created_at TIMESTAMP`, `completed_at TIMESTAMP`, `error_message TEXT`, `result_uri TEXT`
- `database/migrations/009_add_correlation_indexes.sql` — Indexes on `artifacts.correlation_id`, `chat_messages.correlation_id`, `tasks.correlation_id` for fast lookup during result retrieval

**Testing Infrastructure:**
- `tests/integration/llm-task-pipeline.test.ts` — End-to-end test simulating Lambda enqueue → SQS delivery → Fargate pickup → Bedrock mock response → S3 write → DSQL insert → WebSocket event emission
- `tests/unit/fargate/workers/llm-task-processor.test.ts` — Unit tests for SQS message parsing, visibility timeout extension, error handling, graceful shutdown
- `tests/mocks/sqs-message-factory.ts` — Factory functions generating valid `LLMTaskMessage` payloads for artifact generation and chat processing test cases

### Files to Modify

**Lambda HTTP Handlers (Refactor to Async Enqueue):**
- `src/lambda/handlers/artifacts/generate.ts` — Replace synchronous Bedrock invocation with correlation ID generation, SQS message construction, enqueue call, HTTP 202 response with `{ correlationId, status: 'accepted', message: 'Task enqueued for processing' }`
- `src/lambda/handlers/intents/create.ts` — Modify intent creation flow to enqueue artifact generation task instead of inline execution; return intent record with `artifact_status: 'pending'`
- `src/lambda/handlers/chat/message.ts` — Replace inline chat processing with SQS enqueue; return HTTP 202 with correlation ID; frontend polls or waits for WebSocket event
- `src/lambda/handlers/proposals/generate.ts` — Convert to async enqueue pattern matching `artifacts/generate.ts`
- `src/lambda/handlers/evaluations/generate.ts` — Convert to async enqueue pattern matching `artifacts/generate.ts`

**Shared Service Updates:**
- `src/shared/services/correlation-id.ts` — Add `generateCorrelationId()` function using `crypto.randomUUID()` with uniqueness validation against DSQL before returning
- `src/shared/middleware/auth-context.ts` — Export `serializeAuthContext()` function extracting Cognito JWT claims into SQS message context structure

**Frontend API Client (Minimal Change):**
- `src/frontend/services/api-client.ts` — Update artifact generation and chat submission methods to handle HTTP 202 responses, store correlation ID in local state, poll `GET /api/tasks/{correlationId}` as fallback if WebSocket disconnected

### Approach

This implementation follows the **async task handoff pattern** established in the context package. Lambda handlers shift from "process and respond" to "validate, enqueue, and acknowledge." The architectural boundary is clear: Lambda owns HTTP contract enforcement and SQS message publishing; Fargate owns LLM invocation and result persistence.

The Fargate worker runs a single-threaded long-polling loop processing one message at a time per task instance. This simplicity avoids concurrency bugs and connection pool contention. Horizontal scaling is handled by ECS service autoscaling spinning up additional task instances based on SQS queue depth.

WebSocket notification is best-effort: if a connection is stale or closed, the notification is skipped and the task status in DSQL reflects `completed_notification_failed`. Frontend polling provides the fallback mechanism.

All shared code — message schemas, correlation ID generation, auth context serialization — lives in `src/shared/` for use by both Lambda and Fargate. The Bedrock client implementation is duplicated (not shared) because Lambda and Fargate have different optimization profiles: Lambda prioritizes cold start time; Fargate prioritizes persistent connection reuse.

### Order of Operations

**Phase 1 — Shared Infrastructure & Types (Foundation):**
1. Create `src/shared/types/task-messages.ts` and `src/shared/types/websocket-events.ts` with full TypeScript interfaces
2. Implement `src/shared/services/sqs-publisher.ts` with enqueue helper function
3. Update `src/shared/services/correlation-id.ts` with UUID generation and DSQL uniqueness check
4. Export `serializeAuthContext()` in `src/shared/middleware/auth-context.ts`
5. Run DSQL migrations `008_add_task_tracking.sql` and `009_add_correlation_indexes.sql` in dev environment
6. Update Fargate task definition with environment variables for queue URL, bucket name, DSQL connection string

**Phase 2 — Fargate Worker Implementation (Core Processing):**
1. Implement `src/fargate/workers/services/result-storage.ts` with S3 and DSQL write abstractions
2. Implement `src/fargate/workers/services/websocket-notifier.ts` with connection lookup and event emission
3. Create `src/fargate/workers/handlers/artifact-generation.ts` consuming the artifact generation message payload, calling Bedrock, storing results
4. Create `src/fargate/workers/handlers/chat-processing.ts` with chat message handling logic
5. Implement `src/fargate/workers/llm-task-processor.ts` with SQS polling loop, message routing, visibility timeout management
6. Build Docker image, push to ECR, deploy updated task definition to ECS dev cluster
7. Smoke test: manually place message on SQS queue, verify Fargate task picks it up, processes, and emits WebSocket event

**Phase 3 — Lambda Handler Refactoring (Entry Points):**
1. Refactor `src/lambda/handlers/artifacts/generate.ts` to enqueue pattern with HTTP 202 response
2. Refactor `src/lambda/handlers/chat/message.ts` to enqueue pattern
3. Refactor `src/lambda/handlers/proposals/generate.ts`, `src/lambda/handlers/evaluations/generate.ts`, `src/lambda/handlers/intents/create.ts` similarly
4. Deploy Lambda functions to dev environment with feature flag `ENABLE_FARGATE_OFFLOAD=true`
5. Integration test: submit artifact generation request via HTTP, verify 202 response, observe SQS message arrival, Fargate processing, result storage, WebSocket event delivery

**Phase 4 — Observability & Operational Readiness (Monitoring):**
1. Deploy CloudWatch dashboard `infrastructure/cloudwatch/dashboards/llm-pipeline.ts` with all pipeline metrics
2. Configure ECS service autoscaling policy targeting SQS queue depth with 60-second cooldown
3. Set CloudWatch alarms: `SQSQueueDepth > 100`, `DLQMessageCount > 0`, `FargateTaskFailures > 5/hour`, `WebSocketNotificationFailures > 5%`
4. Write runbook documentation for common failure modes: stuck messages, connection pool exhaustion, Bedrock throttling
5. Load test: submit 20 concurrent artifact generation requests, verify autoscaling behavior, check for resource contention

**Phase 5 — Testing & Validation (Quality Assurance):**
1. Implement `tests/unit/fargate/workers/llm-task-processor.test.ts` covering SQS parsing, error handling, shutdown
2. Implement `tests/integration/llm-task-pipeline.test.ts` with full end-to-end flow using LocalStack or moto mocks
3. Create `tests/mocks/sqs-message-factory.ts` with realistic test payloads
4. Run test suite: unit tests, integration tests, load tests
5. Regression validation: ensure existing synchronous Lambda paths (if kept as fallback) still function

**Phase 6 — Production Deployment (Rollout):**
1. Deploy to staging environment with `ENABLE_FARGATE_OFFLOAD=true` for internal users
2. Monitor for 48 hours: check error rates, latency percentiles, cost metrics
3. Deploy to production with gradual rollout: 10% traffic → 50% → 100% over 3 days
4. Deprecate synchronous Lambda paths once Fargate proven stable (retain as emergency rollback for 30 days)

### Dependencies

**Technical Prerequisites:**
- T6-001 Fargate Service Definition must be deployed with validated ECS cluster, task definition, IAM roles
- T6-002 SQS Queue Provisioning must be complete with queue URL, DLQ, CloudWatch alarms configured
- WebSocket API infrastructure (from T5-001) must have connection table and Lambda authorizer operational
- S3 artifact bucket `prometheus-artifacts-{env}` must exist with versioning and lifecycle policies
- Aurora DSQL cluster must be accessible from Fargate VPC subnets with credentials stored in Secrets Manager

**Service Availability:**
- AWS Bedrock Claude 3.5 Sonnet must be available in us-east-1
- VPC NAT Gateway in availability zones us-east-1a and us-east-1b must have capacity headroom for Fargate egress traffic
- CloudWatch Logs retention policies must be configured on `/ecs/prometheus-llm-worker` log group

**Prior Context:**
- This orbit assumes foundational Fargate infrastructure is stable (smoke-tested with dummy task in T6-001)
- Does NOT require T6-004 (retry logic) or T6-005 (multi-region) to proceed — those are follow-on enhancements

---

## Risk Surface

### Edge Cases

**1. SQS Message Visibility Timeout Expiration During Long Bedrock Call**

If a Bedrock API call for complex artifact generation takes longer than the 10-minute visibility timeout, the message becomes visible to other tasks while the original task is still processing. This could cause duplicate artifact generation.

**Mitigation:** Implement visibility timeout extension in the worker loop. Every 8 minutes of processing, call `sqs.changeMessageVisibility` to extend timeout by another 10 minutes (max 12 hours SQS limit). Bedrock client wrapper emits progress events that trigger these extensions.

**2. WebSocket Connection Closed Between Task Enqueue and Completion**

User submits artifact generation, receives HTTP 202, but closes browser tab or loses network connectivity. Fargate completes task and attempts WebSocket notification, but connection no longer exists.

**Mitigation:** WebSocket notifier queries DSQL `websocket_connections` table filtering for `last_ping_at > NOW() - INTERVAL '5 minutes'`. If no active connection found, log warning and set task status to `completed_notification_failed`. Frontend implements polling fallback: every 10 seconds, call `GET /api/tasks/{correlationId}` to check status. This pattern is already established in the context package under "WebSocket Connection Staleness" risk.

**3. Correlation ID Collision (UUID Duplicate)**

Two simultaneous requests generate the same UUID (probability ~10^-18 but non-zero at scale). Both tasks use the same correlation ID, causing log confusion, DSQL constraint violation, and potential cross-user data exposure.

**Mitigation:** Add `generateCorrelationId()` function in `src/shared/services/correlation-id.ts` that queries DSQL `tasks` table before returning: `SELECT COUNT(*) FROM tasks WHERE correlation_id = $1`. If collision detected, regenerate and retry up to 3 attempts. Lambda returns 500 Internal Server Error if all attempts fail. DSQL unique constraint on `(correlation_id, user_id)` provides secondary defense preventing persistence of collisions.

**4. Fargate Task Terminated During Processing by ECS Scale-Down**

ECS service autoscaling policy scales down tasks due to falling queue depth, but a running task is mid-execution. Task receives SIGTERM and is forcibly terminated after 30-second grace period.

**Mitigation:** Set ECS service minimum task count to 1 (never scale to zero during business hours). Implement graceful shutdown in `llm-task-processor.ts`: on SIGTERM signal, stop polling new messages, extend visibility timeout on current message, attempt to complete processing within grace period. If completion not possible, visibility timeout expiration causes message to return to queue naturally. Add CloudWatch alarm on `TasksStoppedReason = ScaleDown` to detect premature terminations.

**5. S3 PutObject Succeeds But DSQL Write Fails**

Fargate task writes artifact to S3 successfully, receives ETag, but DSQL connection fails before writing metadata record. Artifact exists in S3 but is orphaned — no DSQL record means no API discoverability.

**Mitigation:** Implement two-phase commit pattern in `result-storage.ts`: (1) write DSQL record with status `storing`, (2) write S3 object, (3) update DSQL record with S3 URI and ETag, set status `completed`. If step 3 fails, retry DSQL update 3 times with exponential backoff. If all retries fail, set task status to `failed` and emit WebSocket error event. S3 lifecycle policy deletes orphaned objects (no DSQL reference) after 7 days.

**6. Bedrock API Returns Non-Retryable 400 Error**

User submits malformed input causing Bedrock to return 400 Bad Request (invalid prompt, token count exceeded, blocked content). Fargate task retries exhaustively, exhausts SQS redrive policy, message moves to DLQ.

**Mitigation:** Bedrock client categorizes errors: 400/403 are non-retryable; 429/500/503 are retryable. For non-retryable errors, task immediately writes DSQL record with status `failed` and error message, emits `task.failed` WebSocket event, and deletes SQS message (no retry). For retryable errors, implement exponential backoff with jitter: `delay = min(60, 2^attempt) + random(0, 5)` seconds, max 5 attempts before declaring failure.

**7. User Identity Deserialization Failure in Fargate**

SQS message contains serialized Cognito JWT claims, but Fargate task fails to deserialize due to schema mismatch or corrupted payload. Task cannot attribute artifact to user, creating audit trail gap.

**Mitigation:** Lambda's `serializeAuthContext()` includes schema version field in message context. Fargate worker validates schema version matches expected version before deserializing. If mismatch, log error with correlation ID and user ID (from outer message envelope), set task status to `failed` with reason `auth_context_invalid`, delete SQS message. CloudWatch alarm triggers on `AuthContextDeserializationFailures > 0` to detect schema drift.

### Regressions

**1. Existing Synchronous Lambda Paths May Be Inadvertently Disabled**

If Lambda handler refactoring removes synchronous execution code paths entirely, and Fargate deployment is delayed or fails, artifact generation functionality is unavailable until Fargate is operational.

**Mitigation:** Keep synchronous Lambda code paths as commented-out fallback for 30 days post-production deployment. Feature flag `ENABLE_FARGATE_OFFLOAD` controls routing: when true, use async enqueue pattern; when false, use synchronous execution. This allows instant rollback by toggling environment variable. After 30-day stability period, remove synchronous paths in follow-on cleanup orbit.

**2. WebSocket Event Schema Change Breaks Frontend Clients**

New event structure for `task.completed` includes fields not expected by existing frontend code, causing JavaScript errors or silent notification failures.

**Mitigation:** Maintain backward compatibility by keeping all existing WebSocket event fields and adding new fields as optional. Existing clients ignore unknown fields (JavaScript object access to undefined properties returns undefined, not error). Deploy frontend updates consuming new fields in parallel with backend deployment. Use feature detection: frontend checks for presence of `resultUri` field before attempting to render S3 download link.

**3. DSQL Connection Pool Exhaustion Affecting Existing Lambda Functions**

Fargate tasks opening multiple DSQL connections consume pool capacity, starving Lambda functions that also connect to DSQL for queries.

**Mitigation:** Configure separate DSQL connection pools per service: Lambda pool max 50 connections, Fargate pool max 20 connections (2 per task × 10 max tasks). DSQL cluster limit is 100 connections (default), leaving headroom. Monitor `DatabaseConnections` CloudWatch metric; alarm at 80 triggers investigation. Fargate worker uses single persistent connection per task lifecycle (not per message), minimizing pool churn.

### Security

**1. SQS Message Body Contains Sensitive User Input**

Artifact generation payloads include intent descriptions, context data, and potentially PII. SQS message bodies are stored unencrypted (default).

**Mitigation:** Enable SQS server-side encryption using AWS-managed keys (SSE-SQS) on `prometheus-prod-llm-tasks` queue. Fargate task IAM role requires `kms:Decrypt` permission to read encrypted messages. Audit logging: all SQS message receives are logged to CloudWatch with correlation ID and user ID (not payload content). SQS message retention set to 4 days; messages are deleted from queue after processing or DLQ transfer.

**2. Fargate Task IAM Role Over-Permissioned**

If task role is granted broad S3 or DSQL permissions, compromised container could access unrelated data or modify audit logs.

**Mitigation:** Task role scoped to least privilege: `s3:PutObject` limited to `arn:aws:s3:::prometheus-artifacts-${env}/*` with condition `StringEquals: { 's3:x-amz-server-side-encryption': 'AES256' }`. DSQL permissions limited to `dsql:ExecuteStatement` on specific table ARNs: `artifacts`, `tasks`, `chat_messages` (read-only on `websocket_connections`). Explicit `Deny` statements block access to sensitive buckets: `prometheus-secrets-*`, `prometheus-backups-*`. Terraform remote state locking enforces peer review for IAM changes.

**3. WebSocket Event Leaks Data to Wrong User**

Bug in WebSocket notifier logic sends completion event to incorrect connection ID, exposing User A's artifact URI to User B.

**Mitigation:** WebSocket notifier queries `websocket_connections` table with join condition: `user_id = $1 AND last_ping_at > NOW() - INTERVAL '5 minutes'`. Query includes user ID from SQS message context (validated in Lambda authorizer), not from task processing logic. Connection ID returned by query is the only destination for notification. Integration test explicitly validates cross-user isolation: submit tasks as two different users, verify each receives only their own events.

**4. Bedrock API Response Contains Injection Attack Vector**

If user input contains prompt injection payloads and Bedrock response echoes or acts on those payloads, downstream systems (DSQL, frontend rendering) could be exploited.

**Mitigation:** All Bedrock responses are treated as untrusted input. Before writing to DSQL, parameterized queries are used (never string concatenation). Before sending to WebSocket, response content is JSON-serialized with automatic escaping. Frontend renders Bedrock output in sandboxed markdown renderer with HTML sanitization. Input validation in Lambda handlers rejects payloads containing SQL keywords, script tags, or shell metacharacters.

### Performance

**1. Fargate Cold Start Adds 45-Second Delay to First Message Processed**

When queue has been idle and all tasks scaled to zero, first message arrival triggers ECS task launch. Container pull from ECR, task startup, and Bedrock SDK initialization take ~45 seconds, delaying first task completion.

**Mitigation:** Set ECS service minimum task count to 1 during business hours (8am-6pm UTC), scaling to 0 only during overnight low-traffic periods. CloudWatch schedule triggers Lambda function adjusting desired count based on time of day. For production, consider keeping 1 warm task 24/7; cost is $0.04/hour × 24 = $0.96/day vs. user experience cost of 45-second delay.

**2. SQS Long Polling Introduces Latency for Sparse Requests**

If messages arrive infrequently (one every 5 minutes), Fargate task sits idle waiting for next `receiveMessage` call to return (20-second wait time). User perceives delay between SQS enqueue and processing start.

**Mitigation:** SQS long polling with `WaitTimeSeconds: 20` is optimal for cost vs. latency tradeoff. Alternative (short polling with `WaitTimeSeconds: 0`) would reduce latency by ~10 seconds but increase API call costs by 10x. For production, acceptable to have 20-second p50 latency on task pickup given that Bedrock processing itself takes 30-60 seconds (20-second SQS wait is <33% of total time). Revisit if user feedback indicates this is perceptible problem.

**3. Multiple Fargate Tasks Competing for Bedrock API Rate Limit**

At max scale (10 concurrent tasks), each invoking Bedrock simultaneously, account-level Bedrock quota (50 concurrent invocations) is saturated. Eleventh request is throttled, task retries, latency increases.

**Mitigation:** Request Bedrock quota increase to 100 concurrent invocations before production deployment (standard AWS service limit increase request, typically approved within 24 hours). Configure Bedrock client with exponential backoff: `delay = min(60, 2^attempt) + random(0, 5)` seconds. Set CloudWatch alarm on `BedrockThrottles > 10/minute` to detect saturation; alarm triggers temporary reduction of ECS service max task count to 5 (manual circuit breaker). Consider implementing client-side rate limiting using Redis leaky bucket algorithm if throttling persists.

**4. DSQL Write Latency Under Concurrent Load**

10 Fargate tasks each writing artifact metadata to DSQL simultaneously could cause connection queueing or row locking delays, increasing task completion time.

**Mitigation:** DSQL supports 100 concurrent connections; with 2 connections per task, max load is 20 connections (well within limit). Write operations are isolated by correlation ID (no row contention). Add DSQL index on `tasks.correlation_id` (migration `009_add_correlation_indexes.sql`) to optimize status updates. Monitor `DatabaseConnections` and `WriteLatency` CloudWatch metrics; alarm at p95 > 100ms indicates contention requiring investigation.

---

## Scope Estimate

### Orbit Count

**Primary Orbit (this proposal):** 1 orbit implementing the complete Lambda → SQS → Fargate → WebSocket pipeline with all acceptance criteria met.

**Anticipated Follow-On Orbits:**
- **Orbit 2:** Implement DLQ processing and exponential backoff retry logic (deferred from acceptance boundaries, tracked as T6-004)
- **Orbit 3:** Production deployment with gradual rollout and observability validation
- **Orbit 4:** Cleanup and removal of synchronous Lambda fallback code paths after 30-day stability period

Total estimated: **4 orbits** to full production maturity (async pipeline deployed, battle-tested, and fallbacks removed).

### Complexity Assessment

**Complexity: High**

**Justification:**

This orbit spans five AWS services (Lambda, SQS, Fargate, S3, DSQL) with asynchronous handoffs between each. The failure modes are non-trivial: message visibility timeouts, connection pool exhaustion, WebSocket staleness, IAM policy scoping, cross-service correlation ID propagation. Each failure mode has cascading effects (e.g., Bedrock throttling → SQS message churn → Fargate autoscaling thrash).

The implementation requires deep understanding of:
- SQS visibility timeout semantics and extension patterns
- ECS task lifecycle (SIGTERM handling, graceful shutdown, scale-in protection)
- DSQL connection pooling and transaction isolation
- WebSocket connection liveness and stale connection detection
- IAM least privilege with explicit deny statements
- CloudWatch Logs Insights queries for correlation ID tracing across services

The testing surface is also complex: integration tests must mock SQS, Fargate, Bedrock, and WebSocket API simultaneously. Load testing requires simulating 10+ concurrent artifact generations to validate autoscaling behavior and resource contention.

This is NOT a straightforward "add an API endpoint" orbit — it is foundational infrastructure introducing asynchronous processing patterns that future orbits will build upon.

### Work Breakdown

**Phase 1 — Shared Infrastructure (Foundation): 2 days**
- Create shared type definitions, SQS publisher service, correlation ID generator
- Run DSQL migrations, update Fargate task definition with environment variables
- Deliverable: Shared libraries consumed by both Lambda and Fargate, DSQL schema ready

**Phase 2 — Fargate Worker (Core Processing): 4 days**
- Implement result storage, WebSocket notifier, artifact and chat handlers, main worker loop
- Build Docker image, deploy to ECS dev cluster, smoke test with manual SQS message
- Deliverable: Functional Fargate worker processing SQS messages end-to-end

**Phase 3 — Lambda Handler Refactoring (Entry Points): 2 days**
- Refactor 5 Lambda handlers to async enqueue pattern with HTTP 202 responses
- Deploy to dev environment with feature flag, integration test full pipeline
- Deliverable: Lambda handlers enqueuing tasks, returning immediately

**Phase 4 — Observability & Operational Readiness (Monitoring): 2 days**
- Deploy CloudWatch dashboard, configure autoscaling policies, set alarms, write runbooks
- Deliverable: Full observability stack with alerting for all identified risks

**Phase 5 — Testing & Validation (Quality Assurance): 3 days**
- Write unit tests, integration tests, load tests, regression validation
- Run full test suite, fix bugs discovered during testing
- Deliverable: Passing test suite with >80% code coverage on new Fargate worker code

**Phase 6 — Production Deployment (Rollout): 2 days**
- Deploy to staging, monitor for 48 hours, gradual production rollout over 3 days
- Deliverable: Live in production with validated error rates and latency

**Total Estimated Duration: 15 days** (3 engineering weeks with buffer for testing/debugging)

**Estimated File Count:**
- New files: 15 (Fargate worker + shared types + infrastructure + tests)
- Modified files: 6 (Lambda handlers + shared services)
- **Total: 21 files affected**

**Estimated Test Case Count:**
- Unit tests (Fargate worker): 12 test cases
- Integration tests (full pipeline): 6 test scenarios
- Load tests: 3 concurrency levels
- **Total: 21 test cases**

---

## Human Modifications

Pending human review.