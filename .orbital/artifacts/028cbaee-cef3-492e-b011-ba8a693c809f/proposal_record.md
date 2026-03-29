# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2025-02-17  
**Intent:** T6-003  
**Context Package:** CTX-INT-T6-003 (intent-specific)  
**Trust Tier:** 2 — supervised

---

## Interpreted Intent

Prometheus V1 currently executes all LLM operations synchronously within Lambda functions, causing timeout failures when Bedrock or external LLM APIs take longer than Lambda's 15-minute execution limit. This orbit decouples HTTP request handling from LLM execution by introducing an asynchronous processing pipeline: Lambda functions accept user requests and immediately return acknowledgment after writing to SQS, while a pool of Fargate tasks consumes queued messages and executes the long-running LLM operations without time constraints.

The transformation affects two specific workflows:
1. **Artifact generation** — Users request complex artifacts (proposals, context packages, intent documents); Lambda queues the request, Fargate generates via LLM, stores result in S3, updates DSQL, and broadcasts completion via WebSocket
2. **AI chat** — Users send multi-turn conversational messages; Lambda queues the message, Fargate processes with conversation history, streams LLM response, stores in DSQL, and broadcasts reply via WebSocket

The critical architectural shift is **elimination of Lambda-LLM coupling**: Lambda becomes purely an ingress gateway (validate → persist → queue → respond), while Fargate becomes the execution substrate for all LLM interactions. This separates API response latency (must be <500ms) from LLM processing duration (can be minutes), enabling the system to handle arbitrarily complex prompts without user-visible timeout errors.

The implementation preserves existing HTTP APIs and WebSocket protocols — frontend code requires zero changes. Users experience improved reliability (no timeouts) with identical request/response patterns, plus real-time progress notifications during long-running operations.

---

## Implementation Plan

### Files to Create

**Fargate Task Implementation:**
- `src/workers/llm-processor/index.ts` — Main entrypoint; SQS long-polling loop, message routing to handlers, graceful shutdown on SIGTERM
- `src/workers/llm-processor/handlers/artifact-generator.ts` — Artifact generation logic: retrieve prompt from S3, invoke Bedrock, stream response, write result to S3, update DSQL, broadcast WebSocket event
- `src/workers/llm-processor/handlers/chat-processor.ts` — Chat message processing: load conversation history from DSQL, invoke Bedrock with context, stream response, store message, broadcast reply
- `src/workers/llm-processor/handlers/index.ts` — Handler registry and message routing by `taskType`
- `src/workers/llm-processor/config.ts` — Environment variable parsing, connection pool configuration, retry policies
- `src/workers/llm-processor/Dockerfile` — Multi-stage build: Node.js 20 base, dependency caching, production-optimized image (<300MB)
- `src/workers/llm-processor/handlers/artifact-generator.test.ts` — Unit tests for artifact generation: success path, LLM timeout, S3 write failure, DSQL update race condition
- `src/workers/llm-processor/handlers/chat-processor.test.ts` — Unit tests for chat processing: multi-turn context, streaming response handling, connection history retrieval

**Infrastructure Definitions:**
- `infra/ecs/llm-processor-task.ts` — ECS task definition: 2 vCPU, 4GB memory, CloudWatch logs configuration, environment variables, secrets references
- `infra/ecs/llm-processor-service.ts` — ECS service: desired count 2, autoscaling policy (target queue depth: 5 messages), deployment strategy (rolling, min 50% healthy)
- `infra/iam/fargate-task-role.ts` — IAM policy: SQS receive/delete, S3 GetObject/PutObject (artifacts bucket), DSQL execute-statement (artifacts/chat_messages tables only), Secrets Manager get-secret-value (LLM credentials), WebSocket execute-api (broadcast)
- `infra/vpc/dsql-endpoint.ts` — VPC endpoint for DSQL access from private subnet (PrivateLink)
- `infra/sqs/llm-tasks-queue.ts` — SQS FIFO queue configuration refinement: message retention 12h, visibility timeout 300s, redrive policy to DLQ after 3 attempts

**Database Migration:**
- `db/migrations/006_add_status_tracking.sql` — Add `status` enum column to `artifacts` and `chat_messages` tables; default value `queued`, index on `status` for efficient polling queries; add `processing_started_at` and `completed_at` timestamp columns

**Type Definitions:**
- `src/types/sqs-messages.ts` — Message payload schemas: `ArtifactGenerationTask`, `ChatProcessingTask` with Zod validation; includes `taskId`, `taskType`, `userId`, `s3PromptKey`, `metadata`
- `src/types/task-status.ts` — Status enum: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`; status transition validation rules

**Shared Libraries:**
- `src/lib/llm/streaming-handler.ts` — Utility for handling Bedrock streaming responses: buffer management, token counting, timeout detection, partial result preservation on SIGTERM

### Files to Modify

**Lambda Functions:**
- `src/functions/artifacts/generate/index.ts` — Replace synchronous Bedrock invocation with: (1) write artifact record to DSQL with status `queued`, (2) upload prompt to S3 with key `prompts/{artifactId}.json`, (3) publish SQS message with S3 reference, (4) return HTTP 202 with `taskId` and polling URL
- `src/functions/chat/message/index.ts` — Replace synchronous streaming with: (1) write message to DSQL with status `queued`, (2) upload message content to S3 (if >4KB), (3) publish SQS message, (4) return HTTP 202 with `messageId` and WebSocket channel
- `src/functions/artifacts/generate/handler.test.ts` — Update tests to verify SQS publishing instead of Bedrock invocation; add tests for S3 prompt upload, DSQL status tracking, idempotency key generation
- `src/functions/chat/message/handler.test.ts` — Update tests for new async flow; verify message queueing, WebSocket notification of "processing" state

**Shared Libraries:**
- `src/lib/sqs/publisher.ts` — Add `publishLLMTask()` helper with automatic deduplication ID generation, message group ID assignment, error handling with CloudWatch metric emission
- `src/lib/dsql/client.ts` — Add connection pooling configuration for Fargate context: `max: 5` connections per task, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 2000`, exponential backoff retry logic
- `src/lib/websocket/broadcaster.ts` — Add `broadcastTaskProgress()` method for standardized task status events: `task.queued`, `task.processing`, `task.completed`, `task.failed`
- `src/services/artifact/service.ts` — Extract LLM invocation logic into standalone `generateArtifactContent()` function (currently embedded in Lambda handler) for reuse in Fargate task
- `src/services/chat/service.ts` — Extract conversation history loading and LLM invocation into `processChatMessage()` function for Fargate reuse

**Infrastructure:**
- `infra/iam/lambda-execution-role.ts` — Add `sqs:SendMessage` permission to LLM tasks queue; add `s3:PutObject` permission to prompts prefix (`prompts/*`)

**Type Definitions:**
- `src/types/artifact.ts` — Add `status` field to `Artifact` interface with enum type; add `processing_started_at` and `completed_at` optional timestamps
- `src/types/chat.ts` — Add `status` field to `ChatMessage` interface
- `src/types/websocket-events.ts` — Add `TaskProgressEvent` schema for real-time status broadcasts

### Approach

The implementation follows a **three-phase decoupling strategy**:

**Phase 1 — Lambda Gateway Transformation (Days 1-2):**  
Modify existing Lambda handlers to act as ingress gateways: validate request, write DSQL record with `status: queued`, upload prompt/content to S3 (removing inline data from SQS messages), publish to SQS FIFO queue with deterministic deduplication IDs, return HTTP 202 with task tracking URL. This phase preserves all existing interfaces — API Gateway routes, request schemas, JWT validation — while changing only the execution model from synchronous to asynchronous.

**Phase 2 — Fargate Task Development (Days 3-5):**  
Build the long-running worker container with message polling loop, handler routing (artifact vs. chat), status transition management (queued → processing → completed/failed), LLM streaming integration with Bedrock client reuse, S3 result persistence, DSQL atomic updates with optimistic locking, WebSocket broadcasting with failure tolerance, graceful SIGTERM handling (complete in-flight request, preserve partial results, update status to failed with context). Use connection pooling for DSQL (5 max per task), long polling for SQS (20s wait time), structured JSON logging to CloudWatch with request correlation IDs.

**Phase 3 — Infrastructure Provisioning & Integration (Days 6-7):**  
Deploy ECS task definition and service to existing `prometheus-workers` cluster, configure autoscaling based on SQS `ApproximateNumberOfMessagesVisible` metric (scale up at 5 messages, scale down at 0 messages with 5-minute cooldown), provision VPC endpoint for DSQL private subnet access, update IAM policies for least-privilege scoping, apply database migration to add status columns, deploy Lambda changes with feature flag (allows rollback without data loss), execute integration tests with synthetic load (100 artifact requests, 500 chat messages over 10 minutes), validate end-to-end flow, enable CloudWatch alarms for queue depth, task failure rate, and status transition anomalies.

**Pattern Alignment:**  
- **Lambda handlers** follow established `respondCreated()` + service delegation pattern (see `orbits/create/index.ts`)
- **SQS publishing** uses FIFO queue with message group ID per task and content-based deduplication (see `src/lib/sqs/publisher.ts`)
- **DSQL status updates** use optimistic locking `WHERE status = 'queued'` to prevent race conditions (see `orbit/service.ts`)
- **WebSocket events** follow `{domain}.{action}` naming convention with fire-and-forget delivery (see `websocket/broadcaster.ts`)
- **Fargate task** adopts long-polling SQS consumption with single-message processing and exponential backoff retry (emerging pattern, defined in this orbit)

### Order of Operations

1. **Database schema evolution** — Apply migration 006 to add `status`, `processing_started_at`, `completed_at` columns to `artifacts` and `chat_messages` tables; backfill existing records with `status: completed`
2. **Type definitions** — Create SQS message schemas, task status enums, update artifact/chat domain types with status fields
3. **Shared library enhancements** — Extend DSQL client for connection pooling, add SQS publisher helper, add WebSocket broadcaster task progress method
4. **Domain logic extraction** — Refactor LLM invocation logic from Lambda handlers into reusable service functions
5. **Lambda handler modifications** — Update artifact and chat handlers to queue tasks instead of executing LLM calls; maintain HTTP 202 responses
6. **Fargate task implementation** — Build worker container with message handlers, implement artifact generation and chat processing logic
7. **Infrastructure provisioning** — Deploy ECS task definition, service, IAM roles, VPC endpoints
8. **Integration testing** — Execute end-to-end tests with synthetic load, validate status transitions, WebSocket delivery, error handling
9. **Monitoring setup** — Deploy CloudWatch alarms for queue depth, task failures, status anomalies
10. **Canary deployment** — Route 10% of requests to new async flow, monitor for 24 hours, full rollout if metrics pass

### Dependencies

**Internal Systems:**
- ✅ **ECS Cluster (`prometheus-workers`)** — Provisioned in T6-001; capacity provider configured for Fargate Spot
- ✅ **SQS FIFO Queue (`prometheus-llm-tasks.fifo`)** — Created in T6-002; DLQ configured with maxReceiveCount: 3
- ✅ **WebSocket Connection Manager** — Operational per T5-003; connection registry in DSQL `websocket_connections` table
- ✅ **CloudWatch Log Groups** — Log group `/ecs/prometheus/llm-processor` exists from T6-001
- ⚠️ **DSQL Connection Pooling Strategy** — Current Lambda implementation uses single connection per invocation; Fargate requires explicit pooling with `pg-pool` or equivalent (must implement in Phase 2)
- ⚠️ **S3 Artifact Bucket IAM Policies** — Currently grants `s3:PutObject` to Lambda execution role only; must extend to Fargate task role

**External Services:**
- ✅ **AWS Bedrock** — LLM API accessible from private subnet via NAT Gateway or VPC endpoint (verify endpoint availability in `us-east-1`)
- ⚠️ **AWS Secrets Manager VPC Endpoint** — Required for retrieving LLM credentials from private subnet; must provision `com.amazonaws.us-east-1.secretsmanager` endpoint
- ⚠️ **DSQL VPC Endpoint** — Required for private subnet access; must provision DSQL-specific PrivateLink endpoint

**Prior Orbits:**
- **T6-001 (Container Foundation)** — Completed; provides ECS cluster, base IAM roles, VPC subnet structure
- **T6-002 (SQS Integration)** — Completed; provides FIFO queue, DLQ, Lambda SQS send permissions
- **T5-003 (WebSocket Manager)** — Completed; provides connection registry and broadcast service

**Blockers:**
- 🚨 **Critical:** DSQL VPC endpoint provisioning — Fargate tasks cannot connect to DSQL from private subnet without endpoint; must deploy before Phase 3
- 🚨 **Critical:** Secrets Manager VPC endpoint — Fargate tasks cannot retrieve LLM credentials without endpoint; must deploy before Phase 2 testing
- ⚠️ **Non-blocking:** Bedrock VPC endpoint — Can use NAT Gateway for initial deployment; endpoint optimization deferred to cost reduction orbit

---

## Risk Surface

### Edge Cases

**Concurrent Status Updates:**  
Lambda writes `status: queued` at T₀; Fargate pulls message and attempts to update `status: processing` at T₀+50ms; if Lambda transaction commits at T₀+60ms due to network latency, Fargate's update may see stale `status` value. **Mitigation:** Use optimistic locking with `WHERE status = 'queued'` in Fargate's UPDATE query; if affected rows = 0, retry with exponential backoff (3 attempts max); log race condition events to CloudWatch for detection. **Acceptance:** Zero data corruption events in integration tests; race conditions logged but do not fail task execution.

**SQS Message Redelivery During Processing:**  
Fargate task pulls message, updates status to `processing`, begins LLM invocation (expected duration: 90s), but task crashes at 60s; SQS visibility timeout expires at 300s, message returns to queue; second task picks up message and sees `status: processing` instead of `queued`. **Mitigation:** Fargate handler checks `processing_started_at` timestamp on `status: processing` records; if timestamp is >10 minutes old, treat as stale and resume processing (idempotent); if <10 minutes, log warning and delete message (another task is actively processing). **Acceptance:** Duplicate processing rate <0.1%; stale detection logs appear in CloudWatch.

**Partial S3 Upload on Fargate Termination:**  
Fargate task receives SIGTERM during multi-part S3 upload (e.g., 50MB artifact content); upload aborts mid-stream; task terminates before DSQL update; message returns to queue; second task attempts to resume but finds incomplete S3 object. **Mitigation:** Use S3 multipart upload with `uploadId` tracking in DSQL `metadata` column; on task restart, check for existing upload and resume from last completed part; implement 30s graceful shutdown window (`stopTimeout: 30` in ECS task definition) to allow abort + cleanup. **Acceptance:** Graceful shutdown completes 95% of in-flight uploads; aborted uploads cleaned up via S3 lifecycle policy after 24 hours.

**WebSocket Connection Expiry During Processing:**  
User initiates artifact generation at T₀, WebSocket connection active; Fargate begins processing at T₀+10s; user's browser loses network connectivity at T₀+60s, WebSocket disconnects; task completes at T₀+120s and attempts to broadcast to expired `connectionId`. **Mitigation:** WebSocket broadcaster resolves `userId → connectionIds[]` and filters expired connections (TTL < NOW()); failed broadcasts log warning but do not throw exceptions; task marks DSQL status as `completed` regardless of broadcast success; frontend polls `/artifacts/{id}/status` as fallback. **Acceptance:** Broadcast failure rate <5% during network instability; no data loss in DSQL/S3.

**Authorization Code Replay in Chat Context:**  
User submits chat message with JWT token; Lambda validates token and queues message; token expires at T₀+300s; Fargate task dequeues at T₀+310s and cannot validate user identity for conversation history retrieval. **Mitigation:** Lambda extracts `userId` from JWT and embeds in SQS message payload (not the token itself); Fargate trusts the `userId` from SQS (implicit authentication via queue source); implement SQS message expiry (12-hour retention) to prevent stale user context. **Acceptance:** Zero authentication failures in Fargate tasks; message age metric tracked in CloudWatch.

### Regressions

**Existing Artifact Generation API Response Schema:**  
Current Lambda implementation returns HTTP 200 with complete artifact content inline in response body; new implementation returns HTTP 202 with `taskId` and polling URL. **Impact:** Frontend code expects synchronous response; changing to 202 breaks polling logic. **Mitigation:** Phase 1 deploys Lambda changes behind feature flag `ENABLE_ASYNC_ARTIFACTS`; frontend updated to handle 202 status code before flag enabled; integration tests validate both code paths. **Rollback:** Disable feature flag, Lambda reverts to synchronous execution.

**WebSocket Event Schema for Chat Replies:**  
Current implementation streams chat responses token-by-token via WebSocket; new implementation buffers complete response in Fargate and broadcasts single event with full message. **Impact:** Frontend expects incremental updates for typing indicator; single event feels less responsive. **Mitigation:** Phase 2 implements streaming from Fargate: broadcast `chat.reply.chunk` events every 50 tokens during LLM streaming; preserve existing frontend streaming handler. **Acceptance:** User-perceived latency unchanged (<2s to first token).

**DSQL Query Performance with Status Index:**  
Adding `status` column and index to `artifacts` table may degrade existing query performance (e.g., `SELECT * FROM artifacts WHERE user_id = ?`). **Impact:** Dashboard load time increases if index scan is slower than sequential scan for small result sets. **Mitigation:** Run EXPLAIN ANALYZE on critical queries before/after migration; add composite index `(user_id, status, created_at DESC)` to cover dashboard query pattern; monitor query latency metrics in CloudWatch. **Acceptance:** Dashboard load time p95 <500ms (unchanged from current).

**S3 Storage Costs for Prompt Content:**  
Current implementation passes prompt content inline in SQS messages; new implementation uploads prompts to S3 (1-100KB per prompt). **Impact:** S3 storage costs increase by ~$5/month for 10k prompts (negligible), but adds S3 API call costs (PUT + GET per task = $0.0004 per request). **Mitigation:** Use S3 Intelligent-Tiering with 30-day transition to IA; delete prompts after artifact completion (lifecycle rule). **Acceptance:** S3 costs remain <$10/month increase.

### Security

**SQS Message Content Inspection:**  
SQS messages traverse AWS internal network but are not encrypted at rest by default; messages contain S3 keys referencing user prompts, which may include sensitive project details. **Mitigation:** Enable SQS server-side encryption with AWS KMS (use default `alias/aws/sqs` key for cost efficiency); Fargate task role granted `kms:Decrypt` on SQS key; S3 prompts also encrypted with `AES256` (S3-managed keys). **Acceptance:** All SQS messages encrypted; KMS API call latency adds <10ms per message.

**Fargate Task IAM Over-Privilege:**  
Task role requires `dsql:ExecuteStatement` permission; if not scoped correctly, task could read/write any DSQL table including `users`, `billing`, `api_keys`. **Mitigation:** Implement resource-level IAM policy with `Resource` ARN pattern restricting to `artifacts` and `chat_messages` tables only; integration tests validate task cannot query `users` table (expect 403). **Acceptance:** Principle of least privilege enforced; policy limited to 2 tables + 4 operations (SELECT, INSERT, UPDATE, DELETE).

**LLM Credential Exposure in CloudWatch Logs:**  
Fargate task retrieves Bedrock API key from Secrets Manager; if logged during debug operations, credential appears in CloudWatch Logs. **Mitigation:** Wrap Secrets Manager retrieval in logging suppression block; scrub log messages for patterns matching `AKIA*` (AWS access keys) and `sk-*` (OpenAI keys); implement CloudWatch Logs data protection policy to mask secrets. **Acceptance:** Zero credential leaks in log review; CloudWatch data protection rules active.

**S3 Prompt Bucket Public Access:**  
Prompt content stored in S3 with keys like `prompts/{artifactId}.json`; if bucket policy misconfigured, prompts could be publicly readable. **Mitigation:** Enable S3 Block Public Access settings on prompts bucket; bucket policy explicitly denies `s3:GetObject` for `Principal: "*"`; grant access only to Lambda and Fargate task roles via IAM. **Acceptance:** Bucket scan shows zero public objects; AWS Trusted Advisor check passes.

### Performance

**SQS Long Polling Overhead:**  
Fargate task uses 20-second long polling (`WaitTimeSeconds: 20`) to reduce API calls; during high load (>10 messages in queue), polling delay adds 20s latency before task picks up message. **Mitigation:** Deploy multiple ECS tasks (service desired count: 2, max: 20) to distribute polling; each task polls independently, reducing effective wait time to `20s / task_count`; autoscaling policy triggers at queue depth >5 messages. **Acceptance:** p95 message pickup latency <30s during normal load, <60s during burst.

**DSQL Connection Handshake Latency:**  
Fargate task establishes new DSQL connection on startup; TLS handshake + authentication adds 200-500ms per connection; with connection pool size 5, cold start incurs 1-2.5s overhead. **Mitigation:** Connection pool configuration reuses connections across message processing (idle timeout: 30s); warm tasks maintain persistent connections; track connection age metric in CloudWatch. **Acceptance:** Connection overhead amortized across multiple messages; p50 task startup <8s, p95 <15s (including connection pool init).

**Bedrock Streaming Response Buffering:**  
LLM responses arrive in chunks (100-500 tokens per chunk); if Fargate buffers entire response in memory before writing to S3, memory usage spikes for large artifacts (100k tokens = ~20MB). **Mitigation:** Implement streaming S3 upload using `PassThrough` stream: write chunks to S3 multipart upload as they arrive from Bedrock; limit in-memory buffer to 5MB; use backpressure to throttle Bedrock consumption if S3 write lags. **Acceptance:** Peak memory usage <500MB during p95 artifact generation; no OOM events.

**WebSocket Broadcast Fanout Latency:**  
Single user may have multiple WebSocket connections (browser tab + mobile app); broadcasting task completion requires `SELECT connection_id FROM websocket_connections WHERE user_id = ?` query + N WebSocket API calls. **Mitigation:** Cache connection mappings in Fargate task memory (TTL: 60s); batch WebSocket API calls with parallelism limit 10; track broadcast duration metric. **Acceptance:** Broadcast latency p95 <2s for user with 5 connections; no WebSocket throttling errors.

---

## Scope Estimate

**Total Orbits:** 1  
**Duration:** 7-9 working days (assuming single developer)  
**Complexity:** High

### Justification

This orbit introduces **architectural complexity** across multiple dimensions:

1. **Distributed System Failure Modes:** Transitioning from synchronous Lambda execution to async SQS + Fargate introduces new failure scenarios (message loss, duplicate processing, status race conditions, connection pool exhaustion) that require careful mitigation design and integration testing.

2. **Infrastructure Provisioning:** Requires coordinating deployment of ECS task definitions, IAM policies, VPC endpoints, database migrations, and Lambda changes with rollback plan — significantly more complex than a Lambda-only change.

3. **Data Flow Transformation:** Current architecture has single atomic path (Lambda → Bedrock → DSQL); new architecture has 3 async hops (Lambda → SQS, SQS → Fargate, Fargate → WebSocket) with different failure characteristics at each hop.

4. **Integration Testing Scope:** End-to-end validation requires simulating long-running LLM requests (>15min), network partitions, Fargate task termination, SQS visibility timeout edge cases, and WebSocket connection churn — not achievable with simple unit tests.

**Not High Complexity Because:**  
- Core patterns (Lambda handler, SQS publishing, DSQL status tracking, WebSocket broadcasting) are established in prior orbits (T6-001, T6-002, T5-003)
- No novel algorithms or research required — SQS + Fargate for async processing is well-documented AWS pattern
- No data migration complexity — only adding status columns to existing tables, no backfill logic
- Frontend changes minimal — only updating response handling from 200 to 202, existing polling logic reusable

**Breakdown by Phase:**

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| **Phase 1 — Lambda Gateway** | 2 days | Modified Lambda handlers (artifacts, chat), SQS publisher helper, type definitions, unit tests |
| **Phase 2 — Fargate Task** | 3 days | Worker container (Dockerfile, handlers), connection pooling, streaming LLM integration, unit tests |
| **Phase 3 — Infrastructure** | 2 days | ECS task definition, IAM policies, VPC endpoints, database migration, CloudWatch alarms |
| **Integration Testing** | 2 days | End-to-end synthetic load tests, error injection, rollback validation, performance benchmarking |

**Test Coverage Estimate:**

- **Unit Tests:** 35 test cases across Lambda handlers (8), Fargate handlers (12), shared libraries (10), infrastructure (5)
- **Integration Tests:** 15 scenarios covering normal flow (3), error handling (6), concurrency (3), performance (3)
- **Smoke Tests:** 5 critical paths for canary deployment validation

**Risk Buffer:** +2 days for unforeseen issues (DSQL VPC endpoint provisioning delays, Fargate cold start tuning, SQS visibility timeout edge cases)

---

## Human Modifications

Pending human review.