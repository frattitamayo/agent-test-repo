# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** T6-003  
**Orbit:** 1

---

## Codebase References

### Primary (will be modified or created)

**Lambda Functions:**
- `src/functions/artifacts/generate/index.ts` — HTTP handler for artifact generation requests
- `src/functions/chat/message/index.ts` — HTTP handler for AI chat message submissions
- `src/functions/artifacts/generate/handler.test.ts` — Tests for artifact generation flow
- `src/functions/chat/message/handler.test.ts` — Tests for chat message flow

**Fargate Tasks:**
- `src/workers/llm-processor/` — New directory for Fargate task implementation
- `src/workers/llm-processor/index.ts` — Main entrypoint for LLM processing tasks
- `src/workers/llm-processor/Dockerfile` — Container image definition
- `src/workers/llm-processor/handlers/artifact-generator.ts` — Artifact generation logic
- `src/workers/llm-processor/handlers/chat-processor.ts` — Chat message processing logic

**Infrastructure:**
- `infra/sqs/llm-tasks-queue.ts` — SQS FIFO queue definition for LLM task messages
- `infra/ecs/llm-processor-task.ts` — Fargate task definition and service configuration
- `infra/iam/fargate-task-role.ts` — IAM role and policies for Fargate tasks
- `infra/vpc/endpoints.ts` — VPC endpoints for Secrets Manager, S3, DSQL access

**Database Schema:**
- `db/migrations/006_add_status_tracking.sql` — Add `status` enum columns to `artifacts` and `chat_messages` tables

### Secondary (dependencies and interfaces)

**Shared Libraries:**
- `src/lib/dsql/client.ts` — DSQL connection pooling and query utilities
- `src/lib/sqs/publisher.ts` — SQS message publishing helpers
- `src/lib/websocket/broadcaster.ts` — WebSocket event broadcasting service
- `src/lib/s3/artifact-storage.ts` — S3 operations for artifact upload/retrieval
- `src/lib/llm/bedrock-client.ts` — AWS Bedrock integration layer
- `src/lib/secrets/manager.ts` — Secrets Manager credential retrieval

**Type Definitions:**
- `src/types/artifact.ts` — Artifact domain types and status enums
- `src/types/chat.ts` — Chat message types and conversation state
- `src/types/sqs-messages.ts` — SQS message payload schemas
- `src/types/websocket-events.ts` — WebSocket event payloads

**Existing Services:**
- `src/services/websocket/connection-manager.ts` — Manages active WebSocket connections by user/session ID
- `src/services/artifact/service.ts` — Artifact business logic (currently Lambda-local)
- `src/services/chat/service.ts` — Chat session management (currently Lambda-local)

### Tests

**Integration Tests:**
- `tests/integration/artifacts/generate-e2e.test.ts` — End-to-end artifact generation flow
- `tests/integration/chat/session-e2e.test.ts` — Chat session lifecycle tests
- `tests/integration/sqs/message-processing.test.ts` — SQS message consumption validation

**Unit Tests:**
- `src/workers/llm-processor/handlers/artifact-generator.test.ts`
- `src/workers/llm-processor/handlers/chat-processor.test.ts`
- `src/lib/sqs/publisher.test.ts`

---

## Architecture Context

### System Overview

Prometheus V1 follows a **serverless-first architecture** with Lambda functions handling synchronous HTTP/WebSocket traffic and Aurora DSQL for transactional state. The platform orchestrates AI-assisted software development through Projects → Trajectories → Intents → Orbits → Artifacts.

**Current State (Lambda-Only):**
- API Gateway → Lambda → DSQL/S3 for all operations
- Artifact generation: Lambda invokes Bedrock synchronously, writes result to S3, updates DSQL
- AI chat: Lambda streams Bedrock responses via WebSocket connection
- **Constraint:** 15-minute Lambda timeout causes failures for complex prompts (>50k tokens)

**Target State (Lambda + Fargate Hybrid):**
```
[API Gateway] → [Lambda] → [SQS FIFO Queue] → [Fargate Task Pool]
                    ↓                                ↓
                [DSQL: queued]                  [DSQL: processing]
                                                      ↓
                                            [LLM API via VPC Endpoint]
                                                      ↓
                                            [S3 + DSQL: completed]
                                                      ↓
                                         [WebSocket: broadcast event]
```

**Data Flow:**
1. **HTTP Ingress (Lambda):** Validate request → write DSQL record (status: `queued`) → publish SQS message → return HTTP 202 with task ID
2. **SQS → Fargate:** ECS service polls SQS → spawns task → task updates DSQL (status: `processing`)
3. **LLM Execution (Fargate):** Retrieve prompt from S3 → call Bedrock/LLM → stream response → write result to S3
4. **Completion (Fargate):** Update DSQL (status: `completed`) → publish WebSocket event → delete SQS message
5. **Error Handling (Fargate):** On failure, update DSQL (status: `failed`, error details) → send SQS to DLQ → broadcast error event

**Service Boundaries:**
- **Lambda:** HTTP protocol termination, request validation, synchronous DSQL writes, SQS publishing only
- **Fargate:** Long-running LLM interactions, S3 I/O, DSQL status updates, WebSocket broadcasting
- **SQS:** Decoupling layer — Lambda never calls Fargate directly; Fargate polls queue autonomously

**Infrastructure Constraints:**
- Fargate tasks run in private subnets (`10.0.128.0/20`) with NAT Gateway for LLM API egress
- VPC endpoints required: `com.amazonaws.region.secretsmanager`, `com.amazonaws.region.s3`, DSQL endpoint
- ECS cluster `prometheus-workers` uses Fargate Spot for cost optimization (10s cold start acceptable)
- SQS FIFO queue ensures message ordering per `MessageGroupId` (one group per artifact/chat session)

### Reference Documentation

- **Architecture:** `docs/architecture/system-overview.md` — Prometheus V1 high-level design
- **Infrastructure:** `docs/infrastructure/aws-resources.md` — Current AWS resource inventory
- **ADR-006:** `docs/adr/006-async-llm-processing.md` — Decision to use SQS + Fargate over Step Functions
- **WebSocket Protocol:** `docs/api/websocket-events.md` — Event schemas for real-time updates

---

## Pattern Library

### Lambda HTTP Handler Pattern

**Established Pattern:** See `src/functions/orbits/create/index.ts`

```typescript
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const logger = createLogger({ requestId: event.requestId });
  
  try {
    // 1. Parse and validate input
    const body = parseBody<CreateOrbitRequest>(event.body);
    validateOrThrow(body, CreateOrbitSchema);
    
    // 2. Extract auth context
    const userId = extractUserId(event);
    
    // 3. Execute business logic
    const result = await orbitService.create(userId, body);
    
    // 4. Return structured response
    return respondCreated(result);
  } catch (error) {
    logger.error('Orbit creation failed', { error });
    return respondError(error);
  }
};
```

**Key Conventions:**
- Structured logging with `requestId` correlation
- Zod schemas for validation (`validateOrThrow`)
- Service layer pattern (handlers delegate to `*Service` classes)
- Standard response helpers: `respondOK()`, `respondCreated()`, `respondError()`

### SQS Message Publishing

**Established Pattern:** See `src/lib/sqs/publisher.ts`

```typescript
interface TaskMessage {
  taskId: string;
  taskType: 'artifact-generation' | 'chat-processing';
  userId: string;
  s3Key: string; // Reference to input prompt, not inline content
  metadata: Record<string, unknown>;
}

await sqsPublisher.sendMessage({
  queueUrl: process.env.LLM_TASKS_QUEUE_URL,
  messageBody: JSON.stringify(taskMessage),
  messageGroupId: taskMessage.taskId, // FIFO ordering per task
  messageDeduplicationId: `${taskMessage.taskId}-${Date.now()}`, // Prevent duplicates
});
```

**Rules:**
- Never inline sensitive data in message body — use S3 references
- `messageGroupId` ensures ordered processing per artifact/chat session
- Idempotency key format: `{taskId}-{timestamp}`

### DSQL Status Tracking

**Established Pattern:** See `src/services/orbit/service.ts`

```typescript
enum ArtifactStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

await dsqlClient.query(
  `UPDATE artifacts 
   SET status = $1, updated_at = NOW(), processing_started_at = $2
   WHERE id = $3 AND status = 'queued'`,
  [ArtifactStatus.PROCESSING, new Date(), artifactId]
);
```

**Rules:**
- Status transitions are unidirectional: `queued → processing → completed/failed`
- Use optimistic locking: `WHERE status = 'queued'` prevents race conditions
- Timestamp columns: `created_at`, `updated_at`, `processing_started_at`, `completed_at`

### WebSocket Event Broadcasting

**Established Pattern:** See `src/services/websocket/broadcaster.ts`

```typescript
interface TaskProgressEvent {
  type: 'task.progress';
  taskId: string;
  status: ArtifactStatus;
  progress?: number; // 0-100 for streaming operations
  result?: { s3Key: string }; // Only present on completion
  error?: { code: string; message: string }; // Only present on failure
}

await webSocketBroadcaster.sendToUser(userId, {
  type: 'task.progress',
  taskId,
  status: 'completed',
  result: { s3Key: artifactS3Key },
});
```

**Rules:**
- Event types follow `{domain}.{action}` naming convention
- Connection mapping: `userId` → active WebSocket connection IDs stored in DSQL `websocket_connections` table
- Broadcast failures are logged but do not fail the task (fire-and-forget)

### Fargate Task Container Pattern

**Emerging Pattern (define in this orbit):**

```typescript
// src/workers/llm-processor/index.ts
import { SQS } from '@aws-sdk/client-sqs';
import { processMessage } from './handlers';

const sqs = new SQS({ region: process.env.AWS_REGION });
const queueUrl = process.env.LLM_TASKS_QUEUE_URL;

async function pollQueue() {
  while (true) {
    const { Messages } = await sqs.receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: 300, // 5 minutes
    });
    
    if (Messages?.length) {
      await processMessage(Messages[0]);
      await sqs.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: Messages[0].ReceiptHandle,
      });
    }
  }
}

pollQueue().catch(console.error);
```

**Key Decisions:**
- Long polling (20s `WaitTimeSeconds`) to reduce API calls
- Single-message processing (no batching) for simplicity in Orbit 1
- Graceful shutdown: `process.on('SIGTERM')` completes in-flight message before exit
- Visibility timeout (5 min) exceeds expected LLM response time (p95 <2 min)

### Anti-Patterns (Avoid)

**Lambda Direct Invocation:**
- Do NOT use `lambda.invoke()` to call Fargate tasks — always route through SQS
- Rationale: Synchronous coupling defeats the purpose of async architecture

**Inline Secrets in Environment Variables:**
- Do NOT pass LLM API keys via `ECS_TASK_DEFINITION.environment` — use Secrets Manager references
- Rationale: Secrets in env vars are visible in CloudWatch logs and ECS API responses

**Connection-Per-Request DSQL Pattern:**
- Do NOT create new DSQL connections for every query in Fargate — use connection pooling
- See: `src/lib/dsql/client.ts` — singleton pool with 10 max connections per task

**Blocking Fargate on WebSocket Delivery:**
- Do NOT fail task processing if WebSocket broadcast fails — log and continue
- Rationale: WebSocket is a notification channel, not transactional; S3/DSQL state is source of truth

---

## Prior Orbit References

### T6-001: Container Foundation

**Status:** Completed (2025-01-15)  
**Key Outcomes:**
- Created ECS cluster `prometheus-workers` with Fargate capacity provider
- Defined base IAM roles: `ecsTaskExecutionRole` (pull images, write logs), `ecsTaskRole` (application permissions)
- Provisioned CloudWatch log groups: `/ecs/prometheus/llm-processor`
- Established VPC subnet architecture: public (`10.0.0.0/20`), private (`10.0.128.0/20`)

**Relevant Artifacts:**
- `infra/ecs/cluster.ts` — ECS cluster configuration
- `infra/iam/ecs-base-roles.ts` — Execution and task roles
- `docs/infrastructure/ecs-setup.md` — Container runtime decisions

**Lessons Learned:**
- Fargate Spot reduced costs by 60% vs. on-demand; cold start acceptable (<10s p95)
- VPC endpoints for S3/Secrets Manager reduced NAT Gateway data transfer costs by $120/month
- CloudWatch Logs Insights queries required structured JSON logging (now standard)

### T6-002: SQS Integration

**Status:** Completed (2025-01-22)  
**Key Outcomes:**
- Created FIFO queue `prometheus-llm-tasks.fifo` with 12-hour message retention
- Implemented dead-letter queue `prometheus-llm-tasks-dlq` for failed messages (maxReceiveCount: 3)
- Lambda IAM policies grant `sqs:SendMessage` to LLM tasks queue
- SQS publishing helper library: `src/lib/sqs/publisher.ts`

**Relevant Artifacts:**
- `infra/sqs/llm-tasks-queue.ts` — Queue definitions
- `src/lib/sqs/publisher.ts` — Message publishing utilities
- `tests/integration/sqs/message-flow.test.ts` — End-to-end queue validation

**Lessons Learned:**
- FIFO ordering critical for multi-step artifact generation (e.g., research → outline → draft)
- Content-based deduplication insufficient — explicit deduplication IDs required for task retries
- Visibility timeout tuning: 5 minutes covers p99 LLM response time + overhead

### T5-003: WebSocket Connection Manager

**Status:** Completed (2024-12-10)  
**Key Outcomes:**
- Built connection registry in DSQL: `websocket_connections(connection_id, user_id, expires_at)`
- Lambda authorizer for WebSocket `$connect` route validates JWT and writes connection record
- Broadcast service resolves `userId → connectionIds[]` for fan-out messaging
- Automatic cleanup of stale connections via TTL (`expires_at < NOW()`)

**Relevant Artifacts:**
- `src/services/websocket/connection-manager.ts` — Connection lifecycle management
- `src/functions/websocket/connect/index.ts` — Connection authorization handler
- `db/migrations/004_websocket_connections.sql` — Connection registry schema

**Known Issues:**
- Connection ID mapping has 1-2s lag on `$connect` (DSQL write latency) — acceptable for current use case
- No support for reconnection with message replay — lost messages during disconnection not recovered

---

## Risk Assessment

### 1. SQS Message Loss (Moderate Risk)

**Scenario:** Lambda publishes to SQS but message is lost before Fargate task processes it.

**Likelihood:** Low — SQS guarantees at-least-once delivery with redundancy across AZs.

**Impact:** High — User sees "queued" status indefinitely; artifact never generated.

**Mitigations:**
- **Detection:** CloudWatch alarm on SQS `ApproximateAgeOfOldestMessage` metric (threshold: 10 minutes)
- **Remediation:** DLQ captures messages after 3 failed deliveries; separate Lambda processes DLQ for manual retry
- **Acceptance Criteria:** Alarm triggers within 15 minutes of message age exceeding threshold

### 2. Fargate Task OOM During LLM Response Streaming (High Risk)

**Scenario:** Bedrock returns 200k-token response; Fargate task exhausts 2GB memory limit mid-stream.

**Likelihood:** Medium — Token limits are soft constraints; malicious or runaway prompts can exceed.

**Impact:** High — Task terminated, message returned to SQS, retries exhaust DLQ, user sees failure.

**Mitigations:**
- **Prevention:** Enforce 100k-token hard limit in Lambda validation before queueing
- **Graceful Degradation:** Task writes partial result to S3 before termination (catch `SIGTERM`)
- **Monitoring:** CloudWatch Container Insights tracks memory utilization; alert on >80% p95
- **Acceptance Criteria:** Failed tasks write error with `reason: 'memory_exceeded'` to DSQL

### 3. DSQL Connection Pool Exhaustion (Moderate Risk)

**Scenario:** Fargate task pool scales to 10 concurrent tasks; each opens 10 connections (100 total); DSQL cluster limit is 150.

**Likelihood:** Medium — Connection limits depend on cluster size; scaling events can spike connection count.

**Impact:** Moderate — New tasks fail to connect, messages return to SQS, processing stalls.

**Mitigations:**
- **Connection Reuse:** Pool configuration: `max: 5` per task, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 2000`
- **ECS Task Limit:** Service max tasks set to 20 (5 connections × 20 tasks = 100, well under limit)
- **Circuit Breaker:** Task retries DSQL connection 3 times with exponential backoff before failing
- **Acceptance Criteria:** DSQL connection count metric never exceeds 120; tasks log connection errors with retry count

### 4. WebSocket Connection Mapping Stale on Task Completion (Low Risk)

**Scenario:** User's WebSocket disconnects; Fargate task completes but broadcasts to stale `connectionId`.

**Likelihood:** Medium — Mobile clients disconnect frequently; task duration (1-2 min) increases likelihood.

**Impact:** Low — User does not receive real-time notification but can poll HTTP API for status.

**Mitigations:**
- **TTL Cleanup:** WebSocket connection records expire after 1 hour; broadcaster skips expired connections
- **Broadcast Tolerance:** Failed WebSocket sends are logged (warn level) but do not fail task
- **Fallback Polling:** Frontend polls `/artifacts/{id}/status` every 5s as backup mechanism
- **Acceptance Criteria:** <1% of completed tasks fail due to WebSocket errors; no data loss in DSQL/S3

### 5. Fargate Cold Start Latency Exceeds 10s (Low Risk)

**Scenario:** SQS message arrives; ECS launches task; container pulls image, starts, connects to DSQL — total time 15s.

**Likelihood:** Medium — Image size, network latency, DSQL handshake contribute to startup time.

**Impact:** Low — User already expects async processing; 15s vs. 10s cold start not perceptible.

**Mitigations:**
- **Image Optimization:** Multi-stage Docker build; base image cached with dependencies pre-installed
- **Warm Pool (Future):** Maintain 2 idle tasks during business hours (deferred to T6-005)
- **SQS Visibility Timeout:** Set to 5 minutes (300s) to accommodate cold start + processing
- **Acceptance Criteria:** p95 cold start <15s; p50 <8s (warm tasks); no SQS visibility timeout errors

### 6. Lambda SQS Publishing Timeout (Critical Risk)

**Scenario:** Lambda publishes to SQS but network partition causes timeout; Lambda retries 3 times, exceeds 29s API Gateway limit.

**Likelihood:** Low — AWS SDK auto-retries with exponential backoff; SQS is highly available.

**Impact:** Critical — User receives HTTP 504; request lost; no retry mechanism at API layer.

**Mitigations:**
- **Idempotency Key:** Lambda generates deterministic `messageDeduplicationId` from `requestId + timestamp`
- **Write-Ahead DSQL:** Lambda writes DSQL record (`status: queued`) BEFORE publishing to SQS; background job reconciles orphaned records
- **Timeout Tuning:** Lambda timeout set to 25s; SQS publish wrapped in 20s timeout with fallback logging
- **Acceptance Criteria:** <0.1% of requests fail to write DSQL; orphaned records reconciled within 5 minutes

### 7. Concurrent Status Updates from Lambda and Fargate (Moderate Risk)

**Scenario:** Lambda writes `status: queued`; Fargate starts and writes `status: processing`; race condition overwrites Fargate's update.

**Likelihood:** Low — DSQL transactions are serializable; `WHERE status = 'queued'` prevents race.

**Impact:** Moderate — Status stuck in incorrect state; user sees stale UI; manual intervention required.

**Mitigations:**
- **Optimistic Locking:** All status updates use `WHERE status = $expectedStatus` clause
- **Timestamp Ordering:** `updated_at` column enforced as non-null; queries order by timestamp
- **Retry Logic:** Fargate retries status update if affected rows = 0 (indicates race condition)
- **Acceptance Criteria:** Zero status update conflicts observed in integration tests; CloudWatch metric tracks failed updates

---

## Constraints Summary

### Performance Requirements
- Lambda → SQS latency p95: <300ms (target) / <500ms (minimum)
- Fargate cold start p95: <10s (target) / <15s (minimum)
- WebSocket event delivery p95: <2s (target) / <3s (minimum)
- SQS message processing start: <30s from enqueue

### Security Requirements
- No PII or prompt content in SQS messages — S3 references only
- Fargate tasks in private subnets; no direct internet access
- IAM least-privilege: Lambda cannot invoke Fargate; Fargate limited to `artifacts` and `chat_messages` tables
- LLM credentials from Secrets Manager, not environment variables

### Architecture Requirements
- Reuse existing Lambda functions — no API Gateway changes
- Preserve existing DSQL schema for core tables (add `status` column only)
- No synchronous dependencies — Fargate never blocks Lambda
- Graceful shutdown: in-flight LLM requests complete before task termination

### Cost Constraints
- Fargate costs <$200/month for current load (500 artifacts + 2000 chat turns/month)
- Target: per-operation cost decrease vs. Lambda due to precise resource allocation

### Non-Goals
- Batch processing, scheduled jobs, or data pipelines (out of scope)
- Retry logic and DLQ handling (deferred to T6-004)
- Fargate autoscaling optimization (current defaults acceptable)