# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Context Package:** CTX-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

When users request artifact generation or engage in extended AI chat conversations, the system currently blocks the HTTP request until the LLM completes, causing failures for operations that exceed Lambda's 15-minute timeout. This intent establishes an asynchronous processing model where Lambda immediately accepts the request and hands off the long-running LLM work to Fargate, allowing operations to complete within 30 minutes while users receive progress updates via WebSocket connections. The transformation decouples the HTTP lifecycle from the AI processing lifecycle, enabling the system to handle complex artifacts and extended conversations that Lambda cannot support, while maintaining backward-compatible API contracts so the frontend requires no breaking changes.

The critical outcome is reliability: artifact generation and chat operations that currently fail after 15 minutes will succeed within 30 minutes for 95% of requests, with users receiving real-time completion notifications rather than encountering timeout errors.

---

## Implementation Plan

### Files to Create

#### Fargate Task Application

- `src/fargate/task-processor/main.ts`  
  Entry point for Fargate task. Polls SQS with long polling (20-second wait), dispatches messages to command handlers, manages graceful shutdown on SIGTERM, implements CloudWatch structured logging.

- `src/fargate/task-processor/handlers/artifact-generation.ts`  
  Extracted artifact generation logic. Invokes Bedrock streaming API, writes markdown artifacts to S3, updates DSQL metadata, handles timeout cleanup, implements idempotency checks.

- `src/fargate/task-processor/handlers/ai-chat.ts`  
  Extracted AI chat logic. Invokes Bedrock streaming API for multi-turn conversations, writes messages to DSQL `chat_messages` table, handles conversation context window management.

- `src/fargate/task-processor/lib/sqs-poller.ts`  
  SQS polling wrapper with long polling configuration, message visibility timeout management, automatic message deletion on success, DLQ movement on terminal failures.

- `src/fargate/task-processor/lib/task-executor.ts`  
  Command pattern dispatcher that routes SQS messages to appropriate handlers based on `command` field, tracks task lifecycle state, emits CloudWatch metrics.

- `src/fargate/task-processor/lib/signal-handler.ts`  
  Registers SIGTERM handler for graceful shutdown. On signal receipt: marks in-flight tasks as `timeout` in DSQL, returns messages to queue, sends failure notifications via WebSocket, exits cleanly.

- `src/fargate/task-processor/lib/bedrock-streaming.ts`  
  Bedrock API client wrapper with streaming support. Reuses patterns from existing `src/shared/lib/bedrock-client.ts` but replaces API Gateway response streaming with S3/DSQL writes. Implements exponential backoff for throttling.

- `src/fargate/task-processor/lib/s3-writer.ts`  
  S3 artifact persistence with atomic writes. Uploads artifacts to `s3://prometheus-v1-artifacts/{userId}/{intentId}/{artifactId}.md`, captures ETag for integrity verification, generates presigned URLs with 1-hour expiry.

- `src/fargate/task-processor/lib/dsql-writer.ts`  
  Aurora DSQL client with connection pooling (`pg-pool` with max 5 connections per task). Writes artifact metadata and chat messages, implements idempotency checks via dedupe ID, validates S3 integrity before finalizing.

- `src/fargate/task-processor/lib/websocket-notifier.ts`  
  Client for invoking WebSocket notification Lambda. Constructs notification payload with task ID, artifact URL or chat message ID, handles missing connection IDs gracefully (info-level log, not task failure).

- `src/fargate/task-processor/lib/cloudwatch-metrics.ts`  
  Custom CloudWatch metrics emitter. Tracks Bedrock token counts, task duration, error rates, cost per task. Reuses structured logging patterns from `src/shared/lib/logger.ts`.

- `src/fargate/task-processor/Dockerfile`  
  Multi-stage Node.js 20 Alpine build. Follows pattern from orbit T6-001 container build pipeline. Includes healthcheck endpoint at `/health`, optimizes layer caching, minimizes image size.

- `src/fargate/task-processor/package.json`  
  Dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-bedrock-runtime`, `pg`, `pg-pool`. DevDependencies: `@types/node`, `typescript`, `vitest`.

- `src/fargate/task-processor/tsconfig.json`  
  TypeScript configuration matching existing project standards (strict mode, ES2022 target, Node16 module resolution).

#### Infrastructure as Code

- `infrastructure/terraform/sqs-task-queue.tf`  
  SQS FIFO queue with content-based deduplication enabled, message retention 7 days, visibility timeout 35 minutes (5-minute buffer beyond task timeout), dead-letter queue after 2 receive attempts.

- `infrastructure/terraform/sqs-task-dlq.tf`  
  Dead-letter queue for failed tasks. Retention 14 days for post-mortem analysis, CloudWatch alarm triggers when message count >0.

- `infrastructure/terraform/ecs-cluster.tf`  
  ECS Fargate cluster with CloudWatch Container Insights enabled, capacity providers for Fargate and Fargate Spot (70/30 split for cost optimization).

- `infrastructure/terraform/ecs-task-definition.tf`  
  Task definition with 2 vCPU, 4 GB memory, 30-minute stop timeout, environment variables for SQS queue URL, S3 bucket, DSQL endpoint, WebSocket Lambda ARN. Healthcheck command: `curl -f http://localhost:3000/health`.

- `infrastructure/terraform/ecs-service.tf`  
  ECS service with auto-scaling policy (min 1, max 10 tasks), target tracking on SQS `ApproximateNumberOfMessagesVisible` metric (target: 2 messages per task), deployment configuration with rolling updates.

- `infrastructure/terraform/iam-fargate-task-role.tf`  
  IAM role for Fargate task with scoped permissions: `s3:PutObject` on `prometheus-v1-artifacts/*`, `rds-data:ExecuteStatement` on Aurora DSQL with resource condition for `artifacts` and `chat_messages` tables only, `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` on task queue, `bedrock:InvokeModelWithResponseStream` for Claude 3.5 Sonnet, `lambda:InvokeFunction` on WebSocket notification Lambda.

- `infrastructure/terraform/iam-fargate-execution-role.tf`  
  IAM execution role for ECS task definition with `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:CreateLogStream`, `logs:PutLogEvents`.

- `infrastructure/terraform/cloudwatch-log-group.tf`  
  Log group `/ecs/prometheus-v1/task-processor` with 30-day retention, JSON log format parsing enabled for structured logging.

- `infrastructure/terraform/cloudwatch-alarms-fargate.tf`  
  Alarms for: queue depth >50 for 5 minutes (PagerDuty high priority), task failure rate >5% over 10 minutes (PagerDuty low priority), average task duration >25 minutes (warning, no page), Bedrock throttle rate >10% (quota increase request).

- `infrastructure/terraform/ecr-task-processor.tf`  
  ECR repository `prometheus-v1/task-processor` with lifecycle policy (keep last 10 images, delete untagged after 7 days), image scanning on push enabled.

#### CI/CD Pipeline

- `.github/workflows/deploy-task-processor.yml`  
  GitHub Actions workflow for building and deploying Fargate task image. Stages: build Docker image, push to ECR, update ECS task definition with new image tag, deploy with zero-downtime rolling update, run smoke tests.

#### Tests

- `src/fargate/task-processor/__tests__/handlers/artifact-generation.test.ts`  
  Unit tests for artifact generation handler. Scenarios: successful generation, Bedrock throttling with retry, S3 write failure, timeout cleanup, idempotency (duplicate message), invalid request payload (terminal error).

- `src/fargate/task-processor/__tests__/handlers/ai-chat.test.ts`  
  Unit tests for AI chat handler. Scenarios: single-turn chat, multi-turn with context, conversation exceeds token limit, DSQL write failure with rollback.

- `src/fargate/task-processor/__tests__/integration/sqs-to-s3.test.ts`  
  Integration test with localstack. End-to-end flow: enqueue message → task polls → processes → writes S3 → writes DSQL → deletes message. Validates no orphaned messages or partial writes.

- `src/fargate/task-processor/__tests__/integration/timeout-handling.test.ts`  
  Integration test that sends SIGTERM to running task. Validates graceful shutdown: message returned to queue, DSQL marked timeout, WebSocket failure notification sent.

### Files to Modify

- `src/lambda/artifact-generation/handler.ts`  
  **Change:** Replace direct Bedrock invocation with SQS message enqueue.  
  **What:** Extract payload validation, write pending record to DSQL with status `pending`, construct SQS message with dedupe ID, enqueue to task queue, return HTTP 202 with task ID and polling URL.  
  **Why:** Decouple HTTP request from LLM processing. Lambda becomes thin orchestrator, Fargate becomes worker.

- `src/lambda/ai-chat/handler.ts`  
  **Change:** Replace direct Bedrock invocation with SQS message enqueue.  
  **What:** Extract conversation context retrieval from DSQL, construct SQS message with full conversation history, enqueue to task queue, return HTTP 202 with task ID.  
  **Why:** Same decoupling as artifact generation. Long conversations no longer blocked by Lambda timeout.

- `infrastructure/terraform/lambda-artifact-generation.tf`  
  **Change:** Add SQS queue URL environment variable, grant `sqs:SendMessage` permission to Lambda execution role.  
  **What:** Inject `TASK_QUEUE_URL` environment variable, update IAM policy with SQS send permission scoped to task queue ARN.  
  **Why:** Lambda needs queue endpoint and permission to enqueue messages.

- `infrastructure/terraform/lambda-ai-chat.tf`  
  **Change:** Add SQS queue URL environment variable, grant `sqs:SendMessage` permission to Lambda execution role.  
  **What:** Same as artifact generation Lambda — inject queue URL, update IAM policy.  
  **Why:** Both Lambda functions follow same enqueue pattern.

- `infrastructure/terraform/s3-artifacts-bucket.tf`  
  **Change:** Grant Fargate task role `s3:PutObject` permission.  
  **What:** Add bucket policy statement allowing `s3:PutObject` from Fargate task role ARN, restrict to `prometheus-v1-artifacts/*` prefix only.  
  **Why:** Fargate tasks write artifacts to S3, bucket policy must authorize this access.

- `infrastructure/terraform/dsql-iam-policies.tf`  
  **Change:** Grant Fargate task role `rds-data:ExecuteStatement` permission with resource condition.  
  **What:** Add IAM policy statement for Aurora DSQL Data API, condition restricts to `artifacts` and `chat_messages` tables only (prevents lateral movement to other tables).  
  **Why:** Fargate tasks write to DSQL, IAM must authorize with least privilege.

- `src/shared/types/task-message.ts`  
  **Change:** Create new shared type for SQS message schema.  
  **What:** Define `FargateTaskMessage` interface with fields: `taskId`, `command`, `userId`, `requestPayload`, `websocketConnectionId`, `createdAt`, `dedupeId`. Export for use by both Lambda and Fargate.  
  **Why:** Shared type ensures consistent message structure, prevents schema drift between producer (Lambda) and consumer (Fargate).

### Approach

This implementation follows a **command-based asynchronous processing pattern** where Lambda functions become lightweight request validators and message producers, while Fargate tasks become durable workers that execute long-running operations outside the HTTP lifecycle.

The architectural strategy preserves existing HTTP contracts by changing only the response timing model — from synchronous (200 OK with artifact) to asynchronous (202 Accepted with task ID + polling). Clients receive immediate acknowledgment and can choose to wait via WebSocket notifications or poll a status endpoint. This maintains backward compatibility because the response schema and endpoints remain unchanged; only the timing shifts from immediate to eventual.

The Fargate task application is structured as a **single-responsibility worker** that does one thing: polls SQS, dispatches to handlers, cleans up on completion or failure. It does not expose HTTP endpoints (except healthcheck), does not maintain long-lived connections, and does not manage complex state machines. Each task processes one message at a time, making the concurrency model simple: more messages → scale up tasks, fewer messages → scale down tasks.

The implementation reuses proven patterns from prior orbits: Bedrock streaming client (T4-002), WebSocket notification (T5-004), container build pipeline (T6-001), DSQL connection pooling (T3-005). This reduces novelty risk and accelerates delivery by copying what already works.

### Order of Operations

**Phase 1: Infrastructure (Days 1–2)**
1. Create SQS task queue and DLQ in Terraform
2. Create ECS cluster, task definition, and service with auto-scaling
3. Create Fargate IAM roles with scoped permissions
4. Create ECR repository for task processor image
5. Update S3 bucket policy to grant Fargate write access
6. Update DSQL IAM policy to grant Fargate table access
7. Create CloudWatch log group and alarms
8. Apply Terraform plan after human review (Tier 2 requirement)

**Phase 2: Fargate Application (Days 3–5)**
1. Create task processor project structure and package.json
2. Implement SQS poller with long polling and visibility timeout management
3. Implement Bedrock streaming client extracted from Lambda code
4. Implement S3 writer with atomic uploads and ETag verification
5. Implement DSQL writer with connection pooling and idempotency
6. Implement WebSocket notifier client
7. Implement signal handler for graceful SIGTERM shutdown
8. Implement artifact generation handler with timeout cleanup
9. Implement AI chat handler with conversation context
10. Create Dockerfile following T6-001 container pattern
11. Build and push initial image to ECR manually for testing

**Phase 3: Lambda Modifications (Days 6–7)**
1. Update artifact generation Lambda to enqueue SQS messages
2. Update AI chat Lambda to enqueue SQS messages
3. Update Lambda Terraform to inject SQS queue URL and IAM permissions
4. Create shared task message type in `src/shared/types/`
5. Deploy Lambda changes to staging environment

**Phase 4: Testing (Days 8–10)**
1. Write unit tests for all Fargate handlers (coverage target: >90%)
2. Write integration tests for SQS → S3 → DSQL flow with localstack
3. Write integration test for SIGTERM timeout handling
4. Run load test with 100 concurrent artifact requests to validate auto-scaling
5. Monitor CloudWatch metrics during load test: queue depth, task duration, failure rate
6. Validate cost per task meets <$0.50 constraint for p95 workload
7. Verify WebSocket notifications arrive within 2 seconds of completion
8. Test fallback behavior: WebSocket connection expired, frontend polls status endpoint

**Phase 5: Deployment (Days 11–12)**
1. Deploy Fargate service to production with 1 minimum task
2. Enable auto-scaling policy
3. Cut over 10% of traffic to async flow (feature flag in Lambda)
4. Monitor CloudWatch alarms, queue depth, error rates for 24 hours
5. If metrics healthy, increase to 50% traffic
6. If metrics still healthy after 48 hours, cut over 100% traffic
7. Document baseline cost metrics for future cost tracking

### Dependencies

**Upstream (must exist before starting):**
- Orbit T6-001 completed: Container build pipeline and ECR repository pattern established
- Orbit T5-004 completed: WebSocket connection lifecycle and notification Lambda operational
- Orbit T4-002 completed: Bedrock integration with streaming support configured
- Orbit T3-005 completed: Aurora DSQL with connection pooling limits documented

**External:**
- AWS Fargate task quota: Verify current quota is ≥100 concurrent tasks (check via Service Quotas console)
- Bedrock API quota: Verify Claude 3.5 Sonnet TPM quota is ≥100k tokens per minute
- NAT Gateway: Verify existing NAT gateway has capacity for increased egress (Fargate → Bedrock API calls)

**Concurrent Work:**
- Frontend team adds polling fallback for `/artifacts/{artifactId}/status` endpoint (can deploy independently, required before full traffic cutover)

**Blockers:**
- None. All infrastructure and code dependencies exist from prior orbits.

---

## Risk Surface

### Edge Cases

**SQS Message Arrives After Task Timeout**  
If Fargate task timeout (30 minutes) is reached while processing is still in flight, ECS sends SIGTERM to the container. The signal handler has 30 seconds to clean up before SIGKILL. Edge case: cleanup takes longer than 30 seconds (e.g., large S3 upload in progress).  
**Mitigation:** Signal handler cancels in-flight Bedrock API calls immediately via AbortController, does not attempt S3 upload on timeout path, writes compact timeout record to DSQL (single INSERT, no transactions), sends WebSocket notification asynchronously without blocking. Total cleanup target: <10 seconds. Integration test validates this with artificial SIGTERM during large artifact generation.

**Duplicate SQS Message Due to Visibility Timeout Extension Failure**  
If Fargate task crashes after receiving message but before deleting it, and visibility timeout (35 minutes) expires, SQS returns the message to the queue. Another task receives it and processes it again, potentially creating duplicate artifacts.  
**Mitigation:** Every SQS message includes a dedupe ID (SHA-256 of user ID + request payload + timestamp rounded to minute). Before processing, task queries DSQL for existing artifact with matching dedupe ID. If found, skip processing and delete message. Idempotency check adds <50ms latency. Table-driven test validates duplicate message is safely skipped.

**WebSocket Connection Expires During Long-Running Task**  
Median artifact generation is 8 minutes, p95 is 25 minutes. WebSocket connections expire after 10 minutes of inactivity. By the time task completes, connection may be closed, notification fails.  
**Mitigation:** Fargate task gracefully handles missing connection ID (logs info-level event, continues). Notification failure is NOT task failure — artifact is still written to S3/DSQL. Frontend implements polling fallback: every 30 seconds, calls GET `/artifacts/{artifactId}/status` if WebSocket notification not received within expected time. This fallback is acceptable because the async model decouples delivery from generation. Acceptance test validates artifact retrievability even when WebSocket fails.

**Concurrent Message Processing Exhausts DSQL Connection Pool**  
Each Fargate task allocates 5 connections (via `pg-pool`). With 10 concurrent tasks, total connections = 50, which matches DSQL's connection limit. Edge case: 11th task starts before auto-scaling cooldown completes, attempts connection, pool exhausted, task fails.  
**Mitigation:** DSQL writer implements connection retry with exponential backoff (initial delay: 1s, max: 10s, max retries: 3). If connection fails after retries, task returns message to queue (transient failure, not DLQ). CloudWatch alarm triggers if DSQL connection count >45 for 5 minutes, alerting before hard limit. ECS service auto-scaling policy includes 60-second cooldown to prevent rapid over-provisioning.

**Bedrock API Returns Partial Stream Then Disconnects**  
During artifact generation, Bedrock streaming API may disconnect mid-stream (network blip, service degradation). Task has partial artifact content but cannot complete.  
**Mitigation:** Bedrock client wrapper tracks stream completion via `contentBlockDelta` events. On disconnect, if stream was incomplete (no final `contentBlockStop` event), treat as transient error and retry. Task MUST NOT write partial artifact to S3. Retry logic uses exponential backoff with jitter (base: 2s, max: 60s, max retries: 5). After 5 failures, move message to DLQ. Integration test with mocked Bedrock simulates disconnect to validate retry behavior.

**S3 Upload Succeeds But DSQL Write Fails**  
Artifact is written to S3 successfully (ETag captured), but subsequent DSQL INSERT fails (database connection lost, constraint violation, etc.). Task crashes. SQS message returns to queue. Second task receives message, checks for existing artifact, finds none in DSQL (because write failed), writes S3 again with different object key (includes random UUID), now two S3 objects exist for same task.  
**Mitigation:** S3 object key includes task ID (deterministic), not random UUID. If task reprocesses message, it overwrites the same S3 key (S3 PutObject is idempotent). DSQL write includes explicit transaction with rollback on failure. Integration test validates: force DSQL failure after S3 write, verify second attempt reuses same S3 key and successfully completes both writes.

### Regressions

**Existing Lambda Functions Lose Streaming Response**  
Current artifact generation Lambda streams Bedrock responses directly to client via API Gateway. Switching to async model removes streaming — client no longer sees real-time token generation, only receives completed artifact at the end.  
**Impact:** User experience degradation (no progress indicator during generation).  
**Mitigation:** Frontend implements loading state with estimated completion time (based on historical average). WebSocket notification includes task progress events (if implemented in future orbit). For initial deployment, accept this regression as acceptable trade-off for reliability (no timeouts). Document as known limitation in release notes.

**Lambda Response Time Increases Due to SQS Enqueue Overhead**  
Current Lambda invokes Bedrock directly (latency ~200ms to first token). New flow adds SQS SendMessage operation (~20-30ms) and DSQL INSERT for pending record (~10-15ms).  
**Impact:** HTTP response latency increases from ~200ms to ~250ms (25% slower).  
**Mitigation:** Acceptance criteria allows up to 500ms p95 for Lambda enqueue latency, so 250ms is within bounds. If this becomes a concern, optimize by parallelizing SQS send and DSQL write (both operations are independent, can use Promise.all). Load testing validates actual latency meets acceptance criteria.

**Increased DSQL Write Load from Pending Records**  
Current flow writes to DSQL only after artifact completes. New flow writes pending record immediately (Lambda), then updates to completed (Fargate). This doubles write operations per artifact.  
**Impact:** Increased DSQL write IOPS by 100%. If current load is 80% of DSQL write capacity, this could push to 160%, causing throttling.  
**Mitigation:** Query current DSQL write metrics from CloudWatch before deployment. If write IOPS >70% of provisioned capacity, provision additional write capacity before deploying. Monitor `WriteLatency` metric after deployment — if p95 latency increases by >50%, scale DSQL write capacity. This is an operational concern, not a code defect.

### Security Considerations

**Fargate Task IAM Role Over-Permissioned**  
If IAM policy uses wildcards (`s3:*` or `rds-data:*`), compromised Fargate task could read other users' artifacts, modify unrelated tables, or escalate privileges.  
**Mitigation:** IAM policy explicitly scopes every permission:
- `s3:PutObject` ONLY on `arn:aws:s3:::prometheus-v1-artifacts/*` (no GetObject, no DeleteObject, no ListBucket)
- `rds-data:ExecuteStatement` ONLY on Aurora DSQL cluster ARN with resource tag condition `{"TableName": ["artifacts", "chat_messages"]}` (restricts to specific tables)
- `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` ONLY on task queue ARN (not DLQ, not other queues)
- `bedrock:InvokeModelWithResponseStream` ONLY for model ID `anthropic.claude-3-5-sonnet-*` (not other models)
- `lambda:InvokeFunction` ONLY on WebSocket notification Lambda ARN (not other Lambdas)

Terraform plan output MUST be reviewed by human before apply (Tier 2 requirement). IAM policy review checklist:
- [ ] No wildcard resources
- [ ] No wildcard actions
- [ ] Resource conditions applied where possible
- [ ] Least privilege validated for each permission

**SQS Message Contains PII Without Encryption**  
Task messages include user ID, request payloads (which may contain artifact content or chat messages). If SQS message is intercepted (via compromised IAM credentials), attacker reads sensitive data.  
**Mitigation:** SQS queue is NOT public — only Lambda (producer) and Fargate (consumer) have IAM permissions to access. No direct internet access to SQS. For additional defense-in-depth, consider encrypting message payload with KMS before enqueue (future enhancement, not in this orbit's scope). For this orbit, rely on AWS IAM and VPC security groups. Document this as acceptable risk given controlled access.

**Bedrock API Credentials Exposed in Logs**  
If Bedrock client wrapper logs request details, AWS credentials or sensitive input prompts could appear in CloudWatch Logs.  
**Mitigation:** Structured logging pattern explicitly excludes sensitive fields. Log statements MUST NOT include:
- AWS credentials (automatically redacted by SDK, but verify in code review)
- Full Bedrock request payload (log only task ID, model ID, input token count)
- Full Bedrock response (log only output token count, not generated content)
- User ID in plain text (use hashed user ID for correlation)

Code review checklist enforces this. Integration test scans CloudWatch logs for regex patterns matching AWS credentials or common PII patterns (email, phone, SSN).

**Fargate Task Network Access Not Restricted**  
If Fargate task security group allows egress to 0.0.0.0/0, compromised task could exfiltrate data to attacker-controlled endpoint.  
**Mitigation:** Fargate task security group (`sg-prometheus-private`) allows egress ONLY to:
- Bedrock API endpoints (via VPC endpoint or NAT gateway to AWS service IP ranges)
- S3 VPC endpoint
- Aurora DSQL VPC endpoint
- SQS VPC endpoint

No direct internet egress. If Bedrock requires internet access (not VPC endpoint), NAT gateway is acceptable with AWS IP range restriction via network ACL. Verify security group rules in Terraform code review before apply.

### Performance Implications

**SQS Polling Introduces Latency Between Enqueue and Processing**  
Lambda enqueues message at T+0ms. Fargate task polls SQS every 20 seconds (long polling). In worst case, message waits 20 seconds before task receives it.  
**Impact:** Effective task processing time = SQS wait time + Bedrock processing time. For median 8-minute artifact, 20-second wait adds 4% latency. For p95 25-minute artifact, 20-second wait is negligible.  
**Mitigation:** Acceptable latency increase given reliability gain. Acceptance criteria allows up to 45 seconds for cold start to first LLM token, so 20-second SQS polling is within bounds. If this becomes a concern, reduce long polling wait time to 10 seconds (at cost of increased SQS API calls and potential throttling).

**Fargate Cold Start Delays Task Execution**  
When no tasks are running (auto-scaling minimum = 1, but task may crash or be terminated), new task takes 30-45 seconds to start (container pull, healthcheck, SQS connection).  
**Impact:** First message in queue waits for cold start. Users experience 30-45 second delay before processing begins. For subsequent messages, tasks are warm, no cold start.  
**Mitigation:** Acceptance criteria explicitly allows up to 45 seconds for cold start to first LLM token. To reduce cold start frequency, ECS service maintains minimum of 1 task running at all times (even when queue is empty). This costs ~$20/month for 24/7 task execution (2 vCPU, 4 GB at $0.04/hour), acceptable for improved user experience. CloudWatch metric tracks cold start frequency — if >10% of tasks experience cold start, increase minimum task count to 2.

**Connection Pool Contention Increases DSQL Latency**  
With 10 concurrent Fargate tasks, each allocating 5 connections, total DSQL connections = 50 (at limit). Connection acquisition time increases as pool nears capacity.  
**Impact:** DSQL write operations slow from ~10ms (p50) to ~50ms (p95) under peak load. Task duration increases by ~40ms per write operation. For tasks with 5 writes (artifact metadata, 4 progress updates), total impact = ~200ms.  
**Mitigation:** Monitor `DatabaseConnections` CloudWatch metric. If connection count consistently >40, options: (1) reduce tasks' connection pool size (max: 3 per task instead of 5), (2) increase DSQL connection limit via quota request, (3) reduce concurrency (max tasks = 8 instead of 10). Load testing validates actual connection contention impact and informs tuning decisions.

**Bedrock API Throughput Shared Across Tasks**  
Bedrock token-per-minute (TPM) quota is regional, shared across all Fargate tasks. With 10 concurrent tasks generating artifacts, total TPM = 10 tasks × 10k TPM/task = 100k TPM, which matches quota.  
**Impact:** At peak concurrency, tasks compete for Bedrock quota. If quota exhausted, some tasks receive HTTP 429 throttling, retry with exponential backoff, extend task duration. In extreme case (11+ concurrent generations), tasks fail after 5 retries, move to DLQ.  
**Mitigation:** CloudWatch alarm triggers if Bedrock throttle rate >10% over 10 minutes. On alert, on-call engineer requests quota increase via AWS Support. Interim mitigation: reduce max task count from 10 to 8 (lowers concurrent Bedrock load). Proactive approach: request quota increase to 200k TPM before deployment.

**S3 Upload Bandwidth Constrained by NAT Gateway**  
Fargate tasks upload artifacts to S3 via NAT gateway (no S3 VPC endpoint for PutObject from Fargate). Large artifacts (5 MB markdown files) at 10 concurrent uploads = 50 MB/s egress through NAT gateway.  
**Impact:** If NAT gateway bandwidth limit (5 Gbps = 625 MB/s) is shared with other services, artifact uploads may experience throttling. However, 50 MB/s is only 8% of NAT gateway capacity, unlikely to bottleneck.  
**Mitigation:** Monitor NAT gateway `BytesOutToDestination` CloudWatch metric. If sustained >500 MB/s, consider provisioning S3 VPC endpoint for Fargate tasks (eliminates NAT gateway transit). For this orbit, NAT gateway is sufficient given low upload volume.

---

## Scope Estimate

### Orbit Count
**Primary Orbit (Current):** 1 orbit — complete infrastructure, Fargate application, Lambda modifications, testing, and staged deployment.

**Follow-On Orbits (Identified but Out of Scope):**
- Orbit 2: Implement WebSocket progress streaming (real-time token-by-token updates from Fargate to frontend)
- Orbit 3: Add batch processing mode (queue multiple artifacts for single user, process sequentially to reduce cost)
- Orbit 4: Implement cost optimization (use Fargate Spot for non-time-sensitive workloads, 70% cost reduction)

### Complexity Assessment
**Overall Complexity:** High

**Justification:**
- **Architectural Novelty:** First asynchronous processing workload in Prometheus V1. Introduces new patterns: SQS-based task queues, long-running Fargate workers, eventual consistency between Lambda and Fargate state.
- **Multi-Service Orchestration:** Requires coordination between 6 AWS services (Lambda, SQS, ECS Fargate, S3, Aurora DSQL, API Gateway WebSocket). Each service has distinct failure modes and retry semantics.
- **Concurrency Concerns:** Shared resources (DSQL connection pool, Bedrock API quota, NAT gateway bandwidth) create contention risks under peak load. Requires careful load testing and capacity planning.
- **Operational Unknowns:** First Fargate deployment — team has no baseline for cold start behavior, auto-scaling tuning, cost per task. High probability of post-deployment tuning orbit.
- **Regression Risk:** Changes existing user-facing APIs (artifact generation, AI chat). Switching from synchronous to asynchronous model changes user experience — requires careful testing and staged rollout.

**Complexity Breakdown by Work Stream:**
- Infrastructure provisioning: Medium (standard Terraform patterns from prior orbits, but 15 new resources)
- Fargate application: High (new codebase, complex error handling, graceful shutdown logic)
- Lambda modifications: Low (straightforward refactor — replace Bedrock call with SQS enqueue)
- Testing: High (integration tests require localstack for SQS/S3/DSQL, load testing needs production-like environment)
- Deployment: Medium (staged rollout with traffic shifting, requires monitoring and potential rollback)

### Work Phase Breakdown

**Phase 1: Infrastructure (2 days, 16 hours)**
- Terraform resources: 8 hours
- IAM policy review and approval: 2 hours
- Terraform apply and validation: 2 hours
- CloudWatch dashboard setup: 2 hours
- ECR repository and initial manual image push: 2 hours

**Phase 2: Fargate Application (3 days, 24 hours)**
- SQS poller and task executor: 4 hours
- Bedrock streaming client extraction: 3 hours
- S3 writer with ETag verification: 2 hours
- DSQL writer with connection pooling: 3 hours
- Artifact generation handler: 4 hours
- AI chat handler: 3 hours
- Signal handler for SIGTERM: 2 hours
- Dockerfile and build script: 2 hours
- CloudWatch metrics emitter: 1 hour

**Phase 3: Lambda Modifications (2 days, 16 hours)**
- Artifact generation Lambda refactor: 4 hours
- AI chat Lambda refactor: 3 hours
- Shared task message type: 1 hour
- Lambda Terraform updates: 2 hours
- Lambda unit tests: 4 hours
- Lambda deployment to staging: 2 hours

**Phase 4: Testing (3 days, 24 hours)**
- Unit tests (Fargate handlers): 8 hours
- Integration tests (SQS → S3 → DSQL): 6 hours
- Timeout handling test: 3 hours
- Load test setup (100 concurrent requests): 4 hours
- Load test execution and analysis: 3 hours

**Phase 5: Deployment (2 days, 16 hours)**
- Production deployment (1 task): 2 hours
- Traffic cutover 10%: 2 hours
- 24-hour monitoring: 4 hours (on-call)
- Traffic cutover 50%: 2 hours
- 48-hour monitoring: 4 hours (on-call)
- Traffic cutover 100%: 1 hour
- Baseline cost metrics documentation: 1 hour

**Total Estimated Effort:** 12 days (96 hours) for primary orbit

**Risk Buffer:** +3 days (24 hours) for unknown unknowns (Fargate cold start tuning, auto-scaling policy iteration, unexpected Bedrock throttling requiring quota increase wait time)

**Realistic Delivery:** 15 days (120 hours) from orbit start to 100% production traffic

### Test Coverage Plan

**Unit Tests (Target: >90% coverage):**
- All Fargate handlers: artifact generation (8 test cases), AI chat (6 test cases)
- SQS poller: message parsing, visibility timeout, DLQ movement (5 test cases)
- Bedrock client: streaming, retries, throttling (7 test cases)
- S3 writer: uploads, ETag verification, key generation (4 test cases)
- DSQL writer: connection pooling, idempotency, transactions (6 test cases)
- Signal handler: SIGTERM cleanup, timeout recording (3 test cases)

**Integration Tests (End-to-End with Localstack):**
- Happy path: SQS → Fargate → S3 + DSQL → WebSocket notification (1 test)
- Failure path: Bedrock throttle → retry → success (1 test)
- Failure path: S3 write failure → DSQL rollback (1 test)
- Failure path: SIGTERM timeout → graceful cleanup (1 test)
- Idempotency: duplicate message → skip processing (1 test)

**Load Tests (Production-Like Environment):**
- 100 concurrent artifact requests → queue depth, task scaling, cost per task (1 test)
- Sustained load (50 requests/minute for 1 hour) → connection pool stability, Bedrock throttling (1 test)

**Total Test Count:** 45 automated tests (unit + integration + load)

---

## Human Modifications

Pending human review. This section will be populated with any changes made during the Tier 2 authorization review process.