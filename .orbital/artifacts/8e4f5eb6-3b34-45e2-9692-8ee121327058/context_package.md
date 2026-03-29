# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Lambda Functions to Modify
- `src/lambda/artifact-generation/handler.ts` — Current artifact generation endpoint, MUST be refactored to enqueue SQS message instead of direct Bedrock invocation
- `src/lambda/ai-chat/handler.ts` — Current AI chat endpoint, MUST be refactored to enqueue SQS message for long-running conversations
- `src/lambda/websocket-notify/handler.ts` — Existing WebSocket notification Lambda, Fargate tasks will invoke this after completion

### New Fargate Components
- `src/fargate/task-processor/` — New directory for Fargate task application code
  - `src/fargate/task-processor/main.ts` — Entry point that polls SQS and dispatches to handlers
  - `src/fargate/task-processor/handlers/artifact-generation.ts` — Artifact generation logic extracted from Lambda
  - `src/fargate/task-processor/handlers/ai-chat.ts` — AI chat logic extracted from Lambda
  - `src/fargate/task-processor/lib/bedrock-client.ts` — Bedrock API wrapper with streaming support
  - `src/fargate/task-processor/lib/s3-writer.ts` — S3 artifact persistence logic
  - `src/fargate/task-processor/lib/dsql-writer.ts` — DSQL chat history persistence
  - `src/fargate/task-processor/lib/websocket-notifier.ts` — Client for WebSocket notification Lambda
  - `Dockerfile` — Container image definition for Fargate task

### Infrastructure as Code
- `infrastructure/terraform/sqs.tf` — New FIFO queue with DLQ configuration
- `infrastructure/terraform/ecs-cluster.tf` — Fargate cluster with auto-scaling policy
- `infrastructure/terraform/ecs-task-definition.tf` — Task definition with CPU/memory/timeout settings
- `infrastructure/terraform/iam-fargate-execution-role.tf` — IAM role for Fargate task execution (S3, DSQL, SQS, Bedrock permissions)
- `infrastructure/terraform/cloudwatch-alarms.tf` — Alarms for queue depth, task failures, timeout breaches

### Shared Libraries
- `src/shared/types/artifact.ts` — Artifact schema definitions (already exists, reused by Fargate)
- `src/shared/types/chat.ts` — Chat message schema definitions (already exists, reused by Fargate)
- `src/shared/config/websocket.ts` — WebSocket connection table schema (already exists, Fargate reads this)
- `src/shared/lib/logger.ts` — Structured logging utility (already exists, Fargate reuses for CloudWatch Logs)

### Database Schemas
- `database/migrations/` — No schema changes required; Fargate writes to existing `artifacts` and `chat_messages` tables in Aurora DSQL

## Architecture Context

### Current State
Prometheus V1 currently handles artifact generation and AI chat synchronously within Lambda functions. Lambda invokes Bedrock APIs directly, streams responses to the client via API Gateway, and writes results to DSQL before returning the HTTP response. This architecture works for requests that complete within Lambda's 15-minute timeout but fails for complex artifacts or long conversations that exceed this limit.

### Target State
This intent introduces an asynchronous processing model:

1. **Request Ingestion**: Lambda receives HTTP POST to `/artifacts` or `/chat`, validates the request, writes a pending record to DSQL, enqueues a message to SQS, and returns HTTP 202 Accepted with a task ID
2. **Task Processing**: Fargate task polls SQS (long polling with 20-second wait), retrieves message, invokes Bedrock APIs with streaming enabled, writes intermediate progress to S3 (artifacts) or DSQL (chat), handles errors with exponential backoff, and deletes SQS message on success
3. **Notification**: Fargate task invokes WebSocket notification Lambda with task completion event, Lambda publishes to user's active WebSocket connection (if any), frontend receives task ID and retrieves artifact from S3 or chat history from DSQL via existing GET endpoints

### Service Boundaries
- **Lambda**: Request validation, SQS enqueue, WebSocket notification publishing (existing)
- **Fargate**: LLM processing, artifact generation, chat completion, S3/DSQL writes
- **SQS**: Message queue with visibility timeout of 35 minutes (5-minute buffer beyond Fargate task timeout)
- **S3**: Artifact storage (existing bucket with lifecycle policy for 90-day retention)
- **Aurora DSQL**: Relational data (chat history, artifact metadata)
- **API Gateway WebSocket**: Real-time notification delivery to frontend (existing infrastructure)

### Data Flow
```
HTTP POST → Lambda → SQS FIFO Queue → Fargate Task → Bedrock API
                ↓                                    ↓
              DSQL (pending)                    S3 / DSQL (result)
                                                     ↓
                                          WebSocket Lambda → Frontend
```

### Infrastructure Constraints
- **VPC**: Fargate tasks run in private subnets (10.0.2.0/24, 10.0.3.0/24) with NAT gateway for Bedrock API egress
- **Security Groups**: Fargate tasks inherit `sg-prometheus-private` (egress only, no ingress)
- **IAM**: Fargate execution role uses `PrometheusV1FargateExecutionRole` (created in this orbit) with scoped S3/DSQL/SQS/Bedrock permissions
- **Resource Limits**: Fargate task definition sets 2 vCPU, 4 GB RAM, 30-minute timeout
- **Auto-Scaling**: ECS service scales 1–10 tasks based on SQS `ApproximateNumberOfMessagesVisible` metric (target: 2 messages per task)

### Design Patterns
- **Command Pattern**: SQS message payload contains command type (`artifact-generation` or `ai-chat`), user context, and request parameters
- **Idempotency**: Each SQS message includes a dedupe ID (SHA-256 of user ID + request parameters + timestamp) to prevent duplicate processing
- **Circuit Breaker**: Fargate task retries Bedrock API failures with exponential backoff (initial delay: 2s, max delay: 60s, max attempts: 5) before moving message to DLQ
- **Observable State Machine**: Fargate task writes state transitions (`started`, `processing`, `completed`, `failed`) to CloudWatch Logs with structured JSON for X-Ray correlation

## Pattern Library

### SQS Message Schema
```typescript
interface FargateTaskMessage {
  taskId: string;              // UUID for task tracking
  command: 'artifact-generation' | 'ai-chat';
  userId: string;
  requestPayload: ArtifactRequest | ChatRequest;
  websocketConnectionId?: string;  // If user has active WebSocket
  createdAt: string;           // ISO 8601 timestamp
  dedupeId: string;            // SHA-256 for idempotency
}
```

### Fargate Task Logging Pattern
All Fargate task log statements MUST use structured JSON with these fields:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "taskId": "abc-123-def",
  "userId": "user-456",
  "command": "artifact-generation",
  "event": "bedrock_stream_started",
  "metadata": null
}
```

### Error Handling Pattern
Fargate tasks MUST distinguish between retryable and terminal errors:
- **Retryable**: Network timeouts, Bedrock throttling (HTTP 429), transient S3/DSQL errors → return message to queue
- **Terminal**: Invalid request payload, user permission errors, Bedrock content policy violations → move message to DLQ, write error to DSQL

### WebSocket Notification Pattern
Fargate tasks invoke WebSocket notification Lambda with this payload:
```typescript
interface WebSocketNotification {
  connectionId: string;
  event: 'task_completed' | 'task_failed';
  data: {
    taskId: string;
    artifactUrl?: string;      // S3 presigned URL for artifacts
    chatMessageId?: string;    // DSQL record ID for chat
    error?: string;
  };
}
```

### Cost Tracking Pattern
Fargate tasks MUST emit CloudWatch custom metrics after each Bedrock API call:
- `PrometheusV1/Fargate/BedrockInputTokens` (Sum)
- `PrometheusV1/Fargate/BedrockOutputTokens` (Sum)
- `PrometheusV1/Fargate/TaskDurationSeconds` (Average)

### S3 Artifact Storage Pattern
Artifacts MUST be written to S3 with this key structure:
```
s3://prometheus-v1-artifacts/{userId}/{intentId}/{artifactId}.md
```
Presigned URLs MUST expire after 1 hour. S3 bucket lifecycle policy archives to Glacier after 30 days, deletes after 90 days.

## Prior Orbit References

### T6-001: Container Build Pipeline
**Status**: Completed  
**Relevance**: Established ECR repository naming convention (`prometheus-v1/{service-name}`) and Dockerfile patterns for Node.js applications. Fargate task image MUST follow the same pattern: build with `node:20-alpine`, multi-stage build to minimize image size, healthcheck endpoint at `/health`.

**Key Takeaway**: Use `infrastructure/terraform/ecr.tf` as template for new `prometheus-v1/task-processor` repository. Reuse CI/CD pipeline in `.github/workflows/build-container.yml` with service name override.

### T5-004: WebSocket Connection Lifecycle
**Status**: Completed  
**Relevance**: Defined WebSocket connection table schema in DSQL (`websocket_connections` with columns: `connection_id`, `user_id`, `connected_at`, `ttl`). WebSocket notification Lambda (`src/lambda/websocket-notify/handler.ts`) expects connection ID and publishes via API Gateway Management API.

**Key Takeaway**: Fargate task MUST NOT directly interact with WebSocket API Gateway. Instead, invoke WebSocket notification Lambda with task completion event. Lambda handles connection validation and message publishing.

### T4-002: Bedrock Integration
**Status**: Completed  
**Relevance**: Established Bedrock client configuration with streaming support using AWS SDK v3. All Bedrock API calls use `InvokeModelWithResponseStream` with Claude 3.5 Sonnet model ID. IAM policy includes `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` permissions.

**Key Takeaway**: Fargate task MUST reuse existing Bedrock client wrapper from `src/shared/lib/bedrock-client.ts` (currently used by Lambda). Extract Lambda-specific API Gateway streaming logic and replace with S3/DSQL writes.

### T3-005: DSQL Connection Pooling
**Status**: Completed  
**Relevance**: Configured Aurora DSQL with connection pool limit of 50 concurrent connections. Lambda functions use RDS Data API with automatic connection management. Each Lambda invocation acquires 1 connection.

**Key Takeaway**: Fargate tasks will increase connection pool pressure. Task processor MUST use connection pooling library (`pg-pool` with `max: 5` connections per task). Monitor DSQL connection count with CloudWatch metric `DatabaseConnections` and alert if >40.

## Risk Assessment

### Risk: Fargate Task Timeout Without Cleanup
**Impact**: Incomplete artifacts or chat messages left in `pending` state in DSQL, orphaned S3 writes, stuck SQS messages  
**Probability**: Medium (p95 workloads near 30-minute timeout threshold)  
**Mitigation**:
- Task MUST register signal handler for SIGTERM (sent 30 seconds before timeout)
- Signal handler writes `timeout` status to DSQL, moves message to DLQ, sends failure notification via WebSocket
- Integration test MUST verify timeout behavior by artificially triggering SIGTERM

### Risk: SQS Message Duplication
**Impact**: Same artifact generated twice, double Bedrock API cost, duplicate S3 writes  
**Probability**: Low (SQS FIFO provides exactly-once delivery within 5-minute deduplication window)  
**Mitigation**:
- SQS message includes `dedupeId` field (SHA-256 of user ID + request payload + timestamp rounded to nearest minute)
- Fargate task checks DSQL for existing artifact with same dedupe ID before processing
- If duplicate detected, delete SQS message without processing and log warning

### Risk: Fargate Cluster Capacity Exhaustion
**Impact**: SQS queue depth grows unbounded, user requests stall, Lambda returns 503  
**Probability**: Medium (initial auto-scaling policy untested under production load)  
**Mitigation**:
- ECS service auto-scaling scales up to 10 tasks (hard limit for cost control)
- Lambda enqueue endpoint checks SQS queue depth before accepting new requests (reject with HTTP 503 if depth >100)
- CloudWatch alarm triggers PagerDuty alert if queue depth >50 for 5 consecutive minutes
- Load testing MUST simulate 100 concurrent artifact requests to validate scaling behavior

### Risk: Bedrock API Throttling
**Impact**: Task retries exhaust SQS message visibility timeout, messages move to DLQ, user sees failure  
**Probability**: Medium (Bedrock TPM quota shared across all Fargate tasks)  
**Mitigation**:
- Fargate task implements exponential backoff with jitter (base delay: 2s, max: 60s)
- Fargate task monitors HTTP 429 responses and emits CloudWatch metric `PrometheusV1/Fargate/BedrockThrottles`
- If throttle rate >10% over 10 minutes, CloudWatch alarm pages on-call engineer to request quota increase
- Task MUST NOT retry more than 5 times per message (move to DLQ after 5th failure)

### Risk: WebSocket Connection Expired Before Notification
**Impact**: User does not receive real-time notification, relies on polling GET endpoint for artifact status  
**Probability**: High (WebSocket connections expire after 10 minutes of inactivity, median artifact generation is 8 minutes)  
**Mitigation**:
- Frontend implements WebSocket keepalive (send ping every 5 minutes)
- Fargate task gracefully handles missing `websocketConnectionId` in SQS message (skip notification, log info-level event)
- Notification failure is NOT a task failure — artifact MUST still be written to S3/DSQL
- Frontend polls `/artifacts/{artifactId}/status` endpoint every 30 seconds as fallback if WebSocket closed

### Risk: Partial Artifact Write to S3
**Impact**: Artifact metadata exists in DSQL but S3 object missing or incomplete, user sees 404 when retrieving artifact  
**Probability**: Low (S3 PutObject is atomic)  
**Mitigation**:
- Fargate task writes artifact to S3 FIRST, then writes metadata to DSQL only after S3 write confirmed
- DSQL record includes `s3_etag` field to verify S3 object integrity
- GET `/artifacts/{artifactId}` endpoint validates S3 object exists before returning presigned URL
- If S3 object missing but DSQL record exists, endpoint returns HTTP 500 and logs error for manual investigation

### Risk: IAM Role Over-Permissioned
**Impact**: Compromised Fargate task could read other users' artifacts from S3 or modify unrelated DSQL records  
**Probability**: Low (infrastructure code reviewed before deploy)  
**Mitigation**:
- IAM policy restricts S3 actions to `s3:PutObject` on `prometheus-v1-artifacts/*` only (no GetObject, no ListBucket)
- IAM policy restricts DSQL actions to `rds-data:ExecuteStatement` with resource condition limiting to `artifacts` and `chat_messages` tables
- No wildcard permissions in IAM policy
- Terraform plan output MUST be reviewed by human before apply (per Tier 2 requirement)

### Risk: Cost Overrun from Runaway Tasks
**Impact**: Single malformed request triggers infinite Bedrock API loop, exceeds $0.50 budget by 10x  
**Probability**: Low (task timeout enforces hard deadline)  
**Mitigation**:
- Task timeout (30 minutes) prevents infinite loops
- Bedrock client wrapper enforces max tokens limit (input: 100k, output: 16k) per API call
- CloudWatch cost metric alarm triggers if single task exceeds $1.00 (2x budget threshold)
- DLQ message retention set to 7 days for post-mortem analysis of expensive failures