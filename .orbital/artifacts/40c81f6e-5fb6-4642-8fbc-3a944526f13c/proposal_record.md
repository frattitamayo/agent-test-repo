# Proposal Record: T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Context Package:** CTX-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

When users request artifact generation (Context Documents, Proposals, Execution Plans) or submit complex AI chat queries, the system currently fails because Lambda functions timeout after 29 seconds while Bedrock operations routinely take 45-120 seconds. This creates a broken user experience where users must stay on the page, receive no progress feedback, and often encounter 504 errors that leave orphaned work in the database.

The desired end state is a decoupled architecture where the API layer (Lambda) immediately acknowledges the request with HTTP 202 Accepted and hands off the actual LLM processing to a Fargate task that has no timeout constraints. The user receives real-time progress notifications via WebSocket, can close their browser, and returns later to find the completed artifact waiting in S3. The system scales LLM processing capacity independently from API request throughput — 20 concurrent Fargate tasks can process artifacts while the API layer handles 500+ req/sec.

Critical success criteria: No code changes required in frontend clients, all existing REST endpoints maintain identical contracts, and per-artifact costs stay under $0.50 (currently projecting $0.17 including Fargate + Bedrock).

---

## Implementation Plan

### Files to Create

**Infrastructure (Terraform):**
- `infrastructure/terraform/modules/sqs/main.tf` — Standard SQS queue `llm-processing-queue` with 6-minute visibility timeout, 12-hour message retention, and DLQ `llm-processing-dlq` with 3-message max receives
- `infrastructure/terraform/modules/sqs/outputs.tf` — Export `queue_arn`, `queue_url`, `dlq_arn` for consumption by ECS module
- `infrastructure/terraform/modules/ecs/cluster.tf` — ECS cluster `prometheus-llm-cluster` with CloudWatch Container Insights enabled
- `infrastructure/terraform/modules/ecs/task-definition.tf` — Task definition for `llm-processor` with 1 vCPU, 2GB memory, execution role for ECR pulls, task role for Bedrock/S3/DSQL/SQS access
- `infrastructure/terraform/modules/ecs/service.tf` — ECS service with desired count 0, auto-scaling policy triggered by SQS `ApproximateNumberOfMessagesVisible`, scaling range 0-20 tasks
- `infrastructure/terraform/modules/ecs/security-groups.tf` — Security group allowing egress to VPC endpoints (Bedrock, DSQL, S3, ECR), ingress rule added to VPC endpoint SGs to allow Fargate task SG
- `infrastructure/terraform/modules/ecs/iam.tf` — Task execution role (ECR pulls, CloudWatch logs) and task role (Bedrock, S3, DSQL, SQS, API Gateway Management API)

**Application (Fargate Task):**
- `infrastructure/lambda/workers/fargate-llm-processor/Dockerfile` — Multi-stage build from `node:20-alpine`, copies package.json + src/, installs production deps only, exposes no ports (polling-based)
- `infrastructure/lambda/workers/fargate-llm-processor/package.json` — Dependencies: `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-apigatewaymanagementapi`, `pg` for Aurora DSQL
- `infrastructure/lambda/workers/fargate-llm-processor/src/index.ts` — Main entrypoint: polls SQS with long-polling (20s wait), dispatches to handler based on `task_type`, deletes message on success, logs errors and exits on failure
- `infrastructure/lambda/workers/fargate-llm-processor/src/handlers/artifact-generator.ts` — Artifact generation logic extracted from Lambda, follows pattern: validate message → load context from DSQL → construct prompt → invoke Bedrock → upload to S3 → update DSQL → notify WebSocket
- `infrastructure/lambda/workers/fargate-llm-processor/src/handlers/chat-processor.ts` — Long-running chat completion handler (non-streaming variant for >29s responses)
- `infrastructure/lambda/workers/fargate-llm-processor/src/lib/bedrock-client.ts` — Copied from Lambda `infrastructure/lambda/api/lib/bedrock-client.ts`, adds exponential backoff retry logic for `ThrottlingException`
- `infrastructure/lambda/workers/fargate-llm-processor/src/lib/s3-storage.ts` — Copied from Lambda, reused as-is
- `infrastructure/lambda/workers/fargate-llm-processor/src/lib/websocket.ts` — Copied from Lambda, modified to handle 410 Gone gracefully (connection closed)
- `infrastructure/lambda/workers/fargate-llm-processor/src/lib/progress-notifier.ts` — New module that emits WebSocket progress events every 10 seconds using `setInterval`, message format: `{type: "artifact_progress", artifact_id, status: "processing", elapsed_seconds}`

**CI/CD:**
- `.github/workflows/build-fargate-images.yml` — GitHub Actions workflow triggered on merge to `main`: builds Docker image, tags with commit SHA + `latest`, pushes to ECR `prometheus-llm-processor` repository

### Files to Modify

**Lambda API Handlers:**
- `infrastructure/lambda/api/handlers/artifacts.ts` — Replace synchronous Bedrock invocation with SQS message publish:
  1. Create artifact record in DSQL with `status='pending'`
  2. Construct `LLMProcessingMessage` (see Context Package schema) with `task_type="artifact_generation"`
  3. Publish to SQS `llm-processing-queue`
  4. Return HTTP 202 Accepted with `{artifact_id, status: "pending", estimated_completion_seconds: 90}`
- `infrastructure/lambda/api/handlers/chat.ts` — Same pattern for long-running chat: publish to SQS with `task_type="chat_completion"`, return 202 Accepted
- `infrastructure/lambda/api/lib/sqs-client.ts` — New shared module for SQS publishing with message schema validation

**Database Migrations:**
- `infrastructure/database/migrations/004_artifact_status.sql` — Add `status` column to `artifacts` table: `status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed'))`

**Terraform Environment Configs:**
- `infrastructure/terraform/environments/dev/main.tf` — Add module references for `sqs` and `ecs`, pass VPC outputs from `vpc` module
- `infrastructure/terraform/environments/prod/main.tf` — Same as dev, with production-specific parameters (e.g., `max_tasks=20` in dev, `max_tasks=50` in prod after validation)

### Approach

This implementation follows Prometheus's established asynchronous choreography pattern: Lambda orchestrates, workers execute, DSQL tracks state. The architecture decouples the API's responsibility (request validation, state initialization, response) from the worker's responsibility (long-running computation, error handling, completion notification).

**Key architectural decisions:**

1. **Standard SQS queue (not FIFO):** FIFO provides message ordering but limits throughput to 300 msg/sec. Standard queue supports >10,000 msg/sec and ordering isn't required — each artifact generation is independent. Tradeoff: Possible duplicate message delivery, mitigated by idempotent task processing (check DSQL status before starting work).

2. **Event-driven ECS scaling:** Service desired count starts at 0. CloudWatch alarm triggers on `SQS ApproximateNumberOfMessagesVisible >0` → scales to 1 task. Target tracking policy maintains `messages per task = 1` up to 20 tasks maximum. When queue empties, scales back to 0 after 5-minute cooldown.

3. **Container image in ECR (not Lambda layers):** Fargate requires container images. Using ECR allows multi-stage Docker builds, optimized image size, and independent deployment from API Lambda functions. Lambda continues using layers for shared code.

4. **WebSocket progress streaming:** Fargate task spawns background interval timer that emits progress events every 10 seconds. If WebSocket POST returns 410 Gone (connection closed), timer is cancelled but task continues processing — artifact still completes and user retrieves it later via S3 presigned URL.

5. **Idempotent processing:** Before invoking Bedrock, task queries DSQL for artifact status. If already `completed` or `processing` (another task claimed it), exit early and delete SQS message. Prevents duplicate work from SQS at-least-once delivery.

### Order of Operations

**Phase 1: Infrastructure Foundation (Orbit 1)**
1. Create SQS module with queue + DLQ, export ARNs
2. Create ECS cluster + task definition with placeholder container image (`nginx:latest` for initial deployment)
3. Create IAM roles with least-privilege policies
4. Apply Terraform in dev environment, validate VPC endpoint connectivity with test task
5. Manual test: Run standalone Fargate task that curls Bedrock VPC endpoint and writes to CloudWatch Logs

**Phase 2: Worker Application (Orbit 2)**
1. Initialize Node.js project in `fargate-llm-processor/`
2. Implement `src/index.ts` main loop: SQS polling + message dispatching
3. Copy and adapt `bedrock-client.ts`, `s3-storage.ts`, `websocket.ts` from Lambda
4. Implement `artifact-generator.ts` handler with progress notifications
5. Write Dockerfile with multi-stage build
6. Set up GitHub Actions workflow for ECR push

**Phase 3: Lambda Integration (Orbit 3)**
1. Add `status` column to `artifacts` table via migration
2. Modify `artifacts.ts` handler to publish SQS message instead of synchronous Bedrock call
3. Implement `sqs-client.ts` shared library for message publishing
4. Deploy Lambda changes to dev
5. Integration test: POST artifact request → verify SQS message → verify Fargate task picks it up → verify artifact in S3 + WebSocket notification

**Phase 4: Observability & Hardening (Orbit 4)**
1. Add CloudWatch custom metrics: task duration, LLM token count, retry count, DLQ depth
2. Create CloudWatch alarms: DLQ >5 messages, Fargate task failure rate >10%, Bedrock throttle rate >5%
3. Add X-Ray instrumentation: trace from Lambda → SQS → Fargate → Bedrock
4. Implement DLQ monitoring Lambda (triggers on alarm, sends Slack notification with message details)
5. Load test in staging: 50 concurrent artifact requests, validate auto-scaling behavior and cost

**Phase 5: Production Rollout (Orbit 5)**
1. Deploy Terraform to prod with `max_tasks=5` safety limit
2. Feature flag: Enable async processing for 5% of artifact requests
3. Monitor for 24 hours: validate cost (<$0.20 per artifact), latency (P99 <180s), error rate (<1%)
4. Increment feature flag: 25%, 50%, 100% over 3 days
5. Remove synchronous Bedrock code path from Lambda after 1 week of stable operation
6. Increase `max_tasks` to 20 after first 100 production artifacts validated

### Dependencies

**Internal (Must Complete First):**
- T6-001 (VPC Infrastructure) — Provides private subnets and VPC endpoints for Bedrock/DSQL/S3/ECR
- T5-002 (WebSocket API) — Provides `websocket_connections` table and notification helper library
- ECR repository `prometheus-llm-processor` must exist (create manually via AWS Console if not present)
- Aurora DSQL tables `artifacts`, `orbits`, `websocket_connections` must exist

**External (Verify Before Execution):**
- Bedrock model access: Claude 3.5 Sonnet must be enabled in us-east-1
- Bedrock quota: Request increase to 50 concurrent invocations (default is 10)
- S3 bucket `prometheus-artifacts-{env}` must exist with SSE-S3 encryption
- API Gateway WebSocket API endpoint URL must be accessible from Fargate task (via NAT Gateway)

**Blocked By:**
- None — all prerequisites assumed completed or verifiable in pre-execution checks

---

## Risk Surface

### Edge Cases

**1. SQS message received after artifact already completed**
- **Scenario:** Lambda publishes message, Fargate task A processes it, but SQS delivers duplicate message to task B due to at-least-once delivery semantics
- **Mitigation:** Task B queries DSQL before processing. Query: `SELECT status FROM artifacts WHERE id=? FOR UPDATE`. If status is `completed`, delete message and exit. Transaction lock prevents race conditions.

**2. User disconnects WebSocket before artifact completes**
- **Scenario:** User closes browser tab after submitting request. Fargate task tries to send progress notification, receives 410 Gone from API Gateway.
- **Mitigation:** Catch 410 response in `websocket.ts`, log warning, remove connection from `websocket_connections` table, continue processing. Artifact still completes and is retrievable via `GET /artifacts/{id}`.

**3. Fargate task crashes mid-processing**
- **Scenario:** OOM error, segfault, or container runtime issue kills task after Bedrock response received but before S3 upload completes.
- **Mitigation:** SQS message remains in queue (not deleted), becomes visible again after 6-minute timeout, triggers new task. Artifact status stays `processing`, new task sees this and checks: if elapsed time >10 minutes, overwrite as new attempt. Idempotent S3 upload (same key).

**4. Bedrock returns malformed JSON**
- **Scenario:** LLM output contains invalid JSON or incomplete response due to model generation issue.
- **Mitigation:** Wrap JSON parsing in try-catch. On parse failure, log raw response to CloudWatch, set artifact `status='failed'` with `error_message='Invalid LLM output'`, move SQS message to DLQ for human review. Do not retry automatically (avoids burning quota on broken prompts).

**5. SQS visibility timeout expires while task still processing**
- **Scenario:** Complex artifact takes 7 minutes (P99.9 edge case), exceeds 6-minute visibility timeout. Message becomes visible again, spawns duplicate task.
- **Mitigation:** Task emits CloudWatch metric `task_duration` every 30 seconds. Before starting Bedrock call, task extends visibility timeout by 5 minutes using `ChangeMessageVisibility` API. Repeated every 4 minutes if processing continues. Hard timeout at 10 minutes (task exits, message goes to DLQ).

**6. S3 upload succeeds but DSQL update fails**
- **Scenario:** Artifact uploaded to S3, but transaction to update DSQL `status='completed'` rolls back due to connection timeout.
- **Mitigation:** Use optimistic locking: `UPDATE artifacts SET status='completed', s3_key=?, completed_at=NOW() WHERE id=? AND status='processing'`. If zero rows affected, check if status is already `completed` (race with another task) — if yes, delete SQS message and exit. If no, log error and let message redrive for retry.

### Regressions

**1. Existing synchronous artifact generation breaks**
- **Surface:** Lambda `artifacts.ts` handler currently returns artifact content inline in HTTP 200 response. Changing to async 202 breaks clients expecting synchronous response.
- **Mitigation:** Deploy Lambda change behind feature flag `ENABLE_ASYNC_ARTIFACTS` (env var). Default: false. Gradual rollout: 5% → 25% → 50% → 100% over 1 week. Frontend can detect 202 response and poll `GET /artifacts/{id}` every 5 seconds until `status='completed'`.

**2. WebSocket connection table grows unbounded**
- **Surface:** Existing `$disconnect` route deletes connections, but if route fails or user disconnects uncleanly, rows leak. Adding Fargate tasks that query this table could amplify slow query performance.
- **Mitigation:** Add TTL column `expires_at = connected_at + 2 hours` in migration. DSQL auto-deletes expired rows. Fargate task checks `expires_at` before sending notification — if expired, skip notification and delete row. Background Lambda (from T5-002) continues hourly cleanup as defense in depth.

**3. Bedrock throttling affects existing Lambda functions**
- **Surface:** If Fargate tasks saturate Bedrock quota with 20 concurrent requests, existing Lambda-based real-time chat could experience throttling errors.
- **Mitigation:** Request separate service quota for Fargate tasks (if available) or implement priority queuing: Lambda requests tagged with `Priority: High`, Fargate with `Priority: Normal`. Rate limiter in Fargate task: max 10 Bedrock calls per 10 seconds (token bucket). Monitor Bedrock throttle metrics, alert on >5% throttle rate.

**4. DSQL connection pool exhaustion**
- **Surface:** Existing Lambda functions maintain connection pools (max 2 connections per Lambda). Adding 20 Fargate tasks (max 2 connections each) adds 40 connections. DSQL supports 500 max connections, so no immediate issue, but reduces headroom.
- **Mitigation:** Fargate task uses connection pooling with `max_connections: 2` (same as Lambda). Monitor DSQL connection count metric, alert on >400 connections. Task closes connections on graceful shutdown (Docker SIGTERM handler).

### Security

**1. SQS message tampering**
- **Threat:** Attacker with AWS access publishes malicious SQS message with crafted `artifact_id` pointing to sensitive data, causing Fargate task to read and expose it.
- **Mitigation:** SQS queue policy restricts `SendMessage` to Lambda execution role ARN only. Fargate task validates `artifact_id` format (UUID v4) and checks ownership: `SELECT user_id FROM artifacts WHERE id=?`, compares with `user_id` in message. If mismatch, reject and move to DLQ.

**2. S3 presigned URL leakage**
- **Threat:** WebSocket notification contains presigned URL. If user's WebSocket connection is compromised (e.g., XSS in frontend), attacker could intercept URL and download artifact.
- **Mitigation:** Presigned URLs valid for 24 hours (reduces window). Artifacts contain no PII or secrets by design (only code and documentation). S3 bucket has `BlockPublicAccess` enabled. Consider: Add CloudFront signed URLs instead of presigned S3 URLs (future enhancement).

**3. Fargate task privilege escalation**
- **Threat:** Vulnerability in container runtime or task code allows attacker to escape container and access other tasks' data or AWS credentials.
- **Mitigation:** Task role follows least privilege: only `bedrock:InvokeModel`, `s3:PutObject` (scoped to artifacts bucket prefix), `sqs:DeleteMessage` (scoped to queue ARN), `dynamodb:Query/UpdateItem` (scoped to artifacts/orbits tables). No `iam:*`, `sts:AssumeRole`, or wildcard permissions. ECS task definition sets `readonlyRootFilesystem: true`, `privileged: false`, `capabilities: []`.

**4. CloudWatch Logs exposure**
- **Threat:** Task logs contain LLM prompts and responses, which may include sensitive context from user's codebase. Logs stored unencrypted in CloudWatch.
- **Mitigation:** CloudWatch log group encrypted with KMS key `alias/prometheus-logs`. Task logs include `artifact_id`, `model_id`, `token_count` but NOT full prompts or responses. If debugging requires full content, engineer must fetch from S3 (audit trail in CloudTrail).

### Performance

**1. Cold start latency**
- **Concern:** ECS task cold start (image pull + container start) takes 15-20 seconds. Adding to SQS delivery latency (1-2s) and Bedrock latency (30-90s) could push P50 end-to-end time to 60-110 seconds (vs 45-90s target).
- **Impact:** Medium — user experience degrades slightly but still under P99 target of 120s.
- **Mitigation:** Pre-warm 1 task during low-traffic hours (cron job publishes dummy message). Use ECR image cache by tagging with `:latest` (Fargate caches recently pulled images). Monitor `task_startup_time` metric (CloudWatch custom metric from task logs).

**2. SQS polling overhead**
- **Concern:** Long-polling with 20-second wait means task sits idle, burning Fargate costs. At $0.04048/vCPU-hour, 20 seconds idle per poll = ~$0.0002 wasted per message.
- **Impact:** Low — adds <2% to per-artifact cost, still under $0.50 constraint.
- **Mitigation:** Use event-driven scaling: ECS service starts tasks only when SQS queue depth >0 (CloudWatch alarm triggers). Task processes one message, checks queue again with short-polling (2s wait), and exits if empty. Minimizes idle time.

**3. Bedrock response streaming disabled**
- **Concern:** Bedrock supports response streaming, but this implementation uses non-streaming API (simpler error handling). Non-streaming means waiting for full response before processing, adding latency.
- **Impact:** Low — streaming saves ~10-15 seconds on large responses (200K tokens), but implementation complexity increases 3x (SSE parsing, partial result handling, retry logic). Accept latency tradeoff for reliability.
- **Mitigation:** Document as future optimization (Orbit 6+). Current non-streaming approach validated in T3-004 (acceptable latency). If P99 exceeds 120s in production, revisit streaming in next iteration.

**4. DSQL transaction lock contention**
- **Concern:** `SELECT ... FOR UPDATE` on artifact row during status check causes lock. If 5 concurrent tasks target same artifact (SQS duplicate delivery spike), transactions queue and some timeout.
- **Impact:** Low — DSQL supports 10,000 transactions/sec, lock held for <50ms. Timeout requires >200ms contention, unlikely with 5 concurrent tasks.
- **Mitigation:** Use short lock timeout: `SET LOCAL lock_timeout = '200ms'`. If lock times out, task exits gracefully and lets message redrive (SQS handles retry logic). Monitor DSQL `transaction_conflict` metric, alert on >10 conflicts/minute.

---

## Scope Estimate

### Files Affected
| Category | Create | Modify | Total |
|----------|--------|--------|-------|
| Infrastructure (Terraform) | 7 | 2 | 9 |
| Application (Fargate) | 9 | 0 | 9 |
| Lambda (API) | 1 (sqs-client) | 2 (artifacts.ts, chat.ts) | 3 |
| Database | 1 (migration) | 0 | 1 |
| CI/CD | 1 (workflow) | 0 | 1 |
| **Total** | **19** | **4** | **23** |

### Complexity: High

**Justification:**  
This intent introduces three new infrastructure components (SQS, ECS, ECR) and a novel asynchronous processing pattern not previously used in Prometheus. The implementation requires:

1. **Multi-service orchestration:** Lambda → SQS → Fargate → S3 → WebSocket creates 5-hop choreography with distributed error handling
2. **State management:** Artifact lifecycle spans 3 systems (DSQL, SQS, S3) with eventual consistency concerns
3. **Container deployment:** First Docker-based component requires new CI/CD pipeline, image registry, and task definition management
4. **Network complexity:** VPC endpoint configuration, security group rules, and NAT Gateway routing for WebSocket callbacks
5. **Operational unknowns:** Fargate auto-scaling behavior, ECS task health checks, and SQS redrive policies are unproven in this codebase

While individual components are straightforward, the integration surface area is large and testing requires simulating distributed race conditions (message duplication, task crashes, network partitions).

### Estimated Orbit Breakdown

| Orbit | Phase | Duration | Validation |
|-------|-------|----------|------------|
| 1 | Infrastructure scaffolding | 4-6 hours | Manual Fargate task curls Bedrock via VPC endpoint |
| 2 | Fargate worker implementation | 6-8 hours | Unit tests pass, Docker image builds |
| 3 | Lambda integration | 3-4 hours | Integration test: POST request → artifact appears in S3 |
| 4 | Observability & hardening | 5-6 hours | Load test: 50 concurrent requests complete successfully |
| 5 | Production rollout | 8-10 hours | 100 prod artifacts generated, cost <$0.20 each, P99 <180s |

**Total: 5 orbits, 26-34 hours**

### Test Coverage Plan

| Test Type | Count | Target |
|-----------|-------|--------|
| Unit tests (Fargate handlers) | 15 | artifact-generator, chat-processor, message validation |
| Integration tests (Lambda → SQS) | 8 | Message publish, schema validation, error handling |
| Contract tests (SQS → Fargate) | 5 | Message format, idempotency, retry logic |
| Infrastructure tests (Terraform) | 4 | Security groups, IAM policies, VPC endpoints |
| Load tests (Staging) | 3 | 10/50/100 concurrent requests |
| Chaos tests (Prod) | 2 | Task crash mid-process, SQS duplicate delivery |

**Total: 37 test cases**

---

## Human Modifications

Pending human review.