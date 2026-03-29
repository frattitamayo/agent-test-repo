# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1
**Generated:** 2024-01-17
**Intent:** T6-003
**Context Packages:**
- Architectural: CTX-ARCH-PROMETHEUS-001 (inferred from trajectory context)
- Intent-specific: CTX-T6-003-001
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

The Prometheus platform currently fails when users request artifact generation or AI chat operations requiring more than 29 seconds of processing time, because Lambda functions invoke Bedrock synchronously and hit API Gateway's timeout limit. This creates a brittle user experience where complex documents or extended conversations simply error out.

This intent moves long-running LLM operations off Lambda's synchronous execution path and onto Fargate tasks that can run for hours if needed. The architecture changes from "frontend calls Lambda, Lambda waits for Bedrock, Lambda returns" to "frontend calls Lambda, Lambda queues the work on SQS and returns immediately, Fargate picks up the queue message and does the heavy processing, then notifies the frontend via WebSocket when done."

The critical constraints are:
- Lambda stays as the HTTP entry point (no bypassing API Gateway)
- Fargate triggers only via SQS (no direct invocation)
- Short requests (<20s) continue using Lambda's existing synchronous path
- Results are stored atomically — the database never says "completed" unless the S3 artifact actually exists and is verified
- Users get real-time feedback through WebSocket notifications, not by polling

When complete, the platform handles multi-minute LLM operations without timeout failures while maintaining the exact same frontend experience for fast operations.

---

## Implementation Plan

### Files to Create

**1. SQS Message Publishing Layer**

- `backend/services/queue-client.js`
  - Wraps AWS SDK SQS client
  - Publishes messages with correlation IDs and idempotency keys
  - Handles message serialization and error cases
  - Logs publish latency to CloudWatch

- `backend/services/queue-schemas.js`
  - Defines message structure constants
  - Validates message payloads before publishing
  - Operation types: `GENERATE_ARTIFACT`, `PROCESS_CHAT`

**2. Fargate Worker Implementation**

- `backend/workers/fargate-llm-processor/index.js`
  - Task entry point — long-polling loop on SQS queue
  - Message deserialization and validation
  - Routes to appropriate handler based on operation type
  - Updates database status to `processing` on task start
  - Graceful shutdown handling (SIGTERM from ECS)

- `backend/workers/fargate-llm-processor/handlers/artifact-generator.js`
  - Orchestrates artifact generation workflow
  - Invokes Bedrock with retry logic for throttling
  - Assembles artifact content from LLM responses
  - Calls S3 + database update services
  - Sends WebSocket notification on completion

- `backend/workers/fargate-llm-processor/handlers/chat-processor.js`
  - Handles extended AI chat conversations
  - Manages conversation context across multiple LLM turns
  - Updates chat message records in database
  - Similar structure to artifact-generator

- `backend/workers/fargate-llm-processor/services/bedrock-client.js`
  - Bedrock SDK wrapper with exponential backoff
  - Token counting and cost tracking
  - Error classification (throttle vs. model error)
  - Logs Bedrock request/response metadata

- `backend/workers/fargate-llm-processor/services/s3-client.js`
  - S3 upload with atomic write pattern
  - Implements: upload → head verification → return key
  - Idempotent PUT operations (same key overwrites)
  - Content-type and metadata tagging

- `backend/workers/fargate-llm-processor/services/database-client.js`
  - Aurora DSQL connection pooling
  - Status update queries with optimistic locking
  - Transaction management for atomic updates
  - Connection retry logic

- `backend/workers/fargate-llm-processor/services/websocket-notifier.js`
  - Posts completion notifications to API Gateway WebSocket API or IoT Core
  - Handles stale connection IDs gracefully (logs but doesn't fail task)
  - Notification payload includes requestId, artifactId, status

- `backend/workers/fargate-llm-processor/Dockerfile`
  - Multi-stage build: dependencies stage + runtime stage
  - Base image: `node:18-alpine` for minimal size
  - Copies only production dependencies
  - Sets non-root user for security
  - Entrypoint: `node index.js`

- `backend/workers/fargate-llm-processor/package.json`
  - Dependencies: `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`, `@aws-sdk/client-sqs`, `pg` (for DSQL)
  - Scripts: `npm start`, `npm test`

**3. Database Queries**

- `backend/database/queries/artifact-update-status.sql`
  ```sql
  UPDATE artifacts 
  SET status = $1, 
      s3_key = $2, 
      fargate_task_arn = $3,
      updated_at = NOW(),
      completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END
  WHERE id = $4 AND status != 'completed'
  RETURNING *;
  ```

- `backend/database/queries/artifact-check-idempotency.sql`
  ```sql
  SELECT id, status, s3_key 
  FROM artifacts 
  WHERE request_id = $1;
  ```

- `backend/database/queries/chat-message-update-status.sql`
  - Similar structure to artifact update
  - Includes conversation context fields

**4. Infrastructure as Code**

- `infrastructure/fargate/sqs-queues.tf` (or `.json` if using CloudFormation)
  - Main queue: `prometheus-llm-processing-queue`
  - DLQ: `prometheus-llm-processing-dlq`
  - Visibility timeout: 14400 seconds (4 hours)
  - Message retention: 14 days
  - Redrive policy: maxReceiveCount = 3

- `infrastructure/fargate/iam-roles.tf`
  - Lambda role: add `sqs:SendMessage` for main queue
  - Fargate task execution role: ECR pull, CloudWatch Logs write
  - Fargate task role: Bedrock invoke, S3 put/head, SQS receive/delete, DSQL execute, WebSocket post

- `infrastructure/fargate/ecs-task-definition.json`
  - Container name: `llm-processor`
  - Image: `<account>.dkr.ecr.<region>.amazonaws.com/prometheus-llm-processor:latest`
  - CPU: 2 vCPU (2048)
  - Memory: 4 GB (4096)
  - Environment variables: QUEUE_URL, S3_BUCKET, WEBSOCKET_ENDPOINT, DB_HOST, DB_NAME
  - Logging: CloudWatch log group `/ecs/prometheus-llm-processor`

- `infrastructure/fargate/ecs-service.tf`
  - Service name: `prometheus-llm-processor-service`
  - Desired count: 1 (manually scale based on queue depth initially)
  - Launch type: FARGATE
  - Network: private subnets, security group for VPC endpoints
  - Platform version: LATEST

**5. Test Files**

- `backend/services/__tests__/queue-client.test.js`
  - Unit tests for message publishing
  - Mocks SQS SDK responses

- `backend/workers/fargate-llm-processor/__tests__/artifact-generator.test.js`
  - Table-driven tests for generation workflow
  - Scenarios: successful generation, Bedrock throttle, S3 write failure, database update failure

- `backend/workers/fargate-llm-processor/__tests__/idempotency.test.js`
  - Tests duplicate message handling
  - Verifies no double-invocation of Bedrock

- `backend/api/artifacts/__tests__/generate.integration.test.js`
  - End-to-end test: POST request → SQS message published → 202 response

### Files to Modify

**1. Lambda HTTP Handlers**

- `backend/api/artifacts/generate.js`
  - Add duration estimation logic (based on artifact type/complexity)
  - If estimated duration >20s AND `USE_FARGATE_FOR_LLM` feature flag enabled:
    - Generate requestId (uuid v4)
    - Publish message to SQS via `queue-client.js`
    - Insert database record with status `pending`
    - Return 202 Accepted with requestId
  - Else: use existing synchronous Lambda path
  - Error handling: if SQS publish fails, fall back to synchronous or return 503

- `backend/api/chat/message.js`
  - Similar modification for chat operations
  - Add duration estimation (based on conversation history length)
  - Dual-path routing (SQS vs. synchronous)

**2. Configuration**

- `backend/config/aws.js`
  - Add SQS queue URL configuration from environment variable
  - Add feature flag: `USE_FARGATE_FOR_LLM` (default: false)

- `backend/config/environment.js`
  - Map environment variables: `QUEUE_URL`, `S3_BUCKET`, `WEBSOCKET_ENDPOINT`, `DB_HOST`

**3. Logging Utilities**

- `backend/utils/logger.js`
  - Ensure correlation ID support exists
  - Add Fargate task ARN to log context if running in ECS

### Approach

This implementation follows an **additive architecture** — the existing Lambda synchronous path remains untouched and continues to handle short-duration requests. The Fargate path is layered on top, gated by a feature flag, allowing safe rollback and gradual rollout.

The critical design decision is **message-driven coordination**: Lambda publishes to SQS and immediately returns, decoupling the HTTP request lifetime from the LLM processing lifetime. Fargate tasks long-poll the SQS queue, process messages, and send WebSocket notifications when done. The frontend subscribes to WebSocket events and updates the UI accordingly.

Data integrity is guaranteed through an **atomic write pattern**: S3 upload happens first, then S3 head verification, then database update. The database status field acts as the source of truth — if it says `completed`, the S3 artifact is guaranteed to exist.

The implementation references the existing Lambda handler pattern from `backend/api/properties/search.js` for HTTP response structure and error handling. Database queries follow the parameterized SQL pattern from `backend/database/queries/property-search.sql`.

### Order of Operations

**Phase 1: Infrastructure Provisioning (blocking — must complete before code deployment)**
1. Provision SQS queues (main + DLQ) via IaC
2. Create IAM roles for Lambda and Fargate with least-privilege policies
3. Create ECS task definition and service
4. Create ECR repository for container images
5. Validate VPC endpoint connectivity to Bedrock, S3, SQS, DSQL from Fargate tasks

**Phase 2: Core Fargate Worker (parallel with Phase 3)**
6. Implement `backend/workers/fargate-llm-processor/index.js` (task entry point and SQS polling loop)
7. Implement `services/bedrock-client.js` (LLM invocation with retry logic)
8. Implement `services/s3-client.js` (atomic upload pattern)
9. Implement `services/database-client.js` (status update queries)
10. Implement `services/websocket-notifier.js` (completion notifications)
11. Write unit tests for each service module
12. Build Docker image and push to ECR

**Phase 3: Lambda Integration (parallel with Phase 2)**
13. Implement `backend/services/queue-client.js` (SQS message publishing)
14. Modify `backend/api/artifacts/generate.js` to add SQS publishing path with feature flag
15. Modify `backend/api/chat/message.js` similarly
16. Add configuration for queue URLs and feature flags
17. Write integration tests for Lambda → SQS path

**Phase 4: Domain-Specific Handlers (depends on Phase 2 + 3)**
18. Implement `handlers/artifact-generator.js` (orchestrates artifact generation workflow)
19. Implement `handlers/chat-processor.js` (orchestrates chat processing workflow)
20. Wire handlers into `index.js` message routing
21. Write table-driven tests for each handler

**Phase 5: Database Schema Updates (may be blocking if schema incomplete)**
22. Add database migration for `status`, `s3_key`, `fargate_task_arn` fields if not present
23. Add `request_id` column with unique constraint for idempotency
24. Create SQL query files for status updates

**Phase 6: Deployment and Validation**
25. Deploy infrastructure (SQS, IAM, ECS) to staging environment
26. Deploy Lambda changes with feature flag OFF
27. Deploy Fargate container image to ECS service
28. Enable feature flag for 1% of traffic (canary)
29. Monitor CloudWatch metrics for 24 hours: task success rate, WebSocket delivery, S3/database consistency
30. Scale to 100% traffic if metrics meet acceptance criteria

### Dependencies

**Hard Blockers (must exist before Phase 1):**
- VPC with private subnets (assumed from T6-001/T6-002)
- NAT Gateway or VPC endpoints for AWS service access (assumed from T6-001/T6-002)
- ECS Fargate cluster provisioned (assumed from T6-001/T6-002)
- ECR repository created (may need to create if not from T6-001/T6-002)
- Aurora DSQL database with `artifacts` and `chat_messages` tables

**Soft Blockers (can create as part of this orbit):**
- SQS queues (this orbit provisions)
- IAM roles (this orbit provisions)
- WebSocket API or IoT Core connection manager (validation needed — if absent, creates hard blocker)

**External Service Dependencies:**
- Amazon Bedrock service availability (external — cannot control)
- S3 bucket exists (assumed from project description)

**Schema Validation Required:**
- Confirm `artifacts` table has `status`, `s3_key`, `request_id`, `fargate_task_arn` columns
- If columns missing, database migration becomes Phase 0 (blocking)

**Prior Orbit Artifacts:**
- Review T6-001/T6-002 artifacts for: VPC endpoint configuration, Fargate task IAM role baseline, networking decisions
- If T6-001/T6-002 incomplete, delay execution until network validation passes

---

## Risk Surface

### Edge Cases

**1. Duplicate SQS Message Delivery (Standard Queue)**

Standard SQS queues deliver at-least-once, meaning the same message could be received multiple times if Fargate fails to delete it after processing or if network partitions occur.

**Handling:**
- Before invoking Bedrock, Fargate queries `artifacts` table for existing `request_id`
- If record exists with status `completed` or `processing`, skip Bedrock invocation
- If `completed`, fetch existing `s3_key`, send WebSocket notification, delete SQS message
- If `processing` with `updated_at` <30 minutes ago, assume another task is handling it, delete message
- If `processing` with `updated_at` >30 minutes ago (stale), take over processing
- Test case: manually enqueue duplicate message with same `requestId`, verify only one Bedrock call and one S3 artifact

**2. Fargate Task Crash Mid-Processing**

Task could crash after updating status to `processing` but before completing S3 write, leaving orphaned database record.

**Handling:**
- SQS visibility timeout (4 hours) exceeds task timeout, so message reappears in queue if task crashes
- Next Fargate task picks up message, sees status `processing` with stale timestamp, retakes ownership
- Update status to `processing` with new `fargate_task_arn` and current timestamp
- Maximum 3 retries before message goes to DLQ (SQS redrive policy)
- Background Lambda runs hourly: scans for `processing` records >4.5 hours old, marks as `failed`, sends WebSocket notification
- Test case: kill Fargate task mid-execution via ECS stop-task API, verify retry and eventual completion or DLQ

**3. S3 Upload Succeeds but Database Update Fails**

S3 object written successfully but database transaction rolls back due to connection loss or constraint violation.

**Handling:**
- Database update occurs AFTER S3 upload verification (enforced by atomic write pattern)
- If database update fails, Fargate logs error, does NOT delete SQS message, allows retry
- Retry attempt sees S3 object already exists, verifies via head, retries database update only
- S3 PUT with same key is idempotent — overwrites with identical content
- Maximum 3 retries before DLQ
- CloudWatch alarm on DLQ message count >5
- Test case: inject database connection failure after S3 write, verify retry succeeds and database eventually consistent

**4. WebSocket Connection Closed Before Notification Sent**

User closes browser tab while artifact is processing; WebSocket connection ID is stale when notification attempted.

**Handling:**
- Fargate wraps WebSocket post in try/catch
- If post fails (connection closed or not found), log error but proceed with SQS message deletion
- Database record still updated to `completed` with `s3_key`
- Frontend implements polling fallback: every 10 seconds, query API for artifact status by `requestId`
- CloudWatch metric: `WebSocketNotificationFailureRate` (target <2%)
- Test case: disconnect WebSocket before task completion, verify database updated and frontend eventually polls and retrieves result

**5. Authorization Code Timeout (30-Second Lambda Limit for Initial Request)**

Lambda's initial handling of the HTTP request (before SQS publish) must complete within API Gateway's 29-second timeout.

**Handling:**
- SQS message publish is fast (<10ms p95)
- Database insert for `pending` status is fast (<20ms p95)
- Total Lambda execution time for SQS path: <100ms p99
- If SQS publish fails (rare), Lambda falls back to synchronous path OR returns 503 with retry-after header
- Test case: inject artificial latency in SQS publish, verify Lambda times out gracefully with 503, not 500

**6. Concurrent Requests with Same Intent (Idempotency at Intent Level)**

Two users simultaneously request the same artifact (e.g., same context package generation) — should reuse result, not duplicate work.

**Handling:**
- This is out of scope for T6-003 — focus is per-request idempotency, not intent-level deduplication
- Database `request_id` is per HTTP request, not per intent
- Future optimization: add `intent_content_hash` column, check for existing artifacts with same hash before queuing
- For T6-003: allow duplicate generation, rely on request-level idempotency only
- Document as known limitation, defer to future intent

### Regressions

**1. Lambda Synchronous Path Performance Degradation**

Adding SQS publish logic to Lambda could slow down the existing synchronous path if not properly gated.

**Mitigation:**
- Feature flag `USE_FARGATE_FOR_LLM=false` by default — synchronous path remains dominant
- SQS client instantiated only once (module-level singleton), not per invocation
- Duration estimation logic (<50 lines) runs before choosing path — minimal overhead
- Integration tests measure Lambda cold start and warm execution time before and after change
- If regression detected (>10% increase in p95 latency), investigate and optimize before enabling Fargate path

**2. Database Connection Pool Exhaustion from Fargate Tasks**

Fargate tasks opening database connections could exhaust DSQL connection pool, starving Lambda functions.

**Mitigation:**
- Fargate database client uses connection pooling with max 5 connections per task
- Connection idle timeout: 60 seconds
- Aurora DSQL connection limit: verify cluster can handle (Lambda concurrency + Fargate task count) × connection pool size
- CloudWatch alarm on DSQL connection count >80% of limit
- If limit reached, reduce Fargate task count or increase DSQL instance size

**3. S3 Rate Limiting from Concurrent Uploads**

Fargate tasks uploading to S3 simultaneously could hit S3 rate limits (3500 PUT/sec per prefix).

**Mitigation:**
- S3 bucket uses random prefix for artifact keys (e.g., `artifacts/<uuid>/...`) to distribute across partitions
- Expected upload rate: <10 uploads/sec even at peak (not approaching limit)
- S3 client implements exponential backoff for 503 SlowDown errors
- CloudWatch metric: S3 PUT request count and error rate

### Security

**1. SQS Message Tampering or Injection**

Attacker with access to SQS queue could enqueue malicious messages to trigger unauthorized LLM operations.

**Mitigation:**
- SQS queue policy restricts send access to Lambda execution role only (IAM least-privilege)
- Messages do not contain sensitive data — only references (`userId`, `intentId`, `artifactType`)
- Fargate validates message schema before processing — rejects malformed messages to DLQ
- User authorization happens at Lambda (HTTP layer) before enqueueing — Fargate trusts Lambda's authorization decision
- CloudWatch alarm on DLQ message count (may indicate injection attempts)

**2. IAM Role Over-Permissioning**

Fargate task role granted excessive permissions could allow lateral movement or data exfiltration.

**Mitigation:**
- Task role scoped to specific resources: `s3:PutObject` on artifact bucket only, `bedrock:InvokeModel` on specific model ARN
- No `s3:GetObject` permission (Fargate only writes, never reads user artifacts)
- No access to other S3 buckets or DynamoDB tables
- DSQL permissions scoped to `artifacts` and `chat_messages` tables only
- IAM policy review during Tier 2 pre-deployment checkpoint

**3. WebSocket Notification to Wrong User**

Fargate sends notification to incorrect WebSocket connection, leaking artifact completion status to unauthorized user.

**Mitigation:**
- Lambda stores `websocketConnectionId` in SQS message at enqueue time
- Fargate uses that connection ID exactly — no lookup or substitution
- WebSocket connection ID is session-scoped — expires when user disconnects
- API Gateway WebSocket API validates connection ownership before delivering message (built-in feature)
- Test case: attempt to send notification to connection ID owned by different user, verify API Gateway rejects

**4. Bedrock Prompt Injection via User Input**

User crafts malicious artifact parameters to inject commands into Bedrock prompts.

**Mitigation:**
- Out of scope for T6-003 — prompt construction is existing Lambda logic, unchanged
- Fargate receives pre-validated parameters from Lambda
- No raw user input passed directly to Bedrock in this orbit's code
- Document as assumption: intent-specific handlers (artifact-generator, chat-processor) must sanitize inputs
- Recommend separate security review of prompt templates (not blocking for T6-003)

### Performance

**1. Fargate Cold Start Latency**

Fargate task takes 30-60 seconds to start (image pull + network setup), delaying first message processing.

**Impact:** User waits 30-60s before processing begins after Lambda enqueues message.

**Mitigation:**
- ECS service minimum task count = 1 (always one warm task ready)
- Small container image (<500 MB) reduces pull time
- Pre-pull image to ECS cluster during deployment
- CloudWatch metric: time from message enqueue to Fargate log "Task started"
- Target: p95 <45 seconds (acceptance criteria)
- If exceeded, increase minimum task count to 2 or implement pre-warming Lambda

**2. SQS Polling Overhead**

Fargate long-polling SQS with no messages wastes CPU and incurs SQS API costs.

**Mitigation:**
- SQS long-polling with 20-second wait time (maximize efficiency)
- ReceiveMessage call returns immediately if message available, waits up to 20s if queue empty
- Cost: ~$0.0004 per 1,000 requests — negligible at expected volume
- If queue consistently empty, scale task count down (manual initially, auto-scaling in future)

**3. Database Query Performance Under Load**

Concurrent Fargate tasks updating `artifacts` table could cause lock contention or slow queries.

**Mitigation:**
- Status update query uses `WHERE id = $1` (indexed primary key lookup)
- Optimistic locking: `WHERE status != 'completed'` prevents overwriting completed records
- Aurora DSQL supports concurrent writes — not a bottleneck at expected scale (<10 concurrent tasks)
- Add database index on `request_id` for idempotency check query
- CloudWatch metric: query execution time p95

**4. Bedrock API Latency Variability**

Bedrock response time unpredictable (2s - 120s depending on model and prompt size), making accurate duration estimation difficult.

**Mitigation:**
- Duration estimation uses conservative thresholds: if ANY chance of >20s, route to Fargate
- Over-routing to Fargate acceptable — wastes some resources but prevents timeouts
- Track actual vs. estimated duration in CloudWatch custom metrics
- Refine estimation algorithm over time based on production data
- Fallback: if Lambda synchronous path approaches timeout, log warning and complete (no retry)

---

## Scope Estimate

### Files Affected

| Category | Count | Files |
|----------|-------|-------|
| **New files (create)** | 22 | SQS client (2), Fargate worker (8), Database queries (2), Infrastructure (4), Tests (6) |
| **Modified files** | 5 | Lambda handlers (2), Config (2), Logger (1) |
| **Total** | **27** | |

### Complexity Assessment

**Rating: High**

**Justification:**

This intent introduces asynchronous, stateful orchestration across five AWS services (Lambda, SQS, ECS Fargate, S3, Aurora DSQL) plus WebSocket notifications. The complexity stems from:

1. **Distributed state coordination:** Guaranteeing database and S3 consistency requires atomic write patterns across services with different failure modes.

2. **Dual execution paths:** Maintaining both synchronous (Lambda) and asynchronous (Fargate) paths with feature-flag gating increases testing surface area and rollback complexity.

3. **New infrastructure layer:** Fargate container orchestration, ECS service management, and SQS queue tuning are new operational concerns not present in current Lambda-only architecture.

4. **Cross-service error handling:** Failures can occur in six distinct places (Lambda, SQS, Fargate, Bedrock, S3, DSQL), each requiring different retry/recovery strategies.

5. **Observability requirements:** CloudWatch dashboards, alarms, and log correlation must span Lambda and Fargate, with distributed tracing via correlation IDs.

This is not a "straightforward pattern application" — it fundamentally changes the request handling model from synchronous to asynchronous with multiple new infrastructure components.

### Estimated Orbit Count

**Total: 2-3 orbits**

**Breakdown:**

**Orbit 1 (current proposal):**
- Infrastructure provisioning (SQS, IAM, ECS)
- Core Fargate worker (index.js, service modules, Dockerfile)
- Lambda SQS integration with feature flag
- Database queries and schema validation
- Unit tests for worker services
- Deployment to staging with feature flag OFF
- **Estimated duration:** 3-4 weeks (includes infrastructure validation and initial deployment)

**Orbit 2 (domain handler implementation):**
- Artifact generator handler (full LLM workflow)
- Chat processor handler
- WebSocket notification integration
- Table-driven tests for handlers
- End-to-end integration tests (Lambda → SQS → Fargate → S3 → WebSocket)
- Canary deployment to production (1% traffic, feature flag ON)
- **Estimated duration:** 2-3 weeks

**Orbit 3 (optional — if issues arise in canary):**
- Performance optimization based on production metrics
- Retry logic refinement
- Error handling edge cases discovered in canary
- Scaling configuration tuning
- Full rollout (100% traffic)
- **Estimated duration:** 1-2 weeks (only if canary reveals unanticipated issues)

**Why multiple orbits:**
- High complexity and distributed failure modes justify phased rollout
- Orbit 1 establishes infrastructure foundation without affecting production traffic
- Orbit 2 implements domain logic and validates end-to-end flow under canary load
- Orbit 3 provides buffer for production-discovered issues without blocking Orbit 1/2 completion

### Test Coverage Plan

**Unit Tests (per-module):**
- `queue-client.js`: 6 cases (successful publish, SQS error, malformed message, missing credentials, timeout, retry)
- `bedrock-client.js`: 8 cases (successful invoke, throttle with retry, model error, timeout, max retries exceeded, token count validation, response parsing, invalid model ID)
- `s3-client.js`: 6 cases (successful upload, upload failure, head verification failure, retry on 503, idempotent overwrite, invalid key)
- `database-client.js`: 7 cases (successful update, connection failure, optimistic lock violation, concurrent update, idempotency check, query timeout, connection pool exhaustion)
- `websocket-notifier.js`: 5 cases (successful post, connection not found, timeout, malformed payload, API Gateway error)
- `artifact-generator.js`: 10 cases (successful generation, Bedrock error, S3 error, database error, duplicate request, stale processing, partial retry, notification failure, LLM timeout, complex artifact multi-part)
- `chat-processor.js`: 8 cases (successful processing, conversation context retrieval, multi-turn handling, context truncation, similar error cases as artifact-generator)

**Integration Tests:**
- Lambda → SQS: 4 cases (sync path, async path, feature flag disabled, SQS publish failure)
- SQS → Fargate: 3 cases (message received, duplicate message, malformed message)
- Fargate → S3 + Database + WebSocket: 5 cases (end-to-end success, partial failure at each step, retry after failure)

**Total estimated test cases: 62**

### Risk-Adjusted Timeline

| Scenario | Probability | Impact on Timeline |
|----------|-------------|-------------------|
| **Best case:** Infrastructure from T6-001/T6-002 complete, no schema changes needed, canary passes | 20% | 5-6 weeks (2 orbits) |
| **Expected case:** Minor schema updates required, one canary issue requiring refinement | 60% | 6-8 weeks (2-3 orbits) |
| **Worst case:** WebSocket infrastructure missing (must implement), Fargate networking issues, multiple canary failures | 20% | 10-12 weeks (3-4 orbits) |

**Recommendation:** Plan for 8-week timeline (expected case), with checkpoint at Orbit 1 completion to reassess based on infrastructure validation results.

---

## Human Modifications

Pending human review.