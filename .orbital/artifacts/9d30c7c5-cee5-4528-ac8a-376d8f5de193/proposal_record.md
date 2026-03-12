# Proposal Record — T6-003: Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-INT-T6-003-1  
**Generated:** 2025-02-17  
**Intent:** T6-003  
**Context Packages:**
- Architectural: (general Prometheus V1 serverless architecture)
- Intent-specific: CTX-INT-T6-003  
**Trust Tier:** 2 — supervised (critical user-facing workflow with cost sensitivity)

---

## Interpreted Intent

When users request artifact generation or engage in extended AI chat sessions, the work currently happens synchronously inside Lambda functions. This creates a hard ceiling: Lambda times out after 15 minutes regardless of whether the LLM operation has completed. The result is failed requests, frustrated users, and abandoned work.

The solution introduces a **queue-worker pattern**: Lambda remains the HTTP entry point but immediately hands off long-running work to Fargate tasks via SQS. The user receives an instant `202 Accepted` response with a task identifier. A Fargate worker picks up the message, executes the LLM operation (which may take 10-20 minutes), stores the result in S3, updates the task status in DSQL, and sends a WebSocket notification back to the client. If the client has disconnected, they poll an HTTP status endpoint to retrieve the result.

This architectural shift eliminates execution time limits for compute-intensive AI operations while preserving fast HTTP response times. The key insight: **decouple request acceptance from work completion**. Lambda optimizes for low-latency acknowledgment; Fargate optimizes for long-running throughput.

---

## Implementation Plan

### Files to Create

**SQS Client Library:**
- `src/shared/queue/sqs-client.ts` — wrapper for SQS send/receive/delete operations with retry logic, error classification (transient vs. permanent), and structured logging

**Fargate Worker Implementations:**
- `src/fargate/workers/artifact-worker.ts` — long-polling SQS consumer for artifact generation; calls Bedrock, writes result to S3, updates DSQL status, sends WebSocket notification
- `src/fargate/workers/chat-worker.ts` — similar pattern for extended chat sessions
- `src/fargate/workers/shared/worker-base.ts` — abstract base class with graceful shutdown (SIGTERM handling), message processing loop, error handling patterns

**Task Status Repository:**
- `src/shared/database/dsql/task-executions-repository.ts` — CRUD operations for `task_executions` table with methods: `create()`, `updateStatus()`, `findById()`, `findByIntentId()`, `findActiveByUserId()`

**S3 Result Storage:**
- `src/shared/storage/s3-results.ts` — write task results to S3 with key pattern `{org_id}/{intent_id}/{orbit_id}/{task_id}/result.json`; generate pre-signed URLs with 7-day expiration

**Lambda HTTP Handlers:**
- `src/lambda/handlers/tasks/status.ts` — GET endpoint for polling task status; returns status, progress, result URL if completed
- `src/lambda/handlers/tasks/cancel.ts` — POST endpoint to cancel queued/processing tasks (updates DSQL, does not delete SQS message)

**Infrastructure as Code:**
- `infrastructure/terraform/sqs-tasks.tf` — SQS queues for artifact generation and chat processing with DLQ, 30-minute visibility timeout, 14-day retention
- `infrastructure/terraform/fargate-task-definitions.tf` — ECS task definitions for artifact-worker and chat-worker with container config, resource limits (2 vCPU, 4GB RAM), IAM role references
- `infrastructure/terraform/iam-fargate-tasks.tf` — IAM roles/policies granting Fargate tasks access to SQS (receive/delete), S3 (write to results bucket), DSQL (query/update), Bedrock (invoke models), WebSocket API (post to connections)
- `infrastructure/terraform/s3-task-results.tf` — S3 bucket with encryption at rest (AES-256), lifecycle policy (delete objects >30 days), CORS for pre-signed URL fetching
- `infrastructure/terraform/autoscaling-fargate.tf` — Application Autoscaling policies targeting SQS `ApproximateNumberOfMessagesVisible` metric; scale up when >5 messages, scale down when <2 messages; min=1, max=10
- `infrastructure/terraform/cloudwatch-alarms.tf` — alarms for DLQ message count (>5 triggers ops runbook), Fargate task failure rate (>5% in 10 min), cold start latency (p95 >30s)

**Database Migration:**
- `infrastructure/dsql/migrations/006_create_task_executions.sql` — create `task_executions` table with columns: id (UUID), intent_id, orbit_id, task_type (enum), status (enum: queued/processing/completed/failed/cancelled), payload_s3_key, result_s3_key, enqueued_at, started_at, completed_at, error_message, user_id, org_id

**Dockerfile for Workers:**
- `infrastructure/fargate/tasks/artifact-generator/Dockerfile` — multi-stage build: Node.js 20, copy shared libraries, install production dependencies only, optimize for layer caching
- `infrastructure/fargate/tasks/artifact-generator/entrypoint.sh` — shell script that starts worker process with env var validation and health check server

**Tests:**
- `tests/unit/shared/queue/sqs-client.test.ts` — test message send/receive/delete with mocked SQS SDK
- `tests/unit/fargate/workers/artifact-worker.test.ts` — test message processing logic with mocked dependencies (Bedrock, S3, DSQL)
- `tests/integration/lambda/tasks/status.test.ts` — test status endpoint returns correct task state
- `tests/e2e/task-lifecycle.test.ts` — full flow: POST to artifact endpoint → verify SQS message → simulate Fargate processing → verify S3 result → verify WebSocket notification → GET status endpoint

### Files to Modify

**Existing Lambda Handlers (convert to async enqueue pattern):**
- `src/lambda/handlers/artifacts/generate.ts` — replace synchronous Bedrock call with SQS enqueue; return `202 Accepted` with `{ task_id, status: "queued", poll_url: "/tasks/{task_id}/status", websocket_event: "task.completed" }`
- `src/lambda/handlers/chat/message.ts` — for long operations (>30s predicted response time), enqueue to SQS instead of processing inline; short operations (<10s) remain synchronous for perceived responsiveness

**WebSocket Notification Types:**
- `src/shared/websocket/notifications.ts` — add event types: `task.queued`, `task.processing`, `task.completed`, `task.failed`; each includes `{ task_id, intent_id, status, result_url? }`

**Shared Configuration:**
- `src/shared/config/env.ts` — add environment variables: `SQS_ARTIFACT_QUEUE_URL`, `SQS_CHAT_QUEUE_URL`, `S3_TASK_RESULTS_BUCKET`, `FARGATE_TASK_MAX_RUNTIME_SECONDS`

**API Documentation:**
- `docs/api/artifacts.md` — update artifact generation endpoint spec to document new 202 response with task_id and polling pattern
- `docs/api/tasks.md` — NEW: document task status and cancellation endpoints

### Approach

The implementation follows the **async request-reply pattern** common in event-driven architectures. Lambda handles HTTP ingress, authentication, and orchestration. Fargate handles compute. SQS provides decoupling. DSQL tracks state. S3 stores results. WebSocket provides real-time updates.

**Key architectural decisions:**

1. **Consumer-defined ports in workers:** The Fargate worker defines its own port interfaces (e.g., `TaskResultStore`, `LLMClient`, `NotificationPublisher`). Infrastructure adapters (S3, Bedrock, WebSocket) implement these ports. This follows the hexagonal architecture pattern established in `src/lambda/handlers/intents/create.ts`.

2. **Auth context passthrough:** Lambda extracts `user_id` and `org_id` from the JWT and includes them as SQS message attributes (not body). Fargate reads these attributes and enforces row-level security when querying DSQL or writing to S3. No separate auth mechanism for workers.

3. **Graceful degradation:** If WebSocket delivery fails (client disconnected), the system does not retry. The client polls the HTTP status endpoint as a fallback. WebSocket is best-effort; HTTP is guaranteed.

4. **Idempotency:** SQS message deduplication is enabled (5-minute window). Fargate workers use DSQL optimistic locking (`UPDATE ... WHERE status = 'queued'`) to prevent duplicate processing if a message is redelivered.

5. **Cold start mitigation:** The autoscaling policy maintains a minimum of 1 warm Fargate task during business hours (8am-6pm UTC). Outside this window, scale to zero to reduce cost. Cold start SLA is 30 seconds; deploy with pre-warmed tasks initially.

### Order of Operations

**Phase 1: Infrastructure (Terraform + DSQL migration)**
1. Create `task_executions` table in DSQL with indexes on `id`, `status`, `user_id+status`
2. Provision SQS queues (artifact, chat) with DLQ and 30-minute visibility timeout
3. Create S3 bucket for task results with encryption and lifecycle policies
4. Define IAM roles for Fargate tasks with least-privilege policies
5. Deploy task definitions to existing ECS cluster (from T6-001)
6. Configure autoscaling policies targeting SQS queue depth
7. Set up CloudWatch alarms for DLQ, failure rate, cold start latency

**Phase 2: Shared Libraries**
8. Implement `sqs-client.ts` with send/receive/delete operations and retry logic
9. Implement `task-executions-repository.ts` with CRUD + domain queries
10. Implement `s3-results.ts` with write and pre-signed URL generation
11. Extend `notifications.ts` with new task event types

**Phase 3: Fargate Workers**
12. Implement `worker-base.ts` abstract class with polling loop and SIGTERM handling
13. Implement `artifact-worker.ts` extending base class; process messages, call Bedrock, write results
14. Write unit tests for worker logic with mocked dependencies
15. Build Docker image with multi-stage optimization
16. Deploy worker to Fargate (initially disabled via autoscaling min=0)

**Phase 4: Lambda Modifications**
17. Modify `artifacts/generate.ts` to enqueue to SQS and return 202 with task_id
18. Modify `chat/message.ts` for long operations only (short ops remain synchronous)
19. Implement `tasks/status.ts` HTTP endpoint for polling
20. Implement `tasks/cancel.ts` HTTP endpoint
21. Write integration tests for modified endpoints

**Phase 5: End-to-End Testing**
22. Write E2E test for full task lifecycle (Lambda → SQS → Fargate → S3 → WebSocket)
23. Test polling fallback (disconnect WebSocket before completion)
24. Test failure scenarios (Bedrock throttling, S3 write error, DSQL update failure)
25. Load test: 50 concurrent tasks → verify autoscaling behavior

**Phase 6: Deployment**
26. Deploy to staging environment with feature flag `ENABLE_FARGATE_TASKS=false`
27. Smoke test: manually enqueue task, verify worker processing
28. Enable feature flag for 10% of artifact generation requests (canary)
29. Monitor error rates, latency, cost for 48 hours
30. If metrics within SLA, increase to 100%

### Dependencies

**Must exist before execution begins:**
- ECS cluster from T6-001 with VPC, subnets, security groups
- Existing WebSocket infrastructure (API Gateway, connection table, notification logic)
- DSQL connection string and IAM authentication for Lambda/Fargate

**Must be coordinated with other work:**
- Frontend must be updated to handle 202 responses and poll status endpoint (separate PR, can deploy after backend)
- OpenAPI spec must be updated to document new response codes (documentation PR, blocks client integration)

**Blocked by:**
- None — all dependent infrastructure exists or is created within this intent

---

## Risk Surface

### Edge Cases

**SQS message delivered after task already marked completed (duplicate processing):**
- **Scenario:** Network partition causes Fargate to finish processing but fail to delete SQS message before visibility timeout expires. Message becomes visible again, another worker picks it up.
- **Mitigation:** DSQL update uses optimistic locking: `UPDATE task_executions SET status = 'processing' WHERE id = ? AND status = 'queued'`. If row not updated (already processing or completed), worker deletes message without reprocessing.

**WebSocket connection expires (2-hour timeout) during long task:**
- **Scenario:** User submits 20-minute artifact generation, leaves browser tab open but connection expires at 120 minutes. Fargate completes task and tries to send notification to expired connection.
- **Mitigation:** WebSocket delivery failure is logged but not retried. Frontend implements reconnection logic: on page focus or network restore, reconnect WebSocket and check for missed notifications by polling `/tasks/recent` endpoint. DSQL is always source of truth.

**User submits multiple tasks with identical payloads within 5-minute deduplication window:**
- **Scenario:** User clicks "Generate Artifact" button twice quickly. Both requests create valid task_ids but SQS deduplicates the second message.
- **Mitigation:** SQS message deduplication ID is computed from `user_id + intent_id + payload_hash`, not just payload. Each task_id is unique. If payloads are truly identical, both task records reference the same SQS message; first to complete marks both as succeeded.

**Fargate task crashes mid-processing (OOM kill, segfault, SIGKILL):**
- **Scenario:** Worker allocates too much memory for large artifact, Linux OOM killer terminates process before graceful shutdown.
- **Mitigation:** SQS message visibility timeout (30 min) exceeds max task runtime (25 min). If task crashes, message becomes visible again for retry. Worker updates DSQL status to "processing" immediately after receiving message, so crashed tasks are visible in monitoring. After 3 retries (SQS DLQ), CloudWatch alarm triggers ops runbook for manual investigation.

**User cancels task after Fargate has started processing:**
- **Scenario:** User submits long task, changes mind, calls `/tasks/{id}/cancel`. Fargate is mid-LLM call and cannot be interrupted.
- **Mitigation:** Cancel endpoint updates DSQL status to "cancelled" but does not stop Fargate processing. Worker checks DSQL status before writing result; if cancelled, discards result and deletes SQS message without notification. User sees "cancelled" status in polling endpoint.

**S3 pre-signed URL expires before user retrieves result:**
- **Scenario:** User completes task, receives notification, but doesn't click download link for 8 days. URL has 7-day expiration.
- **Mitigation:** Task status endpoint returns `result_expired: true` if current time > expiration. UI shows "Result expired, regenerate?" button. POST to `/tasks/{id}/regenerate-url` creates new pre-signed URL from same S3 object (object has 30-day lifecycle, longer than URL expiration).

**Bedrock API returns throttling error (429) during peak load:**
- **Scenario:** 20 concurrent Fargate tasks all call Bedrock simultaneously, exceed account quota.
- **Mitigation:** Bedrock client implements exponential backoff with jitter (3 retries: 1s, 4s, 16s). If all retries exhausted, worker marks task as "failed" with error "Bedrock throttled, retry later". SQS message is deleted (permanent failure, not transient). User can resubmit task manually. CloudWatch alarm triggers if 429 rate > 10 in 5 minutes → ops reviews quota and requests increase.

### Regressions

**Existing synchronous artifact generation breaks for users not opted into Fargate:**
- **Risk:** Modifying `artifacts/generate.ts` introduces bug that affects legacy path (feature flag off).
- **Mitigation:** Preserve original logic in a separate function `generateArtifactSync()`. Feature flag toggles between `generateArtifactSync()` and `enqueueArtifactTask()`. Unit tests cover both paths. Deploy with flag off initially, enable gradually (10% → 50% → 100%).

**WebSocket notification payload schema change breaks existing clients:**
- **Risk:** Adding new event types (`task.completed`) could confuse clients expecting only `artifact.generated`.
- **Mitigation:** New event types are additive, not replacing. Existing `artifact.generated` still fires for synchronous path. Frontend client library has forward-compatible parser: unknown event types are logged but do not crash. Document event schema changes in API changelog.

**DSQL query performance degrades due to new table without proper indexing:**
- **Risk:** High write volume to `task_executions` during load test causes table bloat, slows down other queries.
- **Mitigation:** Indexes on `id` (primary key), `status` (for filtering active tasks), composite index on `(user_id, status)` for user-specific queries. VACUUM scheduled nightly to reclaim space. Load test in staging before production to validate query plans.

**S3 bucket lifecycle policy accidentally deletes results before 30-day retention:**
- **Risk:** Misconfigured lifecycle rule deletes objects after 7 days instead of 30.
- **Mitigation:** Lifecycle policy uses object tagging: `retention=30days` tag set on upload. Rule: `DELETE objects WHERE tag:retention = '30days' AND age > 30`. Terraform plan shows lifecycle config before apply. Staging environment tested with fast-forward lifecycle (1-day retention) to verify delete works as expected.

### Security

**Auth context spoofing via SQS message attribute injection:**
- **Risk:** Attacker enqueues malicious SQS message with forged `user_id` attribute, gains unauthorized access to another user's data.
- **Mitigation:** SQS queue policy restricts `SendMessage` to Lambda execution role only. Fargate cannot send to the queue, only receive. Lambda is trusted to set correct auth attributes from validated JWT. Integration test verifies Fargate rejects messages with missing or invalid auth attributes.

**Pre-signed S3 URL leakage exposes task results:**
- **Risk:** User shares pre-signed URL publicly (e.g., pastes in Slack); unauthorized users download sensitive artifacts.
- **Mitigation:** Pre-signed URLs have 7-day expiration (short window). S3 bucket has private ACL (no public access). Objects tagged with `user_id` and `org_id` for audit trail. Frontend warns users: "Result URL is private, do not share." Consider adding `Content-Disposition: attachment` header to force download (prevents accidental browser caching).

**Fargate task IAM role has excessive permissions:**
- **Risk:** Over-permissive role allows worker to read/write arbitrary S3 buckets or invoke unrelated Bedrock models.
- **Mitigation:** Principle of least privilege: role has `s3:PutObject` on results bucket only (resource: `arn:aws:s3:::task-results-bucket/{org_id}/*`), `bedrock:InvokeModel` on specific model ARNs (Claude, Titan), `dynamodb:GetItem` on connection table (read-only), `dsql:ExecuteStatement` scoped to task_executions table. Terraform policy validated with IAM Access Analyzer.

**DDoS via task submission spam:**
- **Risk:** Attacker submits thousands of tasks to exhaust Fargate capacity and inflate AWS bill.
- **Mitigation:** Lambda enforces per-user rate limit: max 5 concurrent tasks per user. If user has 5 active tasks, new submissions return `429 Too Many Requests`. API Gateway throttles requests at 100 req/sec per API key. CloudWatch alarm: if queue depth > 100 for 10 minutes, alert ops (possible attack or runaway job).

**Sensitive data logged in CloudWatch:**
- **Risk:** Worker logs task payload containing PII or secrets (API keys, user input).
- **Mitigation:** Structured logging redacts sensitive fields: `logger.info({ task_id, user_id, status })` does not include full payload. If debugging requires payload inspection, log S3 key only (fetch separately). CloudWatch log retention = 30 days (compliance requirement). Avoid logging Bedrock responses verbatim (may contain user prompts with PII).

### Performance

**Cold start latency exceeds 30-second SLA during scale-up:**
- **Risk:** Fargate takes 45-60 seconds to pull Docker image and start container when scaling from 0 → 1.
- **Mitigation:** Pre-warm 1 task during business hours (min capacity = 1, 8am-6pm UTC). Use ECR image caching: tag images with `:latest` and `:stable`; Fargate caches commonly used images. Optimize Dockerfile: multi-stage build, minimize layers, use alpine base image. Monitor cold start latency: CloudWatch metric `TaskStartupDuration` alarmed at p95 > 30s.

**SQS long-polling blocks worker from processing multiple messages concurrently:**
- **Risk:** Worker uses 20-second long-poll, can only process 1 message at a time, underutilizes Fargate resources.
- **Mitigation:** Worker spawns 4 concurrent long-pollers (one per vCPU). Each poller independently fetches and processes messages. Node.js async/await handles concurrency. Integration test validates worker processes 10 messages within 60 seconds (not 200 seconds).

**DSQL connection pool exhaustion under high load:**
- **Risk:** Each Fargate task opens 10 DSQL connections, 10 tasks = 100 connections, exceeds pool limit.
- **Mitigation:** Task uses connection pooling with max 5 connections per task (50 connections at max scale). Connections reused across message processing. Idle connections closed after 5 minutes. DSQL Aurora cluster configured with max_connections = 200 (headroom for other services).

**Large artifact results (>5MB) cause WebSocket message delivery failure:**
- **Risk:** Attempt to send full artifact via WebSocket (payload size limit: 128KB); message rejected by API Gateway.
- **Mitigation:** WebSocket notification contains only metadata: `{ task_id, status: "completed", result_url }`. Client fetches actual result via S3 pre-signed URL (supports multi-GB downloads). Never serialize large objects into WebSocket messages. Anti-pattern documented in `docs/architecture/websocket-notifications.md`.

**N+1 query problem in status endpoint when fetching tasks for user:**
- **Risk:** `/tasks?user_id=X` endpoint queries DSQL for list of task IDs, then makes separate query for each task's details.
- **Mitigation:** Single query with JOIN: `SELECT * FROM task_executions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`. Repository method `findByUserId()` returns complete task objects. Index on `(user_id, created_at)` for fast lookup. Pagination via cursor (last task_id) to avoid OFFSET (slow on large tables).

---

## Scope Estimate

| Metric | Value |
|--------|-------|
| Files affected | 28 (19 create + 9 modify) |
| Complexity | High — introduces new execution environment (Fargate), async processing pattern, multi-service coordination (Lambda/SQS/Fargate/S3/DSQL/WebSocket), autoscaling configuration, and requires extensive testing of failure scenarios |
| Estimated test cases | 42 (15 unit tests for workers/repositories/clients, 12 integration tests for Lambda endpoints, 8 E2E tests for full lifecycle, 7 failure scenario tests) |

**Complexity Justification:**

This is the first Fargate workload with production traffic in the system. It establishes foundational patterns (worker base class, SQS client, task status tracking) that future long-running operations will reuse. The implementation touches six AWS services (Lambda, SQS, Fargate, S3, DSQL, WebSocket) that must coordinate correctly. Failure modes are non-trivial: message deduplication, visibility timeout, graceful shutdown, WebSocket disconnection, auth context passthrough, autoscaling configuration.

Testing scope is large: unit tests for each shared library, integration tests for modified Lambda endpoints, E2E tests for happy path and failure scenarios (throttling, timeouts, crashes, cancellations). Performance testing requires load generation (50+ concurrent tasks) to validate autoscaling and identify bottlenecks.

Deployment risk is high: feature flag rollout requires monitoring cost, error rate, and latency across multiple percentiles (10% → 50% → 100%). Rollback involves draining SQS queues and toggling flag, not just reverting code.

**Work Breakdown (estimated hours):**

| Phase | Effort |
|-------|--------|
| Infrastructure (Terraform + DSQL) | 8h |
| Shared libraries (SQS, DSQL repo, S3) | 12h |
| Fargate workers (base class + implementations) | 16h |
| Lambda modifications + new endpoints | 10h |
| Unit tests | 14h |
| Integration + E2E tests | 18h |
| Docker image optimization + deployment scripts | 6h |
| Staging deployment + smoke testing | 4h |
| Canary rollout + monitoring | 8h |
| Documentation (runbooks, API specs, diagrams) | 6h |
| **Total** | **102h** |

**Estimated Orbit Count:** 2 orbits

- **Orbit 1:** Infrastructure setup, shared libraries, Fargate worker implementation, Lambda modifications, testing (deploy to staging with feature flag off)
- **Orbit 2:** Canary rollout, monitoring, performance tuning, documentation, production deployment (enable feature flag gradually)

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by | |
| Timestamp | |

---

## Human Modifications

Pending human review.