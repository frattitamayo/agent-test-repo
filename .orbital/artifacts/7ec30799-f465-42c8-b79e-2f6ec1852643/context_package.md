# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Infrastructure as Code
- `infrastructure/terraform/fargate-cluster.tf` — ECS Fargate cluster definition, task definitions, capacity providers
- `infrastructure/terraform/sqs-queues.tf` — SQS queue configuration for `prometheus-artifact-generation-queue` and DLQ
- `infrastructure/terraform/iam-roles.tf` — Task execution roles, Lambda roles, cross-service permissions
- `infrastructure/terraform/vpc-endpoints.tf` — Bedrock VPC endpoint configuration (if avoiding NAT Gateway costs)
- `infrastructure/terraform/ecs-task-definitions/artifact-worker.json` — Fargate task definition for artifact generation worker
- `infrastructure/terraform/cloudwatch-alarms.tf` — Monitoring for queue depth, task failures, DLQ messages

### Lambda Functions (HTTP Entry Points)
- `src/functions/api/artifacts/generate.ts` — Existing Lambda handler for artifact generation requests (modify to enqueue SQS message)
- `src/functions/api/chat/send-message.ts` — Chat message handler (modify to enqueue long chat sessions)
- `src/functions/api/jobs/status.ts` — Polling endpoint for job status queries (new or modify existing)
- `src/shared/services/sqs-client.ts` — Shared SQS service wrapper for enqueueing messages
- `src/shared/services/job-service.ts` — Job ID generation, job metadata persistence to DSQL

### Fargate Worker Application
- `src/workers/fargate/artifact-generation/` — Root directory for containerized artifact worker
- `src/workers/fargate/artifact-generation/Dockerfile` — Container image definition
- `src/workers/fargate/artifact-generation/main.ts` — Worker entry point: poll SQS, process message, invoke LLM, write result
- `src/workers/fargate/artifact-generation/handlers/` — Per-artifact-type handlers (Intent Document, Context Package, etc.)
- `src/workers/fargate/shared/bedrock-client.ts` — Bedrock SDK wrapper with retry/timeout logic
- `src/workers/fargate/shared/s3-client.ts` — S3 client for artifact storage
- `src/workers/fargate/shared/websocket-notifier.ts` — WebSocket API client for pushing completion events
- `src/workers/fargate/shared/job-repository.ts` — DSQL repository for updating job status/metadata

### Data Models
- `src/shared/models/job.ts` — TypeScript interface/type for Job entity (job_id, status, artifact_type, artifact_uri, created_at, updated_at)
- `src/shared/models/artifact-request.ts` — SQS message payload schema for artifact generation requests
- `database/migrations/003-add-jobs-table.sql` — DSQL schema for jobs table (if not already exists)

### Frontend Integration Points
- `frontend/src/services/artifact-service.ts` — Client-side service calling Lambda artifact generation endpoint
- `frontend/src/hooks/useJobPolling.ts` — React hook for polling job status (fallback if WebSocket unavailable)
- `frontend/src/hooks/useWebSocketNotifications.ts` — WebSocket subscription hook for real-time job updates
- `frontend/src/components/ArtifactGenerationProgress.tsx` — UI component displaying progress/status

### Monitoring & Observability
- `infrastructure/terraform/cloudwatch-dashboards/fargate-workers.json` — Dashboard definition for task metrics, queue depth, error rates
- `src/workers/fargate/shared/logger.ts` — Structured logging client (Winston/Pino) for CloudWatch
- `src/workers/fargate/shared/xray-instrumentation.ts` — AWS X-Ray SDK integration for distributed tracing

## Architecture Context

### Current State
Prometheus V1 currently processes all artifact generation requests synchronously within Lambda functions. The Lambda handler invokes Amazon Bedrock directly, generates the artifact content, writes to S3 or DSQL, and returns the result to the client. This pattern works for lightweight artifacts but fails for:
- Intent Documents with complex context analysis (5-10 minutes LLM inference)
- Multi-turn AI chat sessions with large conversation history (10-15+ minutes)
- Concurrent high-volume requests that exhaust Lambda concurrency limits (1000 default regional limit)

The Lambda execution model has a hard 15-minute maximum timeout, and real-world LLM inference times vary unpredictably based on model load, prompt complexity, and token generation rates.

### Target Architecture

**Asynchronous Work Queue Pattern:**
```
Client → API Gateway → Lambda (Enqueue) → SQS Queue → Fargate Task → Bedrock LLM
                           ↓                                  ↓
                       Job ID (202)                      S3/DSQL ← Artifact
                                                             ↓
                                                     WebSocket API → Client
```

1. **Lambda as Orchestrator (≤3s):** Lambda receives the artifact generation request, validates input, generates a unique job ID, writes job metadata to DSQL with status `pending`, enqueues an SQS message with the request payload, and returns `202 Accepted` with the job ID.

2. **SQS as Decoupler:** Queue provides guaranteed delivery, automatic retries, and visibility timeout isolation. Fargate tasks are not directly invoked — ECS service auto-scaling triggers based on queue depth (CloudWatch metric + target tracking policy).

3. **Fargate as Worker:** ECS service runs 0-N tasks (scale to zero when idle, scale up to 10+ during load). Each task polls SQS via long polling, retrieves one message at a time, processes it, deletes the message on success, or allows visibility timeout expiration on failure (message returns to queue for retry).

4. **S3/DSQL as Result Store:** Large artifacts (>4KB) stored in S3 with object key `artifacts/{job_id}/{artifact_type}.md`. Small payloads (<4KB) stored directly in DSQL `jobs.result_data` JSONB column. Job metadata updated to status `completed` or `failed` with artifact URI or error details.

5. **WebSocket as Notification Channel:** Upon task completion, Fargate publishes a message to WebSocket API Gateway connections filtered by user_id or job_id. Frontend receives real-time notification and fetches artifact from S3 or displays inline content from DSQL.

6. **Polling as Fallback:** If WebSocket connection is closed or unsupported, frontend polls `GET /jobs/{job_id}/status` every 2-5 seconds until status transitions to terminal state (`completed` or `failed`).

### Service Boundaries

- **Lambda → SQS:** Lambda has no knowledge of Fargate. It writes a message and returns immediately. Dependency: `AmazonSQSFullAccess` IAM permission (scoped to specific queue ARN).
  
- **Fargate → Bedrock:** Fargate task calls Bedrock directly. No Lambda involvement. Dependency: VPC endpoint `com.amazonaws.region.bedrock-runtime` or NAT Gateway egress to public Bedrock API.

- **Fargate → S3:** Direct S3 write. Dependency: IAM role with `s3:PutObject` on `arn:aws:s3:::prometheus-artifacts-${env}/*`.

- **Fargate → DSQL:** Task updates job status via Aurora DSQL Postgres-compatible SQL client. Dependency: IAM role with `dsql:DbConnect` and security group allowing egress to DSQL cluster endpoint.

- **Fargate → WebSocket API:** Task invokes `POST https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/@connections/{connectionId}` to push notification. Dependency: IAM role with `execute-api:ManageConnections` and API Gateway resource policy allowing ECS task role.

### Infrastructure Constraints

- **Subnets:** Fargate tasks must run in private subnets (no public IP assignment). Outbound internet required for Bedrock API unless VPC endpoint exists.
  
- **Security Groups:** Task security group allows outbound HTTPS (443) to Bedrock, S3, DSQL, WebSocket API. Inbound rules: none (tasks are not addressable).

- **Task Resource Allocation:** Initial task size 1 vCPU, 2 GB memory (minimum for Node.js runtime with Bedrock SDK). Monitor memory usage — LLM prompts with large context may require 4 GB.

- **ECS Service Auto-Scaling:** Target tracking policy based on `ApproximateNumberOfMessagesVisible` CloudWatch metric. Scale up when queue depth >5 messages, scale down when queue depth <2 messages. Cooldown period 120 seconds to avoid thrashing.

- **Cost Control:** Tasks must terminate immediately after message processing. No persistent tasks. Fargate pricing: $0.04048 per vCPU-hour + $0.004445 per GB-hour. Average task duration 2-5 minutes = $0.002-$0.005 per artifact.

## Pattern Library

### SQS Message Payload Schema
All SQS messages for artifact generation MUST conform to this schema:

```typescript
interface ArtifactGenerationMessage {
  jobId: string;                    // UUID v4
  userId: string;                   // Authenticated user ID
  artifactType: 'intent' | 'context' | 'proposal' | 'test' | 'retrospective' | 'learning';
  entityContext: {
    projectId: string;
    trajectoryId?: string;
    intentId?: string;
    orbitId: string;
  };
  promptPayload: Record<string, any>; // Artifact-specific prompt variables
  metadata: {
    requestedAt: string;            // ISO 8601 timestamp
    priority?: 'low' | 'normal' | 'high'; // Future: FIFO queue with priority groups
  };
}
```

### Job Status Lifecycle
Jobs transition through these states in DSQL `jobs.status` column:

1. `pending` — Job created, message enqueued, not yet picked up by worker
2. `processing` — Worker retrieved message, started LLM invocation
3. `completed` — Artifact generated, written to S3/DSQL, WebSocket notification sent
4. `failed` — Terminal error (max retries exhausted, unrecoverable Bedrock error, schema validation failure)

**Never** transition from `completed` or `failed` back to earlier states. Use separate `retry_count` column to track retry attempts (max 3).

### Fargate Task Exit Codes
Worker process MUST exit with specific codes for ECS to distinguish failure types:

- **Exit 0:** Success. SQS message deleted. Job marked `completed`.
- **Exit 1:** Transient failure (Bedrock throttling, network timeout). SQS message returned to queue for retry. Job remains `pending`.
- **Exit 2:** Permanent failure (invalid payload, unsupported artifact type). SQS message deleted, sent to DLQ. Job marked `failed`.

### Error Handling in Worker
```typescript
try {
  const message = await sqsClient.receiveMessage(queueUrl);
  const job = parseMessage(message.Body);
  
  await jobRepository.updateStatus(job.jobId, 'processing');
  
  const artifact = await bedrockClient.generateArtifact({
    artifactType: job.artifactType,
    prompt: buildPrompt(job.promptPayload),
    maxTokens: 8000,
    temperature: 0.7
  });
  
  const artifactUri = await s3Client.putObject({
    Bucket: 'prometheus-artifacts-prod',
    Key: `artifacts/${job.jobId}/${job.artifactType}.md`,
    Body: artifact.content
  });
  
  await jobRepository.updateStatus(job.jobId, 'completed', { artifactUri });
  await websocketNotifier.notify(job.userId, { jobId: job.jobId, status: 'completed', artifactUri });
  await sqsClient.deleteMessage(message.ReceiptHandle);
  
  process.exit(0); // Success
} catch (error) {
  if (isTransientError(error)) {
    logger.warn('Transient error, message will retry', { error });
    process.exit(1); // SQS will make message visible again
  } else {
    logger.error('Permanent failure', { error });
    await jobRepository.updateStatus(job.jobId, 'failed', { error: error.message });
    await sqsClient.deleteMessage(message.ReceiptHandle); // Remove from queue
    process.exit(2);
  }
}
```

### CloudWatch Structured Logging
All worker logs MUST include these fields for queryability:

```typescript
logger.info('Artifact generation started', {
  jobId: job.jobId,
  userId: job.userId,
  artifactType: job.artifactType,
  orbitId: job.entityContext.orbitId,
  timestamp: new Date().toISOString()
});
```

Use CloudWatch Insights query:
```
fields @timestamp, jobId, userId, artifactType, message
| filter jobId = "specific-job-id"
| sort @timestamp asc
```

### X-Ray Trace Propagation
Lambda must inject trace context into SQS message attributes:

```typescript
await sqsClient.sendMessage({
  QueueUrl: queueUrl,
  MessageBody: JSON.stringify(message),
  MessageAttributes: {
    'X-Amzn-Trace-Id': {
      DataType: 'String',
      StringValue: process.env._X_AMZN_TRACE_ID
    }
  }
});
```

Fargate worker extracts trace context and initializes X-Ray segment:

```typescript
const traceId = message.MessageAttributes['X-Amzn-Trace-Id']?.StringValue;
AWSXRay.setSegment(AWSXRay.getSegment().addNewSubsegment('FargateWorker'));
```

## Prior Orbit References

### T5-002 Orbit 3: WebSocket Gateway Implementation
**Status:** Completed  
**Relevance:** This orbit delivered the WebSocket API Gateway infrastructure that this intent depends on for real-time notifications.

**Key Learnings:**
- WebSocket connection management requires DynamoDB table to track `connectionId → userId` mappings
- API Gateway `@connections` API has rate limits: 1000 requests/sec per connection
- Lambda authorizer validates JWT on `$connect` route before allowing WebSocket upgrade
- Frontend must handle reconnection logic (exponential backoff) when WebSocket drops

**Reusable Components:**
- `src/shared/services/websocket-client.ts` — Client for posting messages to connected clients
- `infrastructure/terraform/websocket-api.tf` — API Gateway WebSocket API definition
- `database/migrations/002-websocket-connections-table.sql` — DynamoDB table schema (or DSQL if migrated)

**Anti-Pattern Avoided:** Do NOT invoke WebSocket API from Lambda synchronously. Use async invocation or Step Functions to avoid timeout if many connections need notification. For this intent, Fargate can notify synchronously because it's the final step and task terminates afterward.

### T1-001 Orbit 2: Aurora DSQL Schema
**Status:** Completed  
**Relevance:** Established the DSQL database schema for core entities (Projects, Trajectories, Intents, Orbits). This intent adds a `jobs` table for tracking async work.

**Schema Reference:**
```sql
CREATE TABLE jobs (
  job_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  artifact_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'orbit', 'intent', 'trajectory', 'project'
  entity_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  artifact_uri TEXT,
  result_data JSONB,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_entity ON jobs(entity_type, entity_id);
```

**Migration Path:** Add this schema via new migration `003-add-jobs-table.sql`. Ensure `updated_at` trigger exists for automatic timestamp updates.

### T4-001 Orbit 1: LLM Prompt Engineering for Artifacts
**Status:** Completed  
**Relevance:** Defined the prompt templates and system instructions for generating each artifact type (Intent Document, Context Package, etc.). These prompts are now invoked from Fargate instead of Lambda.

**Reusable Prompts:**
- `src/shared/prompts/intent-document.ts` — Prompt template for Intent Document generation
- `src/shared/prompts/context-package.ts` — Prompt template for Context Package generation
- Each template exports a function: `buildPrompt(context: EntityContext): string`

**Key Constraint:** Prompts may exceed Bedrock's 200K token input limit for Claude 3.5 Sonnet if entity context is very large. Worker must implement token counting and truncation logic before invoking Bedrock.

## Risk Assessment

### Risk 1: SQS Message Loss or Duplication
**Scenario:** SQS standard queue (not FIFO) provides at-least-once delivery. A message could be delivered twice if worker fails to delete it within visibility timeout, or lost if DLQ retention expires.

**Impact:** User submits artifact request, receives job ID, but artifact never generates (loss) or generates twice with different content (duplication).

**Likelihood:** Low (SQS durability 99.999999999%). Duplication more likely than loss.

**Mitigation:**
- Use idempotent job ID as S3 object key — duplicate processing overwrites same artifact (safe for most artifact types)
- Implement deduplication check in worker: query DSQL `jobs` table by `job_id` before starting LLM call. If status is `completed`, skip processing and delete message.
- Set DLQ retention to 14 days and alert on messages in DLQ (CloudWatch alarm threshold >0 messages)
- For critical artifacts where duplication is unacceptable (e.g., billing events), migrate to SQS FIFO queue with message deduplication ID

### Risk 2: Fargate Task Crashes Mid-Processing
**Scenario:** Worker task crashes (OOM, unhandled exception, ECS task termination) after starting LLM call but before writing result to S3/DSQL. SQS message visibility timeout expires, message returns to queue, new task picks it up and calls LLM again.

**Impact:** Double billing from Bedrock (two LLM inference calls for same artifact). User may see inconsistent status if DSQL update partially succeeded.

**Likelihood:** Medium (worker code quality, memory limits, ECS spot instance interruptions).

**Mitigation:**
- Set SQS visibility timeout to 110% of expected max task duration (20 minutes visibility for 18-minute task timeout)
- Use X-Ray tracing to detect double invocations (same job ID appears in multiple traces)
- Implement graceful shutdown handler in worker: on SIGTERM (ECS task stop signal), stop processing new messages, finish current message, update job status to `pending`, and allow message to return to queue cleanly
- Monitor Bedrock API call metrics grouped by job ID — alert on duplicate calls for same job within 30 minutes

### Risk 3: WebSocket Notification Failure
**Scenario:** Worker successfully generates artifact, writes to S3, updates DSQL to `completed`, but fails to notify WebSocket client (connection closed, API Gateway throttle, IAM permission denied).

**Impact:** User never knows artifact completed. Frontend remains in loading state indefinitely. Only discoverable if user manually refreshes or polls status endpoint.

**Likelihood:** Medium (WebSocket connections are ephemeral, users may close browser tab mid-processing).

**Mitigation:**
- Make WebSocket notification optional (worker logs error but continues). Job status in DSQL is source of truth, not WebSocket notification.
- Frontend implements polling fallback: if no WebSocket notification received within 60 seconds of job submission, start polling `GET /jobs/{job_id}/status` every 5 seconds.
- Add CloudWatch metric for WebSocket notification failures (count per hour). Alert if failure rate >10%.
- Store notification attempts in DSQL `jobs.notification_attempts` counter — frontend can query this to detect missed notifications.

### Risk 4: S3 Write Failure After LLM Inference
**Scenario:** Worker successfully calls Bedrock and generates artifact content (cost incurred), but S3 `putObject` fails (bucket policy, region throttle, credentials expired). Worker cannot retry Bedrock call (too expensive), cannot store artifact.

**Impact:** User charged for LLM inference but receives no artifact. Job marked `failed`, user must retry entire request (double cost).

**Likelihood:** Low (S3 has 99.99% availability SLA).

**Mitigation:**
- Implement idempotent retry logic for S3 writes: on transient S3 error (500, 503), retry S3 `putObject` up to 3 times with exponential backoff. Do NOT retry Bedrock call.
- Cache LLM response in worker memory before attempting S3 write. If S3 fails after all retries, write to DSQL `jobs.result_data` JSONB column as fallback (if artifact size <1MB). Mark job `completed` with `artifact_uri = NULL`, set `result_data` instead.
- For artifacts >1MB that don't fit in DSQL, write to EFS mounted volume as last resort (requires ECS task definition update to mount EFS). Alert on EFS fallback usage.

### Risk 5: Cold Start Latency Exceeds User Tolerance
**Scenario:** First artifact request after idle period (no running tasks) triggers ECS service scale-up. Fargate task takes 20-30 seconds to start (image pull, container init). User sees "Generating artifact..." for 30+ seconds with no feedback beyond initial 202 response.

**Impact:** Poor UX. User perceives system as slow or unresponsive. May submit duplicate requests thinking first one failed.

**Likelihood:** High (scale-to-zero means every first request after idle incurs cold start).

**Mitigation:**
- Set ECS service minimum task count to 1 (keep one task warm at all times). Cost: ~$30/month for 1 vCPU, 2GB task running 24/7.
- Implement task warm-up period: after scaling up, new task polls SQS but does NOT process messages for first 10 seconds (allows container to fully initialize). Use health check endpoint.
- Frontend displays estimated time remaining based on historical job duration for that artifact type (query DSQL for avg duration of completed jobs by `artifact_type`).
- Add WebSocket progress notifications from worker: send `{ status: 'processing', progress: 10 }` every 30 seconds during LLM inference to indicate liveness.

### Risk 6: Bedrock API Quota Exhaustion
**Scenario:** High concurrent traffic triggers 10+ Fargate tasks simultaneously calling Bedrock. Regional Bedrock quota (e.g., 100 requests/minute for Claude 3.5 Sonnet) is exceeded. Tasks receive throttling errors, fail, retry, amplify the problem.

**Impact:** Cascading failures. Most artifact requests fail. SQS queue fills up (1000s of messages). Users see "Service temporarily unavailable" errors.

**Likelihood:** Medium (depends on Prometheus user growth, Bedrock quota limits per AWS account).

**Mitigation:**
- Request Bedrock quota increase via AWS Support before production launch (from default 100 req/min to 500 req/min for Claude 3.5 Sonnet).
- Implement exponential backoff in worker for Bedrock throttling errors (429 status code). Max backoff 5 minutes before marking job failed.
- Add CloudWatch alarm on Bedrock throttle rate (metric: `ThrottleCount`). Trigger PagerDuty alert if throttle rate >10 per minute.
- Use SQS delay queue for failed tasks: on throttle error, delete message from primary queue, send to delay queue with 2-minute delay. Delay queue drains slowly to avoid retry storm.
- Future enhancement: implement rate limiting at SQS consumer level (Fargate tasks poll at staggered intervals, not all at once).

### Risk 7: DSQL Connection Exhaustion
**Scenario:** Each Fargate task opens a connection to Aurora DSQL. At high scale (50+ concurrent tasks), connection pool exhausted (default limit 100 connections per DSQL cluster).

**Impact:** Tasks fail to update job status. Jobs stuck in `processing` state forever. New Lambda requests fail to write job metadata (can't insert into `jobs` table).

**Likelihood:** Low at current scale (10 task limit). High if scale limit increased without connection pooling.

**Mitigation:**
- Use connection pooling in worker: initialize single connection pool at container startup, reuse connections across message processing loops. Set pool size to 2 connections per task (1 for reads, 1 for writes).
- Configure DSQL cluster with increased `max_connections` parameter (requires cluster restart, coordinate with DBA).
- Implement connection leak detection: log warning if connection held for >60 seconds without commit/rollback.
- Monitor DSQL connection count via CloudWatch metric `DatabaseConnections`. Alert if >80% of max connections in use.