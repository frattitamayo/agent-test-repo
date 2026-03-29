# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2024-01-17  
**Package Type:** intent-specific  
**Intent:** T6-003  
**Trust Tier:** 2 (Supervised)

## Codebase References

### Primary Surfaces (will be modified or created)

**Lambda HTTP Handlers:**
- `src/handlers/artifacts/generate.ts` — Artifact generation endpoint; modify to enqueue SQS instead of direct Bedrock call
- `src/handlers/chat/send.ts` — Chat message endpoint; modify to enqueue SQS instead of synchronous LLM invocation
- `src/handlers/artifacts/generate.test.ts` — Unit tests for artifact generation flow
- `src/handlers/chat/send.test.ts` — Unit tests for chat send flow

**SQS Message Processing:**
- `src/workers/llm-task-processor.ts` — New Fargate container entrypoint for consuming SQS messages
- `src/workers/tasks/artifact-generation.ts` — Task implementation for artifact generation
- `src/workers/tasks/chat-completion.ts` — Task implementation for chat message processing
- `src/workers/tasks/base-task.ts` — Abstract base class for LLM task execution patterns

**WebSocket Event Publishers:**
- `src/services/websocket/task-events.ts` — Publish task lifecycle events (`task_started`, `task_progress`, `task_completed`, `task_failed`)
- `src/services/websocket/client.ts` — WebSocket API Gateway management SDK wrapper

**Infrastructure as Code:**
- `infrastructure/fargate/task-definition.yaml` — ECS Fargate task definition (CPU, memory, IAM role, environment variables)
- `infrastructure/fargate/service.yaml` — ECS service with auto-scaling policy tied to SQS queue depth
- `infrastructure/sqs/llm-task-queue.yaml` — SQS standard queue configuration with dead-letter queue
- `infrastructure/sqs/llm-task-dlq.yaml` — Dead-letter queue for failed tasks
- `infrastructure/iam/fargate-task-role.yaml` — IAM role for Fargate tasks (Bedrock, S3, DSQL, SQS permissions)

### Secondary Surfaces (dependencies and interfaces)

**Existing Services:**
- `src/services/bedrock/client.ts` — AWS Bedrock SDK wrapper with retry logic and error handling
- `src/services/s3/artifacts.ts` — Artifact content persistence in S3 with server-side encryption
- `src/services/dsql/artifacts.ts` — Artifact metadata CRUD operations (must include `task_id`, `task_status` columns)
- `src/services/dsql/chat.ts` — Chat message persistence (must include `task_id`, `task_status` columns)
- `src/services/auth/context.ts` — Tenant ID extraction from request context for IAM isolation

**Shared Types:**
- `src/types/tasks.ts` — Type definitions for SQS message payloads, task states, and WebSocket events
- `src/types/artifacts.ts` — Artifact schema with task correlation fields
- `src/types/chat.ts` — Chat message schema with task correlation fields

**Observability:**
- `src/lib/logger.ts` — Structured logging with correlation ID propagation
- `src/lib/metrics.ts` — CloudWatch custom metrics for task execution telemetry

### Test Files
- `src/handlers/artifacts/generate.integration.test.ts` — End-to-end test with SQS mocking
- `src/handlers/chat/send.integration.test.ts` — End-to-end test with SQS mocking
- `src/workers/llm-task-processor.test.ts` — Unit tests for SQS message consumption and task routing
- `src/workers/tasks/artifact-generation.test.ts` — Unit tests for artifact generation task logic
- `src/workers/tasks/chat-completion.test.ts` — Unit tests for chat completion task logic

## Architecture Context

### System Overview

Prometheus V1 follows a serverless-first architecture with synchronous API Gateway + Lambda for HTTP requests and asynchronous ECS Fargate for long-running workloads. This migration introduces an **async processing boundary** where HTTP handlers transition from direct Bedrock invocation (limited by Lambda 15-minute timeout) to SQS-mediated Fargate execution (up to 60-minute task lifetime).

### Data Flow (Post-Migration)

1. **Request Ingestion:** Client POSTs to `/artifacts/generate` or `/chat/send` → API Gateway → Lambda handler
2. **Authentication & Authorization:** Lambda extracts tenant context, validates permissions, generates correlation ID
3. **Task Enqueue:** Lambda publishes SQS message with payload: `{taskType, tenantId, userId, parameters, correlationId}` → returns HTTP 202 Accepted with `{taskId, estimatedCompletionTime}`
4. **Task Execution:** Fargate container polls SQS → receives message → instantiates task handler → invokes Bedrock (with retries for throttling) → writes results to S3/DSQL → publishes WebSocket event → deletes SQS message
5. **Client Notification:** WebSocket Gateway broadcasts `task_completed` event to client connection → client fetches result from API
6. **Failure Handling:** Task failures after 3 retries → message routed to DLQ → CloudWatch alarm triggers operator notification

### Service Boundaries

- **Lambda (HTTP Layer):** Stateless, ephemeral; owns request validation, tenant isolation enforcement, SQS enqueue logic; does NOT interact with Bedrock post-migration
- **Fargate (Execution Layer):** Stateful (for task duration), long-lived; owns LLM interaction, artifact assembly, result persistence; does NOT expose HTTP endpoints
- **SQS (Decoupling Layer):** Message durability, retry orchestration, poison message isolation via DLQ; visibility timeout = 45 minutes (must exceed p95 task duration)
- **WebSocket (Notification Layer):** Real-time event delivery; connection lifecycle managed independently from task execution

### Infrastructure Constraints

- **VPC Isolation:** Fargate tasks run in private subnets (no IGW route) with NAT Gateway for Bedrock API egress; security groups restrict inbound traffic to zero
- **IAM Least Privilege:** Task role grants `bedrock:InvokeModel` (scoped to Claude 3.5 Sonnet ARN), `s3:PutObject` (scoped to `/artifacts/{tenant_id}/` prefix), `dsql:ExecuteStatement` (scoped to `artifacts` and `chat_messages` tables)
- **Auto-Scaling Boundaries:** ECS service scales 0→20 tasks based on `ApproximateNumberOfMessagesVisible` metric; scale-out threshold = 5 messages, scale-in threshold = 0 messages (5-minute cooldown)
- **Cost Controls:** Tasks force-terminated at 60-minute mark via ECS task timeout; prevents infinite loops or hung Bedrock calls

### Relevant Design Patterns

- **Idempotency:** SQS message deduplication ID = `{taskId}` ensures duplicate delivers (within 5-minute deduplication window) map to same task execution; task handlers check DSQL for existing result before starting work
- **Correlation:** All logs/metrics tagged with `correlationId` (UUIDv4) propagated from HTTP request → SQS message → Fargate logs → WebSocket event
- **Circuit Breaking:** Bedrock client implements exponential backoff (2^n seconds, max 32s) for throttling errors; permanent failures (invalid model, malformed prompt) fail-fast without retry

## Pattern Library

### SQS Message Schema

**Established Pattern:** All task messages follow this envelope structure (see `src/types/tasks.ts`):

```typescript
interface TaskMessage {
  taskId: string;              // UUIDv4, primary key in DSQL
  taskType: 'artifact_generation' | 'chat_completion';
  tenantId: string;            // For IAM isolation and S3 path prefix
  userId: string;              // Audit trail
  correlationId: string;       // End-to-end tracing
  parameters: Record<string, unknown>; // Task-specific payload
  createdAt: string;           // ISO 8601 timestamp
}
```

**Example (Artifact Generation):**
```json
{
  "taskId": "tsk_abc123",
  "taskType": "artifact_generation",
  "tenantId": "ten_xyz789",
  "userId": "usr_def456",
  "correlationId": "cor_ghi012",
  "parameters": {
    "artifactType": "context_package",
    "intentId": "INT-C-002",
    "orbitId": "ORB-001"
  },
  "createdAt": "2024-01-17T10:30:00Z"
}
```

### Lambda HTTP Response (202 Accepted)

**Established Pattern:** Async operations return immediate acknowledgment with task tracking URL (see `src/handlers/artifacts/generate.ts` for reference):

```typescript
return {
  statusCode: 202,
  body: JSON.stringify({
    taskId: 'tsk_abc123',
    status: 'queued',
    estimatedCompletionTime: '2024-01-17T10:45:00Z', // createdAt + p95 duration
    pollUrl: '/tasks/tsk_abc123/status',
    websocketChannel: `tasks:${tenantId}:${userId}`
  })
};
```

### WebSocket Event Schema

**Established Pattern:** Task lifecycle events follow this structure (see `src/services/websocket/task-events.ts`):

```typescript
interface TaskEvent {
  eventType: 'task_started' | 'task_progress' | 'task_completed' | 'task_failed' | 'task_timeout' | 'task_dead_lettered';
  taskId: string;
  correlationId: string;
  timestamp: string;          // ISO 8601
  payload?: {                 // Present for task_completed
    resultUrl?: string;       // S3 presigned URL or API path
    artifactId?: string;      // For artifact_generation tasks
  };
  error?: {                   // Present for task_failed / task_dead_lettered
    code: string;             // Machine-readable error code
    message: string;          // Human-readable error message
    retryable: boolean;       // Whether client should retry
  };
}
```

### Fargate Task Handler Interface

**Established Pattern:** All task implementations extend `BaseTask` abstract class (new file: `src/workers/tasks/base-task.ts`):

```typescript
abstract class BaseTask {
  abstract taskType: string;
  
  async execute(message: TaskMessage): Promise<void> {
    try {
      await this.updateStatus('in_progress');
      const result = await this.process(message.parameters);
      await this.persistResult(result);
      await this.publishEvent('task_completed', { resultUrl: result.url });
      await this.updateStatus('completed');
    } catch (error) {
      await this.handleError(error);
    }
  }
  
  protected abstract process(params: Record<string, unknown>): Promise<unknown>;
  protected abstract persistResult(result: unknown): Promise<void>;
  // ... error handling, status updates, WebSocket publishing
}
```

### Error Handling Classification

**Established Pattern:** Errors categorized for retry vs. dead-letter routing (see `src/services/bedrock/client.ts` for Bedrock-specific examples):

- **Transient (Retry):** `ThrottlingException`, `ServiceUnavailableException`, `InternalServerError`, network timeouts → SQS redelivery with exponential backoff
- **Permanent (Dead-Letter):** `ValidationException` (invalid model ID), `AccessDeniedException` (IAM misconfiguration), `InvalidRequestException` (malformed prompt) → immediate DLQ routing

### Logging Standards

**Established Pattern:** All log entries include structured fields (see `src/lib/logger.ts`):

```typescript
logger.info('Task execution started', {
  correlationId,
  taskId,
  taskType,
  tenantId,
  phase: 'execution_start'
});
```

**Required Fields:** `correlationId`, `taskId`, `taskType`, `tenantId`, `phase` (one of: `enqueue`, `execution_start`, `bedrock_call`, `persist_result`, `publish_event`, `execution_complete`, `execution_failed`)

## Prior Orbit References

### T6-001: WebSocket Gateway Foundation

**Status:** Assumed complete (per intent dependencies)  
**Relevant Outputs:**
- WebSocket API Gateway infrastructure with connection management
- `POST /@connections/{connectionId}` endpoint for server-initiated broadcasts
- Connection-to-user mapping stored in DSQL `websocket_connections` table
- Authentication via `Sec-WebSocket-Protocol` header (JWT token)

**Open Question:** Does the implementation support broadcasting to all connections for a given `tenantId:userId` pair, or only single connection ID targeting? Task events require multi-connection fanout (user may have multiple browser tabs open).

**Integration Point:** Fargate tasks must query DSQL for active connection IDs before publishing task events.

### T5-002: DSQL Schema Evolution

**Status:** Assumed complete (per intent dependencies)  
**Relevant Outputs:**
- `artifacts` table with columns: `id`, `tenant_id`, `orbit_id`, `artifact_type`, `content_s3_uri`, `created_at`, `updated_at`
- `chat_messages` table with columns: `id`, `tenant_id`, `user_id`, `session_id`, `role`, `content`, `created_at`

**Required Schema Changes:**
- **`artifacts` table:** Add `task_id VARCHAR(36) UNIQUE`, `task_status ENUM('queued', 'in_progress', 'completed', 'failed')`
- **`chat_messages` table:** Add `task_id VARCHAR(36)`, `task_status ENUM('queued', 'in_progress', 'completed', 'failed')`
- **New table:** `task_executions` with columns: `task_id (PK)`, `task_type`, `tenant_id`, `user_id`, `correlation_id`, `status`, `error_code`, `error_message`, `created_at`, `started_at`, `completed_at`, `retry_count`

**Migration Strategy:** Deploy schema changes via blue-green DSQL cluster switchover before Fargate deployment.

### T4-003: Bedrock Integration (Hypothetical Prior Work)

**Assumed Context:** Existing Bedrock client wrapper (`src/services/bedrock/client.ts`) already implements:
- Model invocation with Claude 3.5 Sonnet (`anthropic.claude-3-5-sonnet-20241022-v2:0`)
- Retry logic for throttling (exponential backoff, max 3 attempts)
- Structured logging with request/response token counts
- Error classification (transient vs. permanent)

**Reuse Opportunity:** Fargate task handlers should import and delegate to this existing client; do NOT reimplement Bedrock retry logic.

## Risk Assessment

### 1. SQS Message Loss or Duplication

**Risk:** SQS standard queue guarantees at-least-once delivery, not exactly-once; duplicate messages could trigger redundant LLM calls (cost) or create duplicate artifacts (data integrity).

**Likelihood:** Medium (SQS duplicates are rare but documented behavior)  
**Impact:** High (redundant Bedrock calls = direct cost; duplicate artifacts confuse users)

**Mitigation:**
- **Deduplication Window:** Set SQS `MessageDeduplicationId` = `{taskId}` (5-minute deduplication window for standard queues)
- **Idempotency Check:** Task handler queries DSQL `task_executions` table at start; if `task_id` exists with status `completed`, skip processing and ACK message
- **Atomic Updates:** DSQL status transitions use optimistic locking (`UPDATE WHERE status = 'queued'`) to prevent concurrent execution

**Monitoring:** CloudWatch metric `SQSDuplicateMessagesReceived` (custom metric emitted by task handler when duplicate detected); alert if >1% of total messages.

### 2. Fargate Task Starvation Under Load

**Risk:** SQS queue depth grows faster than Fargate service can scale out (auto-scaling lag = 5 minutes), causing user-visible delays exceeding SLA.

**Likelihood:** Medium (traffic spikes during product launches or viral growth)  
**Impact:** High (p95 latency exceeds 30-minute SLA; user frustration; support tickets)

**Mitigation:**
- **Pre-Warming:** Maintain minimum task count of 2 during business hours (9am–6pm Pacific) via scheduled scaling policy
- **Scale-Out Acceleration:** Reduce `ApproximateNumberOfMessagesVisible` threshold from 5 to 3; reduce cooldown from 5 minutes to 2 minutes
- **Queue Backlog Alarm:** CloudWatch alarm if `ApproximateAgeOfOldestMessage` exceeds 10 minutes; triggers operator notification for manual intervention (temporarily increase max task count)

**Monitoring:** Dashboard with queue depth, active task count, and p95 task duration; review weekly for scaling policy tuning.

### 3. Fargate Task IAM Privilege Escalation

**Risk:** Overly permissive IAM task role grants cross-tenant data access (e.g., `s3:PutObject` on `*` instead of tenant-scoped prefix), enabling malicious or buggy code to violate tenant isolation.

**Likelihood:** Low (human error during IaC authoring)  
**Impact:** Critical (data breach; regulatory violation; reputational damage)

**Mitigation:**
- **Least-Privilege Scoping:** IAM policy MUST use condition keys: `s3:PutObject` allowed only if `s3:prefix` matches `artifacts/${aws:PrincipalTag/TenantId}/*`; DSQL statements allowed only if `WHERE tenant_id = <session_tag>`
- **Pre-Deployment Review:** Tier 2 human review gate includes IAM policy audit by security engineer; checklist item: "Task role cannot access resources outside tenant boundary"
- **Runtime Validation:** Task handler extracts `tenantId` from SQS message payload and validates against IAM session tags before any S3/DSQL operation; mismatch triggers `AccessDeniedException` and task failure

**Monitoring:** CloudWatch Logs Insights query for `AccessDeniedException` errors; investigate any occurrence within 1 hour.

### 4. WebSocket Event Delivery Failure

**Risk:** Task completes successfully, but WebSocket event publish fails (connection closed, API Gateway error), leaving user unaware of completion; user must poll or refresh page to discover result.

**Likelihood:** Medium (WebSocket connections drop frequently due to mobile network changes, laptop sleep, etc.)  
**Impact:** Medium (degraded UX; user perceives system as "stuck"; does not block functionality since result is persisted)

**Mitigation:**
- **Best-Effort Delivery:** WebSocket publish is non-blocking; task handler logs publish failure but marks task as `completed` regardless
- **Fallback Polling:** Frontend implements exponential backoff polling of `/tasks/{taskId}/status` endpoint (every 5s → 10s → 30s) as fallback; WebSocket events are optimization, not requirement
- **Reconnection Grace:** If WebSocket connection drops, frontend attempts reconnect for 30 seconds before falling back to polling; replay missed events via `/tasks/{taskId}/events` history endpoint

**Monitoring:** CloudWatch metric `WebSocketPublishFailureRate`; alert if >5%; investigate API Gateway logs for root cause (throttling, service error).

### 5. Bedrock Quota Exhaustion

**Risk:** Concurrent Fargate tasks overwhelm Bedrock quota (200 req/min sustained in us-west-2), causing throttling cascade; new tasks fail immediately without useful work.

**Likelihood:** High (current Lambda implementation already hits quota during peak hours)  
**Impact:** Medium (tasks retry via SQS, eventually succeed; adds latency but doesn't cause data loss)

**Mitigation:**
- **Quota Request:** Submit AWS Support case to increase Bedrock Claude 3.5 Sonnet quota to 500 req/min before production deployment
- **Rate Limiting:** Implement token bucket rate limiter in Fargate task entrypoint (shared state in Redis or DynamoDB); task waits for token before invoking Bedrock, preventing thundering herd
- **Graceful Degradation:** If Bedrock throttling persists beyond 3 retries, task publishes `task_failed` event with `retryable: true` and exits; SQS redelivery occurs after visibility timeout

**Monitoring:** CloudWatch metric `BedrockThrottlingErrorRate` (derived from task handler logs); alert if >10%; page on-call engineer to request emergency quota increase.

### 6. S3 Eventual Consistency Window

**Risk:** Fargate task writes artifact to S3, updates DSQL with `content_s3_uri`, publishes `task_completed` event; frontend immediately fetches S3 URL but receives 404 due to S3 read-after-write inconsistency (rare but documented).

**Likelihood:** Very Low (S3 provides read-after-write consistency for new objects as of 2020; issue only arises if object key collides with recently deleted object)  
**Impact:** Low (user sees "artifact not found" error for <1 second; retry succeeds)

**Mitigation:**
- **Unique S3 Keys:** Use `{tenant_id}/{artifact_id}/{timestamp}_{uuid}.json` to avoid key collisions
- **HeadObject Validation:** Task handler performs S3 HeadObject after PutObject before marking task complete; retries up to 3 times with 1-second delay if 404
- **Frontend Retry:** API client retries S3 GET with exponential backoff (1s, 2s, 4s) if 404 received

**Monitoring:** CloudWatch metric `S3GetObjectNotFoundRate` (custom metric from API Gateway access logs); alert if >0.1%; indicates systemic issue beyond eventual consistency.

### 7. DSQL Transaction Deadlock

**Risk:** Multiple Fargate tasks concurrently update same DSQL row (e.g., `task_executions` status), causing deadlock; transaction fails and task retries indefinitely.

**Likelihood:** Low (task IDs are unique; no concurrent updates expected)  
**Impact:** Medium (task stuck in retry loop; eventual DLQ routing after 3 attempts; manual operator intervention required)

**Mitigation:**
- **Pessimistic Locking:** Use `SELECT ... FOR UPDATE` when reading task state before update; prevents concurrent modifications
- **Optimistic Locking:** Add `version` column to `task_executions`; increment on every update; WHERE clause includes `version = {expected_version}`; failure triggers task-level retry with fresh read
- **Deadlock Detection:** DSQL client wraps transactions in try-catch for `SerializationException`; classifies as transient error for SQS retry

**Monitoring:** CloudWatch Logs Insights query for `SerializationException` or `DeadlockDetected` errors; review weekly for patterns.

### 8. Fargate Container Image Vulnerability

**Risk:** Base Docker image contains CVE-listed vulnerabilities; compromised container could exfiltrate tenant data or mine cryptocurrency.

**Likelihood:** Low (ECR scan-on-push enabled; automated patching process)  
**Impact:** Critical (data breach; regulatory violation; AWS account suspension)

**Mitigation:**
- **Minimal Base Image:** Use AWS-provided `public.ecr.aws/lambda/nodejs:20` base image (maintained by AWS, receives automatic security patches)
- **Dependency Scanning:** Snyk or Trivy scan runs in CI pipeline; blocks merge if critical vulnerabilities detected; exceptions require security team approval
- **Runtime Monitoring:** AWS GuardDuty monitors ECS task network activity; alerts on suspicious egress (e.g., bitcoin mining pool connections, unknown IPs)

**Monitoring:** ECR scan results reviewed weekly; critical vulnerabilities patched within 7 days per compliance policy.

---

**Document Version:** 1.0  
**Last Updated:** 2024-01-17  
**Review Status:** Pending Tier 2 Human Approval