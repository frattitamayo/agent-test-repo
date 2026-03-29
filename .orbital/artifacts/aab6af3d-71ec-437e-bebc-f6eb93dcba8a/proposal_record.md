# Proposal Record: T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Context Package:** CTX-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

Currently, Prometheus V1 executes all AI-powered artifact generation and chat processing synchronously inside Lambda functions. When users request complex artifacts—multi-file codebase analyses, architectural proposals with deep context, or iterative refinement loops—the Lambda execution times out at 15 minutes, leaving requests incomplete and users without their deliverables. This orbit fundamentally restructures the execution model: the API layer (Lambda) becomes a fast request handler that validates input, records intent, and enqueues work. The compute layer (Fargate) becomes the patient, long-running processor that invokes LLM APIs, streams responses, writes artifacts to S3, updates database state, and notifies users via WebSocket when complete.

The observable change is this: users submit the exact same HTTP requests to the same endpoints, but instead of waiting 15 seconds (or timing out at 15 minutes), they receive an immediate 202 Accepted response with a task identifier and status URL. The frontend polls that URL or listens on WebSocket for completion. Behind the scenes, a Fargate task picks up the work from SQS, runs the LLM operation with 60-minute timeout capacity, writes the result to durable storage, and pushes a notification. The system scales horizontally—10 concurrent artifact requests mean 10 Fargate tasks, not 10 blocked Lambda executions. Cost efficiency improves because we stop paying for Lambda idle time during LLM API network wait, and we right-size compute resources per workload type.

This is not a UI refactor, not a batch processing system, and not an LLM optimization pass. It is purely an infrastructure evolution to break the 15-minute Lambda wall.

---

## Implementation Plan

### Files to Create

**Lambda API Handlers:**
- `backend/api/artifacts/generate.js` — HTTP handler for POST /api/artifacts/generate; validates request schema, writes task record to DSQL (status: pending), enqueues SQS message with task_id and metadata, returns 202 Accepted with task_id and status URL
- `backend/api/chat/submit.js` — HTTP handler for POST /api/chat/submit; follows same pattern for chat message processing requests
- `backend/api/tasks/status.js` — HTTP handler for GET /api/tasks/:task_id; queries DSQL for task status, returns current state (pending/processing/completed/failed) and artifact URL if completed

**Fargate Worker Services:**
- `backend/workers/artifact-generator/index.js` — Container entrypoint; polls SQS with long polling (WaitTimeSeconds=20), processes one message at a time, updates DSQL at task start/completion, invokes LLM via Bedrock SDK, writes artifact to S3, sends WebSocket notification, deletes SQS message on success
- `backend/workers/artifact-generator/Dockerfile` — Based on `node:20-alpine`, installs AWS SDK, copies worker code, exposes health check on port 8080
- `backend/workers/artifact-generator/package.json` — Dependencies: @aws-sdk/client-sqs, @aws-sdk/client-s3, @aws-sdk/client-dsql, @aws-sdk/client-apigatewaymanagementapi, @aws-sdk/client-bedrock-runtime
- `backend/workers/chat-processor/index.js` — Similar structure for chat workload; handles streaming LLM responses, writes chat history to DSQL, notifies via WebSocket

**Shared Libraries:**
- `backend/lib/sqs-client.js` — SQS client abstraction; exports `enqueueTask(queueUrl, taskId, metadata)` for Lambda and `pollMessages(queueUrl, handler)` for Fargate; includes retry logic, correlation ID propagation, X-Ray trace context injection
- `backend/lib/websocket-notifier.js` — WebSocket API client; exports `sendNotification(connectionId, event, payload)`; handles 410 Gone (stale connection) by removing from connection table; implements at-least-once delivery with exponential backoff
- `backend/lib/s3-artifact-store.js` — S3 client; exports `uploadArtifact(intentId, orbitId, content)` using multipart upload for files >5MB, returns S3 key; enforces SSE-S3 encryption
- `backend/lib/task-repository.js` — DSQL client for task records; exports `createTask()`, `updateTaskStatus()`, `getTaskById()`; uses optimistic locking (WHERE status = 'pending' on update to 'processing')

**Database Schema:**
- `backend/database/schema/tasks.sql` — Table definition:
```sql
CREATE TABLE tasks (
    task_id VARCHAR(36) PRIMARY KEY,
    intent_id VARCHAR(36) NOT NULL,
    orbit_id VARCHAR(36),
    user_id VARCHAR(36) NOT NULL,
    task_type VARCHAR(50) NOT NULL, -- 'artifact_generation' | 'chat_processing'
    status VARCHAR(20) NOT NULL, -- 'pending' | 'processing' | 'completed' | 'failed'
    request_payload JSONB NOT NULL,
    result_s3_key VARCHAR(512),
    error_message TEXT,
    correlation_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    INDEX idx_user_tasks (user_id, created_at DESC),
    INDEX idx_status_age (status, created_at)
);
```

**Infrastructure as Code:**
- `infrastructure/sqs/artifact-queue.tf` — Terraform resource for `prometheus-artifact-generation-prod` queue; visibility timeout 5400s (90 min), message retention 14 days, DLQ after 3 retries, encryption at rest with AWS managed key
- `infrastructure/sqs/dlq.tf` — Dead letter queue configuration; CloudWatch alarm on ApproximateNumberOfMessagesVisible >0
- `infrastructure/fargate/task-definition.tf` — ECS task definition for artifact-generator; 4 vCPU, 8192 MB memory, image from ECR, environment variables from Secrets Manager (Bedrock API key), task role ARN, execution role ARN, CloudWatch Logs configuration
- `infrastructure/fargate/service.tf` — ECS service; desired count 2, max 50, target tracking scaling on CPU 70%, deployment circuit breaker enabled, private subnets, security group allows egress to VPC endpoints
- `infrastructure/fargate/cluster.tf` — ECS cluster with Container Insights enabled
- `infrastructure/iam/lambda-sqs-role.tf` — IAM role for Lambda; policy allows `sqs:SendMessage` to artifact queue only, `dsql:ExecuteStatement` on tasks table, `logs:CreateLogStream` and `logs:PutLogEvents`
- `infrastructure/iam/fargate-task-role.tf` — IAM role for Fargate tasks; policy allows `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `s3:PutObject` to artifact bucket with condition `s3:x-amz-server-side-encryption: "AES256"`, `dsql:ExecuteStatement`, `execute-api:ManageConnections` for WebSocket, `secretsmanager:GetSecretValue` for Bedrock key
- `infrastructure/iam/fargate-execution-role.tf` — IAM role for ECS task execution; policy allows `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:CreateLogStream`, `logs:PutLogEvents`
- `infrastructure/vpc/endpoints.tf` — VPC endpoints for S3 (gateway), DSQL (interface), SQS (interface), Secrets Manager (interface), ECR (interface)
- `infrastructure/cloudwatch/alarms.tf` — CloudWatch alarms:
  - DLQ depth >0 (critical)
  - Fargate task failed count >3 in 5 minutes (warning)
  - SQS ApproximateAgeOfOldestMessage >3600s (warning)
  - Fargate service CPU >85% for 10 minutes (scale alarm)

**Testing:**
- `backend/tests/integration/artifact-flow.test.js` — End-to-end test: mock API request → verify SQS message enqueued → mock Fargate processing → verify DSQL task status updated → verify S3 artifact written → verify WebSocket notification sent
- `backend/tests/unit/sqs-client.test.js` — Unit tests for SQS abstraction; validates message format, correlation ID propagation, retry behavior
- `backend/tests/unit/task-repository.test.js` — Unit tests for DSQL operations; validates optimistic locking, status transitions, query performance
- `backend/tests/load/concurrent-tasks.test.js` — Load test: submit 100 concurrent artifact requests, measure API p99 latency <200ms, verify all tasks eventually complete, check for SQS DLQ depth

**Configuration:**
- `backend/config/feature-flags.js` — Feature flag loader from Parameter Store; exports `ENABLE_FARGATE_MIGRATION` (default: false)
- `infrastructure/ssm/parameters.tf` — SSM Parameter Store entry for feature flag

### Files to Modify

- `backend/api/properties/search.js` — No modifications; serves as reference pattern
- `backend/database/connection-pool.js` — **Verify compatibility:** Existing connection pooling logic must support long-lived Fargate processes; if current implementation assumes Lambda ephemeral lifecycle (create pool per invocation), refactor to singleton pattern with connection recycling after 1 hour idle time
- `backend/lib/logger.js` — **Add Fargate context:** If logger only emits Lambda request IDs, extend to support correlation IDs from SQS message attributes; ensure all log entries include task_id and trace_id for X-Ray correlation
- `backend/config/env.js` — **Add new variables:** `ARTIFACT_QUEUE_URL`, `WEBSOCKET_ENDPOINT`, `ARTIFACT_BUCKET`, `FARGATE_MIGRATION_ENABLED` (read from Parameter Store)

### Approach

This implementation follows the **request/response decoupling pattern**: API layer handles protocol concerns (HTTP, auth, validation), persistence layer records intent (task record), message queue decouples request from execution, worker layer handles compute-intensive operations. The Lambda handlers are thin adapters that translate HTTP requests into task records and SQS messages. The Fargate workers are specialized processors that consume one message type and produce one artifact type. The architecture maintains synchronous API semantics (POST returns immediately with 202) while internally executing asynchronously.

Key architectural decisions:
1. **SQS as the single point of decoupling** — Lambda does not directly invoke Fargate, does not write to S3, does not send WebSocket messages. It only writes to DSQL and SQS. This keeps Lambda fast and limits its blast radius.
2. **Task status in DSQL as source of truth** — If WebSocket fails, if S3 write succeeds but notification doesn't, if user reloads page, the task record tells the full story. Polling the status API is always a valid fallback.
3. **At-least-once processing with idempotency** — SQS visibility timeout can expire, messages can be delivered twice. Workers check task status before processing; if already 'processing' or 'completed', skip and delete message.
4. **Progressive complexity** — Start with artifact generation (highest business value, clearest requirements), then extend to chat processing. Chat introduces streaming and incremental updates; artifact generation is batch.

### Order of Operations

**Phase 1: Infrastructure Foundation (Orbit 1)**
1. Create SQS queue and DLQ (Terraform apply)
2. Create ECS cluster (no tasks yet)
3. Create IAM roles for Lambda and Fargate with least-privilege policies
4. Create DSQL tasks table with indexes
5. Create S3 bucket for artifacts with SSE enabled
6. Deploy VPC endpoints for S3, SQS, DSQL
7. Run Terraform plan and apply in dev environment

**Phase 2: Shared Libraries (Orbit 1)**
8. Implement `backend/lib/sqs-client.js` with unit tests
9. Implement `backend/lib/task-repository.js` with unit tests
10. Implement `backend/lib/s3-artifact-store.js` with unit tests
11. Implement `backend/lib/websocket-notifier.js` with unit tests
12. Verify all libraries pass tests, add integration test for task record → SQS → task record update

**Phase 3: Lambda Handlers (Orbit 1)**
13. Implement `backend/api/artifacts/generate.js` with feature flag check
14. Implement `backend/api/tasks/status.js` for status polling
15. Deploy Lambda functions with `ENABLE_FARGATE_MIGRATION=false` (rollout safety)
16. Test API endpoints in dev: verify 202 response, task record creation, status API returns pending
17. Manually enqueue test SQS message, verify message format is correct

**Phase 4: Fargate Worker (Orbit 2)**
18. Implement `backend/workers/artifact-generator/index.js` with LLM invocation logic
19. Write Dockerfile and build image locally
20. Push image to ECR
21. Create ECS task definition referencing ECR image
22. Deploy single Fargate task in dev (desired count 1)
23. Manually enqueue SQS message with test task_id
24. Verify Fargate task: receives message, updates DSQL to 'processing', invokes mock LLM, writes S3 artifact, updates DSQL to 'completed', sends WebSocket notification, deletes SQS message
25. Check CloudWatch Logs for structured logs with correlation ID

**Phase 5: End-to-End Testing (Orbit 2)**
26. Enable feature flag in dev: `ENABLE_FARGATE_MIGRATION=true`
27. Submit real artifact generation request via API
28. Observe full flow: Lambda → SQS → Fargate → S3 → DSQL → WebSocket
29. Verify frontend receives WebSocket notification and displays artifact
30. Run load test: 50 concurrent requests, measure API latency, verify Fargate auto-scales, check for DLQ messages
31. Introduce failure scenarios: kill Fargate task mid-processing, verify SQS message redelivery and idempotency

**Phase 6: Production Rollout (Orbit 3)**
32. Deploy infrastructure to prod environment (SQS, ECS cluster, IAM roles)
33. Deploy Lambda handlers to prod with feature flag `false`
34. Deploy Fargate worker to prod with desired count 2
35. Enable feature flag for 5% of requests (canary rollout)
36. Monitor CloudWatch metrics: API latency, Fargate task count, SQS queue depth, DLQ depth
37. Increase feature flag to 25%, then 50%, then 100% over 3 days
38. Document rollback procedure in runbook

**Phase 7: Chat Processing Extension (Orbit 4)**
39. Implement `backend/api/chat/submit.js` following artifact pattern
40. Implement `backend/workers/chat-processor/index.js` with streaming LLM handling
41. Deploy and test in dev
42. Rollout to prod using same canary approach

### Dependencies

**Internal:**
- **DSQL tasks table** must exist before Lambda handlers can write task records — this is a hard blocker for Phase 3
- **S3 artifact bucket** must be provisioned with encryption and lifecycle policies before Fargate workers can write — blocker for Phase 4
- **WebSocket API Gateway** must have connection management endpoints deployed and tested — blocker for Phase 4 WebSocket notification testing
- **Existing Lambda IAM roles** must allow Parameter Store reads for feature flag — verify before Phase 3 deploy

**External:**
- **AWS Fargate service quota** in target region (us-east-1): default is 500 concurrent tasks, this implementation requires max 50 per region, so no quota increase needed unless org-wide usage is high
- **Bedrock Claude 3.5 Sonnet availability** in us-east-1: confirm endpoint is accessible from VPC, latency is <5s at p99, rate limits are >10 req/min (more than adequate for 50 concurrent tasks)
- **DSQL connection limits**: default is 100 connections per database; Fargate worker uses max 2 connections per task × 50 tasks = 100 connections; this is at the limit — consider increasing quota to 200 or implementing connection pooling with shorter idle timeout
- **SQS service limits**: 3000 messages/sec send rate, 300 messages/sec receive rate per queue; our expected load is <10 messages/sec so no quota increase needed

**Unresolved Questions:**
- Does the existing DSQL connection pool implementation (`backend/database/connection-pool.js`) support long-lived processes? If it assumes Lambda's ephemeral model (create pool on cold start, destroy on shutdown), we need to refactor it before Phase 4.
- Are Bedrock API credentials currently stored in Secrets Manager or environment variables? We need the secret ARN for Fargate task definition.
- Does the WebSocket API have a connection table in DSQL for mapping user_id to connection_id? Fargate workers need to query this table to know which connection to notify.

---

## Risk Surface

### Edge Cases

**SQS Message Delivered Twice (Visibility Timeout Expiry):**
- **Scenario:** Fargate task takes 95 minutes (visibility timeout is 90 minutes), message becomes visible again, second task starts processing
- **Handling:** Before processing, worker queries DSQL `SELECT status FROM tasks WHERE task_id = :task_id FOR UPDATE`. If status is not 'pending', skip processing and delete message. Use DSQL row-level locking to prevent race condition where two tasks read 'pending' simultaneously.
- **Test case:** Set visibility timeout to 10 seconds in dev, submit task that takes 15 seconds, verify only one completion record in DSQL

**Lambda Enqueue Fails After Task Record Written:**
- **Scenario:** Lambda writes task record to DSQL (status: pending), crashes before SQS enqueue, task stuck in pending forever
- **Handling:** Implement compensating background job (Lambda on EventBridge schedule every 5 minutes) that queries `SELECT task_id FROM tasks WHERE status = 'pending' AND created_at < NOW() - INTERVAL 5 MINUTE` and re-enqueues to SQS. Job also updates `correlation_id` so reprocessing can be traced.
- **Test case:** Mock Lambda crash after DSQL write, verify background job re-enqueues within 5 minutes

**WebSocket Connection Closed Before Notification Sent:**
- **Scenario:** User closes browser tab, Fargate task completes artifact 10 seconds later, WebSocket send returns 410 Gone
- **Handling:** Worker logs warning but does not treat as fatal error. Task status remains 'completed' in DSQL. When user returns and reconnects WebSocket, frontend queries `GET /api/tasks?status=completed&since={last_seen_timestamp}` on mount to catch missed notifications.
- **Test case:** Disconnect WebSocket client, trigger task completion, reconnect, verify frontend polls and displays completed task

**Fargate Task OOM Kill Mid-Processing:**
- **Scenario:** LLM returns 200k token response, Node.js heap grows to 9GB, ECS kills container with SIGKILL
- **Handling:** Worker does not delete SQS message until all steps succeed (DSQL update, S3 write, WebSocket send). SQS message becomes visible again after visibility timeout, new task retries. Implement memory monitoring: if `process.memoryUsage().heapUsed > 7GB`, log error and reject message (move to DLQ after 3 attempts).
- **Test case:** Inject mock LLM response of 10GB JSON payload, verify task crashes, SQS message retries, DLQ captures after 3 attempts

**Concurrent Task Status Updates (Race Condition):**
- **Scenario:** Two Fargate tasks read task status 'pending' simultaneously (before either updates to 'processing'), both proceed to process
- **Handling:** Use DSQL optimistic locking: `UPDATE tasks SET status = 'processing', started_at = NOW() WHERE task_id = :task_id AND status = 'pending'`. Check affected row count. If 0 rows updated, another task won the race; skip processing and delete SQS message.
- **Test case:** Enqueue same task_id to SQS twice (manual test), start two Fargate tasks, verify only one processes, other logs "skipped - already processing"

**S3 Upload Fails With Transient Error (503 SlowDown):**
- **Scenario:** 50 tasks complete simultaneously, all attempt S3 PutObject to same bucket prefix partition, S3 returns 503
- **Handling:** S3 client implements exponential backoff with jitter (AWS SDK default). Worker retries up to 3 times with delays of 1s, 2s, 4s. If all retries fail, mark task as 'failed' in DSQL with error_message, delete SQS message (do not retry indefinitely).
- **Test case:** Mock S3 client to return 503 on first two calls, verify worker retries and succeeds on third attempt

**Authorization Code or Session Token Expired During Long Task:**
- **Scenario:** User submits artifact request, Lambda validates session token (valid), Fargate picks up task 30 seconds later, session token expired (if short TTL), LLM API call fails with 401
- **Handling:** Worker does not use user's session token for LLM API calls. Worker authenticates with service role credentials (Bedrock uses IAM role, OpenAI uses API key from Secrets Manager). User authentication is validated once at API ingress, task execution is service-authenticated.
- **Test case:** Submit task with expired session token at API layer, verify Lambda rejects with 401 before enqueue

### Potential Regressions

**Existing Synchronous LLM Callers Break When Feature Flag Enabled:**
- **Risk:** If there are other Lambda functions or services that directly call LLM APIs synchronously (outside the artifact generation flow), enabling the feature flag should not affect them
- **Mitigation:** Feature flag is scoped to `/api/artifacts/generate` and `/api/chat/submit` only. Audit codebase for other LLM invocations (search for `BedrockRuntimeClient`, `OpenAI` imports) and verify they are isolated.
- **Rollback plan:** Feature flag can be toggled off in <1 minute via Parameter Store update, Lambda picks up new value on next invocation (no code deploy required)

**DSQL Connection Pool Exhaustion Under Load:**
- **Risk:** Existing Lambda functions share DSQL connection pool. Adding 50 Fargate tasks with 2 connections each (100 total) plus existing Lambda load could exceed DSQL connection limit, causing new connections to fail
- **Mitigation:** Audit DSQL connection limit (query `SHOW max_connections` or check quota in AWS console). If limit is 100, request increase to 200 before Phase 6 prod rollout. Alternatively, reduce Fargate max task count to 25 (50 connections) and monitor.
- **Detection:** CloudWatch Logs will show `DSQL connection error: too many connections` if limit is hit. Fargate service CPU alarm will not trigger because tasks are blocked waiting for connection, not CPU-bound.

**WebSocket Connection Table Lock Contention:**
- **Risk:** If connection table uses coarse-grained locking (table-level instead of row-level), 50 concurrent Fargate tasks querying `SELECT connection_id FROM ws_connections WHERE user_id = :user_id` could block each other
- **Mitigation:** Verify connection table has index on `user_id` and DSQL query planner uses index scan (not table scan). Use `EXPLAIN` to verify. If lock contention is detected in prod (queries taking >500ms), consider read replica or caching connection_id in Redis with 5-minute TTL.

**Artifact S3 Bucket Lifecycle Policy Deletes In-Progress Uploads:**
- **Risk:** If S3 bucket has lifecycle policy that deletes incomplete multipart uploads after 1 day, and Fargate task takes >1 day (should never happen, but if stuck), upload is deleted before completion
- **Mitigation:** Fargate task has 60-minute timeout at ECS level. If task exceeds 60 minutes, ECS kills it, SQS message retries. Incomplete multipart upload is orphaned but cleaned up by lifecycle policy after 1 day. No functional impact, but storage cost for 1 day.

### Security Considerations

**SQS Message Eavesdropping:**
- **Risk:** SQS messages contain task_id and user_id. If queue is not encrypted at rest, AWS employee with access to underlying storage could read messages.
- **Mitigation:** Enable SQS encryption at rest using AWS managed key (terraform attribute `kms_master_key_id = "alias/aws/sqs"`). Messages are encrypted before writing to queue storage.
- **Additional:** Messages do NOT contain PII, API keys, or sensitive request payloads. Only task_id (UUID), user_id (UUID), intent_id (UUID), and task_type (enum). If request payload must be included in message (for debugging), encrypt with envelope encryption using KMS customer managed key.

**Fargate Task IAM Role Over-Privilege:**
- **Risk:** If Fargate task role has `s3:*` or `dsql:*` wildcard permissions, compromised container could read/write arbitrary data
- **Mitigation:** IAM policy restricts S3 PutObject to artifact bucket only with condition `"s3:x-amz-server-side-encryption": "AES256"` (enforces encryption). DSQL policy allows `ExecuteStatement` but with resource ARN scoped to tasks table only (no other tables). No `s3:GetObject` or `s3:DeleteObject` permissions.
- **Testing:** Attempt to write to different S3 bucket from Fargate task, verify AccessDenied error. Attempt to query users table from Fargate task, verify permission denied.

**Bedrock API Key Exposure in Logs:**
- **Risk:** If LLM API key is accidentally logged (e.g., in error stack trace), it could be leaked via CloudWatch Logs
- **Mitigation:** Use Secrets Manager for API key storage. Inject into Fargate container as environment variable with name `BEDROCK_API_KEY` (not included in logs by default). Redact any environment variables from error serialization in logger (`backend/lib/logger.js` must strip `process.env` from log payloads).
- **Validation:** Grep CloudWatch Logs for string `sk-` (OpenAI key prefix) or `aws_secret` to verify no leaks

**WebSocket Notification Hijacking:**
- **Risk:** If connection_id is predictable or guessable, attacker could subscribe to another user's WebSocket and receive their completion notifications
- **Mitigation:** WebSocket connection_id is AWS-generated UUID (not user-controlled). Connection table enforces foreign key constraint: `user_id` must match authenticated user who opened WebSocket. Fargate worker queries `SELECT connection_id FROM ws_connections WHERE user_id = :user_id` (from task record), does not accept connection_id from SQS message.
- **Testing:** Attempt to send notification to connection_id not owned by user_id, verify error or no-op

**DDoS Amplification via SQS:**
- **Risk:** Attacker submits 10,000 artifact requests in 1 minute, Lambda enqueues 10,000 SQS messages, Fargate scales to quota limit (50 tasks), remaining 9,950 messages sit in queue
- **Mitigation:** API Gateway rate limiting (existing): 1000 req/min per IP. Lambda-level rate limiting: check `SELECT COUNT(*) FROM tasks WHERE user_id = :user_id AND status IN ('pending', 'processing')`, if >5 concurrent tasks, reject with 429 Too Many Requests. SQS queue depth alarm triggers if >100 messages for >10 minutes, indicating abuse or scaling issue.
- **Cost protection:** SQS message retention is 14 days, but after 3 failed attempts, message moves to DLQ. DLQ alarm triggers manual review. Worst-case cost: 10,000 messages × $0.0000004 per request = $0.004 (negligible).

### Performance Implications

**API Latency Increase (Lambda → SQS Enqueue):**
- **Expected impact:** Current synchronous LLM call in Lambda has median latency 5s (includes LLM API network time). New async pattern: Lambda writes to DSQL (10-20ms) + SQS enqueue (5-10ms) = 30ms total. API response is 15x faster but user waits for WebSocket notification instead.
- **Measurement:** CloudWatch metric `APILatency` with dimension `Endpoint=/api/artifacts/generate`, target p99 <200ms
- **Optimization:** Parallelize DSQL write and SQS enqueue (both are async operations, can be fired simultaneously), reduces to max(DSQL_time, SQS_time) ≈ 20ms

**Fargate Cold Start Impact on Time-to-First-Artifact:**
- **Expected impact:** First request after scale-down-to-zero (overnight): cold start is 45-60s (image pull + container start). User submits request at 8:00 AM, receives 202 Accepted in 30ms, but Fargate task doesn't start processing until 8:01 AM. Total time-to-artifact is LLM_processing_time + 60s cold start.
- **Mitigation:** Maintain min desired count of 2 tasks 24/7 (cost: 2 tasks × 4 vCPU × $0.04/hr × 730 hrs/month = $233/month). Warm tasks pick up messages in <5s.
- **Measurement:** Custom CloudWatch metric `FargateTaskStartLatency` = time between SQS message sent and Fargate task updates status to 'processing', target p95 <10s for warm tasks, <60s for cold starts

**DSQL Query Performance Under Concurrent Load:**
- **Expected impact:** Status polling API (`GET /api/tasks/:task_id`) queries `SELECT * FROM tasks WHERE task_id = :task_id`. With 1000 users polling every 5 seconds during high-activity period, that's 200 queries/sec. DSQL default throughput is 1000 reads/sec, so well within limits.
- **Optimization:** Add index on `task_id` (already primary key, so indexed by default). Consider caching task status in Redis with 10-second TTL for completed tasks (reduces DSQL load by 90% for hot tasks).
- **Measurement:** DSQL CloudWatch metric `ReadThroughput`, alarm if >800 reads/sec sustained for 5 minutes

**S3 Artifact Write Latency (Large Files):**
- **Expected impact:** Artifact generation produces markdown files (1-50 KB) and JSON metadata (<10 KB). S3 PutObject latency for objects <1MB is 10-50ms at p99. No significant performance concern.
- **Edge case:** If artifact includes binary attachments (e.g., generated diagrams, PDFs), file size could reach 10-50 MB. Use multipart upload (AWS SDK automatically uses multipart for files >5MB). Multipart upload latency is 500ms-2s for 50MB file.
- **Measurement:** Custom CloudWatch metric `ArtifactUploadLatency`, alarm if p99 >5s

**WebSocket Notification Delivery Latency:**
- **Expected impact:** Fargate task calls `apigatewaymanagementapi.PostToConnection()`, AWS delivers message to client WebSocket connection. Network latency is 10-100ms (us-east-1 to us-east-1 client). If client is in Europe and WebSocket API is us-east-1, latency is 100-200ms.
- **Mitigation:** Deploy WebSocket API Gateway in same region as Fargate tasks to minimize latency. Use CloudFront with WebSocket support for global users (not in scope for this orbit).
- **Measurement:** Custom CloudWatch metric `WebSocketDeliveryLatency` = time between task completed_at timestamp and WebSocket send API call, target p95 <2s

---

## Scope Estimate

**Estimated Orbit Count:** 4 orbits

**Orbit Breakdown:**

| Orbit | Phase | Deliverables | Estimated Effort |
|-------|-------|--------------|------------------|
| **Orbit 1** | Infrastructure + Lambda Handlers | SQS queues, ECS cluster, IAM roles, DSQL schema, shared libraries, Lambda API handlers with feature flag | 5-7 days |
| **Orbit 2** | Fargate Worker + End-to-End Testing | Fargate artifact-generator implementation, Dockerfile, ECS task definition, integration tests, dev environment validation | 5-7 days |
| **Orbit 3** | Production Rollout + Monitoring | Prod infrastructure deploy, canary rollout with feature flag, CloudWatch dashboard, runbook documentation, performance validation | 3-5 days |
| **Orbit 4** | Chat Processing Extension | Chat-specific Lambda handler and Fargate worker, streaming response handling, incremental testing, prod rollout | 4-6 days |

**Total Estimated Effort:** 17-25 days (assuming single engineer, no blockers)

**Complexity Assessment:** **High**

**Justification:**
This orbit introduces multiple new infrastructure components (SQS, Fargate, VPC endpoints, CloudWatch alarms), each with its own configuration surface and failure modes. The async execution model is a fundamental architectural shift from Prometheus V1's current synchronous Lambda-only design. Integration points span five AWS services (API Gateway, Lambda, SQS, Fargate, DSQL, S3, WebSocket API Gateway), each with latency characteristics, error modes, and observability requirements.

The trust tier (Tier 2 - Supervised) reflects the blast radius: LLM operations drive user value, and silent failures (message loss, WebSocket delivery failure without fallback) could degrade UX without immediate detection. The implementation requires careful ordering (infrastructure before code, dev validation before prod rollout) and multiple feedback loops (load testing, alarm tuning, rollback validation).

**Risk Factors Increasing Complexity:**
- This is the **first orbit in the Fargate trajectory** — no existing patterns, no prior art, establishing conventions from scratch
- Async execution introduces **visibility challenges** — when a task fails, the error is not immediately visible to the API caller; requires robust logging and tracing
- **Feature flag rollout** adds deployment complexity — need to validate behavior in both modes (sync vs async) during transition period
- **Unresolved dependency questions** (DSQL connection pooling compatibility, WebSocket connection table existence) could require investigative work mid-implementation

**Scope Boundaries (What This DOES NOT Include):**
- Frontend UI changes to display async task progress (status polling, progress bars, cancellation buttons)
- LLM prompt optimization or model selection changes
- Batch processing or scheduled jobs
- Multi-region Fargate deployment
- Advanced cost optimization (spot instances, Fargate Savings Plans)

**Estimated Test Coverage:**
- **Unit tests:** 15 test suites (sqs-client, task-repository, s3-artifact-store, websocket-notifier, Lambda handlers, Fargate worker message processing logic)
- **Integration tests:** 5 end-to-end flows (artifact generation success, failure with retry, DLQ delivery, WebSocket notification, status polling)
- **Load tests:** 2 scenarios (50 concurrent tasks, 1000 req/min API throughput)
- **Failure injection tests:** 5 scenarios (Lambda crash after DSQL write, Fargate OOM, S3 503 error, WebSocket 410 Gone, SQS message replay)

---

## Human Modifications

Pending human review.