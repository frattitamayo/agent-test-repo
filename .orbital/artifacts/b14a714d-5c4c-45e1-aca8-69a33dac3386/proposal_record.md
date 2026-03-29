# Proposal Record — T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2026-03-12  
**Intent:** T6-003  
**Context Package:** CTX-INT-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

Users currently hit Lambda's 15-minute execution limit when generating artifacts or engaging in AI chat for large codebases or complex intent decomposition. This creates a broken experience where the request times out mid-processing, forcing users to split requests artificially or abandon features entirely. The solution decouples the HTTP request-response cycle from the LLM execution by introducing an asynchronous architecture: API Gateway receives the request and immediately returns acknowledgment with a task ID, an SQS message triggers a Fargate task to handle the long-running LLM call (which may take 30+ minutes), and a WebSocket notification informs the user when processing completes. The user never waits synchronously for LLM responses, eliminating timeouts as a constraint. The system must maintain sub-500ms notification latency and gracefully handle failures through retries and dead-letter queuing, while keeping costs bounded through Fargate scaling limits and task resource caps.

---

## Implementation Plan

### Files to Create

**Lambda Layer (SQS Client):**
- `infrastructure/lambda/shared/sqs-client.ts` — Typed wrapper around AWS SDK v3 SQS client with methods `publishMessage({ queueUrl, body, messageAttributes })` and `extendVisibilityTimeout({ queueUrl, receiptHandle, timeoutSeconds })`. Handles throttling errors with exponential backoff (base 100ms, max 3 retries). Returns message ID on success, throws typed error on failure. Pattern follows existing `s3-client.ts` structure.

**Modified Lambda Handler:**
- `infrastructure/lambda/api-gateway/handlers/artifacts/generate.ts` — Replace synchronous LLM invocation with:
  1. Validate request using existing Zod schema
  2. Create `artifact` record in DSQL with `task_status = 'queued'`, `task_id = uuid()`, `user_id`, `workspace_id`, `orbit_id`, `intent_ref`
  3. Publish SQS message containing `{ taskId, userId, workspaceId, orbitId }` (no sensitive parameters — those are in DSQL)
  4. Return `202 Accepted` with `{ taskId, status: 'queued', estimatedCompletionSeconds: 300 }`
  5. Use `ApiResponse` helper, preserve existing `withAuth` middleware

**Fargate Task Implementation:**
- `infrastructure/fargate/tasks/artifact-generation/index.ts` — Main entry point:
  - Infinite loop: poll SQS with 20-second long polling → process message → delete message
  - Message processing: retrieve artifact parameters from DSQL by `taskId` → invoke Bedrock via `bedrock-client.ts` → store result in S3 with key `artifacts/{workspaceId}/{orbitId}/{taskId}.json` → update DSQL artifact with `task_status = 'completed'`, `content_url = s3SignedUrl` in single transaction → broadcast WebSocket event → delete SQS message
  - Graceful shutdown: trap `SIGTERM`, finish in-flight message, exit cleanly within 30 seconds
  - Error handling: on failure, allow SQS visibility timeout to expire (message becomes visible for retry), after 3 retries move to DLQ, update artifact with `task_status = 'failed'`, `task_error = errorMessage`
  - Structured logging with `taskId`, `userId`, `workspaceId` in every log line

- `infrastructure/fargate/tasks/artifact-generation/Dockerfile` — Multi-stage build:
  - Stage 1: `node:20-alpine`, copy package files, `npm ci --production`
  - Stage 2: `node:20-alpine`, copy built artifacts, set `CMD ["node", "index.js"]`
  - Install AWS X-Ray daemon as sidecar (ENV `AWS_XRAY_DAEMON_ADDRESS`)

- `infrastructure/fargate/tasks/artifact-generation/task-definition.json` — ECS task definition:
  - Container: image from ECR, 2 vCPU, 4GB RAM
  - Environment variables: `SQS_QUEUE_URL`, `DSQL_ENDPOINT`, `S3_BUCKET_NAME`, `WEBSOCKET_API_ENDPOINT`, `AWS_REGION`
  - IAM role: `arn:aws:iam::account-id:role/FargateArtifactGenerationTaskRole`
  - Network mode: `awsvpc`, requires private subnet assignment

**Fargate Shared Utilities:**
- `infrastructure/fargate/shared/bedrock-client.ts` — Bedrock API wrapper:
  - Method `invokeModel({ modelId, prompt, maxTokens, temperature })` with retry logic (exponential backoff, max 3 attempts)
  - Timeout: 30 minutes (fail task if LLM call exceeds)
  - Error classification: transient (retry) vs. permanent (fail immediately)
  - Uses AWS SDK v3 `@aws-sdk/client-bedrock-runtime`

- `infrastructure/fargate/shared/websocket-notifier.ts` — WebSocket broadcast utility:
  - Method `notifyTaskCompletion({ userId, taskId, artifactId, downloadUrl })`:
    1. Query `websocket_connections` by `userId` to get `connectionId`
    2. Call API Gateway Management API `postToConnection` with payload `{ type: 'task_completed', taskId, artifactId, downloadUrl }`
    3. Handle `GoneException` (410) by removing stale connection from registry, do not fail task
    4. Log broadcast success/failure, never throw (best-effort delivery)
  - Connection ID caching: in-memory map with 5-minute TTL

**Infrastructure as Code:**
- `infrastructure/terraform/fargate-cluster.tf` — ECS cluster, service, task definition:
  - Cluster: `prometheus-fargate-cluster`
  - Service: `artifact-generation-service`, desired count 1, max 10, autoscaling policy based on SQS queue depth (target: 5 messages per task)
  - Task definition reference: `aws_ecs_task_definition.artifact_generation`
  - Launch type: `FARGATE`, platform version `LATEST`, private subnets with NAT gateway

- `infrastructure/terraform/sqs-queues.tf` — Main queue and DLQ:
  - Main queue: `artifact-generation-tasks`, visibility timeout 45 minutes, message retention 7 days
  - DLQ: `artifact-generation-tasks-dlq`, redrive policy after 3 receive attempts
  - Encryption at rest: AWS-managed KMS key
  - Outputs: queue URL, queue ARN for Lambda and Fargate IAM policies

- `infrastructure/terraform/iam-fargate.tf` — IAM role and policy for Fargate tasks:
  - Role: `FargateArtifactGenerationTaskRole`, trust policy allows `ecs-tasks.amazonaws.com`
  - Policy statements:
    - `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` on `artifact-generation-tasks` queue
    - `s3:PutObject` on `arn:aws:s3:::artifacts-bucket/artifacts/*`
    - `dsql:ExecuteStatement` with row-level security constraint (task can only access artifacts in its `workspaceId`)
    - `bedrock:InvokeModel` on Claude 3 models
    - `execute-api:ManageConnections` on WebSocket API
    - `logs:CreateLogStream`, `logs:PutLogEvents` on log group `/ecs/artifact-generation-task`
    - `xray:PutTraceSegments`, `xray:PutTelemetryRecords`

- `infrastructure/terraform/vpc-endpoints.tf` — Add Bedrock VPC endpoint:
  - Resource: `aws_vpc_endpoint.bedrock_runtime`, service name `com.amazonaws.us-east-1.bedrock-runtime`
  - Type: `Interface`, private DNS enabled, security group allows inbound 443 from Fargate task security group
  - Conditional creation: only if `enable_vpc_endpoints = true` variable is set

**Database Migration:**
- `infrastructure/dsql/migrations/008_add_task_tracking.sql`:
  ```sql
  ALTER TABLE artifacts 
    ADD COLUMN task_id UUID,
    ADD COLUMN task_status VARCHAR(20) DEFAULT 'pending' 
      CHECK (task_status IN ('queued', 'processing', 'completed', 'failed')),
    ADD COLUMN task_error TEXT,
    ADD INDEX idx_task_status_created (task_status, created_at);
  ```

**Observability:**
- `infrastructure/cloudwatch/dashboards/fargate-tasks.json` — Dashboard with widgets:
  - Active task count (ECS service metric `RunningTaskCount`)
  - Queue depth (SQS metric `ApproximateNumberOfMessagesVisible`)
  - Task duration histogram (custom metric `TaskDuration` from Fargate task)
  - Failure rate (custom metric `TaskFailureRate`)
  - WebSocket notification latency (custom metric `NotificationLatency`)

- `infrastructure/cloudwatch/alarms/task-failures.json` — Alarm definitions:
  - Queue depth > 50 for 5 minutes → alert to Slack
  - Task failure rate > 1% over 10 minutes → page on-call
  - p99 task duration > 10 seconds (queue pickup latency) → alert
  - Active task count ≥ 8 for 10 minutes (80% capacity) → warning

**Tests:**
- `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — Unit tests for modified handler:
  - Valid request → artifact created with `task_status = 'queued'`, SQS message published, 202 response returned
  - Invalid request → 400 error, no artifact created, no SQS message
  - DSQL write fails → 500 error, SQS message not published
  - SQS publish fails → artifact rolled back (transaction aborted), 500 error

- `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — Integration tests for Fargate task:
  - Mock SQS `receiveMessage` to return test message, mock Bedrock response, assert DSQL update with `task_status = 'completed'`, S3 write, SQS delete, WebSocket broadcast
  - Bedrock timeout scenario → task updates artifact with `task_status = 'failed'`, message visibility timeout expires
  - DSQL transaction failure → message not deleted, retry occurs
  - WebSocket broadcast failure → task still completes, artifact marked complete

- `tests/integration/fargate-to-websocket.test.ts` — End-to-end test:
  - Spin up LocalStack with SQS, S3, DSQL mock
  - POST `/artifacts` via API Gateway → assert 202 response with `taskId`
  - Fargate task picks up message (simulated with test runner) → invoke mock LLM → write to S3/DSQL
  - Assert WebSocket connection receives event within 1 second
  - Teardown: clean up test resources

### Approach

Follow the established Lambda-SQS-Worker pattern: Lambda acts as a thin request validator and queue publisher, Fargate acts as the worker that consumes messages and performs heavy computation. The implementation reuses existing patterns — Lambda handler follows `orbits/create.ts` structure (request validation, business logic delegation, response formatting), Fargate task follows long-running process conventions (graceful shutdown on `SIGTERM`, structured logging), and WebSocket notification reuses `broadcast.ts` utility from the existing WebSocket infrastructure. The critical architectural decision is to store task parameters in DSQL (not SQS messages) to keep messages small and non-sensitive, requiring Fargate to perform a DSQL lookup before processing. This adds 100-200ms latency but ensures PII and codebase content never appear in CloudWatch Logs or SQS console. All state transitions are transactional — artifact status changes only commit after successful S3 writes — preventing orphaned records.

### Order of Operations

**Phase 1 — Infrastructure Provisioning:**
1. Create Terraform resources: Fargate cluster, SQS queues, IAM roles, VPC endpoints
2. Apply DSQL migration to add task tracking columns to `artifacts` table
3. Build and push Fargate container image to ECR
4. Deploy ECS task definition and service (initial desired count: 1)
5. Verify: Fargate task starts successfully, logs appear in CloudWatch, task polls SQS queue

**Phase 2 — Fargate Task Implementation:**
1. Implement `bedrock-client.ts` with retry logic and timeout handling
2. Implement `websocket-notifier.ts` with connection lookup and broadcast logic
3. Implement `index.ts` main loop (poll → process → delete)
4. Write integration tests for task logic (mock SQS, Bedrock, DSQL, WebSocket)
5. Verify: Task processes test message, writes to S3, updates DSQL, broadcasts event, deletes message

**Phase 3 — Lambda Handler Modification:**
1. Implement `sqs-client.ts` wrapper for message publishing
2. Modify `generate.ts` handler to enqueue SQS message instead of invoking LLM
3. Update handler tests to assert SQS message structure and 202 response
4. Deploy handler to staging environment
5. Verify: POST `/artifacts` returns task ID, SQS message appears in queue

**Phase 4 — End-to-End Integration:**
1. Deploy full stack to staging environment (Lambda + Fargate + SQS)
2. Run integration test: API call → Fargate processing → WebSocket notification
3. Stress test with 10 concurrent requests, verify queue depth and task scaling
4. Verify error paths: Bedrock timeout, DSQL failure, WebSocket connection gone
5. Review CloudWatch metrics and X-Ray traces

**Phase 5 — Observability and Deployment:**
1. Create CloudWatch dashboard with task metrics
2. Configure alarms for queue depth, failure rate, task latency
3. Enable feature flag `fargate_artifact_generation` in staging, test with real users
4. Production deployment: Lambda first (gradual rollout), then enable feature flag for 10% traffic
5. Monitor for 24 hours, expand to 100% if metrics are within SLOs

### Dependencies

**Prerequisite Infrastructure:**
- Fargate cluster and ECS service configuration (can be created in Phase 1)
- SQS queue and DLQ (can be created in Phase 1)
- VPC with private subnets and NAT gateway (assumed to exist, verify in pre-work)
- IAM roles with appropriate permissions (created in Phase 1)

**Service Dependencies:**
- AWS Bedrock model access enabled for Claude 3 (verify in AWS Console before starting)
- Existing WebSocket API and connection management infrastructure (already deployed)
- S3 bucket `artifacts-bucket` (already exists, no changes needed)
- DSQL database endpoint and authentication (already configured)

**External Services:**
- Bedrock runtime API availability (monitor AWS Health Dashboard during deployment)
- API Gateway WebSocket API connection limits (default 500 concurrent connections, sufficient for current user base)

**Prior Work:**
- T1-005 (WebSocket infrastructure) must be deployed and operational
- T4-008 (S3 artifact storage) provides the bucket structure Fargate task will use

**Blocking Issues:**
- If Bedrock model access is not enabled, request via AWS Support (estimated 1-2 business days)
- If VPC endpoints for Bedrock do not exist and NAT gateway is not provisioned, Phase 1 is blocked until networking is configured

---

## Risk Surface

### Edge Cases

**Authorization code replay during Fargate task processing:**
- **Scenario:** User submits artifact generation request twice with identical parameters (e.g., browser double-click, network retry). Lambda creates two artifact records with different task IDs, publishes two SQS messages. Fargate processes both, potentially invoking Bedrock twice for the same operation.
- **Mitigation:** Add idempotency key to artifact creation based on `userId + workspaceId + orbitId + intentRef + hash(parameters)`. Lambda checks for existing `queued` or `processing` artifact with same key before creating new record. If exists, return existing `taskId` in 202 response. Test: Submit identical requests <1 second apart, assert only one SQS message published.

**SQS message visibility timeout expires during Bedrock call:**
- **Scenario:** Fargate task invokes Bedrock with 30-minute expected duration. SQS visibility timeout is 45 minutes. If task processing takes >45 minutes (e.g., extremely large codebase, slow model response), message becomes visible again while task is still running. Second Fargate task picks up message, begins duplicate processing.
- **Mitigation:** Task must extend visibility timeout periodically during long operations using `sqs:ChangeMessageVisibility` API. Extend by 10 minutes every 5 minutes while Bedrock call is in progress. If extension fails (message already deleted or DLQ'd), abort task gracefully. Test: Mock 50-minute LLM call, assert message visibility extended, no duplicate processing.

**PKCE verifier mismatch — wait, wrong intent. This is artifact generation, not auth flow.**
- **Correction:** Ignore auth-specific edge cases. Relevant edge case: **Workspace deletion while task is processing.**
- **Scenario:** Admin deletes workspace while Fargate task is generating artifact for that workspace. Task completes, attempts to write to S3 and update DSQL, but workspace record no longer exists (foreign key constraint violation).
- **Mitigation:** DSQL schema uses `ON DELETE CASCADE` for artifact → workspace relationship. When workspace is deleted, all artifacts are also deleted. Fargate task must check for artifact existence before updating (SELECT with row lock). If artifact is missing, log warning and delete SQS message without retrying. Test: Delete workspace during task processing, assert task completes without error, no orphaned S3 objects.

**WebSocket connection closed before notification:**
- **Scenario:** User closes browser tab while Fargate task is processing. Task completes, attempts to broadcast WebSocket event, but connection no longer exists in registry.
- **Mitigation:** `websocket-notifier.ts` catches `GoneException`, logs connection closure, does not fail task. Client must poll artifact status endpoint as fallback (already implemented in frontend). Test: Close WebSocket connection, complete task, assert no task failure, artifact marked complete in DSQL.

**Concurrent Fargate tasks updating same orbit record:**
- **Scenario:** User submits two artifact generation requests for different intents in the same orbit. Two Fargate tasks run concurrently, both attempt to update `orbits.updated_at` timestamp, causing DSQL serialization conflict.
- **Mitigation:** Artifact updates do not touch orbit record — only artifact table is modified. If future requirements add orbit-level aggregation (e.g., "all artifacts completed"), use optimistic locking with retry on serialization failure. Test: Run two tasks concurrently for same orbit, assert both complete without deadlock.

### Regressions

**Existing synchronous artifact generation for small requests:**
- **Risk:** Modifying `generate.ts` handler breaks the fast path for small requests that complete in <30 seconds. Users who previously got instant responses now wait for Fargate task pickup (2-5 seconds) even for trivial operations.
- **Mitigation:** Introduce request size heuristic in Lambda handler: if `estimatedLinesOfCode < 1000` AND `conversationTurns < 5`, invoke Bedrock synchronously (existing flow). Otherwise, enqueue SQS message (new flow). Feature flag controls this cutoff threshold. Test: Submit small request, assert synchronous response (<5 seconds). Submit large request, assert async response (202 with task ID).

**WebSocket broadcast implementation already handles stale connections:**
- **Risk:** Reusing `broadcast.ts` utility without understanding existing error handling could introduce duplicate connection cleanup or missed `GoneException` handling.
- **Mitigation:** Review `broadcast.ts` implementation before integration. Existing code already removes stale connections on 410 response — Fargate task needs no additional logic. Test: Reuse integration test from T1-005 (WebSocket notification with closed connection), verify behavior is unchanged.

**S3 bucket structure conventions from T4-008:**
- **Risk:** Fargate task writes artifacts to S3 with incorrect key structure, breaking frontend's download URL assumptions.
- **Mitigation:** S3 key MUST follow existing pattern: `artifacts/{workspaceId}/{orbitId}/{artifactId}.json`. Fargate task uses same `s3-client.ts` helper (if exists) or replicates key generation logic. Test: Generate artifact via Fargate, assert S3 key matches pattern, frontend can download via signed URL.

**CloudWatch log retention from T3-012:**
- **Risk:** Fargate task logs use different retention period than Lambda, causing inconsistent log availability or unexpected cost.
- **Mitigation:** Set Fargate log group `/ecs/artifact-generation-task` to same retention (7 days) as Lambda functions. Use structured logging format matching existing Lambda logs (JSON with `timestamp`, `level`, `message`, `context`). Test: Verify log entries appear in CloudWatch with correct structure, retention policy is 7 days.

### Security

**Fargate task IAM role over-permission:**
- **Risk:** IAM policy grants `s3:*` on entire bucket instead of scoped to `artifacts/*` prefix. Task compromise allows attacker to list, read, or delete unrelated S3 objects (e.g., infrastructure Terraform state, user uploads).
- **Mitigation:** IAM policy uses resource constraint: `s3:PutObject` only on `arn:aws:s3:::artifacts-bucket/artifacts/*`. No `s3:GetObject` or `s3:ListBucket` permissions granted. Terraform policy resource block explicitly defines allowed actions and resources. Test: Attempt to write object outside `artifacts/` prefix from Fargate task, assert permission denied.

**SQS message contains sensitive data in plain text:**
- **Risk:** Developer includes `codebaseContent` or `conversationHistory` in SQS message body for convenience. CloudWatch Logs (enabled by default) expose message payload, leaking PII or proprietary code.
- **Mitigation:** SQS message schema enforced via Zod: `{ taskId: uuid, userId: uuid, workspaceId: uuid, orbitId: uuid }`. No other fields allowed. Fargate task retrieves artifact parameters from DSQL using `taskId`. Code review checklist includes "SQS message contains only IDs". Test: Publish message with extra fields, assert Fargate task rejects invalid schema.

**WebSocket broadcast to wrong connection:**
- **Risk:** Fargate task looks up connection by `workspaceId` instead of `userId`, broadcasting task completion to all users in workspace (cross-user data exposure if workspace contains PII).
- **Mitigation:** `websocket-notifier.ts` queries `websocket_connections WHERE user_id = ?`, never by `workspace_id`. Broadcast payload contains only `taskId` (user must authenticate to fetch artifact content via API). Test: User A submits task, User B in same workspace should not receive WebSocket notification.

**Bedrock API key exposure in logs:**
- **Risk:** Fargate task logs Bedrock request parameters for debugging, accidentally including prompt or model configuration. Prompt may contain user-provided code or instructions, exposing PII.
- **Mitigation:** Structured logging redacts sensitive fields. Log `{ modelId, taskId, duration }` on success. On error, log `{ taskId, errorCode, retryCount }` without `prompt` or `response`. Use log scrubbing regex to detect accidental PII (email, SSN, credit card) in CloudWatch Logs Insights queries. Test: Generate artifact with PII in intent description, verify CloudWatch logs do not contain raw text.

**Row-level security in DSQL:**
- **Risk:** Fargate task can update artifacts in any workspace, not just the one it's processing. Task compromise or bug allows attacker to mark another workspace's artifacts as failed or overwrite their content.
- **Mitigation:** DSQL policy enforces: `WHERE workspace_id = current_user_workspace_id()`. Fargate task authenticates to DSQL with workspace-scoped credentials (separate IAM role per workspace, or dynamic credentials with workspace context). **Critical:** This requires clarification — current DSQL schema may not support row-level security. If not, add application-level check: `UPDATE artifacts WHERE task_id = ? AND workspace_id = ?` (two-condition WHERE clause). Test: Task attempts to update artifact in different workspace, assert update affects 0 rows.

### Performance

**Fargate task cold start accumulates queue backlog:**
- **Risk:** Queue depth increases from 0 → 20 messages in 2 minutes (burst of user requests). ECS autoscaling policy triggers, but new tasks take 10-15 seconds to start (image pull + task initialization). During cold start, messages wait in queue, p95 latency increases from 2 seconds to 20 seconds.
- **Mitigation:** Set ECS service `desiredCount = 1` (always keep one task warm). Autoscaling adds tasks beyond baseline, not from zero. Monitor `TimeInQueue` metric (custom metric: `message.sentTimestamp` - `message.receiveTimestamp`). Alert if p95 > 5 seconds. Test: Send 50 messages to empty queue, measure time from first message publish to first message processed, assert <10 seconds.

**WebSocket notification latency exceeds 500ms:**
- **Risk:** Fargate task completes, updates DSQL, looks up connection ID (DSQL query: 100-200ms), invokes API Gateway Management API (network call: 50-100ms), total latency 150-300ms. Under load (10 concurrent tasks), DSQL connection pool exhaustion adds 200-500ms, exceeding SLO.
- **Mitigation:** Index `websocket_connections` on `user_id` (already exists based on T1-005). Cache connection IDs in Fargate task memory (in-memory map with 5-minute TTL, invalidate on `GoneException`). Reduce cache miss rate to <10%. If broadcast latency exceeds 500ms for 3 consecutive tasks, log warning and consider asynchronous broadcast (write to SNS topic, Lambda handles broadcast). Test: Complete 100 tasks concurrently, measure p95 notification latency, assert <500ms.

**DSQL transaction contention on artifacts table:**
- **Risk:** Multiple Fargate tasks update different artifacts concurrently. DSQL uses row-level locking, but high write volume causes `SerializationFailure` errors (transaction retry required). Task must retry, adding 500-1000ms per retry.
- **Mitigation:** Artifact updates are isolated by `task_id` (different rows, no contention). Only `updated_at` on shared orbit record could conflict, but orbit updates are not part of this implementation. Monitor `SerializationFailure` error rate in CloudWatch Logs. Alert if >1% of transactions require retry. Test: Update 50 artifacts concurrently, assert <1% retry rate.

**S3 PutObject latency for large artifacts (>5MB):**
- **Risk:** Artifact content is 10MB JSON (large codebase context package). S3 `PutObject` takes 2-3 seconds at p95. Task completes, but S3 write blocks DSQL transaction commit, increasing end-to-end latency from 300ms to 3 seconds.
- **Mitigation:** Write to S3 BEFORE starting DSQL transaction. If S3 write fails, do not update DSQL (task will retry). If DSQL update fails after successful S3 write, SQS retry overwrites same S3 key (idempotent). This inverts the risk: S3 may contain orphaned objects if DSQL write fails permanently, but end-to-end latency is minimized. Add S3 lifecycle policy to delete objects not referenced by DSQL after 7 days (cleanup orphans). Test: Generate 10MB artifact, measure S3 write duration, assert <2 seconds at p95.

**Bedrock rate limiting under burst load:**
- **Risk:** 10 Fargate tasks invoke Bedrock concurrently. Bedrock enforces per-model rate limit (e.g., 10 requests/minute for Claude 3 Opus). Tasks receive `ThrottlingException`, must retry with exponential backoff, adding 5-10 seconds to task duration.
- **Mitigation:** Implement jitter in retry backoff (random delay 0-1000ms before first retry). Monitor Bedrock API throttle rate in CloudWatch. If throttle rate >5%, consider: (1) request quota increase from AWS Support, (2) implement client-side rate limiting (max 5 concurrent Bedrock calls across all tasks), (3) use cheaper model for non-critical operations. Test: Invoke Bedrock 20 times in 30 seconds, assert retry logic handles throttles without task failure.

---

## Scope Estimate

### Orbit Breakdown

**Estimated Total: 1 orbit** (this orbit: proposal + context + execution + verification)

**Rationale:** This is a self-contained architectural change with well-defined boundaries. The implementation follows established patterns (Lambda-SQS-Worker is industry standard), the infrastructure is net-new (no refactoring of existing services), and the risk surface is manageable through feature flags and gradual rollout. All dependencies are either already complete (WebSocket infrastructure, S3 storage) or can be created within this orbit (Fargate cluster, SQS queues). Complexity is medium: the individual components (Lambda handler, Fargate task, Terraform resources) are straightforward, but the integration requires careful coordination across 5 AWS services and correctness testing of failure paths (retry logic, dead-letter queue, WebSocket fallback).

A second orbit would be required only if:
- Bedrock VPC endpoint provisioning requires additional networking changes (e.g., new subnet CIDR ranges, route table modifications)
- DSQL row-level security implementation is not supported and requires application architecture redesign
- Integration testing reveals edge cases not covered in the proposal (e.g., multi-region WebSocket connections, Fargate task memory exhaustion)

### Complexity Assessment

**Medium Complexity**

**Justification:**
- **Infrastructure Provisioning (30% of work):** Terraform resources for Fargate, SQS, IAM are standard AWS patterns. Complexity comes from IAM policy scoping (must be least-privilege) and VPC endpoint configuration (requires understanding of subnet routing).
- **Lambda Handler Modification (20% of work):** Straightforward change — replace synchronous call with SQS publish. Complexity is in idempotency key design (prevent duplicate tasks) and request size heuristic (fast path for small requests).
- **Fargate Task Implementation (30% of work):** The core logic (poll → process → delete) is standard, but correctness depends on edge case handling: graceful shutdown, visibility timeout extension, transaction rollback on failure, WebSocket broadcast best-effort. Each failure mode must be tested.
- **Observability and Testing (20% of work):** CloudWatch dashboard and alarms are copy-paste from existing patterns, but integration testing requires end-to-end trace verification (API Gateway → SQS → Fargate → WebSocket) with mocked LLM responses and injected failures.

Not high complexity because:
- No novel algorithms or domain-specific logic
- No refactoring of existing services (Lambda handler adds new code path, doesn't replace existing)
- No multi-region or disaster recovery requirements
- No user data migration or schema backfilling

### Work Phases

**Phase 1 — Infrastructure (estimated 16 hours):**
- Terraform: Fargate cluster, SQS queues, IAM roles, VPC endpoints (8 hours)
- DSQL migration: add task tracking columns, test backward compatibility (2 hours)
- ECR repository setup, container build pipeline (2 hours)
- Deploy to staging environment, verify Fargate task starts (2 hours)
- Smoke test: manually publish SQS message, verify task picks up and processes (2 hours)

**Phase 2 — Fargate Task (estimated 20 hours):**
- Implement `bedrock-client.ts` with retry and timeout (4 hours)
- Implement `websocket-notifier.ts` with connection lookup and broadcast (4 hours)
- Implement `index.ts` main loop with SQS polling, processing, deletion (6 hours)
- Write integration tests for task logic (4 hours)
- Local testing with LocalStack (2 hours)

**Phase 3 — Lambda Handler (estimated 12 hours):**
- Implement `sqs-client.ts` wrapper (2 hours)
- Modify `generate.ts` handler to enqueue SQS message (4 hours)
- Add idempotency key logic and request size heuristic (4 hours)
- Update unit tests for handler (2 hours)

**Phase 4 — Integration (estimated 16 hours):**
- Deploy full stack to staging (2 hours)
- End-to-end test: API → Fargate → WebSocket (4 hours)
- Stress test with 20 concurrent requests (2 hours)
- Error path testing: Bedrock timeout, DSQL failure, WebSocket gone (4 hours)
- X-Ray trace validation (2 hours)
- Fix issues discovered during testing (2 hours)

**Phase 5 — Observability and Rollout (estimated 12 hours):**
- CloudWatch dashboard and alarms (4 hours)
- Feature flag configuration and gradual rollout plan (2 hours)
- Production deployment (4 hours)
- 24-hour monitoring and on-call readiness (2 hours)

**Total Estimated Hours:** 76 hours (≈2 weeks for one engineer, or 1 week for paired implementation)

**Confidence:** 80% — Estimates assume:
- No blocking issues with Bedrock model access or VPC endpoint provisioning
- DSQL supports row-level security or application-level checks are sufficient
- LocalStack accurately simulates SQS, S3, and DSQL behavior
- No unexpected edge cases discovered during integration testing

Risk of scope increase (requiring second orbit):
- Bedrock API behavior differs from documentation (e.g., unexpected timeout handling, throttle rate limits lower than advertised)
- Fargate task memory exhaustion due to large artifact content (requires optimization or resource limit increase)
- WebSocket notification delivery rate below 99% (requires fallback architecture redesign, e.g., SNS-based broadcast)

### Estimated Test Coverage

**Target:** 85% code coverage, 100% critical path coverage

**Test Count:**
- Lambda handler: 8 unit tests (valid request, invalid request, DSQL failure, SQS failure, idempotency key match, request size heuristic, auth failure, rate limit)
- Fargate task: 12 integration tests (successful processing, Bedrock timeout, DSQL transaction failure, SQS visibility timeout, WebSocket broadcast failure, graceful shutdown, concurrent processing, idempotency on retry, large artifact >5MB, stale connection cleanup, DLQ after max retries, X-Ray trace propagation)
- End-to-end: 4 integration tests (full flow success, user closes connection mid-processing, workspace deleted during processing, burst load with 20 concurrent tasks)

**Total:** 24 tests

**Critical Paths (must be tested):**
1. API request → SQS message published → Fargate task processes → WebSocket notifies client (happy path)
2. Bedrock call times out → task marks artifact failed → message moves to DLQ (failure path)
3. Duplicate request → idempotency key prevents second task (edge case)
4. WebSocket connection closed → task completes without error → client polls for status (fallback path)

---

## Human Modifications

Pending human review.