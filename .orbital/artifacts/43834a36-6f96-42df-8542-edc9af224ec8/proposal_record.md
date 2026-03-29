# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-O1  
**Generated:** 2025-02-17  
**Intent:** T6-003  
**Orbit:** 1  
**Context Packages:**
- Intent-specific: T6-003 Context Package
**Trust Tier:** 2 — supervised (new infrastructure pattern, production data flow, moderate blast radius)

---

## Interpreted Intent

When a user requests artifact generation or sends a chat message, the system must respond instantly with confirmation while the actual LLM processing happens asynchronously without timing out. The current architecture has Lambda functions that wait for Bedrock responses, which can take 30-180 seconds and frequently hit Lambda's execution limits. This orbit restructures the flow so the API layer becomes a stateless request acceptor that delegates heavy computation to Fargate tasks triggered via SQS.

The transformation: HTTP request → Lambda validates and enqueues → returns 202 Accepted immediately → Fargate picks up message → processes LLM operation with unlimited time → stores results in S3/DSQL → notifies frontend via WebSocket. The user sees instant acknowledgment that their request is processing, receives real-time progress updates, and gets the final result delivered asynchronously.

This pattern must support at least 10 concurrent long-running LLM operations, cost less than $0.50/hour per task at peak utilization, maintain backward compatibility with existing API contracts, and provide the same WebSocket event schemas the frontend already expects. The infrastructure must be deployable without downtime, include full observability in CloudWatch, and allow clean rollback via feature flags for at least 7 days post-deployment.

---

## Implementation Plan

### Files to Create

**Infrastructure (CDK)**
- `infra/lib/stacks/fargate-llm-stack.ts` — New L3 stack defining ECS cluster, Fargate task definition, SQS queue with DLQ, IAM roles for task execution and runtime, CloudWatch log group
- `infra/lib/constructs/fargate-task.ts` — Reusable construct encapsulating Fargate task definition with configurable CPU/memory, IAM role grants for DSQL/S3/SQS/WebSocket, X-Ray tracing enablement, awslogs driver configuration
- `infra/lib/constructs/llm-queue.ts` — SQS queue construct with FIFO ordering (per intent requirement), KMS encryption, 4-hour message retention, 15-minute visibility timeout, DLQ with 3 max receives, CloudWatch alarms on queue depth and DLQ message count

**Lambda API Layer Modifications**
- `src/lambda/api/shared/queue-client.ts` — Typed SQS client wrapper with methods: `enqueueArtifactGeneration(request: ArtifactRequest)` and `enqueueChatMessage(request: ChatRequest)`, includes X-Ray tracing instrumentation, message attribute injection for correlation IDs, error handling with exponential backoff on throttling

**Fargate Task Handler**
- `src/fargate/llm-processor/index.ts` — Entrypoint that initializes AWS clients, starts SQS long-polling loop with 20-second wait time, dispatches messages to handlers based on message type, implements graceful shutdown on SIGTERM
- `src/fargate/llm-processor/handlers/artifact-generator.ts` — Extracted from existing Lambda artifact generation logic, handles `artifact.generate` message type, invokes Bedrock, persists to S3, updates DSQL, sends WebSocket event, implements idempotency check via request ID lookup in DSQL
- `src/fargate/llm-processor/handlers/chat-responder.ts` — Extracted from existing Lambda chat logic, handles `chat.respond` message type, follows same pattern as artifact generator
- `src/fargate/llm-processor/lib/bedrock-client.ts` — Shared Bedrock invocation wrapper with retry logic for throttling exceptions (exponential backoff with jitter), timeout handling (14-minute task-level timeout), response streaming to avoid memory buffer issues
- `src/fargate/llm-processor/lib/websocket-notifier.ts` — WebSocket client using API Gateway Management API, queries DynamoDB for connection ID by user ID, posts event with retry on transient errors, handles 410 Gone gracefully by logging stale connection without failing task
- `src/fargate/llm-processor/lib/result-persister.ts` — S3 upload with MIME type detection, atomic DSQL transaction for artifact/chat_message insert + status update, includes ETag in persistence response for frontend verification
- `src/fargate/llm-processor/lib/message-validator.ts` — Zod schema validation for SQS message bodies, throws typed error if schema mismatch to trigger DLQ routing

**Docker**
- `src/fargate/llm-processor/Dockerfile` — Multi-stage build: stage 1 uses `node:18-alpine` to compile TypeScript, stage 2 copies only runtime dependencies and compiled JS, runs as non-root user (`node`), sets working directory `/app`, exposes no ports (task is worker, not server)
- `src/fargate/llm-processor/.dockerignore` — Excludes `node_modules`, `tests`, `*.test.ts`, `*.map`, `README.md`, `.git`

**Shared Types**
- `src/shared/types/queue-messages.ts` — TypeScript interfaces: `ArtifactGenerationMessage { type: 'artifact.generate', requestId, userId, tenantId, orbitId, promptData, correlationId }`, `ChatResponseMessage { type: 'chat.respond', requestId, userId, tenantId, chatId, messageId, promptData, correlationId }`
- `src/shared/lib/websocket-client.ts` — Extracted from `src/lambda/websocket/connection-manager.ts`, exported `WebSocketClient` class with `postToConnection(userId, event)` method usable by both Lambda and Fargate

### Files to Modify

**Lambda API Handlers**
- `src/lambda/api/artifacts/generate.ts` — Replace synchronous Bedrock call with: check `fargateEnabled` feature flag → if true, validate input, generate request ID, enqueue SQS message via `queue-client`, return HTTP 202 with operation ID; if false, fall back to existing synchronous flow
- `src/lambda/api/chat/send-message.ts` — Same pattern as artifact handler: feature flag check, enqueue on true, synchronous flow on false

**Infrastructure Entry Point**
- `infra/bin/prometheus.ts` — Add `new FargateLlmStack(app, 'FargateLlmStack-Prod', { env: prodEnv })` to stack instantiation

**CI/CD**
- `.github/workflows/deploy.yml` — Add Docker build and ECR push step before CDK deploy: `docker build -t $ECR_REPO:$COMMIT_SHA`, `docker push`, pass image URI to CDK context for Fargate task definition

**Environment Variables**
- `infra/lib/stacks/fargate-llm-stack.ts` — Pass environment variables to Fargate task: `QUEUE_URL`, `DSQL_ENDPOINT`, `S3_BUCKET`, `WEBSOCKET_API_ENDPOINT`, `AWS_REGION`, `LOG_LEVEL`, `TASK_TIMEOUT_MS=840000` (14 minutes)

### Approach

Follow the established serverless CDK construct pattern: define infrastructure as reusable L3 constructs that encapsulate resources, IAM policies, and observability configuration. The `FargateLlmStack` orchestrates three constructs: `LlmQueue` (SQS with DLQ), `FargateTask` (ECS task definition with IAM roles), and grants (cross-resource permissions).

Lambda API handlers become thin coordinators: validate request schema, check feature flag, enqueue message with typed payload, return 202 Accepted. The heavy lifting moves to Fargate, where handlers extracted from existing Lambda functions process messages independently. Shared business logic (Bedrock prompts, S3 storage patterns, DSQL queries) is extracted into `src/shared/lib/` modules importable by both Lambda and Fargate.

The WebSocket notification layer is refactored into a shared client library so both execution contexts can emit events with the same schema. Idempotency is enforced at the database level: Fargate checks if `requestId` already exists in DSQL before processing; SQS message deduplication prevents duplicate enqueues from Lambda.

Deployment follows a phased rollout: CDK deploys new infrastructure (queue, Fargate, IAM) alongside existing Lambda stack, feature flag defaults to `false` (synchronous flow), operator enables flag for 10% of traffic, monitors for 48 hours, scales to 100% if metrics are healthy. Rollback is flag toggle, no redeployment required.

### Order of Operations

1. **Infrastructure first** — Deploy CDK stacks in this sequence:
   - `LlmQueue` construct (SQS queue, DLQ, CloudWatch alarms)
   - `FargateTask` construct (ECS cluster, task definition, IAM roles, log group)
   - Grant permissions: task role → DSQL, S3, SQS, WebSocket API
   - Deploy without traffic (task desiredCount = 0 initially)

2. **Shared libraries** — Extract reusable logic before modifying Lambda or creating Fargate:
   - `src/shared/lib/websocket-client.ts` from `connection-manager.ts`
   - `src/shared/types/queue-messages.ts` with Zod schemas
   - Verify existing `dsql-client.ts` and `s3-client.ts` are importable by Fargate

3. **Fargate handler implementation** — Build Docker image and task handler:
   - Implement `index.ts` SQS polling loop
   - Port artifact generation logic to `artifact-generator.ts`
   - Port chat logic to `chat-responder.ts`
   - Write unit tests for handlers (table-driven, mock Bedrock/DSQL/S3)
   - Build and push Docker image to ECR

4. **Lambda modifications** — Update API handlers to support async flow:
   - Add `queue-client.ts` wrapper
   - Modify `generate.ts` and `send-message.ts` with feature flag branching
   - Update unit tests to verify both flows
   - Deploy Lambda changes (feature flag off, no traffic routed to new flow)

5. **Integration testing** — Validate end-to-end flow in staging:
   - Manually enable feature flag for test tenant
   - Send artifact generation request via API
   - Verify SQS message enqueued
   - Verify Fargate task processes message
   - Verify S3 object created, DSQL record updated
   - Verify WebSocket event received by frontend
   - Verify idempotency: duplicate request does not reprocess

6. **Production rollout** — Gradual traffic migration:
   - Set Fargate ECS Service `desiredCount: 1` (warm task)
   - Enable `fargateEnabled` flag for 10% of artifact generation requests
   - Monitor for 48 hours: SQS queue depth, Fargate task duration, error rate, WebSocket delivery success rate
   - If metrics healthy, scale to 50%, then 100%
   - Keep synchronous Lambda code for 30 days post-100% rollout

### Dependencies

**Internal:**
- **T6-002 completion** — Feature flag infrastructure must exist in DSQL `feature_flags` table; Lambda handlers must have flag-checking logic pattern
- **T2-004 completion** — WebSocket event schemas must be stable; frontend expects `artifact.completed` and `chat.response` events

**External:**
- **ECR repository** — `prometheus/llm-processor` must be created manually or via CDK before Docker push
- **VPC configuration** — Fargate tasks require VPC with private subnets and NAT Gateway for Bedrock egress; VPC endpoint for API Gateway Management API if fully private
- **KMS key** — SQS encryption requires KMS key provisioned with grants for Lambda (SendMessage) and Fargate (ReceiveMessage, DeleteMessage)

**Blocked by:**
- None — this orbit can begin immediately after proposal approval

**Blocks:**
- **T6-004** — Background job processing orbit will reuse the Fargate task pattern established here

---

## Risk Surface

### Edge Cases

**SQS message arrives but Fargate task is scaling from 0 → 1**
- **Scenario:** Queue has been idle, ECS Service is at desiredCount 0, message arrives
- **Impact:** Task startup takes 15-20 seconds, violates "begin processing within 30 seconds" acceptance boundary if scaling is slow
- **Mitigation:** Configure ECS Service with `desiredCount: 1` minimum, use target tracking scaling on queue depth metric (`ApproximateNumberOfMessagesVisible > 5` triggers scale-up), add CloudWatch alarm on `ApproximateAgeOfOldestMessage > 30` to detect cold-start issues

**Bedrock returns 200k token response, Fargate task OOMs**
- **Scenario:** Claude generates unusually verbose artifact, response exceeds 4GB memory allocation
- **Impact:** Task killed by ECS, message returns to SQS, retry loop depletes retry count, lands in DLQ
- **Mitigation:** Implement streaming response handler in `bedrock-client.ts` that writes chunks to S3 as they arrive instead of buffering entire response, monitor ECS `MemoryUtilization` metric, set up alarm at 90% utilization, add task-level timeout at 14 minutes to prevent runaway memory growth

**WebSocket connection expired before Fargate completes**
- **Scenario:** User starts artifact generation, Fargate task takes 10+ minutes, WebSocket connection expires after 2-hour idle timeout
- **Impact:** Fargate posts event to stale connection, receives 410 Gone, logs error but task succeeds
- **Mitigation:** `websocket-notifier.ts` handles 410 gracefully by logging warning without failing task, frontend polls artifact status endpoint as fallback if WebSocket event not received within expected timeframe, include connection age check before posting (query `websocket_connections` table for `lastActiveAt` timestamp)

**Duplicate SQS message due to at-least-once delivery**
- **Scenario:** Fargate task processes message, crashes before deleting from queue, message becomes visible again, second task processes duplicate
- **Impact:** Duplicate Bedrock invocation, wasted compute cost, duplicate S3 objects, confused DSQL state
- **Mitigation:** Implement idempotency check at start of handler: query DSQL for existing record with matching `requestId`, if found and status is `completed`, skip processing and delete message, use `requestId` as SQS FIFO deduplication ID, add UNIQUE constraint on `artifacts.request_id` column to prevent duplicate writes

**Lambda enqueues message but SQS throttles SendMessage**
- **Scenario:** Burst of 100+ concurrent requests, SQS enforces per-action throttle limits
- **Impact:** Lambda returns 500 to user, request lost, user must retry
- **Mitigation:** Implement exponential backoff with jitter in `queue-client.ts` for SendMessage calls (AWS SDK default retry is 3 attempts), add CloudWatch alarm on Lambda `Errors` metric filtered by SQS throttling, if sustained throttling, request SQS limit increase via AWS Support

### Regressions

**Existing Lambda handlers must continue working when feature flag is off**
- **Risk:** Introducing queue-client import or feature flag check logic breaks existing synchronous flow
- **Impact:** All artifact generation and chat requests fail for users not on the new flow
- **Mitigation:** Unit tests must cover both branches: `fargateEnabled=true` path and `fargateEnabled=false` path, integration tests run against both flows, deployment plan keeps synchronous code for 30 days, manual QA verification in staging before production deployment

**WebSocket event schema drift breaks frontend**
- **Risk:** Fargate emits events with different field names or types than Lambda currently emits
- **Impact:** Frontend fails to parse events, users see no completion notifications
- **Mitigation:** Use shared `src/shared/types/websocket-events.ts` for event definitions, Fargate and Lambda both import same types, add JSON schema validation test that asserts Fargate-emitted events match frontend's expected schema (from T2-004 context)

**DSQL transaction deadlock from concurrent Fargate tasks**
- **Risk:** Two tasks process requests for same orbit simultaneously, both try to update `orbits` table status, deadlock occurs
- **Impact:** One task fails, message returns to SQS, retry succeeds but adds latency
- **Mitigation:** Implement transaction retry logic with exponential backoff in `result-persister.ts`, use row-level locks (`SELECT ... FOR UPDATE`) when reading orbit state before updating, monitor Aurora `Deadlocks` metric, if consistently >10/hour, refactor to optimistic locking pattern

### Security Considerations

**Fargate task role has overly broad S3 permissions**
- **Risk:** Task role grants `s3:*` on entire bucket, allowing read/write of other tenants' artifacts
- **Impact:** Tenant data leakage if task logic has bug or is exploited
- **Mitigation:** Scope task role to specific S3 prefix per tenant: `s3:PutObject` on `arn:aws:s3:::prometheus-artifacts-prod/${tenantId}/*`, enforce via IAM policy, add S3 Bucket Policy with condition `StringEquals: {"s3:ExistingObjectTag/tenant_id": "${tenantId}"}`, tag all objects with tenant ID during upload

**SQS message body logged to CloudWatch, contains user prompt data with potential PII**
- **Risk:** Prompts may include user-generated content with names, emails, sensitive project details
- **Impact:** Compliance violation (GDPR, CCPA), data retention exceeds 4-hour SQS limit if stored in logs
- **Mitigation:** Redact message body in logger calls, only log metadata: `requestId`, `userId`, `tenantId`, `messageType`, `timestamp`, store prompt data in S3 with encryption at rest and lifecycle policy (delete after 90 days), enable SQS encryption with KMS key, set SQS message retention to 4 hours as specified

**Malicious actor bypasses Lambda validation by sending crafted SQS message directly**
- **Risk:** If SQS queue policy allows external SendMessage, attacker could inject arbitrary prompts or corrupt requestId values
- **Impact:** Resource exhaustion from expensive Bedrock calls, privilege escalation if tenantId is manipulated
- **Mitigation:** SQS queue policy restricts SendMessage to Lambda execution role ARN only, no public access, validate message schema in Fargate handler using Zod before processing (defense in depth), add request size limits in Lambda (max 500KB prompt data), implement rate limiting at API Gateway layer

**IAM role confusion between task execution role and task role**
- **Risk:** Granting Bedrock/DSQL/S3 permissions to execution role instead of task role, or vice versa
- **Impact:** Task cannot access required resources, or logs contain secrets from execution role permissions
- **Mitigation:** Follow AWS best practice: execution role has only ECR pull (`ecr:GetAuthorizationToken`, `ecr:BatchGetImage`) and CloudWatch logs (`logs:CreateLogStream`, `logs:PutLogEvents`), task role has runtime permissions (DSQL, S3, SQS, Bedrock, WebSocket), validate via CDK `cdk diff` review in pre-deploy gate

### Performance Implications

**SQS long-polling adds latency to task startup**
- **Expected behavior:** 20-second wait time means tasks may idle for up to 20 seconds when queue is empty before receiving message
- **Impact:** User waits extra 0-20 seconds before processing begins
- **Mitigation:** Use target tracking scaling to maintain 1-2 warm tasks during business hours, reduce long-poll wait time to 5 seconds if latency is consistently >10 seconds at p95, monitor `ApproximateAgeOfOldestMessage` metric

**Fargate cold-start from 0→1 tasks exceeds 30-second acceptance boundary**
- **Expected behavior:** ECS Fargate typically starts tasks in 10-20 seconds, but ECR pull + task initialization can occasionally take 40+ seconds
- **Impact:** Violates acceptance criteria, users see delays on first request of the day
- **Mitigation:** Keep `desiredCount: 1` minimum (costs ~$0.05/hour for 1 idle task), use ECS Exec-based healthcheck to verify task is ready before routing traffic, add CloudWatch alarm on task startup duration p95 > 30s

**Concurrent DSQL writes from 10 Fargate tasks saturate connection pool**
- **Expected behavior:** 10 tasks × 10 connections per task = 100 connections, Aurora max is 100
- **Impact:** Connection acquisition timeouts, failed artifact writes, retry storms
- **Mitigation:** Configure task connection pool with `max: 5` (10 tasks × 5 = 50 connections at peak, 50% headroom), implement connection retry with exponential backoff, use Aurora read replicas for connection ID lookups (read-heavy query), monitor `DatabaseConnections` CloudWatch metric

**S3 PutObject from 10 concurrent tasks triggers request rate throttling**
- **Expected behavior:** S3 bucket has 3500 PUT/s baseline rate, 10 concurrent 10MB uploads should not throttle
- **Impact:** If throttled, tasks retry, adding latency
- **Mitigation:** Use S3 Transfer Acceleration if consistent throttling observed, partition bucket by `tenantId` prefix to distribute load (S3 scales per prefix), add exponential backoff on 503 responses in `result-persister.ts`

---

## Scope Estimate

### Complexity Assessment

**Medium-High Complexity**

**Justification:**
- Introducing Fargate and SQS to a previously Lambda-only architecture requires new CDK constructs, IAM patterns, and operational knowledge
- Extracting synchronous Bedrock logic into async handlers with idempotency, retries, and graceful degradation is non-trivial
- Maintaining backward compatibility via feature flags adds branching logic to API handlers
- Docker image build and ECR integration introduces new CI/CD steps
- WebSocket notification from Fargate requires cross-service IAM grants and connection lookup logic
- Not "high" because the business logic (Bedrock prompts, artifact storage) is already implemented and tested — this orbit is primarily a deployment pattern change

### Work Breakdown

**Orbit 1: Infrastructure and Shared Libraries (this proposal)**
- Create CDK constructs for SQS queue and Fargate task definition
- Extract WebSocket client into shared library
- Define queue message types and Zod schemas
- Implement queue-client wrapper in Lambda layer
- Build Docker image with multi-stage build
- Deploy infrastructure to staging, verify with manual testing
- **Files affected:** 15 (9 create, 6 modify)
- **Estimated duration:** 5-7 days with testing

**Orbit 2: Fargate Handler Implementation**
- Port artifact generation logic to Fargate handler
- Port chat response logic to Fargate handler
- Implement Bedrock client with retries and streaming
- Implement WebSocket notifier with 410 handling
- Implement result persister with S3 and DSQL atomicity
- Write table-driven unit tests for all handlers
- **Files affected:** 12 (10 create, 2 modify)
- **Estimated duration:** 4-6 days

**Orbit 3: Lambda Integration and Rollout**
- Modify Lambda API handlers with feature flag branching
- Update Lambda unit tests to cover both flows
- Write end-to-end integration test for async flow
- Deploy to production with `fargateEnabled=false`
- Enable flag for 10% of traffic, monitor for 48 hours
- Scale to 100%, monitor for 7 days before removing feature flag
- **Files affected:** 6 (3 modify, 3 test files)
- **Estimated duration:** 3-5 days with monitoring windows

**Total Orbit Count:** 3 orbits  
**Total Files Affected:** 33 files (19 create, 11 modify, 3 test-only)  
**Total Estimated Duration:** 12-18 days (excludes monitoring windows between rollout phases)

### Test Coverage

**Unit Tests:**
- `queue-client.test.ts` — verify SQS message construction, enqueue retry logic
- `artifact-generator.test.ts` — table-driven tests for valid request, Bedrock throttling, S3 failure, DSQL conflict, idempotency check
- `chat-responder.test.ts` — table-driven tests for valid request, long response streaming, WebSocket 410 handling
- `message-validator.test.ts` — Zod schema validation for all message types
- `websocket-notifier.test.ts` — connection lookup, post event success/failure paths
- `result-persister.test.ts` — S3 upload with ETag verification, DSQL transaction commit/rollback

**Integration Tests:**
- `fargate-llm-flow.test.ts` — end-to-end: API POST → SQS enqueue → Fargate process → S3 write → DSQL update → WebSocket event
- `fargate-idempotency.test.ts` — duplicate request handling via requestId uniqueness
- `fargate-failure-recovery.test.ts` — Bedrock throttling triggers retry, DLQ routing after 3 failures

**Manual Tests (pre-production):**
- Cold-start timing: measure ECS task startup from 0→1
- Cost validation: run 100 artifact requests, validate per-request cost < $0.05
- Backward compatibility: verify synchronous Lambda flow still works with `fargateEnabled=false`

**Estimated Test Count:** 45 test cases (35 unit, 10 integration)

---

## Human Modifications

Pending human review.