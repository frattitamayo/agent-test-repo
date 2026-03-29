# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Lambda Functions (HTTP Entry Points)

- `src/functions/artifacts/create.ts` — Current synchronous artifact generation handler; must be modified to enqueue SQS message instead of invoking Bedrock directly
- `src/functions/chat/message.ts` — Current AI chat handler; requires similar SQS enqueueing logic
- `src/functions/artifacts/get.ts` — Artifact retrieval endpoint; no changes required but may need extended error handling for async completion states
- `src/lib/bedrock/client.ts` — Bedrock client abstraction currently used in Lambda; will be reused in Fargate tasks

### SQS Message Handling

- `src/services/queue/` — New directory for SQS message schema definitions, producer utilities, and consumer logic
- `src/services/queue/schemas.ts` — TypeScript interfaces for SQS message payloads (artifact generation request, chat message request)
- `src/services/queue/producer.ts` — Helper functions for enqueueing messages from Lambda with proper error handling and tracing

### Fargate Task Implementation

- `src/workers/` — New directory for long-running Fargate task entry points
- `src/workers/artifact-generator.ts` — Main process for polling SQS, generating artifacts via Bedrock, writing results to S3/DSQL
- `src/workers/chat-processor.ts` — Handler for AI chat message processing with context management
- `Dockerfile.worker` — Container image definition for Fargate tasks; must include Node.js runtime, AWS SDK v3, and minimal dependencies
- `ecs-task-definition.json` — ECS task definition specifying vCPU/memory allocation, IAM role, environment variables, and logging configuration

### Storage Layer

- `src/lib/storage/s3.ts` — S3 client wrapper; add method for writing artifacts with server-side encryption and metadata tags
- `src/lib/storage/dsql.ts` — Aurora DSQL query builder; extend with artifact metadata insertion (location, token count, status, timestamps)
- `src/models/artifact.ts` — Artifact domain model; add status field for tracking async lifecycle (queued, processing, completed, failed)

### WebSocket Notifications

- `src/functions/websocket/connection.ts` — Existing WebSocket connection manager; no changes required
- `src/lib/websocket/publisher.ts` — Utility for publishing events to connected clients; add new event types for artifact generation status
- `src/lib/websocket/events.ts` — WebSocket event schema definitions; extend with `artifact.queued`, `artifact.processing`, `artifact.completed`, `artifact.failed`

### Infrastructure as Code

- `infrastructure/fargate-cluster.ts` — CDK construct for ECS cluster with Fargate capacity provider
- `infrastructure/sqs-queues.ts` — SQS queue definitions with DLQ, visibility timeout (1800s), and KMS encryption
- `infrastructure/iam-roles.ts` — Task execution role and task role with least-privilege permissions
- `infrastructure/vpc.ts` — Existing VPC configuration; verify NAT gateway exists for Fargate task internet access

### Monitoring and Observability

- `src/lib/observability/metrics.ts` — CloudWatch Metrics publisher; add custom metrics for queue depth, task duration, Bedrock token usage
- `src/lib/observability/logger.ts` — Structured logging utility; ensure consistent format across Lambda and Fargate
- `infrastructure/alarms.ts` — CloudWatch Alarms for SQS queue depth, Fargate task failures, and DLQ message count

## Architecture Context

### Current State (Synchronous Lambda Execution)

Prometheus V1 currently handles all LLM operations synchronously within Lambda functions:

1. Client sends POST request to `/artifacts` or `/chat/messages` via API Gateway HTTP API
2. Lambda function authenticates request, validates input, and invokes Bedrock directly via `bedrock-runtime:InvokeModel`
3. Lambda waits for Bedrock response (30-120 seconds typical, up to 900 seconds worst-case)
4. Response written to S3 (artifacts) or DSQL (chat history)
5. HTTP 201/200 response returned with artifact location or chat message

**Limitation:** Lambda 15-minute execution limit causes timeouts for complex artifacts (context packages with >50K tokens, multi-turn chat with deep context) and blocks HTTP connection for entire duration.

### Target State (Asynchronous Fargate Processing)

Decoupled architecture with Lambda as orchestrator and Fargate as executor:

```
┌─────────┐         ┌────────┐         ┌─────┐         ┌────────┐         ┌─────────┐
│ Client  │────────▶│ Lambda │────────▶│ SQS │────────▶│Fargate │────────▶│ S3/DSQL │
└─────────┘         └────────┘         └─────┘         └────────┘         └─────────┘
     │                                                       │                    │
     │                                                       │                    │
     │              ┌───────────┐                           │                    │
     └──────────────│ WebSocket │◀──────────────────────────┴────────────────────┘
                    └───────────┘
```

**Data Flow:**

1. **Request Initiation:** Client sends POST to Lambda with artifact/chat parameters
2. **Message Enqueueing:** Lambda validates input, writes SQS message with payload (intent ID, user ID, generation parameters, artifact type), returns 202 Accepted with correlation ID
3. **WebSocket Binding:** Client maintains WebSocket connection subscribed to correlation ID for status updates
4. **Task Activation:** Fargate task polls SQS long-polling (20s timeout), receives message, starts processing
5. **Generation Loop:** Task invokes Bedrock with streaming disabled, aggregates full response, handles retries on throttling
6. **Result Persistence:** Completed artifact written to S3 with server-side encryption; metadata row inserted to DSQL with S3 key, token count, generation time
7. **Status Notification:** Task publishes WebSocket event (`artifact.completed` with S3 presigned URL or `artifact.failed` with error code)
8. **Message Deletion:** Task deletes SQS message only after successful S3 write and DSQL insert
9. **Client Retrieval:** Frontend receives WebSocket event, fetches artifact via presigned URL or queries DSQL for chat history

**Service Boundaries:**

- **Lambda Responsibilities:** HTTP authentication/authorization, input validation, SQS message production, immediate 202 response
- **Fargate Responsibilities:** SQS message consumption, Bedrock invocation with retry logic, result storage, WebSocket notification, message deletion
- **SQS Contract:** Message schema versioning, idempotency key in payload, DLQ for failed messages after 3 retries
- **S3 Semantics:** Artifacts stored at `s3://prometheus-artifacts/{trajectory_id}/{intent_id}/{artifact_id}.json` with metadata tags (user_id, intent_id, generated_at)
- **DSQL Schema:** `artifacts` table with columns: id (UUID), intent_id, user_id, artifact_type, s3_location, token_count, status, created_at, completed_at

**Infrastructure Constraints:**

- **Fargate Networking:** Tasks run in private subnets with NAT gateway for Bedrock API access (no public IPs)
- **IAM Boundaries:** Task execution role for ECR/CloudWatch only; task role for Bedrock/S3/DSQL/SQS with resource-level permissions
- **Resource Allocation:** 1 vCPU, 2GB memory per task (sufficient for Node.js process + Bedrock SDK buffer); auto-scaling disabled initially (manual capacity provisioning)
- **Concurrency Model:** SQS maximum receives per task = 1 (sequential processing); multiple tasks run concurrently for parallel throughput
- **Cold Start Mitigation:** Container pre-loaded with AWS SDK v3, Bedrock client initialized at module load, no runtime dependency fetching

## Pattern Library

### SQS Message Schema

All messages follow this envelope format:

```typescript
interface QueueMessage<T> {
  version: '1.0';
  messageId: string; // UUIDv4 for idempotency
  timestamp: string; // ISO8601
  userId: string;
  intentId: string;
  trajectoryId: string;
  correlationId: string; // For WebSocket subscriptions
  payload: T;
}
```

**Artifact Generation Payload:**

```typescript
interface ArtifactGenerationPayload {
  artifactType: 'context_package' | 'proposal' | 'test_suite' | 'deployment_plan';
  orbitNumber: number;
  entityContext: {
    project: ProjectSummary;
    trajectory: TrajectorySummary;
    intent: IntentDocument;
    orbit: OrbitSummary;
  };
  skillReference: string; // e.g., "context-package"
}
```

**Chat Message Payload:**

```typescript
interface ChatMessagePayload {
  messageContent: string;
  conversationHistory: ChatMessage[]; // Previous 50 messages for context
  systemPrompt: string;
  maxTokens: number;
}
```

### Lambda to SQS Producer Pattern

```typescript
// src/services/queue/producer.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/lib/observability/logger';

export async function enqueueArtifactGeneration(
  userId: string,
  intentId: string,
  trajectoryId: string,
  payload: ArtifactGenerationPayload
): Promise<string> {
  const correlationId = uuidv4();
  const messageId = uuidv4();

  const message: QueueMessage<ArtifactGenerationPayload> = {
    version: '1.0',
    messageId,
    timestamp: new Date().toISOString(),
    userId,
    intentId,
    trajectoryId,
    correlationId,
    payload,
  };

  const command = new SendMessageCommand({
    QueueUrl: process.env.ARTIFACT_QUEUE_URL,
    MessageBody: JSON.stringify(message),
    MessageAttributes: {
      UserId: { DataType: 'String', StringValue: userId },
      IntentId: { DataType: 'String', StringValue: intentId },
      ArtifactType: { DataType: 'String', StringValue: payload.artifactType },
    },
  });

  await sqsClient.send(command);
  logger.info('Enqueued artifact generation', { correlationId, intentId, artifactType: payload.artifactType });

  return correlationId;
}
```

### Fargate Task Consumer Pattern

```typescript
// src/workers/artifact-generator.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { processArtifactGeneration } from './handlers/artifact-generation';
import { publishWebSocketEvent } from '@/lib/websocket/publisher';

async function pollAndProcess() {
  while (true) {
    const command = new ReceiveMessageCommand({
      QueueUrl: process.env.ARTIFACT_QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // Long polling
      MessageAttributeNames: ['All'],
    });

    const response = await sqsClient.send(command);

    if (!response.Messages || response.Messages.length === 0) {
      continue;
    }

    const message = response.Messages[0];
    const queueMessage: QueueMessage<ArtifactGenerationPayload> = JSON.parse(message.Body!);

    try {
      await publishWebSocketEvent(queueMessage.correlationId, {
        type: 'artifact.processing',
        timestamp: new Date().toISOString(),
      });

      const result = await processArtifactGeneration(queueMessage);

      await publishWebSocketEvent(queueMessage.correlationId, {
        type: 'artifact.completed',
        artifactId: result.artifactId,
        s3Location: result.s3Location,
        presignedUrl: result.presignedUrl,
        tokenCount: result.tokenCount,
        timestamp: new Date().toISOString(),
      });

      await sqsClient.send(new DeleteMessageCommand({
        QueueUrl: process.env.ARTIFACT_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      }));
    } catch (error) {
      logger.error('Artifact generation failed', { error, correlationId: queueMessage.correlationId });
      await publishWebSocketEvent(queueMessage.correlationId, {
        type: 'artifact.failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      // Message will return to queue after visibility timeout
    }
  }
}
```

### WebSocket Event Publishing

```typescript
// src/lib/websocket/publisher.ts
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

export async function publishWebSocketEvent(correlationId: string, event: any): Promise<void> {
  // Query connections table for subscribers to this correlationId
  const queryCommand = new QueryCommand({
    TableName: process.env.WEBSOCKET_CONNECTIONS_TABLE,
    IndexName: 'CorrelationIdIndex',
    KeyConditionExpression: 'correlationId = :cid',
    ExpressionAttributeValues: {
      ':cid': { S: correlationId },
    },
  });

  const result = await dynamoClient.send(queryCommand);

  if (!result.Items || result.Items.length === 0) {
    logger.warn('No WebSocket connections found for correlation ID', { correlationId });
    return;
  }

  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: process.env.WEBSOCKET_API_ENDPOINT,
  });

  for (const item of result.Items) {
    const connectionId = item.connectionId.S!;
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(event)),
    });

    try {
      await apiClient.send(command);
    } catch (error) {
      if (error.statusCode === 410) {
        // Connection stale; remove from table
        logger.info('Removing stale WebSocket connection', { connectionId });
        // Delete from DynamoDB (omitted for brevity)
      }
    }
  }
}
```

### Error Handling and Retry Strategy

- **Bedrock Throttling:** Exponential backoff with jitter; max 5 retries; initial delay 1s, max delay 32s
- **S3 Write Failures:** Immediate retry once, then fail task (message returns to queue)
- **DSQL Connection Errors:** Connection pool with auto-reconnect; 3 retries before failure
- **SQS Visibility Timeout:** Set to 1800s (30 minutes); if task crashes, message reappears for retry
- **Dead Letter Queue:** After 3 failed attempts (across all replicas), message moves to DLQ for manual inspection

### Logging and Tracing

All log entries use structured JSON format:

```typescript
logger.info('message', {
  correlationId: string,
  intentId: string,
  userId: string,
  phase: 'queued' | 'processing' | 'completed' | 'failed',
  duration_ms?: number,
  token_count?: number,
  error?: string,
});
```

CloudWatch Logs Insights queries pre-defined for:
- Average task duration by artifact type
- Error rate by failure reason
- P95 latency from enqueue to completion

## Prior Orbit References

### T6-001: Container Infrastructure Setup (Assumed Prerequisite)

**What It Did:** Provisioned base ECS cluster with Fargate launch type, VPC configuration with public/private subnets, NAT gateway for outbound internet access, and IAM service-linked roles.

**Key Takeaways:**
- VPC uses 10.0.0.0/16 CIDR with /24 subnets; Fargate tasks assigned to private subnets (10.0.2.0/24, 10.0.3.0/24)
- NAT gateway required for Bedrock API access (no VPC endpoints available for bedrock-runtime in all regions)
- ECS cluster named `prometheus-v1-cluster` with container insights enabled

**Relevance:** This intent builds on T6-001's infrastructure; verify cluster exists before deploying task definitions.

### T5-002: WebSocket Connection Management (Assumed Completed)

**What It Did:** Implemented API Gateway WebSocket API with $connect, $disconnect, and $default routes; DynamoDB table for connection tracking; Lambda functions for connection lifecycle management.

**Key Patterns:**
- Connections table schema: `connectionId` (partition key), `userId` (GSI), `correlationId` (GSI for subscription filtering)
- Connection TTL: 2 hours; clients must reconnect after timeout
- Stale connection cleanup: PostToConnection failures with 410 status trigger DynamoDB deletion

**Relevance:** Fargate tasks reuse this infrastructure for pushing status events; no new WebSocket logic required, only event schema additions.

### INT-C-001: Aurora DSQL Schema Design (Assumed Operational)

**What It Did:** Defined core tables for projects, trajectories, intents, orbits, artifacts; established connection pooling with pgBouncer; set up read replicas for query scaling.

**Current Schema Limitations:**
- `artifacts` table has `status` enum with values: `draft`, `published`; needs extension to include `queued`, `processing`, `completed`, `failed`
- No index on `artifacts.intent_id` + `status`; query performance may degrade when filtering async completion states

**Migration Required:** Add new status values and create composite index before deploying Fargate tasks.

## Risk Assessment

### 1. SQS Message Loss or Duplication

**Risk:** Network partition or Lambda crash after SQS send but before response to client; client retries, duplicate messages enqueued.

**Impact:** Same artifact generated twice, wasted Bedrock API cost, potential S3 key collision.

**Mitigation:**
- Include idempotency key (`messageId` field) in SQS message payload
- Fargate task checks DSQL for existing artifact with same `intent_id` + `artifact_type` + `orbit_number` before processing
- S3 key includes UUID to prevent overwrites; metadata reconciliation detects duplicates

**Residual Risk:** Low — idempotency key prevents duplicate processing; worst case is duplicate S3 object with no DSQL reference.

### 2. Fargate Task Crash Before Message Deletion

**Risk:** Task crashes after writing S3/DSQL but before deleting SQS message; message reappears, duplicate processing attempt.

**Impact:** Second task sees existing artifact in DSQL, skips generation, deletes message (no harm).

**Mitigation:**
- All operations follow idempotent pattern: check existence before write, use S3 conditional puts with metadata precondition
- SQS visibility timeout (30 minutes) greater than worst-case generation time (15 minutes); reduces chance of concurrent processing

**Residual Risk:** Low — idempotency checks prevent harmful duplication.

### 3. WebSocket Notification Failure

**Risk:** Fargate task completes successfully but WebSocket publish fails (connection closed, API Gateway throttled, DynamoDB query error).

**Impact:** Client waits indefinitely for status update; artifact exists but user unaware.

**Mitigation:**
- Client polls fallback endpoint (`GET /artifacts/{correlationId}/status`) every 10 seconds if WebSocket silent for >30 seconds
- CloudWatch alarm on WebSocket publish failure rate > 1%
- Artifacts table includes `completed_at` timestamp; client can list recent artifacts by `intent_id` as last resort

**Residual Risk:** Medium — WebSocket is best-effort; clients must implement polling fallback.

### 4. Bedrock API Quota Exhaustion

**Risk:** Concurrent Fargate tasks exceed Bedrock model quota (e.g., Claude Sonnet limit 10 requests/second); throttling errors cascade.

**Impact:** Multiple tasks retry simultaneously, amplifying throttling; SQS messages cycle through retries, DLQ fills.

**Mitigation:**
- Request quota increase from AWS Support before production deployment (target: 50 requests/second)
- Implement jittered exponential backoff with per-task random seed
- CloudWatch alarm on Bedrock throttling rate > 5%; manual intervention to pause SQS message delivery

**Residual Risk:** Medium — quota limits are hard; cannot be solved with architecture alone.

### 5. Cold Start Latency Accumulation

**Risk:** Fargate task cold start (10s) + SQS long polling (20s) + Bedrock queue time (5s) = 35s before first token generated.

**Impact:** User perceives system as slow; 35s delay before "processing" status even appears.

**Mitigation:**
- Lambda publishes `artifact.queued` event immediately after SQS send, before Fargate task starts
- CloudWatch metric tracks time-to-first-Bedrock-API-call; P95 must be <15s
- Consider Fargate Spot for cost optimization but maintain on-demand capacity pool for low-latency tasks

**Residual Risk:** Low — users expect async processing; 35s latency acceptable with immediate "queued" feedback.

### 6. S3 Eventual Consistency and Presigned URL Race

**Risk:** Fargate task writes S3 object, generates presigned URL, publishes WebSocket event; client fetches URL immediately, S3 returns 404 due to eventual consistency lag.

**Impact:** User sees "artifact completed" but download fails; poor experience.

**Mitigation:**
- Use S3 strong consistency (enabled by default in all regions since Dec 2020); no eventual consistency risk for new objects
- Presigned URL includes `x-amz-server-side-encryption` header to enforce encryption validation; reduces cache poisoning risk

**Residual Risk:** Negligible — S3 strong consistency eliminates race condition.

### 7. IAM Role Privilege Escalation

**Risk:** Fargate task role over-permissioned; compromised task can modify DSQL schema, delete S3 artifacts, or invoke Bedrock outside policy scope.

**Impact:** Security breach, data loss, unauthorized API usage.

**Mitigation:**
- Task role restricted to:
  - `bedrock:InvokeModel` on specific model ARN (Claude 3.5 Sonnet only)
  - `s3:PutObject` on `prometheus-artifacts/*` prefix only
  - `dynamodb:PutItem`, `dynamodb:GetItem` on `artifacts` table only
  - `sqs:ReceiveMessage`, `sqs:DeleteMessage` on specific queue ARN
  - `execute-api:ManageConnections` on WebSocket API ARN
- No wildcard permissions; no `s3:*` or `dynamodb:*`
- Task execution role separate from task role; execution role only for ECR/CloudWatch

**Residual Risk:** Low — least-privilege IAM enforced.

### 8. Cost Runaway from Failed Task Loops

**Risk:** Bug in task code causes infinite retry loop; task crashes, message reappears, task restarts, repeat.

**Impact:** Fargate vCPU-hours accumulate, CloudWatch Logs storage grows unbounded, Bedrock API quota exhausted.

**Mitigation:**
- SQS DLQ after 3 failed attempts prevents infinite loops
- CloudWatch alarm on DLQ message count > 5; triggers SNS notification to engineering team
- CloudWatch Logs retention set to 30 days (not indefinite)
- AWS Budgets alert at 80% of monthly cost threshold

**Residual Risk:** Low — circuit breakers prevent runaway.

### 9. Backward Compatibility Breakage During Rollout

**Risk:** Clients using old synchronous endpoint (`POST /artifacts` expects immediate response) fail when Lambda starts returning 202 Accepted.

**Impact:** Existing integrations (CLI, CI/CD pipelines, external tools) break without notice.

**Mitigation:**
- Deploy new async endpoint at `/artifacts/async` first; leave synchronous endpoint operational
- Add deprecation warning to synchronous endpoint response headers: `Warning: 299 - "Endpoint deprecated, migrate to /artifacts/async"`
- After 30-day migration window, synchronous endpoint returns 410 Gone with migration instructions
- Document breaking change in changelog with example migration code

**Residual Risk:** Medium — clients must update; cannot be fully mitigated, only communicated.

### 10. DSQL Schema Migration Coordination

**Risk:** Fargate tasks deployed before DSQL schema migration completes; tasks fail when inserting status values not yet in enum.

**Impact:** All tasks fail, DLQ fills, artifact generation halted.

**Mitigation:**
- Schema migration deployed and verified before Fargate task rollout
- Task code includes schema version check on startup; task fails fast if schema incompatible
- Blue/green deployment: new tasks deployed to separate ECS service, traffic shifted only after validation
- Rollback plan: revert task definition to previous version, roll back schema migration

**Residual Risk:** Low — schema-first deployment order enforced.