# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Primary Implementation Surfaces

**Lambda HTTP Handlers (to be refactored):**
- `src/lambda/handlers/artifacts/generate.ts` — Current synchronous artifact generation endpoint
- `src/lambda/handlers/intents/create.ts` — Intent creation flow that triggers artifact generation
- `src/lambda/handlers/chat/message.ts` — AI chat message handling
- `src/lambda/handlers/proposals/generate.ts` — Proposal artifact generation
- `src/lambda/handlers/evaluations/generate.ts` — Evaluation artifact generation

**New Fargate Worker Code (to be created):**
- `src/fargate/workers/llm-task-processor.ts` — Main worker entrypoint that polls SQS and dispatches to handlers
- `src/fargate/workers/handlers/artifact-generation.ts` — Artifact generation logic extracted from Lambda
- `src/fargate/workers/handlers/chat-processing.ts` — Chat message processing logic
- `src/fargate/workers/services/bedrock-client.ts` — Bedrock API interaction layer
- `src/fargate/workers/services/result-storage.ts` — S3 and DSQL result persistence
- `src/fargate/workers/services/websocket-notifier.ts` — WebSocket event emission

**Shared Libraries:**
- `src/shared/types/task-messages.ts` — SQS message schema definitions
- `src/shared/types/websocket-events.ts` — WebSocket event schemas
- `src/shared/services/sqs-publisher.ts` — SQS message enqueue helper
- `src/shared/services/correlation-id.ts` — Correlation ID generation and propagation
- `src/shared/middleware/auth-context.ts` — User identity extraction and serialization

**Infrastructure as Code:**
- `infrastructure/fargate/task-definition.ts` — ECS task definition (from T6-001)
- `infrastructure/fargate/service.ts` — ECS service with autoscaling (from T6-001)
- `infrastructure/sqs/llm-task-queue.ts` — SQS queue configuration (from T6-002)
- `infrastructure/iam/fargate-task-role.ts` — IAM policies for Fargate task execution
- `infrastructure/cloudwatch/dashboards/llm-pipeline.ts` — Observability dashboard

**Database Schema:**
- `database/migrations/008_add_task_tracking.sql` — DSQL schema for task status tracking
- `database/migrations/009_add_correlation_indexes.sql` — Indexes on correlation_id fields

**Tests:**
- `tests/integration/llm-task-pipeline.test.ts` — End-to-end test for Lambda → SQS → Fargate → WebSocket flow
- `tests/unit/fargate/workers/llm-task-processor.test.ts` — Worker logic unit tests
- `tests/mocks/sqs-message-factory.ts` — Test fixtures for SQS message payloads

## Architecture Context

### System Overview

Prometheus V1 currently operates as a synchronous Lambda-based API where artifact generation and AI chat requests are processed inline within the HTTP handler execution context. This architecture is constrained by Lambda's 15-minute timeout and leads to 504 Gateway Timeout errors when Bedrock API calls exceed this limit.

The new architecture introduces an **asynchronous task processing pipeline**:

1. **Request Acceptance Layer (Lambda):** HTTP handlers validate inputs, generate correlation IDs, enqueue task messages to SQS, and immediately return HTTP 202 Accepted with tracking metadata
2. **Message Queue (SQS):** Standard queue acts as buffer between Lambda and Fargate; provides delivery guarantees and visibility timeout management
3. **Worker Layer (Fargate):** Containerized tasks poll SQS, process messages by invoking Bedrock APIs, store results, and emit WebSocket events
4. **Storage Layer:** S3 for artifact blobs (Intent documents, proposals, evaluations); Aurora DSQL for metadata, chat history, and task status
5. **Notification Layer:** WebSocket API delivers real-time events (`task.started`, `task.completed`, `task.failed`) to connected frontend clients

### Data Flow

```
Client → API Gateway → Lambda Handler
                          ↓ (enqueue)
                        SQS Queue
                          ↓ (poll)
                     Fargate Task → Bedrock API
                          ↓ (store results)
                     S3 + DSQL
                          ↓ (notify)
                     WebSocket API → Client
```

**Authentication Propagation:** User identity (Cognito JWT claims) is extracted by Lambda authorizer, serialized into SQS message metadata, and reconstructed in Fargate task for audit logging and DSQL record attribution.

**Correlation ID:** UUID generated at request acceptance, embedded in SQS message, HTTP 202 response, all CloudWatch logs, DSQL records, and WebSocket events — enables full request tracing across services.

### Infrastructure Constraints

- **VPC Configuration:** Fargate tasks run in private subnets with no direct internet access; outbound Bedrock API calls route through NAT gateway in `us-east-1a` and `us-east-1b` availability zones
- **IAM Scoping:** Fargate task execution role has read-only access to ECR for container images; task role has scoped write permissions to S3 artifact bucket (`s3:PutObject` on `prometheus-artifacts-{env}/*`) and DSQL tables (`dsql:ExecuteStatement` on specific table ARNs)
- **Scaling Behavior:** ECS service autoscaling configured with target tracking on SQS `ApproximateNumberOfMessagesVisible` metric; scales from 0 to 10 tasks with 60-second cooldown
- **Cost Guardrails:** Fargate tasks terminate immediately after processing each message (no persistent workers); SQS long polling (20-second wait time) minimizes empty receives

### Service Boundaries

- **Lambda Responsibility:** HTTP contract enforcement, input validation, rate limiting, SQS enqueue, correlation ID generation — NO LLM invocation
- **Fargate Responsibility:** SQS polling, message deserialization, Bedrock API interaction, retry logic (within single task), result persistence, WebSocket notification
- **Deferred to T6-004:** Dead-letter queue processing, poison message handling, exponential backoff retry across task invocations

## Pattern Library

### SQS Message Schema

All task messages follow this structure:

```typescript
interface LLMTaskMessage {
  correlationId: string;           // UUID v4
  taskType: 'artifact_generation' | 'chat_message';
  userId: string;                  // Cognito sub claim
  organizationId: string;
  timestamp: string;               // ISO 8601
  payload: ArtifactGenerationPayload | ChatMessagePayload;
  context: {
    userEmail: string;
    userRoles: string[];
    requestId: string;             // API Gateway request ID
  };
}
```

**Naming Convention:** SQS queue names follow `prometheus-{env}-llm-tasks` (e.g., `prometheus-prod-llm-tasks`).

### WebSocket Event Schema

Events emitted to WebSocket API follow this envelope:

```typescript
interface WebSocketEvent {
  event: 'task.started' | 'task.progress' | 'task.completed' | 'task.failed';
  correlationId: string;
  taskType: string;
  timestamp: string;
  payload: {
    // Event-specific fields
    progress?: number;              // 0-100 for task.progress
    resultUri?: string;             // S3 presigned URL for task.completed
    error?: { code: string; message: string };  // For task.failed
  };
}
```

### Lambda Handler Refactor Pattern

Existing synchronous handlers should be refactored to this structure:

```typescript
// BEFORE (synchronous)
export const handler = async (event: APIGatewayProxyEvent) => {
  const result = await generateArtifact(input);  // Blocks for minutes
  return { statusCode: 200, body: JSON.stringify(result) };
};

// AFTER (asynchronous enqueue)
export const handler = async (event: APIGatewayProxyEvent) => {
  const correlationId = generateCorrelationId();
  const userContext = extractAuthContext(event);
  
  await sqsPublisher.enqueue({
    queueUrl: process.env.LLM_TASK_QUEUE_URL,
    message: {
      correlationId,
      taskType: 'artifact_generation',
      userId: userContext.sub,
      organizationId: userContext.organizationId,
      timestamp: new Date().toISOString(),
      payload: parseAndValidateInput(event.body),
      context: {
        userEmail: userContext.email,
        userRoles: userContext.roles,
        requestId: event.requestContext.requestId,
      },
    },
  });
  
  return {
    statusCode: 202,
    body: JSON.stringify({
      correlationId,
      status: 'accepted',
      message: 'Task enqueued for processing',
    }),
  };
};
```

### Fargate Worker Pattern

Worker entrypoint follows this long-polling loop:

```typescript
// src/fargate/workers/llm-task-processor.ts
async function main() {
  const sqsClient = new SQSClient({ region: 'us-east-1' });
  const queueUrl = process.env.LLM_TASK_QUEUE_URL;
  
  while (true) {
    const messages = await sqsClient.receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,  // Long polling
      VisibilityTimeout: 600,  // 10 minutes
    });
    
    if (!messages.Messages?.length) continue;
    
    const message = messages.Messages[0];
    const task = JSON.parse(message.Body) as LLMTaskMessage;
    
    try {
      await processTask(task);
      await sqsClient.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      });
    } catch (error) {
      logger.error('Task processing failed', { correlationId: task.correlationId, error });
      // Message returns to queue after visibility timeout
    }
  }
}
```

### CloudWatch Logging Pattern

All components emit structured JSON logs with correlation ID:

```typescript
logger.info('Task processing started', {
  correlationId: task.correlationId,
  taskType: task.taskType,
  userId: task.userId,
  timestamp: Date.now(),
});
```

Log groups:
- Lambda: `/aws/lambda/prometheus-{functionName}`
- Fargate: `/ecs/prometheus-llm-worker`
- Centralized search: CloudWatch Logs Insights queries filter by `correlationId` field

### IAM Least Privilege Pattern

Fargate task roles follow this scoping:

```typescript
new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['s3:PutObject'],
  resources: [`arn:aws:s3:::prometheus-artifacts-${env}/*`],
  conditions: {
    StringEquals: {
      's3:x-amz-server-side-encryption': 'AES256',
    },
  },
});
```

No wildcard permissions; no cross-service assume role chains.

## Prior Orbit References

### T6-001: Fargate Service Definition

**Status:** Completed
**Key Outputs:**
- ECS cluster `prometheus-workers-{env}` created in VPC `vpc-prometheus-{env}`
- Task definition `prometheus-llm-worker:1` with 2 vCPU, 4 GB memory, CloudWatch Logs integration
- Private subnets (`10.0.128.0/20`, `10.0.144.0/20`) with route tables pointing to NAT gateway
- Security group allowing outbound HTTPS (443) to `0.0.0.0/0` for Bedrock API access
- IAM execution role for ECR image pull with `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`

**Lessons Learned:**
- Initial task definition used 1 vCPU, which caused Bedrock SDK initialization timeouts; increased to 2 vCPU resolved
- Fargate Spot was considered but rejected due to unpredictable interruptions during long-running LLM calls
- CloudWatch log group must be created BEFORE task definition; otherwise task fails to start with opaque error

**Reusable Artifacts:**
- `infrastructure/fargate/base-task-definition.ts` — Template for worker tasks
- `infrastructure/networking/vpc-endpoints.ts` — VPC endpoints for ECR, S3, CloudWatch Logs (avoids NAT gateway charges for AWS service calls)

### T6-002: SQS Queue Provisioning

**Status:** Completed
**Key Outputs:**
- Standard SQS queue `prometheus-prod-llm-tasks` with 4-day message retention, 10-minute visibility timeout
- Dead-letter queue `prometheus-prod-llm-tasks-dlq` with 14-day retention
- CloudWatch alarms: `SQSQueueDepth > 100` (indicates backlog), `DLQMessageCount > 0` (indicates failures)
- IAM policy for Lambda enqueue: `sqs:SendMessage` on queue ARN
- IAM policy for Fargate consume: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`

**Lessons Learned:**
- Default visibility timeout of 30 seconds was too short; tasks were re-processed mid-execution causing duplicate artifacts
- Redrive policy maxReceiveCount set to 3 — messages move to DLQ after 3 failed processing attempts
- SQS FIFO queues were considered but rejected; artifact generation order is not critical, and FIFO throughput limits (300 TPS) were constraining

**Reusable Artifacts:**
- `src/shared/services/sqs-publisher.ts` — Enqueue helper with automatic error handling and retries
- `tests/mocks/sqs-message-factory.ts` — Test fixture generator for valid task messages

### T5-001: WebSocket API Infrastructure

**Status:** Completed (prior trajectory)
**Key Outputs:**
- API Gateway WebSocket API `wss://ws.prometheus.{env}.example.com`
- Connection table in DSQL: `websocket_connections` with `connection_id`, `user_id`, `connected_at`, `last_ping_at` fields
- Lambda authorizer validates Cognito JWT and stores user context in connection record
- Disconnect handler removes stale connections from table

**Relevant for T6-003:**
- WebSocket notification service (`src/shared/services/websocket-notifier.ts`) already exists; can be reused by Fargate tasks
- Connection ID lookup by user ID: `SELECT connection_id FROM websocket_connections WHERE user_id = $1 AND last_ping_at > NOW() - INTERVAL '5 minutes'`
- Notification failure (connection closed) should NOT fail the task; log warning and continue

### T4-002: Bedrock Integration

**Status:** Completed (prior trajectory)
**Key Outputs:**
- Bedrock client wrapper: `src/shared/services/bedrock-client.ts` with retry logic, token counting, prompt template management
- Claude 3.5 Sonnet model ID: `anthropic.claude-3-5-sonnet-20241022-v2:0`
- Prompt templates stored in S3 bucket `prometheus-prompts-{env}` with versioning enabled
- IAM policy for Bedrock access: `bedrock:InvokeModel` on model ARN, `s3:GetObject` on prompt bucket

**Relevant for T6-003:**
- Bedrock client is environment-agnostic; can be used in Lambda or Fargate without modification
- Rate limiting handled by AWS; no client-side throttling required
- Observed latencies: Intent generation ~45 seconds, Context Package ~30 seconds, Proposal ~60 seconds (p95)

**Anti-pattern to Avoid:**
- Do NOT stream Bedrock responses to WebSocket in real-time; buffers entire response and sends as single `task.completed` event (streaming deferred to T7-001)

## Risk Assessment

### Risk 1: SQS Message Loss During Fargate Scale-Down

**Scenario:** Fargate task receives message from SQS, begins processing, but ECS service scales down due to low queue depth metric lag. Task is forcibly terminated mid-execution.

**Impact:** Message visibility timeout expires, message returns to queue, duplicate processing occurs. Artifact may be generated twice and stored with different S3 keys.

**Mitigation:**
- Set ECS service scale-in protection: `scale_in_protection = true` on task definition
- Implement graceful shutdown handler: SIGTERM signal triggers SQS visibility timeout extension before task termination
- Add idempotency key to DSQL artifact records: `ON CONFLICT (correlation_id, artifact_type) DO UPDATE SET s3_uri = EXCLUDED.s3_uri` prevents duplicate rows
- CloudWatch alarm on `TasksStoppedReason = ScaleDown` with SNS notification to engineering team

### Risk 2: Bedrock API Throttling

**Scenario:** Burst of concurrent artifact generation requests exceeds Bedrock account-level quota (default: 10 concurrent invocations per model). Fargate tasks retry exhaustively, messages return to queue, cascading retries amplify load.

**Impact:** SQS queue depth grows unbounded, Fargate scales to max tasks (10), all tasks enter retry loops, no progress is made. DLQ fills with timeout errors.

**Mitigation:**
- Request Bedrock quota increase to 50 concurrent invocations before deploying to production
- Implement exponential backoff in Bedrock client with jitter: `delay = min(60, 2^attempt) + random(0, 5)` seconds
- Set SQS visibility timeout extension during retries: `changeMessageVisibility` before each retry attempt
- CloudWatch alarm on `BedrockThrottles > 10/minute` triggers Fargate service max task limit reduction (temporary circuit breaker)

### Risk 3: WebSocket Connection Staleness

**Scenario:** User submits artifact generation request, Lambda enqueues task and returns 202, but user's WebSocket connection drops before Fargate completes processing. Notification fails silently.

**Impact:** User receives no feedback on task completion; must manually refresh or poll for results. Creates perception of "black hole" for long-running tasks.

**Mitigation:**
- Implement connection liveness check in Fargate notification service: query DSQL for `last_ping_at > NOW() - INTERVAL '5 minutes'` before sending event
- If connection stale, skip WebSocket notification and set DSQL task status to `completed_notification_failed`
- Frontend polling fallback: JavaScript client polls `GET /api/tasks/{correlationId}` every 10 seconds if WebSocket disconnects
- Log metric `WebSocketNotificationFailures` to CloudWatch; if exceeds 5% of completions, investigate connection stability

### Risk 4: S3 Eventual Consistency Race

**Scenario:** Fargate task writes artifact to S3, immediately writes metadata to DSQL with S3 URI, and sends WebSocket notification. Frontend receives notification and fetches presigned URL, but S3 object is not yet visible (eventual consistency lag).

**Impact:** User clicks "view artifact" link and receives 404 Not Found. Confusing UX; appears as system failure.

**Mitigation:**
- S3 strong consistency (default since December 2020) eliminates read-after-write lag for new objects
- DSQL write includes S3 ETag validation: store ETag from PutObject response, include in presigned URL generation as `If-Match` header
- Frontend retry logic: if S3 GET returns 404, retry up to 3 times with 2-second delay before showing error
- Add CloudWatch metric `S3ArtifactNotFound` from frontend; alert if > 1% of fetches fail

### Risk 5: Correlation ID Collision

**Scenario:** UUID v4 generation produces duplicate correlation ID (astronomically rare but not impossible at scale). Two unrelated tasks have same correlation ID, causing log confusion and incorrect WebSocket routing.

**Impact:** User A receives notification for User B's task completion; potential data leak if artifact URI is exposed.

**Mitigation:**
- Use `crypto.randomUUID()` (Node.js native) for UUID generation; provides cryptographically strong randomness
- Add DSQL unique constraint on `(correlation_id, user_id)` pair; prevents cross-user collision from being persisted
- Lambda enqueue validates correlation ID uniqueness by querying DSQL before sending SQS message: `SELECT COUNT(*) FROM tasks WHERE correlation_id = $1`
- If collision detected, regenerate correlation ID and retry (max 3 attempts before failing with 500 Internal Server Error)

### Risk 6: Fargate Task IAM Policy Drift

**Scenario:** Infrastructure change grants Fargate task role overly broad permissions (e.g., `s3:*` on all buckets). Task is compromised or abused, enabling lateral movement to unrelated S3 data.

**Impact:** Security incident; potential data breach; compliance violation.

**Mitigation:**
- IAM policy includes explicit `Deny` statements for sensitive buckets: `arn:aws:s3:::prometheus-secrets-*`, `arn:aws:s3:::prometheus-backups-*`
- Terraform remote state locking enforces peer review for IAM policy changes; no direct AWS console modifications
- AWS Config rule `iam-policy-no-statements-with-full-access` monitors Fargate task role for wildcard permissions
- Quarterly IAM policy audit: automated scan for overly permissive statements, manual review of all Fargate-related roles

### Risk 7: DSQL Connection Pool Exhaustion

**Scenario:** 10 concurrent Fargate tasks each open 5 DSQL connections (50 total). DSQL cluster max connections limit (default: 100) is nearly saturated. Additional tasks cannot acquire connections, queries time out, tasks fail.

**Impact:** Processing halts despite queue having pending messages; SQS visibility timeouts cause message churn; DLQ fills with connection errors.

**Mitigation:**
- Configure DSQL client connection pool with `max: 2` connections per task (20 total at max scale)
- Implement connection reuse: single persistent connection per task lifecycle, not per message
- Set connection timeout to 30 seconds with retry: `pg.connect({ connectionTimeoutMillis: 30000, retry: true })`
- CloudWatch alarm on DSQL `DatabaseConnections > 80` triggers notification; manual investigation of connection leaks