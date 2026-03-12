# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2026-03-12  
**Intent:** T6-003  
**Context Package:** CTX-INT-T6-003  
**Trust Tier:** 2 — Supervised  
**Orbit:** 1

---

## Interpreted Intent

The system currently processes AI artifact generation and chat operations synchronously in Lambda functions, which fail when LLM processing exceeds Lambda's 15-minute execution limit. This orbit introduces an asynchronous task processing model where Lambda functions accept HTTP requests, enqueue work to SQS, and return immediately. Fargate containers poll the queue, execute long-running LLM operations (up to 30 minutes), persist results to S3 and DSQL, and notify clients via WebSocket events.

The user experience remains unchanged — same API endpoints, same response formats — but the system now handles arbitrarily long LLM processing without timeouts. Clients receive real-time progress updates through their existing WebSocket connection, and can query task status via a new GET endpoint if the WebSocket disconnects.

This is not a complete replacement of Lambda. Lambda continues to handle all synchronous operations (validation, auth, enqueuing). Fargate handles only the specific operations that require >15 minutes: artifact generation and chat processing with complex multi-turn LLM interactions.

Success means zero Lambda timeout errors for these operations, ≥99.5% task completion rate, and queue-to-execution latency under 10 seconds.

---

## Implementation Plan

### Files to Create

**Infrastructure (Terraform assumed based on naming conventions):**

1. **`infrastructure/sqs/llm-processing-queue.tf`**  
   - SQS standard queue: `prometheus-{env}-llm-processing-queue`
   - Visibility timeout: 30 minutes (matches task timeout)
   - Message retention: 4 days
   - Encryption at rest: AWS managed KMS key
   - DLQ configured after 3 receive attempts
   - Tags: `Environment`, `Service=llm-processing`, `CostCenter`

2. **`infrastructure/sqs/llm-processing-dlq.tf`**  
   - Dead letter queue: `prometheus-{env}-llm-processing-dlq`
   - Message retention: 14 days
   - CloudWatch alarm: depth >0 triggers SNS notification

3. **`infrastructure/ecs/cluster.tf`**  
   - ECS Fargate cluster: `prometheus-{env}-fargate-cluster`
   - Container Insights enabled
   - Capacity providers: FARGATE and FARGATE_SPOT

4. **`infrastructure/ecs/task-definition.tf`**  
   - Task family: `prometheus-llm-processor`
   - CPU: 4096 (4 vCPU)
   - Memory: 8192 MB (8 GB)
   - Network mode: awsvpc
   - Requires compatibilities: FARGATE
   - Task role ARN: (from task-role.tf)
   - Execution role ARN: (from execution-role.tf)
   - Container definition: image from ECR, environment variables from Secrets Manager
   - Log configuration: `/ecs/prometheus-llm-processor` CloudWatch log group
   - Stop timeout: 120 seconds (graceful shutdown window)

5. **`infrastructure/ecs/service.tf`**  
   - ECS Service: `llm-processor-service`
   - Launch type: FARGATE
   - Desired count: 0 (scales up on demand)
   - Min capacity: 0, Max capacity: 10
   - Network configuration: private subnets, security group allowing egress to Bedrock/LLM APIs
   - Auto-scaling target: ECS service scaling based on SQS ApproximateNumberOfMessagesVisible metric
   - Scaling policy: target value 2 (one task per 2 messages in queue)

6. **`infrastructure/iam/fargate-execution-role.tf`**  
   - Role: `prometheus-{env}-fargate-execution-role`
   - Trusted entity: ecs-tasks.amazonaws.com
   - Managed policies: `AmazonECSTaskExecutionRolePolicy`
   - Inline policy: ECR pull, CloudWatch Logs write, Secrets Manager read

7. **`infrastructure/iam/fargate-task-role.tf`**  
   - Role: `prometheus-{env}-fargate-task-role`
   - Trusted entity: ecs-tasks.amazonaws.com
   - Inline policy:
     - SQS: ReceiveMessage, DeleteMessage, ChangeMessageVisibility on queue ARN
     - S3: PutObject on `arn:aws:s3:::prometheus-{env}-artifacts-{account}/user-artifacts/*`
     - Bedrock: InvokeModel on specific model ARN
     - DSQL: WriteRecords on tasks table
     - CloudWatch Logs: PutLogEvents on `/ecs/prometheus-llm-processor`
     - WebSocket API: POST to connections endpoint (execute-api invoke)

8. **`infrastructure/monitoring/cloudwatch-dashboard.tf`**  
   - Dashboard: `Prometheus-LLM-Processing`
   - Widgets:
     - SQS queue depth (ApproximateNumberOfMessagesVisible)
     - Task count (ECS service running task count)
     - Task duration (custom metric from application, p50/p95/p99)
     - Task success rate (completed / total)
     - DLQ depth
     - Fargate cost estimate (vCPU-hours × running tasks)
     - LLM API latency

9. **`infrastructure/monitoring/alarms.tf`**  
   - Alarm: DLQ depth >0 for 5 minutes → SNS topic
   - Alarm: Task failure rate >1% for 10 minutes → SNS topic
   - Alarm: Queue depth >50 for 15 minutes → SNS topic (capacity warning)
   - Alarm: Task duration p99 >25 minutes for 5 minutes → SNS topic (approaching timeout)

**Application Code (Fargate Container):**

10. **`backend/workers/fargate-task-processor/Dockerfile`**
    ```dockerfile
    FROM node:20-alpine
    WORKDIR /app
    COPY package*.json ./
    RUN npm ci --only=production
    COPY . .
    RUN addgroup -g 1001 -S appuser && adduser -S -u 1001 -G appuser appuser
    USER appuser
    HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 
      CMD node healthcheck.js
    CMD ["node", "index.js"]
    ```

11. **`backend/workers/fargate-task-processor/package.json`**  
    - Dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-apigatewaymanagementapi`, `uuid`, `winston`

12. **`backend/workers/fargate-task-processor/index.js`**  
    - Main loop: poll SQS with long polling (WaitTimeSeconds=20)
    - On message received: validate schema, extract correlationId, route to handler based on operationType
    - Timeout monitor: spawn worker thread, check elapsed time every 30 seconds, force-exit at 28 minutes
    - Error handling: catch all exceptions, log with correlation ID, do NOT delete message on failure
    - Graceful shutdown: on SIGTERM, finish current message processing, then exit

13. **`backend/workers/fargate-task-processor/handlers/artifact-generation.js`**  
    - Idempotency check: query DSQL for taskId status (if completed, skip processing)
    - Update DSQL: status=in_progress, startedAt=now
    - Invoke Bedrock: Claude 3 Sonnet with streaming enabled
    - Progress tracking: emit WebSocket event every 25% completion
    - On success: write artifact to S3 with Content-Type: text/markdown, update DSQL (status=completed, artifactUrl, completedAt), publish WebSocket event, delete SQS message
    - On failure: log error, update DSQL (status=failed, errorMessage), publish WebSocket event, do NOT delete message

14. **`backend/workers/fargate-task-processor/handlers/chat-processing.js`**  
    - Similar structure to artifact-generation.js
    - Handles multi-turn conversation context
    - Stores intermediate state in DSQL for resumability

15. **`backend/workers/fargate-task-processor/lib/sqs-client.js`**  
    - Wrapper: ReceiveMessage with long polling
    - DeleteMessage with retry logic (exponential backoff 3 attempts)
    - ChangeMessageVisibility for extending timeout during long processing

16. **`backend/workers/fargate-task-processor/lib/llm-client.js`**  
    - Bedrock InvokeModelWithResponseStream wrapper
    - Token streaming with chunk accumulation
    - Error handling: distinguish 429 (rate limit) from 500 (service error) from 400 (invalid request)
    - Retry logic: exponential backoff for 429 and 500, no retry for 400

17. **`backend/workers/fargate-task-processor/lib/websocket-notifier.js`**  
    - API Gateway Management API PostToConnection wrapper
    - Retry logic: 3 attempts with exponential backoff
    - Error handling: if connection gone (410), log and continue (client will poll status endpoint)
    - Structured event format: `{ event, taskId, timestamp, data }`

18. **`backend/workers/fargate-task-processor/lib/storage-client.js`**  
    - S3 PutObject with server-side encryption
    - DSQL WriteRecords with retry logic
    - Transaction simulation: write DSQL first, then S3 (fail-early pattern)

19. **`backend/workers/fargate-task-processor/lib/logger.js`**  
    - Winston structured logging to CloudWatch
    - Correlation ID in all log entries
    - Sanitization: remove secrets, API keys, PII from payloads
    - Levels: INFO (task started/completed), WARN (retry attempt), ERROR (failure)

20. **`backend/workers/fargate-task-processor/healthcheck.js`**  
    - Checks: SQS connection reachable, memory usage <90%, uptime <29 minutes
    - Exit code 0 if healthy, 1 if unhealthy (ECS restarts container)

**Lambda Handler Modifications:**

21. **`backend/handlers/artifact-generation-enqueue.js`** (new file)  
    - Validate JWT (extract userId from token)
    - Validate request body: intentId, promptTemplate, modelConfig
    - Generate correlationId (uuid v4)
    - Check feature flag: `process.env.ENABLE_FARGATE_PROCESSING`
    - If flag=true: construct SQS message, send to queue, return 202 Accepted with `{ status: "accepted", taskId: correlationId, statusUrl: "/api/tasks/{correlationId}/status" }`
    - If flag=false: invoke existing synchronous handler (backward compatibility)
    - Error handling: if SQS send fails, return 503 Service Unavailable

22. **`backend/handlers/chat-enqueue.js`** (new file)  
    - Similar structure to artifact-generation-enqueue.js
    - Handles conversation context in payload

23. **`backend/handlers/task-status.js`** (new file)  
    - GET /api/tasks/{taskId}/status
    - Query DSQL for task record
    - Return `{ taskId, status: "queued" | "in_progress" | "completed" | "failed", createdAt, completedAt?, artifactUrl?, errorMessage? }`
    - If not found: return 404

**Database Schema (DSQL assumed):**

24. **`backend/database/migrations/001_create_tasks_table.sql`**  
    - Table: tasks
    - Columns: taskId (PK), userId, projectId, intentId, operationType, status, enqueuedAt, startedAt, completedAt, artifactUrl, errorMessage, metadata (JSONB)
    - Indexes: (userId, status), (enqueuedAt), (status, startedAt)

**CI/CD:**

25. **`.github/workflows/build-fargate-container.yml`** (or equivalent)  
    - On push to main: build Docker image, tag with commit SHA, push to ECR
    - Update ECS task definition with new image
    - Force ECS service deployment (rolling update)

### Files to Modify

26. **`infrastructure/api-gateway/routes.tf`** (assumed to exist)  
    - Add routes: POST /api/generate-artifact → Lambda artifact-generation-enqueue
    - Add route: POST /api/chat → Lambda chat-enqueue
    - Add route: GET /api/tasks/{taskId}/status → Lambda task-status
    - CORS configuration: OPTIONS preflight for new routes

27. **`backend/api/properties/search.js`** (current sample file)  
    - No modification required — this is unrelated sample code
    - Will be replaced/removed as Prometheus V1 platform is built out

### Approach

**Phase 1: Infrastructure Foundation (Orbit 1, Days 1-2)**
- Deploy SQS queue, DLQ, IAM roles
- Deploy ECS cluster and task definition (dummy container initially)
- Deploy CloudWatch dashboard and alarms
- Validate IAM permissions with AWS IAM Policy Simulator

**Phase 2: Container Development (Orbit 1, Days 3-5)**
- Implement Fargate processor application (handlers, lib modules)
- Write unit tests for handlers (mocked SQS, Bedrock, S3)
- Build Docker image, push to ECR
- Deploy to ECS with desired count=1 for smoke testing
- Manual test: enqueue sample message, verify end-to-end flow

**Phase 3: Lambda Integration (Orbit 1, Days 6-7)**
- Implement enqueue handlers with feature flag
- Implement task status endpoint
- Deploy Lambda functions
- Integration test: API Gateway → Lambda → SQS → Fargate → WebSocket
- Verify idempotency: send duplicate taskId, confirm no double-processing

**Phase 4: Observability & Rollout (Orbit 1, Days 8-10)**
- Validate CloudWatch metrics populate correctly
- Test alarms: manually trigger DLQ depth, task failure scenarios
- Enable feature flag for 10% of requests (load balancer routing or user cohort)
- Monitor for 48 hours: compare Lambda timeout rate (should drop to zero) vs. Fargate task success rate
- If success rate ≥99.5% and p95 latency <500ms: scale to 100%
- If issues detected: disable feature flag (instant rollback), investigate

### Order of Operations

1. Deploy infrastructure (SQS, ECS, IAM)
2. Build and deploy Fargate container with dummy handler (health check only)
3. Verify ECS service launches task successfully, scales to zero after idle
4. Implement full Fargate processor logic
5. Deploy Lambda enqueue handlers with feature flag=false
6. Enable feature flag=true for manual test traffic
7. End-to-end integration test
8. Gradual rollout: 10% → 50% → 100%

### Dependencies

**Must Exist Before Execution:**
- WebSocket API with connection management (assumed operational)
- S3 bucket: `prometheus-{env}-artifacts-{account}` with lifecycle policies
- DSQL database with network connectivity from Fargate VPC
- Bedrock model access (Claude 3 Sonnet) with sufficient quota
- Secrets Manager: LLM API keys (if using external provider) or Bedrock credentials
- Private subnets in VPC with NAT Gateway for Fargate egress
- ECR repository for container images

**Must Be Completed During Execution:**
- DSQL table migration (tasks schema)
- API Gateway route updates
- Feature flag environment variable deployment

**External Coordination:**
- Frontend team: no changes required, but inform about new GET /api/tasks/{id}/status endpoint for polling fallback
- DevOps team: ECR repository provisioning, ECS cluster capacity planning
- Security team: review IAM policies, approve Fargate egress to LLM APIs

---

## Risk Surface

### Edge Cases

**1. SQS Message Visibility Timeout Expiration During Processing**  
- **Scenario:** Task processes for 25 minutes, visibility timeout expires at 30 minutes, message becomes visible again, second task picks it up
- **Mitigation:** Task monitors elapsed time, extends visibility timeout every 5 minutes using ChangeMessageVisibility (up to 12-hour maximum). Application-level timeout at 28 minutes prevents reaching the 30-minute window.
- **Test:** Simulate slow LLM API (inject delay), verify visibility extension calls logged, confirm no duplicate processing

**2. Fargate Task Crashes Mid-Processing**  
- **Scenario:** Task invokes LLM, receives partial response, container crashes (OOM, segfault), message not deleted
- **Mitigation:** SQS visibility timeout causes message to reappear. Next task performs idempotency check: if DSQL status=in_progress and startedAt >30 minutes ago, assume crash, restart processing. If <30 minutes, skip (likely still processing).
- **Test:** Manually kill ECS task during LLM invocation, verify message reappears, second task completes successfully

**3. WebSocket Connection Lost Before Completion Event**  
- **Scenario:** Client's WebSocket disconnects, task completes, event published to gone connection (410 error)
- **Mitigation:** Fargate task logs 410 but continues (does not fail task). Client polls GET /api/tasks/{id}/status every 5 seconds as fallback. Frontend implements this pattern: on WebSocket disconnect, switch to polling, on reconnect, resume WebSocket.
- **Test:** Disconnect WebSocket mid-task, verify task completes, client retrieves result via status endpoint

**4. Concurrent Duplicate Message Processing**  
- **Scenario:** SQS eventually consistent behavior causes message to appear in two concurrent ReceiveMessage calls
- **Mitigation:** Idempotency check with row-level locking in DSQL: UPDATE tasks SET status='in_progress' WHERE taskId=? AND status='queued'. If affected rows=0, another task already claimed it, skip processing.
- **Test:** Manually create duplicate SQS messages with same taskId, verify only one task processes, other logs "skipped duplicate"

**5. LLM API Returns Partial Response Then Errors**  
- **Scenario:** Bedrock streams 3000 tokens, then 500 internal server error, partial artifact exists
- **Mitigation:** Task logs error, does NOT write partial artifact to S3, updates DSQL status=failed. Client sees WebSocket event "task_failed". User can retry (re-submit intent). Message not deleted, SQS retry mechanism activates.
- **Test:** Mock Bedrock client to fail after N tokens, verify S3 not written, DSQL updated correctly

### Potential Regressions

**1. Lambda-Based Artifact Retrieval Performance**  
- **Impact:** Existing GET /api/artifacts/{id} endpoint currently retrieves from S3. If S3 bucket suddenly experiences high write traffic from Fargate, could affect read latency.
- **Mitigation:** S3 scales automatically, but monitor p95 latency on GET requests. If degradation observed (>1s), implement S3 Transfer Acceleration or CloudFront distribution.
- **Test:** Load test: 100 concurrent Fargate writes + 100 concurrent Lambda reads, verify read latency remains <500ms

**2. DSQL Write Contention**  
- **Impact:** Current system writes to DSQL during synchronous Lambda execution. Adding Fargate writes (task status updates) increases total write throughput.
- **Mitigation:** DSQL auto-scales, but partition key design matters. tasks table uses taskId as PK (high cardinality, evenly distributed). Add composite index (userId, status) to support status queries without full table scan.
- **Test:** Stress test: 50 concurrent Fargate tasks updating status, verify no throttling errors in CloudWatch Logs

**3. WebSocket Connection Table Size**  
- **Impact:** Existing WebSocket API tracks active connections in DynamoDB. If connection lifetime increases (users keep tabs open waiting for task completion), table size grows.
- **Mitigation:** Implement connection TTL: Lambda disconnect handler (on WebSocket disconnect) immediately deletes DynamoDB record. Add Time-To-Live attribute (expire after 1 hour of inactivity).
- **Test:** Monitor DynamoDB connection table size, verify cleanup occurs

### Security Considerations

**1. SQS Message Payload Contains Sensitive Data**  
- **Risk:** If promptTemplate includes PII or proprietary information, messages at rest in SQS expose this data.
- **Mitigation:** SQS encryption at rest (constraint requirement met). Additionally, consider encrypting sensitive fields in payload before enqueue (application-level encryption with KMS Data Key). Fargate task decrypts on processing.
- **Validation:** Audit SQS bucket policy, confirm encryption enabled, no unencrypted logging of payloads

**2. Fargate Task IAM Role Over-Permissioned**  
- **Risk:** Task role has write access to entire S3 bucket, could write to unauthorized prefixes.
- **Mitigation:** IAM policy restricts PutObject to `user-artifacts/${userId}/*` prefix. Task extracts userId from SQS message (validated by Lambda during enqueue). Fargate constructs S3 key with userId prefix: `s3://bucket/user-artifacts/{userId}/{intentId}/{taskId}.md`.
- **Validation:** Attempt to write to root prefix or other user's prefix, verify Access Denied error

**3. LLM API Credentials Exposed in Logs**  
- **Risk:** Bedrock API calls log request/response, which might include API keys or sensitive prompts.
- **Mitigation:** Logger sanitization (logger.js): regex pattern removes AWS access keys, bearer tokens, specific field names (`apiKey`, `password`). Bedrock SDK configured with environment variable `AWS_SDK_LOG_LEVEL=info` (no debug logging).
- **Validation:** Review CloudWatch Logs after processing, grep for "ey" (JWT prefix), "AKIA" (AWS key prefix), confirm zero matches

**4. SQS Queue Policy Allows Unauthorized Enqueue**  
- **Risk:** If queue policy is misconfigured, external actor could submit malicious tasks.
- **Mitigation:** SQS queue policy: `Action: sqs:SendMessage` restricted to `Principal: { AWS: arn:aws:iam::{account}:role/prometheus-lambda-enqueue-role }`. No wildcard principals. API Gateway rate limiting (1000 req/min per IP) prevents abuse.
- **Validation:** Attempt to send message from different IAM role, verify Access Denied

### Performance Implications

**1. Fargate Cold Start Adds 60s Latency to First Task**  
- **Measured Impact:** Acceptance criteria allows 60s for first task launch. Users with feature flag enabled during off-hours (no active tasks) experience this delay.
- **Mitigation:** Pre-warm: ECS Service minimum count=1 during business hours (9am-6pm UTC), count=0 off-hours. CloudWatch Events rule triggers Lambda to scale service up at 8:55am daily.
- **User-Facing:** WebSocket event immediately after enqueue: `{ event: "task_queued", message: "Processing starting, this may take a moment..." }`. Set user expectation.

**2. SQS Long Polling Reduces Message Pickup Latency**  
- **Benefit:** WaitTimeSeconds=20 eliminates empty receive calls. Message arrives, SQS holds connection, immediately delivers to waiting ReceiveMessage call.
- **Trade-off:** If no tasks are polling (ECS service scaled to zero), first message waits for ECS to launch task (~60s) before pickup. Acceptable per acceptance criteria.
- **Validation:** Enqueue message with zero active tasks, measure time-to-pickup (CloudWatch metric: QueueMessageTimestamp - MessageSentTimestamp)

**3. LLM Token Streaming Improves Perceived Performance**  
- **Benefit:** Task streams tokens from Bedrock, publishes WebSocket event every 1000 tokens with partial progress (`{ progress: 0.4, message: "Generated 2 of 4 sections..." }`). Users see activity, perceive task as progressing.
- **Cost:** WebSocket events add ~10-20ms per event. Acceptable overhead.

**4. S3 Write Latency at p99**  
- **Measured:** S3 PutObject typically <100ms at p50, <500ms at p99. Artifact size varies (1KB - 5MB markdown).
- **Mitigation:** If p99 >1s observed (CloudWatch metric), enable S3 Transfer Acceleration. Cost: +$0.04/GB, justified by improved user experience.

---

## Scope Estimate

### Complexity Assessment

**Overall Complexity: Medium-High**

**Justification:**  
- **Medium Complexity Components:**
  - SQS integration (well-understood AWS service)
  - Docker containerization (standard Node.js app)
  - IAM role configuration (clear permissions model)
  - Lambda enqueue handler (straightforward proxy pattern)

- **High Complexity Components:**
  - Distributed idempotency guarantees across SQS/DSQL/S3 (requires careful transaction ordering)
  - Fargate task timeout management (application-level monitoring + ECS stopTimeout coordination)
  - WebSocket event publishing with retry logic (stateful connection handling)
  - Multi-phase rollout with feature flag (requires parallel Lambda handlers, A/B testing)

- **Complexity Drivers:**
  - No existing async task pattern in codebase (greenfield architectural introduction)
  - Failure modes span 5 services (Lambda, SQS, Fargate, S3, DSQL) — requires comprehensive error handling
  - Performance acceptance criteria are strict (10s queue pickup, 99.5% success rate)

### Estimated Orbit Breakdown

**Single Orbit: 10 working days**

This orbit is intentionally scoped as a single unit because infrastructure and application code are tightly coupled — ECS task definition references the container image, IAM roles are used by both Lambda and Fargate, observability spans all components. Splitting into sub-orbits would create artificial boundaries.

**Work Phases within Orbit:**

| Phase | Duration | Deliverables | Dependencies |
|-------|----------|-------------|--------------|
| **Infrastructure Provisioning** | 2 days | SQS/DLQ, ECS cluster, task definition, IAM roles deployed to staging environment | None (start immediately) |
| **Container Development** | 3 days | Fargate processor application with handlers, libs, tests, Dockerfile | Infrastructure provisioned |
| **Lambda Integration** | 2 days | Enqueue handlers, status endpoint, feature flag implementation | Container deployed to ECR |
| **Observability & Testing** | 2 days | CloudWatch dashboard, alarms, integration tests, idempotency validation | Full stack deployed |
| **Rollout & Monitoring** | 1 day | Feature flag enabled 10% → 100%, production monitoring, rollback readiness | All tests passing |

### File Count Summary

| Category | Create | Modify | Total |
|----------|--------|--------|-------|
| Infrastructure (Terraform) | 9 files | 1 file | 10 |
| Application (Fargate) | 10 files | 0 | 10 |
| Application (Lambda) | 3 files | 0 | 3 |
| Database | 1 migration | 0 | 1 |
| CI/CD | 1 workflow | 0 | 1 |
| **Total** | **24 files** | **1 file** | **25 files** |

### Test Coverage Plan

**Unit Tests (Jest):**
- Fargate handlers: 15 test cases (success, LLM timeout, invalid payload, idempotency skip, etc.)
- Lib modules: 10 test cases (SQS client retry, logger sanitization, WebSocket 410 handling)
- Lambda handlers: 8 test cases (feature flag toggle, SQS send failure, JWT validation)

**Integration Tests (Testcontainers + LocalStack):**
- End-to-end: Lambda → SQS → Fargate → S3 → DSQL → WebSocket (5 scenarios)
- Failure paths: DLQ routing, task crash recovery (3 scenarios)

**Load Tests (k6):**
- 100 concurrent tasks, verify queue depth, task duration, success rate
- Ramp-up: 0 → 50 tasks over 5 minutes, monitor ECS auto-scaling

**Total Estimated Test Cases:** 41

### Risk Mitigation Effort

**High-Risk Items Requiring Extra Effort:**
- Idempotency validation: 1 day of testing (duplicate messages, concurrent processing, crash recovery)
- Rollback mechanism: 0.5 days (feature flag implementation, smoke test both code paths)
- Security audit: 0.5 days (IAM policy validation, payload encryption verification)

**Total Additional Effort:** 2 days (included in 10-day estimate)

### Success Criteria for Orbit Completion

| Criterion | Verification Method |
|-----------|---------------------|
| Zero Lambda timeout errors | CloudWatch Logs query: filter "Task timed out" on artifact/chat Lambda functions, count=0 over 48 hours |
| ≥99.5% task success rate | CloudWatch metric: (Fargate tasks status=completed) / (total tasks) ≥ 0.995 over 48 hours |
| Queue pickup <10s | CloudWatch metric: SQS MessageAge p95 <10,000 ms |
| Feature flag rollback works | Manual test: disable flag, submit request, verify synchronous Lambda execution (not SQS) |
| DLQ alarm triggers | Manual test: enqueue invalid message, verify 3 retries, DLQ placement, SNS alert received |

---

## Human Modifications

**Status:** Pending human review

This section will be populated during the proposal review phase. Expected modifications:
- IAM policy scope refinement (if DSQL permission syntax is incorrect)
- Fargate task CPU/memory allocation (if cost analysis suggests smaller instance)
- Feature flag rollout percentages (if gradual rollout strategy differs)
- SQS visibility timeout tuning (if 30 minutes is too aggressive/conservative)
- CloudWatch alarm threshold adjustments (if baseline metrics suggest different values)

Human reviewer: Please annotate changes directly in this section with format:
```
- Field: [section.subsection]
- Original: [what AI proposed]
- Modified: [your change]
- Reason: [why you changed it]
```