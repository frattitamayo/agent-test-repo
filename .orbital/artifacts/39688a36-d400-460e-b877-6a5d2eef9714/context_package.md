# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Infrastructure (CDK)
- `infrastructure/lib/stacks/compute-stack.ts` — Lambda function definitions, needs new Fargate task definitions and SQS queue resources
- `infrastructure/lib/constructs/fargate-service.ts` — Create new construct for ECS Fargate service configuration
- `infrastructure/lib/constructs/sqs-queue.ts` — Standard queue + DLQ construct with retry policy
- `infrastructure/lib/stacks/iam-stack.ts` — IAM roles for Fargate tasks (S3, DSQL, Bedrock, WebSocket API permissions)
- `infrastructure/lib/stacks/network-stack.ts` — VPC configuration from T6-001 dependency

### API Layer
- `services/api/src/handlers/artifacts/generate.ts` — Current Lambda handler for artifact generation, needs SQS message publishing logic
- `services/api/src/handlers/chat/complete.ts` — Current Lambda handler for chat completions, needs SQS message publishing logic
- `services/api/src/lib/sqs-client.ts` — Create new SQS client wrapper with message schema validation

### Fargate Application
- `services/fargate-worker/` — New service directory structure:
  - `src/main.ts` — Entry point for Fargate task, SQS polling loop
  - `src/handlers/artifact-generator.ts` — LLM artifact generation logic extracted from Lambda
  - `src/handlers/chat-processor.ts` — LLM chat completion logic extracted from Lambda
  - `src/lib/bedrock-client.ts` — Bedrock SDK wrapper (shared with Lambda version)
  - `src/lib/s3-storage.ts` — S3 persistence layer
  - `src/lib/dsql-client.ts` — DSQL write operations
  - `src/lib/websocket-notifier.ts` — WebSocket event emission
  - `Dockerfile` — Multi-stage build for Node.js runtime
  - `package.json` — Dependencies matching Lambda environment

### Shared Libraries
- `services/shared/src/schemas/sqs-messages.ts` — TypeScript schemas for SQS message payloads (artifact generation, chat completion)
- `services/shared/src/lib/observability.ts` — X-Ray tracing helpers, CloudWatch metric publishing
- `services/shared/src/lib/secrets-manager.ts` — Bedrock API key retrieval with TTL caching

### Monitoring
- `infrastructure/lib/stacks/monitoring-stack.ts` — CloudWatch dashboard definitions, alarms for DLQ depth, task failures, cost anomalies
- `infrastructure/lib/constructs/fargate-alarms.ts` — Fargate-specific alarms (task count, CPU/memory utilization, run duration)

### Tests
- `services/fargate-worker/src/__tests__/handlers/` — Unit tests for extracted handlers
- `services/fargate-worker/src/__tests__/integration/` — Integration tests with LocalStack (SQS, S3, DSQL mocks)
- `services/api/src/__tests__/handlers/artifacts/generate.test.ts` — Update to test SQS publishing instead of direct invocation

## Architecture Context

### Current State (Lambda-Only)
API Gateway → Lambda (artifact/chat handlers) → Bedrock → S3/DSQL → WebSocket notification

**Constraints:**
- Lambda timeout: 15 minutes max (currently configured at 10 minutes)
- Lambda memory: 10GB max (artifact generation peaks at 8GB)
- Synchronous execution model causes timeout failures on complex prompts

### Target State (Hybrid Lambda + Fargate)
API Gateway → Lambda (request validator) → SQS → Fargate (long-running processor) → S3/DSQL → WebSocket notification

**Request Flow:**
1. **API Layer (Lambda):** Validates request, enriches with user context from JWT, publishes SQS message with `{intentId, userId, operation, parameters, traceId}`, returns HTTP 202 Accepted with correlation ID
2. **Queue Layer (SQS):** Standard queue with visibility timeout = 60 minutes, dead-letter queue after 3 failures, FIFO not required (operations are idempotent via intent ID)
3. **Processing Layer (Fargate):** ECS service polls SQS, spawns task per message, invokes Bedrock with prompt, writes result to S3 (`s3://prometheus-artifacts/{intentId}/output.json`), inserts DSQL record, deletes SQS message on success
4. **Notification Layer (WebSocket):** Fargate invokes existing `/notify` Lambda function endpoint with event payload `{type: 'artifact_ready', intentId, userId, s3Path}`

**Service Boundaries:**
- **Lambda:** Thin HTTP adapter, auth validation, SQS publishing. No business logic. Timeout: 30 seconds.
- **Fargate:** Isolated LLM processing, no HTTP exposure, scales 0-to-N based on SQS depth (target tracking: 5 messages per task)
- **SQS:** Decoupling buffer, retry orchestration, backpressure management

**Infrastructure Patterns (from T6-001):**
- Fargate tasks run in private subnets with NAT Gateway for external API calls (Bedrock)
- ECR repository: `prometheus-fargate-worker:latest` with semantic versioning tags
- ECS cluster: `prometheus-fargate-cluster` shared across Fargate services
- IAM execution role separate from task role (ECS pulls image vs. application permissions)

**Data Flow:**
```
[User] → [API GW] → [Lambda: validate + enqueue]
                         ↓ SQS Message
                    [Fargate Task: process]
                         ↓ Bedrock API
                    [S3 + DSQL: persist]
                         ↓ WebSocket Event
                    [Lambda: /notify] → [User Frontend]
```

**Observability:**
- X-Ray trace spans across Lambda → SQS → Fargate with shared `traceId` in message attributes
- CloudWatch Logs: `/aws/ecs/prometheus-fargate-worker` with structured JSON logging
- CloudWatch Metrics: Custom namespace `Prometheus/Fargate` with dimensions `{Operation, IntentId}`

## Pattern Library

### SQS Message Schema
```typescript
// services/shared/src/schemas/sqs-messages.ts
interface ArtifactGenerationMessage {
  operation: 'artifact_generation';
  intentId: string;
  userId: string;
  traceId: string;
  parameters: {
    type: 'context_package' | 'risk_assessment' | 'test_spec';
    context: Record<string, unknown>;
  };
  requestedAt: string; // ISO 8601
}

interface ChatCompletionMessage {
  operation: 'chat_completion';
  intentId: string;
  userId: string;
  traceId: string;
  parameters: {
    conversationId: string;
    userMessage: string;
    conversationHistory: Array<{role: string; content: string}>;
  };
  requestedAt: string;
}

type FargateMessage = ArtifactGenerationMessage | ChatCompletionMessage;
```

### SQS Publishing Pattern (Lambda)
```typescript
// services/api/src/handlers/artifacts/generate.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';

const sqs = new SQSClient(null);
const queueUrl = process.env.FARGATE_QUEUE_URL;

export const handler = async (event: APIGatewayProxyEvent) => {
  const { intentId, type, context } = JSON.parse(event.body);
  const userId = event.requestContext.authorizer.userId;
  const correlationId = randomUUID();

  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({
      operation: 'artifact_generation',
      intentId,
      userId,
      traceId: correlationId,
      parameters: { type, context },
      requestedAt: new Date().toISOString(),
    }),
    MessageAttributes: {
      TraceId: { DataType: 'String', StringValue: correlationId },
      Operation: { DataType: 'String', StringValue: 'artifact_generation' },
    },
  }));

  return {
    statusCode: 202,
    body: JSON.stringify({ correlationId, status: 'processing' }),
  };
};
```

### Fargate Task Main Loop
```typescript
// services/fargate-worker/src/main.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { processMessage } from './processor';

const sqs = new SQSClient(null);
const queueUrl = process.env.QUEUE_URL;

async function pollQueue() {
  while (true) {
    const { Messages } = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: 3600, // 60 minutes
    }));

    if (!Messages?.length) continue;

    for (const message of Messages) {
      try {
        await processMessage(JSON.parse(message.Body));
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }));
      } catch (error) {
        console.error('Processing failed', { error, messageId: message.MessageId });
        // Message returns to queue after visibility timeout
      }
    }
  }
}

pollQueue().catch(console.error);
```

### WebSocket Notification Pattern
```typescript
// services/fargate-worker/src/lib/websocket-notifier.ts
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient(null);

export async function notifyUser(payload: {
  userId: string;
  type: string;
  intentId: string;
  data: Record<string, unknown>;
}) {
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.WEBSOCKET_NOTIFY_FUNCTION,
    InvocationType: 'Event', // Async invocation
    Payload: JSON.stringify(payload),
  }));
}
```

### Dockerfile Multi-Stage Build
```dockerfile
# services/fargate-worker/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
ENV NODE_ENV=production
USER node
CMD ["node", "dist/main.js"]
```

### IAM Task Role (Fargate)
```typescript
// infrastructure/lib/stacks/iam-stack.ts
const fargateTaskRole = new iam.Role(this, 'FargateWorkerTaskRole', {
  assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
  ],
  inlinePolicies: {
    BedrockAccess: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*:*:foundation-model/*'],
      })],
    }),
    S3ArtifactAccess: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [`${artifactBucket.bucketArn}/*`],
      })],
    }),
    DSQLAccess: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        actions: ['dsql:ExecuteStatement'],
        resources: [dsqlCluster.clusterArn],
      })],
    }),
    SQSConsume: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
        resources: [queue.queueArn],
      })],
    }),
    LambdaNotify: new iam.PolicyDocument({
      statements: [new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [websocketNotifyFunction.functionArn],
      })],
    }),
  },
});
```

### CDK Fargate Service Definition
```typescript
// infrastructure/lib/constructs/fargate-service.ts
const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
  memoryLimitMiB: 16384, // 16GB
  cpu: 4096, // 4 vCPU
  taskRole: taskRole,
});

taskDefinition.addContainer('worker', {
  image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'fargate-worker',
    logRetention: logs.RetentionDays.ONE_WEEK,
  }),
  environment: {
    QUEUE_URL: queue.queueUrl,
    WEBSOCKET_NOTIFY_FUNCTION: notifyFunction.functionName,
    NODE_ENV: 'production',
  },
  secrets: {
    BEDROCK_API_KEY: ecs.Secret.fromSecretsManager(bedrockSecret),
    DSQL_CONNECTION_STRING: ecs.Secret.fromSecretsManager(dsqlSecret),
  },
});

const service = new ecs.FargateService(this, 'Service', {
  cluster: cluster,
  taskDefinition: taskDefinition,
  desiredCount: 0, // Scale from zero
  minHealthyPercent: 0, // Allow full replacement
  maxHealthyPercent: 200, // Allow double provisioning during deploy
});

// Auto-scaling based on SQS depth
const scaling = service.autoScaleTaskCount({
  minCapacity: 0,
  maxCapacity: 10,
});

scaling.scaleOnMetric('SQSBacklog', {
  metric: queue.metricApproximateNumberOfMessagesVisible(),
  scalingSteps: [
    { upper: 0, change: -1 },
    { lower: 1, change: +1 },
    { lower: 10, change: +2 },
    { lower: 50, change: +5 },
  ],
  adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
});
```

## Prior Orbit References

### T6-001: Container Infrastructure Setup
- **Status:** Completed
- **Artifacts:**
  - ECS Fargate cluster: `prometheus-fargate-cluster`
  - VPC configuration: 3 AZs, private subnets with NAT Gateway
  - ECR repository: `prometheus-fargate-worker`
  - Base IAM execution role for ECS task launches
- **Lessons:**
  - Fargate cold start latency averages 25 seconds for 16GB memory tasks
  - NAT Gateway bandwidth: 45 Gbps per AZ, sufficient for Bedrock API calls
  - ECR image pull time: ~8 seconds for 500MB Node.js image
- **References:**
  - `infrastructure/lib/stacks/network-stack.ts` — VPC construct
  - `infrastructure/lib/stacks/ecs-cluster-stack.ts` — Fargate cluster setup

### Prior LLM Timeout Incidents
- **INC-2024-11-03:** Artifact generation timeout during context package generation for large codebases (12-minute Lambda execution)
- **Root cause:** Bedrock Claude 3.5 Sonnet invocation took 9 minutes due to 50K token prompt
- **Mitigation attempt:** Increased Lambda timeout to 15 minutes (maximum allowed), but still insufficient for p99 latency
- **Resolution:** Accepted degraded UX; this intent removes the constraint entirely

### WebSocket Notification Pattern (Established)
- **Origin:** Orbit management real-time updates (T3-005)
- **Pattern:** Lambda function at `/notify` endpoint, invoked asynchronously by backend services
- **Schema:** `{userId, type, data}` — frontend reconnection logic handles dropped connections with exponential backoff (max 5 retries)
- **Performance:** p95 delivery latency < 800ms from invocation to client receipt

### DSQL Write Performance (T4-002)
- **Observed:** Batch insert of 1000 records = 3.2 seconds
- **Observed:** Single record insert with conflict check = 45ms p50, 120ms p95
- **Constraint:** No transactions across S3 and DSQL; use idempotency keys (`intentId`) to handle retries

## Risk Assessment

### Risk 1: SQS Message Loss or Duplication
**Scenario:** Network partition or Fargate task crash mid-processing causes message to return to queue after visibility timeout. Task restarts and processes duplicate message.

**Impact:** Duplicate artifact generation invokes Bedrock twice (cost increase), writes duplicate S3 objects, sends duplicate WebSocket notifications.

**Mitigation:**
- Use `intentId` as idempotency key for S3 writes (`PutObject` with `x-amz-meta-idempotency-key: {intentId}`)
- DSQL inserts use `ON CONFLICT (intent_id) DO UPDATE SET updated_at = NOW()` to handle duplicates
- WebSocket notifications are idempotent (frontend deduplicates by `intentId`)
- Fargate task logs include `messageId` and `receiptHandle` for audit trail

**Residual Risk:** Low. Duplicate processing costs <$0.10 per occurrence; no data corruption.

---

### Risk 2: Fargate Task OOM or CPU Throttling
**Scenario:** Complex LLM prompts with 100K+ token context exceed 16GB memory allocation or require >4 vCPU for JSON parsing.

**Impact:** Task killed by ECS, SQS message returns to queue, retries until DLQ. User receives no result after 3 failures.

**Mitigation:**
- CloudWatch alarm on ECS task stopped reason `OutOfMemoryError` or `ResourceInitializationError`
- Fargate task definition allows upgrade to 30GB / 8 vCPU without code changes
- Implement memory pressure monitoring (Node.js `process.memoryUsage()`) and emit CloudWatch metric before OOM
- Pre-validation in Lambda: reject requests with >200K token estimated context (return HTTP 413 Payload Too Large)

**Residual Risk:** Medium. Bedrock model upgrades may change memory requirements unexpectedly. Requires production load testing.

---

### Risk 3: Runaway Fargate Costs from Misconfigured Auto-Scaling
**Scenario:** SQS backlog spikes to 1000 messages (e.g., bulk operation or API abuse), auto-scaling provisions 100 Fargate tasks simultaneously.

**Impact:** AWS bill spike from $500/month baseline to $5000/day if tasks run continuously.

**Mitigation:**
- ECS service `maxCapacity: 10` hard limit in CDK (requires manual override to increase)
- CloudWatch anomaly detection alarm on daily Fargate cost (threshold: 3x baseline)
- SQS queue `maxReceiveCount: 3` prevents infinite retry loops
- API rate limiting on artifact/chat endpoints: 10 requests per user per minute (existing middleware)
- Budget alert configured in AWS Billing Console: $1000/day threshold triggers PagerDuty

**Residual Risk:** Low. Multiple safeguards prevent runaway scaling. Worst case: $1000 overage detected within 24 hours.

---

### Risk 4: Fargate Task Hangs or Zombie Processes
**Scenario:** Bedrock API call hangs indefinitely (network timeout, SDK bug), Fargate task remains in RUNNING state but makes no progress.

**Impact:** Task consumes Fargate capacity without processing SQS messages; queue backs up; auto-scaler provisions more tasks, exacerbating cost.

**Mitigation:**
- Bedrock SDK client configured with `requestTimeout: 50 minutes` (10-minute buffer below SQS visibility timeout)
- Fargate task includes self-termination logic: if no SQS message processed in 5 minutes, exit gracefully
- CloudWatch alarm on ECS tasks running >45 minutes (expected max: 30 minutes for p99 operation)
- ECS task `stopTimeout: 60 seconds` forces SIGKILL after graceful shutdown attempt

**Residual Risk:** Low. SDK timeout + task-level timeout + ECS stopTimeout provide defense-in-depth.

---

### Risk 5: Secrets Rotation During Task Execution
**Scenario:** AWS Secrets Manager rotates Bedrock API key or DSQL connection string while Fargate task is mid-processing.

**Impact:** Task fails with authentication error, SQS message returns to queue, retry succeeds with new secret.

**Mitigation:**
- Secrets Manager rotation triggers Lambda function to drain ECS service (set `desiredCount: 0`) before rotation completes
- Fargate tasks use AWS SDK credential caching with 15-minute TTL — rotation window is 30 minutes, ensuring overlap
- DLQ alarm on `SecretRotationFailure` includes runbook step to manually restart ECS service

**Residual Risk:** Low. Rotation is infrequent (90 days) and automated coordination prevents mid-task failures.

---

### Risk 6: S3 Write Failure or DSQL Unavailability
**Scenario:** Fargate task completes Bedrock invocation successfully but fails to persist result to S3 (quota exceeded, network partition) or DSQL (cluster restart, connection pool exhaustion).

**Impact:** LLM response is lost, user receives no result, SQS message deleted (appears successful).

**Mitigation:**
- Fargate task transactional logic: Bedrock response → S3 write → DSQL write → SQS delete. Failure at any step = retry entire flow.
- S3 write uses multipart upload with retry on `SlowDown` or `ServiceUnavailable` errors (AWS SDK automatic retry with exponential backoff)
- DSQL connection pool: 10 connections per task, circuit breaker pattern after 3 consecutive failures
- CloudWatch metric: `StorageWriteFailure` with alarm threshold >5 per hour

**Residual Risk:** Medium. Partial failures are retry-safe, but Bedrock invocation cost is re-incurred. Consider caching Bedrock response in-memory if S3/DSQL write fails.

---

### Risk 7: WebSocket Notification Delivery Failure
**Scenario:** Fargate task successfully writes to S3/DSQL but WebSocket notification Lambda fails (throttled, misconfigured, user disconnected).

**Impact:** User never receives completion event; frontend polls S3/DSQL or times out waiting.

**Mitigation:**
- WebSocket notification is asynchronous (`InvocationType: Event`) — Fargate task does not wait for confirmation
- Frontend implements polling fallback: check artifact status every 30 seconds if no WebSocket event received within 2 minutes
- Lambda `/notify` includes retry logic with 2 attempts (AWS SDK default) and DLQ for undeliverable events
- CloudWatch alarm on Lambda `/notify` error rate >5%

**Residual Risk:** Low. Notification is best-effort; frontend polling provides guaranteed eventual consistency.

---

### Risk 8: Rollback Complexity
**Scenario:** Fargate deployment introduces critical bug (e.g., Bedrock response parsing error). Rollback to Lambda-only processing required.

**Impact:** Inflight SQS messages are incompatible with Lambda handler if message schema changed. Data loss or processing stalls.

**Mitigation:**
- Feature flag `FARGATE_ENABLED` in Lambda handlers — toggle to skip SQS publishing and invoke Bedrock directly
- SQS message schema is backward-compatible: Lambda can process same messages Fargate sends (validation schema shared via `services/shared`)
- Rollback procedure tested in staging: drain SQS queue, disable Fargate service, toggle feature flag, verify Lambda processing
- Canary deployment: 10% of traffic routed to Fargate for 24 hours before full cutover

**Residual Risk:** Medium. Requires rehearsal in staging environment. Inflight messages during rollback may experience delays.