# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Intent Reference:** T6-003  
**Orbit:** 1  
**Generated:** 2024-01-17  
**Trust Tier:** 2 (Supervised)

---

## Codebase References

### Primary Surfaces (will be modified)

#### Lambda API Handlers
- `backend/api/artifacts/generate.ts` — Current synchronous artifact generation endpoint; will be refactored to enqueue SQS message
- `backend/api/chat/send.ts` — Current synchronous chat message handler; will be refactored to enqueue SQS message
- `backend/api/artifacts/generate.test.ts` — Existing test suite; must be updated for async behavior validation

#### New Fargate Task Components
- `backend/fargate/artifact-worker/` — New directory for Fargate container application
  - `backend/fargate/artifact-worker/index.ts` — Task entrypoint; SQS message polling and dispatch
  - `backend/fargate/artifact-worker/handlers/generate-intent.ts` — Intent Document generation handler
  - `backend/fargate/artifact-worker/handlers/generate-context.ts` — Context Package generation handler
  - `backend/fargate/artifact-worker/handlers/generate-proposal.ts` — Proposal generation handler
  - `backend/fargate/artifact-worker/handlers/chat-message.ts` — Chat interaction handler
  - `backend/fargate/artifact-worker/services/bedrock-client.ts` — LLM invocation logic with streaming support
  - `backend/fargate/artifact-worker/services/notification-client.ts` — WebSocket notification sender
  - `backend/fargate/artifact-worker/Dockerfile` — Container image definition
- `backend/fargate/artifact-worker/tests/` — Test suite for Fargate worker logic

#### Infrastructure as Code
- `infrastructure/fargate/task-definition.ts` — ECS task definition (CPU, memory, IAM role, environment variables)
- `infrastructure/fargate/cluster.ts` — ECS cluster configuration
- `infrastructure/fargate/service.ts` — ECS service for long-running worker (if using service vs. RunTask)
- `infrastructure/sqs/artifact-queue.ts` — Queue definition with visibility timeout, DLQ configuration
- `infrastructure/sqs/artifact-dlq.ts` — Dead letter queue for unprocessable messages
- `infrastructure/iam/fargate-task-role.ts` — IAM role granting Fargate tasks access to DSQL, S3, Secrets Manager, ApiGatewayManagementApi

### Secondary Surfaces (dependencies)

#### Existing Services
- `backend/services/bedrock/client.ts` — Current Bedrock integration; will be reused by Fargate worker
- `backend/services/websocket/notification-service.ts` — WebSocket message sender; must be callable from Fargate context
- `backend/repositories/artifact-repository.ts` — DSQL data access layer for `artifacts` table
- `backend/repositories/chat-repository.ts` — DSQL data access layer for `chat_messages` table
- `backend/schemas/sqs-message.ts` — TypeScript schema for SQS message payload validation

#### Database Schema
- `database/schema/artifacts.sql` — Existing `artifacts` table; must support `status` enum values: `'processing'`, `'completed'`, `'failed'`
- `database/schema/chat_messages.sql` — Existing `chat_messages` table; no schema changes required

#### Infrastructure Dependencies (from T6-001, T6-002)
- `infrastructure/vpc/endpoints.ts` — VPC endpoints for Secrets Manager, DSQL, SQS (assumed provisioned)
- `infrastructure/network/private-subnets.ts` — Private subnets for Fargate tasks
- `infrastructure/ecr/repository.ts` — Container registry for Fargate images (assumed configured)

---

## Architecture Context

### Current State (Lambda-based)
Prometheus V1 currently handles artifact generation and chat interactions synchronously via Lambda functions behind API Gateway. When a user requests artifact generation (`POST /artifacts/generate`), the Lambda function:
1. Validates request and authenticates user
2. Invokes AWS Bedrock (Claude Sonnet 4) directly
3. Streams LLM response into memory
4. Writes completed artifact to DSQL and S3
5. Returns HTTP 200 with artifact metadata

This architecture is constrained by Lambda's 15-minute timeout. Complex artifacts (Context Packages, multi-section Proposals) frequently exceed this limit, resulting in HTTP 504 errors and incomplete data writes.

### Target State (Fargate-based Async)
The migration introduces an asynchronous task processing model:

1. **HTTP Request Path (Lambda):**
   - User sends `POST /artifacts/generate` → API Gateway → Lambda
   - Lambda validates request, authorizes user, generates unique `request_id`
   - Lambda constructs SQS message with user context, operation type, and parameters
   - Lambda enqueues message to `artifact-processing-queue`
   - Lambda returns HTTP 202 Accepted with `{ request_id, status: 'queued' }`
   - Response time: <500ms

2. **Background Processing Path (Fargate):**
   - Fargate task polls `artifact-processing-queue` via long-poll (20-second wait time)
   - Task receives message, validates schema, extracts user context
   - Task invokes Bedrock with streaming response handling (can run 25+ minutes)
   - Task writes progress updates to WebSocket via ApiGatewayManagementApi (`artifact:progress` events every 30 seconds)
   - On completion: Task writes final artifact to S3, updates DSQL `artifacts` table (`status='completed'`, `s3_key`, `completed_at`)
   - On failure: Task writes error to DSQL (`status='failed'`, `error_message`), message moves to DLQ after 3 retries
   - Task sends final WebSocket notification (`artifact:complete` or `artifact:failed`)
   - Task deletes message from SQS

3. **Frontend Experience:**
   - User receives immediate HTTP 202 response on submission
   - Frontend WebSocket connection receives real-time progress updates
   - Final artifact rendered when `artifact:complete` message received
   - No polling required; event-driven updates only

### Data Flow Diagram (Conceptual)
```
[Frontend] --POST /artifacts/generate--> [API Gateway] --> [Lambda]
                                                            |
                                                            v
                                                        [SQS Queue]
                                                            |
                                                            v
                                                     [Fargate Task]
                                                       /    |    
                                                      /     |     
                                                     v      v      v
                                              [Bedrock] [DSQL] [S3]
                                                           |
                                                           v
                                                    [WebSocket API]
                                                           |
                                                           v
                                                      [Frontend]
```

### Service Boundaries
- **Lambda:** Thin orchestration layer; no LLM invocation, no blocking I/O beyond SQS enqueue
- **Fargate:** Compute-intensive LLM operations; owns result persistence and notification lifecycle
- **SQS:** Durable message queue; guarantees at-least-once delivery with 30-minute visibility timeout
- **DSQL:** Single source of truth for artifact metadata and status
- **S3:** Blob storage for completed artifact content
- **WebSocket API:** Real-time notification channel; connection lifecycle managed by separate Lambda functions (existing)

### Infrastructure Constraints
- **Network:** Fargate tasks run in private subnets (no internet gateway); all AWS service communication via VPC endpoints
- **Secrets:** Bedrock API keys and DSQL credentials retrieved from Secrets Manager at task startup (not environment variables)
- **Concurrency:** Initial deployment supports 10 concurrent Fargate tasks; ECS service auto-scaling can be added post-MVP
- **Cost:** Fargate tasks use 2 vCPU, 4 GB memory ($0.12/hour); monthly budget caps total task hours

---

## Pattern Library

### SQS Message Schema (Established in T1-002)
All SQS messages follow this structure:
```typescript
interface ArtifactQueueMessage {
  request_id: string;          // UUID v4
  user_id: string;             // UUID v4 from JWT claims
  connection_id: string;       // ApiGateway WebSocket connection ID
  timestamp: string;           // ISO 8601
  operation: 'generate_artifact' | 'chat_message';
  payload: GenerateArtifactPayload | ChatMessagePayload;
}

interface GenerateArtifactPayload {
  intent_id: string;
  orbit_id: string;
  artifact_type: 'intent' | 'context' | 'proposal';
  parameters: Record<string, unknown>;  // Operation-specific params
}
```

Validation: Use `AjvValidator` with JSON Schema before enqueuing.

### DSQL Repository Pattern (Established in T1-001)
Data access follows repository pattern with typed models:
```typescript
// backend/repositories/artifact-repository.ts
class ArtifactRepository {
  async create(artifact: NewArtifact): Promise<Artifact> { /* ... */ }
  async updateStatus(id: string, status: ArtifactStatus, errorMessage?: string): Promise<void> { /* ... */ }
  async setCompleted(id: string, s3Key: string, completedAt: Date): Promise<void> { /* ... */ }
}

enum ArtifactStatus {
  Queued = 'queued',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed'
}
```

Fargate tasks must call `updateStatus('processing')` immediately after receiving message, `setCompleted()` on success, `updateStatus('failed', errorMsg)` on error.

### WebSocket Notification Format (Established in T2-003)
WebSocket messages follow CloudWatch-compatible JSON structure:
```typescript
interface WebSocketMessage {
  type: 'artifact:progress' | 'artifact:complete' | 'artifact:failed' | 'chat:message';
  request_id: string;
  timestamp: string;
  payload: {
    artifact_id?: string;
    status?: ArtifactStatus;
    progress?: number;  // 0-100 for progress events
    error_message?: string;
    content?: string;   // For chat messages
  };
}
```

Send via `ApiGatewayManagementApi.postToConnection()`. Handle `GoneException` (stale connection) gracefully by logging and continuing.

### Error Handling Convention (Established in T1-004)
All async task errors logged as structured JSON:
```typescript
interface TaskErrorLog {
  level: 'error';
  request_id: string;
  user_id: string;
  operation: string;
  error_type: string;  // e.g., 'BedrockTimeout', 'DSQLConnectionError'
  error_message: string;
  stack_trace: string;
  retry_count: number;
  timestamp: string;
}
```

Errors written to CloudWatch Logs with JSON formatter. Fargate task must catch all exceptions, log with context, update DSQL status, send WebSocket failure notification, then exit gracefully (no uncaught exceptions).

### Idempotency Pattern (Established in T1-003)
Use `request_id` as idempotency key. Before starting work:
```typescript
async function ensureIdempotent(requestId: string): Promise<boolean> {
  const existing = await artifactRepository.findByRequestId(requestId);
  if (existing && existing.status !== 'failed') {
    // Already processed or in progress
    return false;  // Skip processing
  }
  return true;  // Safe to proceed
}
```

If duplicate message received (SQS at-least-once delivery), skip LLM invocation and return cached result.

### Container Logging Pattern (Established in T6-002)
Fargate containers log to stdout/stderr; CloudWatch Logs captures automatically. Use `pino` logger with JSON output:
```typescript
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: 'artifact-worker',
    version: process.env.APP_VERSION,
  },
});
```

Every log entry includes `request_id`, `user_id`, `operation` fields for trace correlation.

---

## Prior Orbit References

### T6-001: Container Base Infrastructure
**Status:** Completed (Orbit 3)  
**Relevance:** Provisioned VPC, private subnets, NAT Gateway, and VPC endpoints required for Fargate connectivity.

**Key Artifacts:**
- `infrastructure/vpc/main.ts` — VPC configuration with CIDR 10.0.0.0/16
- `infrastructure/vpc/endpoints.ts` — VPC endpoints for Secrets Manager, DSQL, SQS, ApiGatewayManagementApi
- Private subnets: `10.0.1.0/24`, `10.0.2.0/24` (us-east-1a, us-east-1b)

**Lessons Learned:** VPC endpoint for ApiGatewayManagementApi required explicit policy allowing `execute-api:ManageConnections` action. Default endpoint policy insufficient.

### T6-002: Container Deployment Pipeline
**Status:** Completed (Orbit 2)  
**Relevance:** Established CI/CD patterns for building and deploying Fargate containers.

**Key Artifacts:**
- `.github/workflows/build-fargate-image.yml` — GitHub Actions workflow for Docker builds
- `infrastructure/ecr/repository.ts` — ECR repository with lifecycle policy (retain last 10 images)
- `scripts/deploy-fargate-task.sh` — Deployment script that updates ECS task definition and forces new deployment

**Lessons Learned:** Fargate task definition updates require explicit `forceNewDeployment: true` flag to pick up new container image. Otherwise, tasks continue running old image until manually stopped.

### T1-001: DSQL Schema Foundation
**Status:** Completed (Orbit 4)  
**Relevance:** Defined `artifacts` table schema with status column.

**Key Artifacts:**
- `database/schema/artifacts.sql` — Table definition with `status` enum: `('queued', 'processing', 'completed', 'failed')`
- `database/migrations/001_create_artifacts.sql` — Initial migration

**Known Issue:** Original schema lacked `error_message` column for failed artifacts. Added in migration `004_add_error_message.sql`. Ensure Fargate worker references latest schema.

### T2-003: WebSocket Notification Service
**Status:** Completed (Orbit 5)  
**Relevance:** Provides real-time notification mechanism required for async artifact delivery.

**Key Artifacts:**
- `backend/api/websocket/connect.ts` — Connection handler; stores `connection_id` in DSQL `connections` table
- `backend/api/websocket/disconnect.ts` — Cleanup handler; removes stale connections
- `backend/services/websocket/notification-service.ts` — Wrapper around `ApiGatewayManagementApi.postToConnection()`

**Critical Note:** `ApiGatewayManagementApi` requires `@connections` endpoint URL constructed from `ApiGateway` stage URL. Fargate task must retrieve this from environment variable `WEBSOCKET_API_ENDPOINT` (format: `https://<api-id>.execute-api.us-east-1.amazonaws.com/<stage>/@connections`).

### T3-002: Bedrock Integration (Claude Sonnet 4)
**Status:** Completed (Orbit 3)  
**Relevance:** Established patterns for invoking Bedrock with streaming responses.

**Key Artifacts:**
- `backend/services/bedrock/client.ts` — BedrockRuntimeClient configuration with retry logic
- `backend/services/bedrock/streaming.ts` — Helper for processing `ResponseStream` events
- Credentials stored in Secrets Manager: `prod/bedrock/api-key` (JSON: `{ "accessKeyId": "...", "secretAccessKey": "..." }`)

**Pattern to Reuse:**
```typescript
async function* streamBedrockResponse(prompt: string): AsyncGenerator<string> {
  const response = await bedrockClient.invokeModelWithResponseStream({
    modelId: 'anthropic.claude-sonnet-4-20250514',
    body: JSON.stringify({ prompt, max_tokens: 100000 }),
  });

  for await (const event of response.body) {
    if (event.chunk) {
      const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
      yield chunk.completion;
    }
  }
}
```

**Known Issue:** Streaming responses occasionally produce partial JSON. Worker must buffer complete chunks before parsing.

### T1-002: API Request Validation
**Status:** Completed (Orbit 2)  
**Relevance:** Established schema validation pattern reused for SQS message validation.

**Key Artifacts:**
- `backend/middleware/validate-schema.ts` — AJV-based validator middleware
- `backend/schemas/sqs-message.schema.json` — JSON Schema for SQS message structure

**Pattern:** Every Fargate handler must validate incoming SQS message against schema before processing. On validation failure, log error and delete message (do not retry).

---

## Risk Assessment

### Risk 1: Message Loss (SQS visibility timeout misconfiguration)
**Likelihood:** Medium  
**Impact:** High (user sees "queued" status indefinitely; no completion notification)

**Scenario:** If Fargate task crashes or runs longer than SQS visibility timeout (30 minutes), message becomes visible again. Another task may pick it up, causing duplicate processing. Alternatively, if task doesn't delete message after successful processing, retry loop begins.

**Mitigation:**
- Set SQS visibility timeout to 30 minutes (longer than expected task duration)
- Configure max receive count of 3 on queue; unprocessed messages move to DLQ
- Implement idempotency check using `request_id` before starting work
- Task must explicitly delete message only after writing final status to DSQL
- Monitor CloudWatch metric `ApproximateAgeOfOldestMessage`; alarm if >35 minutes

**Detection:** CloudWatch alarm on DLQ message count >0; manual DLQ inspection reveals patterns.

### Risk 2: Fargate Task OOM (memory exhaustion during LLM streaming)
**Likelihood:** Medium  
**Impact:** Medium (task killed mid-processing; partial artifact data orphaned)

**Scenario:** Complex artifacts with large context windows (Context Packages referencing many files) cause Bedrock responses to buffer excessively in memory. Task exceeds 4 GB limit, ECS kills task, SQS message returns to queue.

**Mitigation:**
- Stream Bedrock responses directly to S3 using multipart upload (do not buffer entire response)
- Write partial artifact to S3 with `status='processing'` every 5 minutes (checkpoint pattern)
- Monitor CloudWatch Container Insights metric `MemoryUtilized`; alarm at 90% of 4 GB
- Implement circuit breaker: if task memory >3.5 GB, truncate streaming response and mark artifact as partial
- Test with maximum expected payload size (estimated 500 KB prompt, 2 MB response)

**Detection:** CloudWatch Logs shows task exit code 137 (OOM kill); ECS task stopped reason `OutOfMemoryError`.

### Risk 3: DSQL Connection Pool Exhaustion
**Likelihood:** Low  
**Impact:** High (subsequent tasks fail to write results; data corruption risk)

**Scenario:** Long-running Fargate tasks hold DSQL connections open for 20+ minutes. Under concurrent load (10 tasks), connection pool exhausted. New tasks cannot acquire connection; `updateStatus()` calls fail silently or timeout.

**Mitigation:**
- Use `pg` connection pool with `max: 2` connections per task (minimize hold time)
- Close connection after each DSQL operation; do not hold for entire task lifecycle
- Implement connection timeout of 10 seconds; retry once on failure
- Monitor DSQL connection count via `pg_stat_activity`; alarm if >50 connections
- Configure DSQL max_connections to 100 (accommodates 10 tasks × 2 connections + overhead)

**Detection:** CloudWatch Logs shows `ConnectionTimeoutError`; tasks fail at `updateStatus()` calls.

### Risk 4: WebSocket Connection Staleness
**Likelihood:** High  
**Impact:** Low (user doesn't receive real-time updates; must refresh page)

**Scenario:** User's browser tab backgrounded or network hiccup causes WebSocket disconnect. Fargate task attempts to send notification to stale `connection_id`; ApiGatewayManagementApi returns `GoneException`. Task logs error but continues processing.

**Mitigation:**
- Catch `GoneException` gracefully; log warning but do not fail task
- Write notification attempt to DSQL `notifications` table with status `'failed'` for audit trail
- Frontend implements reconnect logic; on reconnect, queries DSQL for missed notifications
- Implement fallback: if WebSocket send fails, write notification to S3 as JSON file; frontend polls for new files (degraded mode)

**Detection:** CloudWatch metric filter on `GoneException` count; expected pattern <5% of notifications.

### Risk 5: DLQ Message Accumulation (unhandled error types)
**Likelihood:** Low  
**Impact:** Medium (user sees permanent "queued" state; manual intervention required)

**Scenario:** New error type introduced (e.g., Bedrock throttling, schema validation failure on malformed SQS message) causes task to crash before updating DSQL status. Message retried 3 times, moves to DLQ. No automated recovery; message sits in DLQ indefinitely.

**Mitigation:**
- Comprehensive error handling: catch all exception types, classify as retryable vs. non-retryable
- Non-retryable errors (schema validation, authentication failure) update DSQL to `'failed'` before exiting
- Retryable errors (Bedrock timeout, DSQL connection error) allow message retry up to 3 times
- Implement DLQ processor Lambda (triggered by DLQ messages): parse message, write failure to DSQL, send WebSocket notification
- Monitor DLQ depth with CloudWatch alarm; page on-call if >5 messages

**Detection:** CloudWatch alarm on `artifact-processing-dlq` message count >0; manual inspection required.

### Risk 6: Cost Overrun (runaway task loop)
**Likelihood:** Low  
**Impact:** High (unexpected AWS charges; budget exceeded)

**Scenario:** Bug in task code causes infinite loop (e.g., retry logic without backoff, uncaught exception in message deletion). Task runs for hours/days, consuming Fargate compute. 10 tasks × 24 hours × $0.12/hour = $28.80/day.

**Mitigation:**
- Set ECS task timeout via `stop_timeout` parameter: 35 minutes max (kill task if exceeds)
- Implement cost alarm: CloudWatch Budget alert if Fargate spend >$50/day
- Code review checklist: verify all loops have exit conditions, all exceptions caught
- Structured logging: every iteration logs progress; detect stuck tasks via missing logs
- Use AWS Cost Explorer to monitor daily Fargate spend by task definition

**Detection:** AWS Budget alert triggers; CloudWatch Logs shows repetitive log entries without progress.

### Risk 7: Race Condition on Artifact Status Updates
**Likelihood:** Low  
**Impact:** Medium (DSQL state inconsistent; frontend shows stale status)

**Scenario:** Duplicate SQS message delivered (at-least-once guarantee). Two Fargate tasks process same `request_id` simultaneously. Both call `updateStatus('processing')`, then race to write final status. One writes `'completed'`, other writes `'failed'` (due to "already exists" error). Final state incorrect.

**Mitigation:**
- Implement database-level row locking on `artifacts` table: `SELECT ... FOR UPDATE` before status updates
- Idempotency check returns cached result if artifact already in terminal state (`'completed'` or `'failed'`)
- Use optimistic locking: include `version` column in `artifacts` table; increment on each update
- Test: Manually trigger duplicate processing via SQS console; verify only one task proceeds

**Detection:** CloudWatch Logs shows two tasks processing same `request_id` with overlapping timestamps; DSQL audit log shows conflicting writes.

### Risk 8: Security — IAM Role Over-Permissioning
**Likelihood:** Medium  
**Impact:** High (privilege escalation risk if task compromised)

**Scenario:** Fargate task IAM role granted overly broad permissions (e.g., `s3:*`, `dynamodb:*`). If task code vulnerability exploited, attacker gains access to entire S3 bucket or DSQL database.

**Mitigation:**
- Apply least-privilege IAM policy: restrict to specific S3 bucket ARN, DSQL table ARNs
- Use IAM condition keys: `s3:prefix` for artifact paths, `aws:RequestedRegion` for us-east-1 only
- Enable CloudTrail logging for all Fargate task API calls; monitor for unusual patterns
- Implement runtime security: Fargate task runs as non-root user, read-only filesystem except `/tmp`
- Quarterly IAM policy review: audit unused permissions, tighten scopes

**Policy Example:**
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::prometheus-artifacts/*",
  "Condition": {
    "StringEquals": {
      "s3:x-amz-server-side-encryption": "AES256"
    }
  }
}
```

**Detection:** AWS GuardDuty alert on anomalous API calls; manual IAM Access Analyzer scan.