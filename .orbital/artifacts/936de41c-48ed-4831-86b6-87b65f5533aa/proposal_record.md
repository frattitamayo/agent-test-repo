# Proposal Record — T6-003: Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-17  
**Intent:** T6-003  
**Context Packages:**
- Architectural: (none provided)
- Intent-specific: CTX-T6-003  
**Trust Tier:** 2 — supervised

---

## Interpreted Intent

When users request artifact generation or initiate AI chat sessions, these operations currently execute synchronously within Lambda functions that time out at 15 minutes — failing 100% of artifact generations that require extended Bedrock interactions. This migration restructures the system into an asynchronous request-response pattern: the user's HTTP request succeeds immediately by enqueuing a task message to SQS, a Fargate container picks up that message and executes the LLM operation without timeout constraints (up to 60 minutes), results persist to S3 and DSQL, and the user receives real-time completion notification via WebSocket. The system transforms from "hope it completes in 15 minutes" to "guaranteed completion with observable progress" — enabling workflows that were previously impossible while maintaining identical HTTP API contracts so the frontend requires zero changes beyond subscribing to WebSocket events.

---

## Implementation Plan

### Files to Create

**Fargate Worker Infrastructure:**
- `src/workers/llm-task-processor.ts` — Container entrypoint that polls SQS, routes messages to task handlers, manages lifecycle (startup, graceful shutdown, health checks)
- `src/workers/tasks/base-task.ts` — Abstract base class defining task execution pattern (status updates, result persistence, WebSocket publishing, error handling)
- `src/workers/tasks/artifact-generation.ts` — Concrete implementation for artifact generation task type; consumes `TaskMessage` with `parameters.artifactType/intentId/orbitId`, invokes Bedrock via existing client, assembles artifact content, writes to S3, updates DSQL
- `src/workers/tasks/chat-completion.ts` — Concrete implementation for chat completion task type; retrieves conversation history from DSQL, invokes Bedrock with context, persists response message
- `src/workers/health-check.ts` — HTTP endpoint for ECS health checks (responds 200 if SQS client initialized and Bedrock credentials valid)

**Message Schema & Types:**
- `src/types/tasks.ts` — TypeScript interfaces for `TaskMessage`, `TaskEvent`, task status enums, error classification types

**Lambda Handler Modifications:**
- `src/handlers/artifacts/generate.ts` — Replace direct Bedrock invocation with SQS enqueue logic; return 202 Accepted with `taskId` and WebSocket channel
- `src/handlers/chat/send.ts` — Replace synchronous LLM call with SQS enqueue; return 202 Accepted
- `src/handlers/tasks/status.ts` — New HTTP endpoint for polling task status from DSQL `task_executions` table

**WebSocket Event Publisher:**
- `src/services/websocket/task-events.ts` — Service layer for publishing task lifecycle events; queries DSQL `websocket_connections` for active connections matching `tenantId:userId`, iterates and posts to each connection ID via API Gateway SDK

**Infrastructure as Code:**
- `infrastructure/fargate/task-definition.yaml` — ECS Fargate task definition: 4 vCPU / 8 GB memory, container image from ECR, environment variables (SQS queue URL, DSQL endpoint, S3 bucket, WebSocket API endpoint), CloudWatch log driver configuration
- `infrastructure/fargate/service.yaml` — ECS service with target tracking scaling policy: scale out when `ApproximateNumberOfMessagesVisible` > 3, scale in when < 1, min 0 tasks, max 20 tasks, 2-minute cooldown
- `infrastructure/sqs/llm-task-queue.yaml` — SQS standard queue: visibility timeout 45 minutes, message retention 4 days, dead-letter queue after 3 receives, redrive policy configuration
- `infrastructure/sqs/llm-task-dlq.yaml` — Dead-letter queue for failed tasks: message retention 14 days (for operator investigation), CloudWatch alarm on message count > 0
- `infrastructure/iam/fargate-task-role.yaml` — IAM role with policies: `bedrock:InvokeModel` scoped to Claude 3.5 Sonnet ARN, `s3:PutObject` with condition `s3:prefix = artifacts/${aws:PrincipalTag/TenantId}/*`, `dsql:ExecuteStatement` on `artifacts`, `chat_messages`, `task_executions`, `websocket_connections` tables, `sqs:ReceiveMessage/DeleteMessage/ChangeMessageVisibility` on task queue, `execute-api:ManageConnections` on WebSocket API
- `infrastructure/cloudwatch/alarms.yaml` — Alarms for queue depth > 10 for 5 minutes, DLQ message count > 0, task failure rate > 5%

**Database Schema Migrations:**
- `migrations/dsql/003_add_task_tracking.sql` — Alter `artifacts` table to add `task_id VARCHAR(36) UNIQUE`, `task_status ENUM('queued','in_progress','completed','failed')`; alter `chat_messages` table to add same columns; create new `task_executions` table with columns: `task_id PRIMARY KEY`, `task_type`, `tenant_id`, `user_id`, `correlation_id`, `status`, `error_code`, `error_message`, `created_at`, `started_at`, `completed_at`, `retry_count`, `version INT DEFAULT 1`

### Files to Modify

- `src/handlers/artifacts/generate.ts` — Remove Bedrock client import and invocation; add SQS client initialization; replace synchronous artifact generation logic with SQS publish call wrapped in try-catch; change response from 200 (synchronous result) to 202 (async task created); add `taskId` generation (UUIDv4) and inclusion in response body
- `src/handlers/chat/send.ts` — Same pattern as artifact handler: remove Bedrock call, add SQS enqueue, return 202 with task tracking info
- `src/services/dsql/artifacts.ts` — Add methods `updateTaskStatus(taskId, status)`, `getArtifactByTaskId(taskId)` for task lifecycle management
- `src/services/dsql/chat.ts` — Add methods `updateMessageTaskStatus(taskId, status)`, `getMessageByTaskId(taskId)`
- `src/lib/logger.ts` — Add `phase` field to structured log schema (one of: `enqueue`, `execution_start`, `bedrock_call`, `persist_result`, `publish_event`, `execution_complete`, `execution_failed`)
- `src/lib/metrics.ts` — Add custom CloudWatch metrics: `TaskEnqueued`, `TaskStarted`, `TaskCompleted`, `TaskFailed`, `BedrockCallDuration`, `WebSocketPublishSuccess`, `WebSocketPublishFailure`

### Approach

Follow the **async request-response pattern** established in distributed systems: the HTTP layer becomes a "task submitter" that immediately acknowledges the request and hands off execution to a durable queue. The Fargate worker layer becomes the "task processor" that consumes messages, executes long-running work, and publishes results. This decoupling prevents Lambda timeouts from being a hard constraint while preserving the existing API contract.

The implementation mirrors the CQRS command pattern already present in the codebase: commands (artifact generation, chat completion) define their own execution logic in isolated handlers that consume standardized message payloads. The `BaseTask` abstract class enforces lifecycle consistency — all tasks follow the same status transition sequence (queued → in_progress → completed/failed) with automatic WebSocket event publishing at each transition.

Idempotency is achieved through DSQL-based deduplication: before starting work, the task handler queries `task_executions` by `task_id` and skips processing if status is already `completed`. This handles SQS at-least-once delivery semantics without requiring FIFO queue overhead. Optimistic locking via the `version` column prevents concurrent status updates if SQS delivers duplicates within the visibility timeout window.

### Order of Operations

1. **Database Schema Migration** — Deploy DSQL schema changes (`task_id`, `task_status` columns, `task_executions` table) to production cluster via blue-green switchover; validate schema with read-only queries before proceeding
2. **SQS Queue Provisioning** — Create task queue and DLQ via CloudFormation; configure visibility timeout (45 minutes) and redrive policy (3 attempts); smoke test by manually publishing message and verifying DLQ routing after 3 receives
3. **Fargate Task Definition** — Build and push Docker image to ECR with worker code; create ECS task definition with IAM role, resource limits, and environment variables; validate IAM permissions with `aws iam simulate-principal-policy` CLI
4. **Lambda Handler Modification** — Deploy updated `generate.ts` and `send.ts` handlers with SQS enqueue logic behind feature flag (environment variable `ENABLE_ASYNC_LLM=false` initially); test in staging with feature flag enabled, verify 202 responses and SQS message format
5. **Fargate Service Deployment** — Deploy ECS service with desired count 1 (single task for initial testing); validate task startup logs show successful SQS polling and Bedrock client initialization
6. **End-to-End Integration Test** — Enable feature flag in staging; trigger artifact generation via API; observe SQS message enqueue → Fargate task pickup → Bedrock invocation → S3 write → DSQL update → WebSocket event publish; verify frontend receives `task_completed` notification and can fetch result
7. **Auto-Scaling Configuration** — Add target tracking policy to ECS service; test scale-out behavior by enqueueing 10 messages and observing task count increase; test scale-in by draining queue and observing task count return to 0
8. **Production Deployment** — Blue-green Lambda deployment with 10% traffic to new handlers; monitor error rate, DLQ depth, task completion rate for 2 hours; if metrics healthy, shift to 50% for 24 hours, then 100%
9. **Feature Flag Removal** — After 1 week of stable operation, remove `ENABLE_ASYNC_LLM` flag and synchronous Bedrock code paths from Lambda handlers

### Dependencies

**External Services:**
- Amazon Bedrock Claude 3.5 Sonnet quota in us-west-2 must be ≥ 500 requests/minute (submit AWS Support case before production deployment if current quota is 200)
- Amazon SQS standard queue available in us-west-2 (no quotas blocking this migration)
- Amazon ECS Fargate capacity in us-west-2 private subnets (validate vCPU limit allows 20 concurrent 4-vCPU tasks = 80 vCPU total)

**Prior Orbits:**
- **T6-001 (WebSocket Gateway)** — Must be operational; specifically requires server-initiated broadcast capability where Lambda or Fargate can publish events to connection IDs without client-initiated request; validate `POST /@connections/{connectionId}` endpoint exists and accepts authenticated requests
- **T5-002 (DSQL Schema Evolution)** — Schema changes for `task_id`/`task_status` columns block Fargate deployment; migration must complete first

**Infrastructure Prerequisites:**
- VPC private subnets with NAT Gateway route to 0.0.0.0/0 (required for Fargate tasks to reach Bedrock API endpoints in public AWS IP ranges)
- KMS key for S3 server-side encryption (existing; validate Fargate task role has `kms:Decrypt` permission)
- ECR repository for worker container images (create if doesn't exist: `prometheus-v1/llm-workers`)

**Open Questions:**
- **WebSocket fanout:** Does the existing implementation support querying for all connection IDs matching `tenantId:userId` and iterating to publish to each, or only single connection ID targeting? (Assumption: multi-connection fanout exists; if not, impacts user experience when multiple browser tabs open)
- **Bedrock quota isolation:** Are Bedrock throttling limits shared between Lambda and Fargate execution environments, or tracked separately per IAM role? (Assumption: shared; if isolated, reduces throttling risk)

---

## Risk Surface

### Edge Cases

**SQS Message Duplication (At-Least-Once Delivery):**
- SQS standard queues guarantee at-least-once delivery, meaning duplicate messages are possible (rare but documented)
- Mitigation: Task handler queries `task_executions` table at entry; if `task_id` exists with `status = 'completed'`, skip all processing, publish `task_completed` event (idempotent), and delete SQS message
- Edge case within edge case: If duplicate message arrives while first execution is `in_progress`, second handler detects status and exits; status will transition to `completed` when first execution finishes
- Monitoring: Custom CloudWatch metric `SQSDuplicateMessagesReceived` emitted when duplicate detected; alarm if rate > 1% of total messages

**Fargate Task Terminated Mid-Execution (ECS SIGTERM):**
- ECS may terminate tasks during scale-in, deployment, or node maintenance; tasks receive SIGTERM with 30-second grace period
- Mitigation: Worker entrypoint traps SIGTERM signal, sets `shutting_down = true` flag; task handler checks flag before each Bedrock call and aborts with `task_failed` status if true; SQS message visibility timeout expires and another task retries
- Edge case: If Bedrock call in progress when SIGTERM received, request completes but result may not persist; task status remains `in_progress` and SQS redelivers after visibility timeout
- Monitoring: CloudWatch Logs Insights query for `SIGTERM received during execution` log entries; review weekly to understand scale-in patterns

**Authorization Code Mismatch Between Enqueue and Execution:**
- User's session token may expire between Lambda enqueue (auth validated) and Fargate execution (minutes later)
- Mitigation: SQS message includes `tenantId` and `userId` extracted at enqueue time; Fargate task does NOT re-validate session token, trusts enqueue-time validation; this is acceptable because task payload only contains operation parameters (intent ID, artifact type), not sensitive data
- Edge case: If user account is suspended/deleted between enqueue and execution, task completes normally but result is orphaned (no active user to notify); acceptable behavior — operator can manually clean up via DLQ review
- Monitoring: No specific monitoring required; account lifecycle events are rare

**WebSocket Connection Closed Before Task Completion:**
- User closes browser tab, mobile app backgrounds, or network disconnects before Fargate task finishes
- Mitigation: WebSocket publish failure is logged but does NOT mark task as failed; task status transitions to `completed` regardless; frontend implements polling fallback (every 5s → 10s → 30s exponential backoff) if WebSocket disconnect detected
- Edge case: User reconnects after task completes but before notification received; frontend queries `/tasks/{taskId}/status` on reconnect and discovers result retroactively
- Monitoring: CloudWatch metric `WebSocketPublishFailureRate`; alert if > 5% sustained for 10 minutes (indicates systemic WebSocket API issue, not individual disconnects)

**S3 PutObject Succeeds But DSQL Update Fails:**
- Artifact content written to S3, but subsequent DSQL update (set `content_s3_uri`, status `completed`) fails due to network error or transaction deadlock
- Mitigation: Task handler wraps DSQL update in retry loop (3 attempts with exponential backoff); if all retries fail, task marks status `failed` with error message; SQS message redelivers, next execution detects existing S3 object by key pattern and skips Bedrock call, retries DSQL update
- Edge case: S3 object exists but artifact record never created in DSQL; periodic cleanup job (separate trajectory) scans for orphaned S3 objects older than 7 days and deletes
- Monitoring: CloudWatch Logs Insights query for `DSQL update failed after S3 write` pattern; alert if count > 5 in 1 hour

### Regressions

**Artifact Generation Latency Increase for Quick Operations:**
- Current synchronous Lambda execution completes "simple" artifacts (e.g., small context packages) in 2-3 minutes
- Async pattern adds overhead: Lambda enqueue time (~100ms) + Fargate cold start (p95 60 seconds) + SQS polling latency (~1-2 seconds) = minimum 60+ seconds even if Bedrock call completes instantly
- Impact: Users perceive slowdown for operations that previously succeeded within Lambda timeout
- Mitigation: Acceptable tradeoff for Tier 2 migration — reliability (100% success rate) outweighs latency regression for subset of operations; if critical, future optimization could route "quick" operations to Lambda and "slow" operations to Fargate based on estimated duration
- Monitoring: CloudWatch metric `TaskEndToEndDuration` with dimension `artifactType`; track p50/p95/p99 over time; regression acceptable if p95 stays under 30-minute SLA

**Bedrock Throttling Visibility:**
- Current Lambda implementation surfaces Bedrock throttling errors immediately to client via 429 HTTP response
- Async pattern hides throttling behind SQS retry mechanism; user sees task stuck in `in_progress` status while Fargate retries with backoff
- Impact: User uncertainty — is it throttled or genuinely slow?
- Mitigation: Task handler publishes `task_progress` event with message "Retrying due to Bedrock rate limits" when throttling detected; frontend displays this as informational message
- Monitoring: CloudWatch metric `BedrockThrottlingErrorRate` (per-task); alert if cluster-wide rate > 10% sustained for 5 minutes

**WebSocket Infrastructure Load:**
- Async pattern generates 3-5 WebSocket events per task (`task_started`, `task_progress` x1-2, `task_completed`/`task_failed`) vs. previous zero events (synchronous response)
- Current WebSocket API Gateway may have unvalidated throughput limits (assumed: 10,000 connections, 500 messages/sec)
- Impact: If WebSocket API throttles, events drop silently; users fall back to polling (degraded UX)
- Mitigation: Load test WebSocket API with 500 tasks/minute (burst scenario) before production deployment; validate no throttling occurs; if limits hit, request quota increase or implement event batching
- Monitoring: API Gateway `5XXError` metric for WebSocket API; alert if error rate > 0.1%

### Security

**SQS Message Payload Exposure:**
- Task messages contain `tenantId`, `userId`, `intentId`, `artifactType` — not directly sensitive but could enable enumeration attack if queue is compromised
- Mitigation: SQS queue encryption at rest enabled (AWS-managed KMS key); queue policy restricts access to Lambda enqueue role and Fargate task role only (deny all other principals); no cross-account access
- Attack scenario: If Fargate task role is compromised via container escape, attacker could read queue messages and enumerate active users/tenants; cannot access artifact content (requires S3 permissions) but could trigger DoS by deleting messages
- Defense-in-depth: ECS task IAM role limited to `sqs:ReceiveMessage/DeleteMessage` (no `sqs:PurgeQueue` or `sqs:SendMessage`); cannot inject malicious tasks

**Fargate Task IAM Privilege Escalation:**
- Task role grants `s3:PutObject` and `dsql:ExecuteStatement` — if not properly scoped, could access cross-tenant data
- Mitigation: IAM policy uses condition keys: `s3:PutObject` allowed only if `s3:prefix = artifacts/${aws:PrincipalTag/TenantId}/*`; task execution environment injects `tenantId` from SQS message into session tags via ECS task definition environment variables
- Attack scenario: If task handler code is compromised (supply chain attack on npm dependency), malicious code could attempt to write S3 objects outside tenant prefix or query DSQL across tenants
- Defense-in-depth: Task handler validates `tenantId` from SQS message matches session tag before any I/O operation; mismatch triggers `AccessDeniedException` logged to CloudWatch and task fails immediately (does NOT retry)
- Pre-deployment review: Security engineer audits IAM policy JSON for condition key correctness; checklist item: "Task role cannot access resources outside tenant boundary"

**WebSocket Connection ID Spoofing:**
- If WebSocket connection IDs are predictable or enumerable, attacker could subscribe to another user's task events
- Mitigation: Connection IDs are UUIDs generated by API Gateway (non-guessable); connection-to-user mapping in DSQL `websocket_connections` table enforces authentication (JWT validation at $connect route)
- Attack scenario: If attacker compromises victim's JWT token, can establish WebSocket connection and receive victim's task events; this is acceptable — token compromise grants broader access than just task events
- Defense-in-depth: WebSocket events contain only `taskId` and `resultUrl` — no inline sensitive data; attacker must also have API authorization to fetch result

**Bedrock Prompt Injection:**
- If artifact generation or chat input is derived from user-controlled data (e.g., intent description, chat message), malicious input could inject prompts that leak system prompts or trigger unintended behavior
- Mitigation: Not directly in scope for this migration (risk exists in current synchronous implementation); task handlers use existing Bedrock client which already implements input validation and prompt templating
- Note for future trajectory: Implement prompt injection detection (content filtering, input sanitization, response validation) in separate security-focused orbit

### Performance

**Fargate Cold Start Latency:**
- First task execution after scale-to-zero incurs ECS task launch overhead: pull container image from ECR (~20-30 seconds), start container (~5-10 seconds), initialize SDK clients (~5-10 seconds) = p95 60 seconds total
- Impact: Users requesting artifacts during off-peak hours (when service scaled to 0) experience 60-second delay before work begins
- Mitigation: Configure scheduled scaling policy to maintain minimum 2 tasks during business hours (9am-6pm Pacific); overnight scale-to-zero acceptable for cost optimization
- Trade-off: 2 idle tasks cost ~$50/month vs. cold start UX impact for <10 requests/hour during off-hours; acceptable expense for Tier 2 reliability target

**SQS Polling Inefficiency (Empty Receives):**
- Fargate worker polls SQS with long polling (20-second wait time); if queue is empty, 95% of API calls return zero messages
- Impact: Unnecessary SQS API costs (~$0.40 per million requests); CloudWatch Logs volume (empty receive logged at INFO level)
- Mitigation: Use SQS long polling (already planned) to reduce empty receive rate; 20-second wait time means 3 requests/minute/task when idle vs. 60 requests/minute with short polling
- Optimization for future: Implement event-driven architecture where SQS triggers ECS task via EventBridge (requires SQS-to-EventBridge pipe, not in scope for this orbit)

**DSQL Transaction Contention on task_executions Table:**
- Multiple Fargate tasks querying/updating `task_executions` concurrently could create lock contention or deadlocks
- Impact: Task execution delays; retries consume SQS visibility timeout
- Mitigation: Each task operates on unique `task_id` (no row-level contention); table schema uses UUID primary key (no sequential ID hotspot); optimistic locking via `version` column prevents lost updates if duplicates occur
- Load test: Simulate 20 concurrent tasks updating different rows; measure transaction latency (expected: <50ms p95)

**Bedrock API Quota Exhaustion:**
- 20 concurrent Fargate tasks × 10 Bedrock calls/task = 200 concurrent Bedrock requests could exceed quota (current: 200 req/min sustained in us-west-2)
- Impact: Throttling cascade — all tasks retry simultaneously, amplifying queue depth
- Mitigation: Request Bedrock quota increase to 500 req/min before production deployment (2-week lead time via AWS Support); implement client-side rate limiter in Fargate worker (token bucket algorithm, shared state in Redis or DynamoDB) to prevent thundering herd
- Fallback: If quota increase denied, reduce ECS service max task count from 20 to 10; accept longer queue drain time (2× p95 latency during traffic spikes)

**S3 Multi-Part Upload Overhead for Large Artifacts:**
- Artifacts exceeding 5 GB require S3 multi-part upload (not expected for ORBITAL artifacts, but possible for future media-rich artifacts)
- Impact: Network bandwidth consumption; task execution time increase
- Mitigation: Not applicable to current artifact types (Context Packages, Proposals are <10 MB); if future use case requires, implement streaming upload with progress events
- Monitoring: S3 PutObject CloudWatch metric filtered by `ObjectSize > 100MB`; alert if detected (indicates unexpected artifact size)

---

## Scope Estimate

### Orbit Breakdown

**Orbit 1 (Current):** Proposal generation and approval (this document)  
**Orbit 2:** Database schema migration + SQS queue provisioning + IAM role creation (low-risk infrastructure changes)  
**Orbit 3:** Fargate worker implementation (core execution logic: base task class, artifact generation handler, chat completion handler, WebSocket publisher)  
**Orbit 4:** Lambda handler modifications (enqueue logic, 202 response format, feature flag)  
**Orbit 5:** End-to-end integration testing in staging + auto-scaling validation  
**Orbit 6:** Production deployment (blue-green rollout with monitoring gates)  
**Orbit 7:** Post-deployment verification + documentation + feature flag removal

**Total Estimated Orbits:** 7

### Complexity Assessment

**High Complexity** — Justification:

1. **Distributed systems coordination:** This migration introduces asynchronous boundaries across 5 AWS services (Lambda, SQS, Fargate, S3, DSQL) with no single-transaction rollback capability; failure modes are non-deterministic and difficult to reproduce in local development
2. **Data integrity risk:** Task failures mid-execution could leave orphaned S3 objects or inconsistent DSQL records; idempotency and retry logic must be bulletproof across all code paths
3. **Security surface expansion:** New IAM roles with multi-service permissions (Bedrock, S3, DSQL, SQS, WebSocket API) increase attack surface; tenant isolation must be preserved across async boundaries where Lambda request context is not available
4. **Observability gaps:** Distributed tracing requires new instrumentation linking HTTP request → SQS message → Fargate execution → WebSocket event; missing correlation IDs create blind spots during incident response
5. **Operational complexity:** Fargate tasks are long-lived and stateful (for task duration); debugging requires SSH-equivalent access (ECS Exec) and understanding container lifecycle; different skillset than Lambda troubleshooting

**Tier 2 Justification:** Revenue-impacting workflow (artifact generation blocks user progress on paid plans), blast radius spans multiple AWS accounts/regions if misconfigured, rollback requires coordination across infrastructure and application layers.

### Work Phase Breakdown

| Phase | Orbits | Estimated Duration | Key Deliverables |
|-------|--------|-------------------|------------------|
| **Infrastructure Provisioning** | 2 | 2 days | DSQL schema deployed, SQS queues created, IAM roles validated, ECR repository configured |
| **Core Implementation** | 3 | 5 days | Fargate worker code complete with unit tests, base task abstraction, artifact/chat handlers, WebSocket publisher |
| **Lambda Integration** | 4 | 2 days | HTTP handlers modified, SQS enqueue tested, 202 responses validated, feature flag wired |
| **Integration Testing** | 5 | 3 days | Staging environment end-to-end tests, auto-scaling behavior verified, load testing (50 concurrent tasks), failure scenario validation |
| **Production Deployment** | 6 | 3 days | Blue-green rollout, 10% → 50% → 100% traffic shift, 24-hour monitoring gate, rollback playbook execution drill |
| **Verification & Cleanup** | 7 | 2 days | 7-day production soak test, documentation updates, feature flag removal, post-mortem for any incidents |

**Total Estimated Duration:** 17 business days (3.4 weeks)

### Test Case Planning

| Test Category | Estimated Count | Focus Areas |
|--------------|-----------------|-------------|
| **Unit Tests** | 40 | Base task lifecycle, artifact generation handler logic, chat completion handler logic, WebSocket publisher, SQS message parsing, error classification |
| **Integration Tests** | 15 | Lambda → SQS enqueue, Fargate → DSQL updates, S3 write + DSQL update atomicity, WebSocket event delivery, DLQ routing after retries |
| **End-to-End Tests** | 10 | Full artifact generation flow (HTTP → SQS → Fargate → S3 → WebSocket), chat completion flow, concurrent task execution (no data corruption), task timeout behavior, graceful shutdown on SIGTERM |
| **Load Tests** | 5 | 50 concurrent tasks, queue depth auto-scaling trigger, Fargate task count scaling behavior, Bedrock throttling under load, WebSocket fanout to 100 connections |
| **Security Tests** | 8 | Cross-tenant isolation (cannot access other tenant's artifacts), IAM policy validation (deny actions outside scope), SQS message tampering detection, WebSocket connection ID validation |
| **Failure Scenario Tests** | 12 | Bedrock throttling retry, DSQL transaction deadlock recovery, S3 write failure rollback, WebSocket publish failure (task completes anyway), Fargate task terminated mid-execution, SQS visibility timeout expiration |

**Total Estimated Test Cases:** 90

**Test Automation Coverage Target:** 80% (unit + integration tests automated; E2E and load tests semi-automated with manual validation; security tests mix of automated policy scanning and manual penetration testing)

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by | (awaiting review) |
| Timestamp | (awaiting approval) |

---

## Human Modifications

Pending human review. This section will be populated during Tier 2 approval process with any modifications to the proposal — capturing the delta between AI proposal and human-approved implementation plan for learning feedback.