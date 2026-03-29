# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Codebase References

### Existing Files (Reference)

**API Layer:**
- `backend/api/properties/search.js` — Example Lambda handler demonstrating request parsing, error handling, and response structure patterns

**Database Layer:**
- `backend/database/queries/property-search.sql` — Example parameterized SQL query demonstrating naming conventions and structure

**Documentation:**
- `README.md` — Project overview and setup instructions

### Files to Create

**Lambda API Handlers:**
- `backend/api/artifacts/generate.js` — HTTP handler for artifact generation requests (validates input, enqueues to SQS, returns 202 Accepted with task_id)
- `backend/api/chat/submit.js` — HTTP handler for AI chat message submission (similar enqueue pattern)
- `backend/api/tasks/status.js` — HTTP handler for polling task status from DSQL (fallback for missed WebSocket notifications)

**Infrastructure Definitions:**
- `infrastructure/ecs/task-definitions/artifact-worker.json` — Fargate task definition for artifact generation worker (CPU, memory, container image, environment variables)
- `infrastructure/ecs/task-definitions/chat-worker.json` — Fargate task definition for chat processing worker
- `infrastructure/sqs/queues.yaml` — SQS queue and DLQ configuration (visibility timeout, retention, encryption)
- `infrastructure/iam/lambda-execution-role.json` — IAM policy for Lambda (sqs:SendMessage only)
- `infrastructure/iam/fargate-task-role.json` — IAM policy for Fargate tasks (SQS read, S3 write, DSQL access, WebSocket API permissions)
- `infrastructure/iam/fargate-execution-role.json` — IAM policy for ECS task execution (ECR pull, CloudWatch Logs, Secrets Manager)
- `infrastructure/cloudwatch/alarms.yaml` — CloudWatch alarms (DLQ depth, Fargate OOM, task failure rate)

**Fargate Worker Services:**
- `backend/workers/artifact-generator/index.js` — Main entrypoint for artifact generation worker (SQS polling, message processing, LLM invocation)
- `backend/workers/artifact-generator/Dockerfile` — Container image definition (Node.js base, dependencies, healthcheck)
- `backend/workers/artifact-generator/package.json` — Node.js dependencies (AWS SDK, LLM clients, logging)
- `backend/workers/chat-processor/index.js` — Chat message processing worker
- `backend/workers/chat-processor/Dockerfile` — Chat worker container image

**Database Schema:**
- `backend/database/schema/tasks.sql` — Task status table definition (task_id, intent_id, user_id, status, created_at, updated_at, error_message, correlation_id)
- `backend/database/schema/artifacts.sql` — Artifact metadata table (artifact_id, task_id, s3_key, file_size, content_type)
- `backend/database/queries/task-insert.sql` — Insert new task record
- `backend/database/queries/task-update-status.sql` — Update task status with optimistic locking
- `backend/database/queries/task-get-by-id.sql` — Retrieve task details for status API

**Shared Libraries:**
- `backend/lib/sqs-client.js` — SQS abstraction with message enqueue, retry logic, correlation ID propagation
- `backend/lib/websocket-notifier.js` — WebSocket API Gateway client for server-initiated notifications
- `backend/lib/s3-artifact-store.js` — S3 upload helper with multipart support, SSE encryption, presigned URL generation
- `backend/lib/logger.js` — Structured logging utility with correlation IDs and X-Ray context
- `backend/lib/xray-middleware.js` — X-Ray instrumentation for Lambda and SDK calls
- `backend/lib/dsql-connection.js` — DSQL connection pool management (verify compatibility with long-lived Fargate processes)

**Configuration:**
- `backend/config/fargate.js` — Fargate-specific configuration (task counts, scaling thresholds, timeout values)
- `backend/config/sqs.js` — SQS configuration (queue URLs, visibility timeout, retry policy)
- `backend/config/feature-flags.js` — Feature flag loader from Parameter Store (ENABLE_FARGATE_MIGRATION)

**Testing:**
- `backend/tests/integration/artifact-generation-flow.test.js` — End-to-end test: Lambda → SQS → mock Fargate → WebSocket delivery
- `backend/tests/integration/chat-flow.test.js` — End-to-end test for chat message processing
- `backend/tests/unit/artifact-generator.test.js` — Unit tests for worker message processing logic
- `backend/tests/unit/sqs-client.test.js` — Unit tests for SQS enqueue with error handling
- `backend/tests/unit/websocket-notifier.test.js` — Unit tests for WebSocket delivery with retry logic

**Deployment:**
- `.github/workflows/deploy-fargate.yml` — GitHub Actions workflow for building and pushing container images to ECR
- `.github/workflows/update-task-definition.yml` — Workflow for updating ECS task definitions on infrastructure changes

## Architecture Context

### Current State

Prometheus V1 currently executes all operations synchronously within Lambda functions behind API Gateway. LLM-powered artifact generation and AI chat sessions run directly in Lambda request handlers with a 15-minute execution limit. This architecture works for simple operations but fails when:
- Artifact generation requires large context windows (200k+ tokens)
- Multi-step reasoning chains exceed Lambda timeout
- Complex codebase analysis takes >15 minutes
- Concurrent user requests exhaust Lambda concurrency limits

The existing architecture is:
```
Client → API Gateway → Lambda (sync LLM call) → Response
                            ↓
                         DSQL (artifact metadata)
                            ↓
                         S3 (artifact files)
```

### Target State

This orbit introduces an **asynchronous execution plane** that decouples API request handling from LLM processing while preserving the existing HTTP API contract. The new architecture is:

```
Client → API Gateway → Lambda → SQS Queue → Fargate Task → LLM API
                          ↓                        ↓
                       DSQL (task)              DSQL (update)
                          ↓                        ↓
                       202 Accepted             S3 (artifact)
                                                   ↓
Client ← WebSocket API ← WebSocket Notifier ← Completion
```

### Data Flow

1. **Request Submission (Lambda):**
   - User sends POST to `/api/artifacts/generate` with intent context
   - Lambda validates request, authenticates user
   - Lambda writes task record to DSQL with status='pending', generates task_id
   - Lambda enqueues message to SQS (`artifact-generation-queue`) with task_id, intent_id, user_id
   - Lambda returns 202 Accepted with task_id and status polling URL
   - **Duration:** <200ms

2. **Task Processing (Fargate):**
   - Fargate worker polls SQS with long polling (20s wait time)
   - Worker receives message, extracts task_id
   - Worker updates DSQL task status to 'processing'
   - Worker fetches LLM API credentials from Secrets Manager
   - Worker invokes LLM API (Bedrock Claude or OpenAI) with intent context
   - Worker streams LLM response to memory or S3 for large outputs
   - Worker writes final artifact to S3 bucket with SSE encryption
   - Worker updates DSQL task status to 'completed', records S3 key
   - **Duration:** 5-60 minutes depending on complexity

3. **Notification (WebSocket):**
   - Worker looks up user's WebSocket connection ID from connection table
   - Worker sends notification via API Gateway WebSocket API
   - Frontend receives event, displays "Artifact Ready" with download link
   - Worker deletes SQS message (acknowledges successful processing)
   - **Duration:** <2s from task completion

### Failure Scenarios

**SQS Message Retry:**
- If Fargate worker crashes mid-processing, SQS visibility timeout expires (3600s)
- Message becomes visible again, another worker picks it up
- Worker checks DSQL task status before processing (idempotency via optimistic locking)
- After 3 failed attempts, message moves to DLQ

**WebSocket Delivery Failure:**
- If user disconnects or WebSocket send returns 410 Gone, worker logs error but task remains 'completed'
- Frontend polls `/api/tasks/{task_id}` on reconnect to catch missed notifications
- DSQL is source of truth, WebSocket is best-effort optimization

**Fargate Scale-Down:**
- If no tasks for 10 minutes, ECS scales to min task count (2)
- Next request experiences cold start (container pull, process start)
- Message waits in SQS until worker is ready (visibility not affected)

### Service Boundaries

**Lambda Responsibilities:**
- HTTP request validation and authentication
- Rate limiting and abuse detection
- Task record creation in DSQL
- SQS message enqueue with correlation ID
- Immediate HTTP response (202 Accepted)
- Polling endpoint for task status

**Fargate Responsibilities:**
- SQS message consumption and processing
- LLM API invocation with retry logic
- Artifact generation and S3 upload
- DSQL task status updates
- WebSocket notification delivery
- Structured logging with correlation IDs

**AWS Service Dependencies:**
- **SQS:** Message queue, retention 14 days, DLQ after 3 retries
- **ECS on Fargate:** Container orchestration, auto-scaling based on CPU
- **S3:** Artifact storage with SSE-S3 encryption, private bucket
- **DSQL:** Task metadata, atomic status transitions
- **Secrets Manager:** LLM API credentials, rotated every 90 days
- **API Gateway WebSocket:** Server-initiated notifications to frontend
- **CloudWatch:** Logs, metrics, alarms for operational visibility
- **X-Ray:** Distributed tracing across Lambda, SQS, Fargate

### Infrastructure Constraints

**Fargate Task Configuration:**
- CPU: 4 vCPU (required for Claude 3.5 Sonnet with large context)
- Memory: 8 GB (6 GB for LLM processing + 2 GB buffer)
- Networking: Private subnet with NAT Gateway for Bedrock egress
- VPC Endpoints: S3, DSQL, Secrets Manager (no public internet for data plane)
- Container Image: `node:20-alpine` base with AWS SDK and LLM clients
- Health Check: HTTP GET on port 8080/health every 30s

**SQS Configuration:**
- Queue Name: `prometheus-artifact-generation-prod`
- Visibility Timeout: 3600s (1 hour, longer than expected processing time)
- Message Retention: 14 days (maximum allowed)
- DLQ: `prometheus-artifact-generation-dlq-prod` after 3 retries
- Encryption: AWS managed KMS key (in-transit and at-rest)
- Max Receive Count: 3 (move to DLQ after 3 failed processing attempts)

**Auto-Scaling Policy:**
- Metric: CPU utilization target 70%
- Min Tasks: 2 (always warm, avoid cold starts)
- Max Tasks: 50 (per-region limit consideration)
- Scale-Out: Add 5 tasks when CPU >70% for 2 minutes
- Scale-In: Remove 1 task when CPU <30% for 10 minutes

**Network Architecture:**
- VPC: Existing Prometheus VPC or new dedicated VPC
- Subnets: Private subnets in 3 AZs (us-east-1a, us-east-1b, us-east-1c)
- NAT Gateway: One per AZ for Bedrock API access
- VPC Endpoints: S3 Gateway endpoint, DSQL interface endpoint, Secrets Manager interface endpoint
- Security Groups: Fargate tasks can egress to 443 for Bedrock, no inbound traffic

### Rollback Strategy

**Feature Flag Control:**
- Parameter Store key: `/prometheus/feature-flags/enable-fargate-migration`
- Default: `false` (synchronous Lambda execution)
- When `true`: Lambda enqueues to SQS instead of calling LLM directly

**Rollback Steps:**
1. Set feature flag to `false` via AWS Console or CLI
2. New requests execute synchronously in Lambda (old behavior)
3. Monitor SQS queue depth - wait for in-flight tasks to drain
4. Scale Fargate tasks to zero once queue is empty
5. Investigate issues in CloudWatch Logs and DLQ messages

**Rollback Time:** <5 minutes (feature flag update + cache TTL)

## Pattern Library

### Lambda Handler Pattern

**Reference:** `backend/api/properties/search.js`

All new Lambda handlers MUST follow this structure:

```javascript
const { createLogger } = require('../lib/logger');

module.exports.handler = async (event, context) => {
    const logger = createLogger(context.requestId);
    
    try {
        // 1. Parse and validate input
        const requestBody = JSON.parse(event.body);
        if (!requestBody.query) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Missing required field: query' })
            };
        }
        
        // 2. Execute business logic
        const result = await processRequest(requestBody, logger);
        
        // 3. Return structured response
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };
        
    } catch (error) {
        logger.error('Handler error', {
            error: error.message,
            stack: error.stack,
            requestId: context.requestId
        });
        
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
```

**For SQS Enqueue Handlers:**
- Return 202 Accepted (not 200 OK)
- Include `task_id` and `status_url` in response body
- Log correlation ID that spans Lambda → SQS → Fargate
- Write task record to DSQL before SQS enqueue (transaction or compensating logic)

### SQL Query Pattern

**Reference:** `backend/database/queries/property-search.sql`

All SQL queries MUST:
- Use named parameters (`:parameter_name`) never string concatenation
- Be stored as `.sql` files in `backend/database/queries/`
- Include explicit column lists (avoid `SELECT *`)
- Use consistent naming: snake_case for columns, kebab-case for file names

Example for task insertion:
```sql
-- backend/database/queries/task-insert.sql
INSERT INTO tasks (
    task_id,
    intent_id,
    user_id,
    status,
    correlation_id,
    created_at,
    updated_at
) VALUES (
    :task_id,
    :intent_id,
    :user_id,
    'pending',
    :correlation_id,
    NOW(),
    NOW()
)
RETURNING task_id, status, created_at;
```

### Fargate Worker Pattern

**New Pattern (to be established):**

All Fargate worker entrypoints MUST follow this structure:

```javascript
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { createLogger } = require('./lib/logger');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const queueUrl = process.env.SQS_QUEUE_URL;
const logger = createLogger();

async function pollAndProcess() {
    while (true) {
        try {
            // Long polling (20s wait)
            const command = new ReceiveMessageCommand({
                QueueUrl: queueUrl,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 20,
                MessageAttributeNames: ['All']
            });
            
            const response = await sqsClient.send(command);
            
            if (!response.Messages || response.Messages.length === 0) {
                continue; // No messages, poll again
            }
            
            const message = response.Messages[0];
            await processMessage(message);
            
            // Delete only after successful processing
            await sqsClient.send(new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: message.ReceiptHandle
            }));
            
        } catch (error) {
            logger.error('Polling error', { error: error.message });
            await sleep(5000); // Back off on error
        }
    }
}

async function processMessage(message) {
    const { task_id, intent_id, user_id } = JSON.parse(message.Body);
    const correlationId = message.MessageAttributes.correlationId.StringValue;
    
    logger.info('Processing task', { task_id, correlationId });
    
    try {
        // 1. Update status to 'processing'
        await updateTaskStatus(task_id, 'processing');
        
        // 2. Invoke LLM API
        const artifact = await generateArtifact(intent_id);
        
        // 3. Upload to S3
        const s3Key = await uploadToS3(artifact);
        
        // 4. Update status to 'completed'
        await updateTaskStatus(task_id, 'completed', { s3_key: s3Key });
        
        // 5. Notify via WebSocket
        await notifyWebSocket(user_id, { task_id, status: 'completed', artifact_url: s3Key });
        
        logger.info('Task completed', { task_id, s3Key });
        
    } catch (error) {
        logger.error('Task failed', { task_id, error: error.message, stack: error.stack });
        await updateTaskStatus(task_id, 'failed', { error_message: error.message });
        throw error; // Let SQS retry
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, finishing current task');
    process.exit(0);
});

pollAndProcess();
```

### Naming Conventions

**SQS Queue Names:**
- Format: `prometheus-{workload-type}-{environment}`
- Examples: `prometheus-artifact-generation-prod`, `prometheus-chat-processing-dev`
- DLQ: Append `-dlq` suffix

**S3 Bucket Structure:**
- Bucket: `prometheus-artifacts-{account-id}-{region}`
- Key Pattern: `artifacts/{intent_id}/{orbit_id}/{artifact_id}.{extension}`
- Example: `artifacts/T6-003/1/context-package.md`

**CloudWatch Log Groups:**
- Lambda: `/aws/lambda/prometheus-api-{function-name}`
- Fargate: `/ecs/prometheus-workers/{task-family}`
- Example: `/ecs/prometheus-workers/artifact-generator`

**IAM Role Names:**
- Format: `prometheus-{service}-{role-type}-{environment}`
- Examples:
  - `prometheus-api-lambda-execution-prod`
  - `prometheus-fargate-task-prod`
  - `prometheus-fargate-execution-prod`

**Correlation IDs:**
- Format: UUID v4
- Propagation: HTTP request header → Lambda context → SQS message attribute → Fargate log entry
- Log with every structured log statement

### Environment Variables

**Lambda Functions:**
- `AWS_REGION`: Deployment region (e.g., `us-east-1`)
- `SQS_QUEUE_URL`: Full URL of artifact generation queue
- `DSQL_ENDPOINT`: DSQL cluster endpoint
- `FEATURE_FLAG_PARAMETER`: Parameter Store path for rollback flag
- `LOG_LEVEL`: `INFO` in production, `DEBUG` in development

**Fargate Tasks:**
- `AWS_REGION`: Deployment region
- `SQS_QUEUE_URL`: Queue URL for message polling
- `S3_BUCKET_NAME`: Artifact storage bucket
- `DSQL_ENDPOINT`: DSQL cluster endpoint
- `WEBSOCKET_API_ENDPOINT`: WebSocket API Gateway endpoint
- `LLM_API_SECRET_ARN`: Secrets Manager ARN for LLM credentials
- `LOG_LEVEL`: `INFO` (DEBUG causes excessive log volume)

## Prior Orbit References

### T6 Trajectory Context

This is **Orbit 1** of the Container Infrastructure (Fargate) trajectory (T6). No prior orbits exist in this trajectory.

### Cross-Trajectory References

**If Relevant Prior Work Exists:**
- Check for existing VPC configuration, subnet layout, NAT Gateway setup
- Check for existing CloudWatch Logs patterns, structured logging conventions
- Check for existing IAM role naming patterns and permission boundaries
- Check for existing Secrets Manager usage for API credentials
- Check for existing DSQL connection pooling implementation

**Expected Patterns to Inherit:**
- Structured logging format (if established in existing Lambda functions)
- Error handling and retry strategies
- CloudWatch metrics and alarm conventions
- X-Ray tracing setup and subsegment naming
- Authentication and authorization flow (JWT validation, user context)

### Known Issues to Address

**From Intent Dependencies Section:**
1. **DSQL Connection Pooling:** Current Lambda implementation may use connections that don't work well in long-lived Fargate processes. Need to verify connection recycling strategy.

2. **LLM Credentials Storage:** Unclear if credentials are in Secrets Manager, Parameter Store, or environment variables. This orbit must standardize on Secrets Manager for Fargate injection.

3. **WebSocket Connection Management:** Existing WebSocket API may only handle client-initiated messages. Need to verify support for server-initiated notifications and connection table structure.

### Anti-Patterns to Avoid

**Do NOT:**
- Store large payloads in SQS message bodies (limit: 256 KB) — use message attributes and reference data in DSQL/S3
- Hardcode credentials in Lambda environment variables — use Secrets Manager with automatic rotation
- Skip DLQ configuration — poison messages will block the queue indefinitely
- Use synchronous HTTP calls between Lambda and Fargate — they are decoupled by design
- Buffer entire LLM response in memory — stream to S3 for large outputs (>500 MB)
- Ignore visibility timeout tuning — tasks that exceed timeout will be retried unnecessarily

## Risk Assessment

### Critical Risks

**Risk: Message Loss Between Lambda and SQS**
- **Scenario:** Lambda writes task record to DSQL, crashes before SQS.sendMessage() completes, task stuck in 'pending' forever
- **Impact:** User receives 202 Accepted but task never processes, no notification, silent failure
- **Likelihood:** Low (Lambda rarely crashes post-DSQL write) but high impact
- **Mitigation:**
  - Use DSQL transaction: write task record and enqueue SQS in atomic operation if DSQL supports distributed transactions
  - If not atomic, implement compensating transaction: background Lambda job queries tasks in 'pending' state older than 5 minutes, requeues to SQS
  - CloudWatch alarm on task age: alert if any task in 'pending' >10 minutes
- **Detection:** CloudWatch metric filters on DSQL, alarm on stale pending tasks
- **Rollback:** Feature flag to bypass SQS enqueue, process synchronously in Lambda

**Risk: Fargate Task OOM During LLM Processing**
- **Scenario:** LLM returns 200k token response, Node.js buffers entire response in memory, process exceeds 8 GB limit, ECS kills container with SIGKILL
- **Impact:** Task marked as failed, SQS message becomes visible again, infinite retry loop until DLQ threshold
- **Likelihood:** Medium (depends on prompt design and model behavior)
- **Mitigation:**
  - Configure ECS memory reservation: 7 GB soft limit for application, 1 GB buffer for OS/runtime
  - Implement streaming: write LLM response chunks to S3 as they arrive, avoid buffering
  - Monitor with CloudWatch Container Insights: alert on memory utilization >85%
  - Set hard memory limit in task definition to trigger graceful OOM instead of SIGKILL
- **Detection:** CloudWatch Logs contain OOM error, ECS task state = STOPPED with exit code 137
- **Recovery:** DLQ captures message after 3 attempts, manual review determines if task needs 16 GB configuration

**Risk: WebSocket Connection Closed Before Notification**
- **Scenario:** User closes browser tab during 20-minute artifact generation, Fargate completes task, WebSocket.send() fails with 410 Gone
- **Impact:** User never learns task completed unless they manually refresh or poll status API
- **Likelihood:** High (users don't keep tabs open for long operations)
- **Mitigation:**
  - WebSocket is best-effort optimization, not guaranteed delivery
  - DSQL task status is source of truth
  - Frontend implements polling on page load: fetch user's pending/completed tasks, display missed notifications
  - Fargate logs WebSocket delivery failures but marks task as completed regardless
- **Detection:** CloudWatch Logs show 410 responses, custom metric tracks WebSocket delivery success rate
- **User Experience:** Polling fills the gap, no data loss, slight UX degradation

**Risk: SQS Visibility Timeout Expires, Duplicate Processing**
- **Scenario:** Fargate task takes 70 minutes due to slow LLM API, visibility timeout is 60 minutes, message becomes visible again, second worker starts processing
- **Impact:** Two workers generate same artifact, both upload to S3, second write overwrites first, wasted compute and potential race condition
- **Likelihood:** Medium if visibility timeout not tuned properly
- **Mitigation:**
  - Set visibility timeout to 90 minutes (longer than any expected processing time)
  - Implement idempotency: Fargate worker checks DSQL task status before processing, skips if not 'pending'
  - Use optimistic locking: `UPDATE tasks SET status='processing' WHERE task_id=:id AND status='pending'` — fails if already processing
  - Monitor 95th percentile task duration, adjust visibility timeout if tasks regularly exceed 60 minutes
- **Detection:** CloudWatch Logs show duplicate task_id processing, custom metric tracks duplicate attempts
- **Recovery:** Last write wins in DSQL, S3 versioning preserves both artifacts if needed for debugging

### High-Severity Risks

**Risk: Fargate Cold Start Latency Exceeds 60s**
- **Scenario:** All tasks scaled to zero overnight (weekend, low traffic), first Monday morning request waits 90 seconds for container image pull (500 MB) + extraction + process start
- **Impact:** User experiences degraded UX, API responds quickly but task sits in queue for 90s before processing starts, perceived latency spike
- **Likelihood:** Medium (depends on auto-scaling policy and traffic patterns)
- **Mitigation:**
  - Maintain min task count of 2 (always warm, cost vs. latency tradeoff)
  - Use smaller base image: `node:20-alpine` (120 MB) instead of `node:20` (350 MB)
  - Pre-warm tasks during scale-up: synthetic "ping" requests keep containers warm
  - Cache container image on ECS-optimized AMI if using EC2 launch type (not applicable for Fargate)
- **Detection:** CloudWatch metrics show task launch time >60s, X-Ray traces show gap between SQS message visible and worker start
- **User Communication:** API response includes `estimated_start_time` field based on current scale state

**Risk: DSQL Connection Pool Exhaustion**
- **Scenario:** 50 concurrent Fargate tasks, each opens 10 DSQL connections, total 500 connections exceeds DSQL cluster limit (default 300)
- **Impact:** New tasks fail to acquire connection, log error "connection pool exhausted", retry SQS messages, system unstable
- **Likelihood:** Medium (depends on task concurrency and connection pooling config)
- **Mitigation:**
  - Configure connection pool per task: max 2 connections, connection timeout 5s, idle timeout 30s
  - Reuse single connection across sequential task processing (poll → process → poll loop)
  - Use DSQL proxy or RDS Proxy if available for connection multiplexing
  - Request DSQL connection limit increase if sustained concurrency >50 tasks
- **Detection:** CloudWatch Logs show "ECONNREFUSED" or "connection timeout" errors, custom metric tracks connection pool size
- **Recovery:** Auto-scaling backs off if tasks repeatedly crash, manual intervention to increase DSQL limit or reduce max task count

**Risk: S3 PutObject Rate Limiting**
- **Scenario:** 100 tasks complete simultaneously, all attempt S3.putObject(), S3 returns 503 SlowDown
- **Impact:** Task retries S3 upload with exponential backoff, adds latency (30-60s), no permanent failure but user waits longer
- **Likelihood:** Low (S3 prefix partitioning distributes load, default rate limit 3500 PUT/s per prefix)
- **Mitigation:**
  - Use S3 Transfer Acceleration for uploads >100 MB
  - Implement exponential backoff with jitter on 503 errors (AWS SDK default behavior)
  - Partition S3 keys by date or hash prefix: `artifacts/2026/03/15/{intent_id}/...`
  - Request S3 rate limit increase if sustained write rate >3000 PUT/s
- **Detection:** CloudWatch Logs show 503 responses, S3 server access logs capture throttling events
- **Recovery:** Retry logic in worker code, eventual success within 3 attempts

### Medium-Severity Risks

**Risk: CloudWatch Logs Ingestion Cost Spike**
- **Scenario:** Fargate tasks emit verbose debug logs, 50 tasks × 2 MB logs/minute = 100 MB/minute = 4.3 TB/month ingestion
- **Impact:** AWS bill increases by $2,100/month (CloudWatch Logs ingestion = $0.50/GB), no functional impact but budget overage
- **Likelihood:** High if log level not controlled
- **Mitigation:**
  - Set `LOG_LEVEL=INFO` in production (avoid DEBUG)
  - Implement sampling for high-volume trace logs: log 1% of LLM API responses
  - Set CloudWatch Logs retention to 7 days for worker logs (vs. 30 days for API logs)
  - Use structured logging: JSON format enables efficient querying and filtering
- **Detection:** AWS Cost Explorer shows CloudWatch Logs cost anomaly, budget alarm triggers
- **Recovery:** Update task definition to reduce log level, redeploy without code change

**Risk: Feature Flag Rollback Requires Manual Intervention**
- **Scenario:** Parameter Store read fails due to IAM permissions, Lambda falls back to synchronous execution, but some tasks already enqueued to SQS, inconsistent state
- **Impact:** Some users experience new async flow, others get old sync flow, confused user experience
- **Likelihood:** Low (IAM policies tested during deployment) but moderate impact
- **Mitigation:**
  - Test Parameter Store access during Lambda cold start, fail fast if unavailable
  - Implement fallback: if Parameter Store unavailable, read from environment variable (secondary source)
  - Drain SQS queue before rollback: wait for queue depth = 0, then toggle flag
- **Detection:** CloudWatch Logs show Parameter Store access errors, custom metric tracks feature flag read failures
- **Recovery:** Fix IAM policy, restart Lambda functions to clear cache

**Risk: X-Ray Trace Sampling Overhead**
- **Scenario:** X-Ray samples 100% of traces, adds 20-50ms overhead per request, impacts p99 latency SLO (<200ms)
- **Impact:** API latency increases, SLO breach, user-visible slowdown
- **Likelihood:** Medium (depends on X-Ray sampling configuration)
- **Mitigation:**
  - Configure X-Ray sampling: 5% of requests for steady-state tracing, 100% for first 1 request/second
  - Disable X-Ray in non-production environments if not needed
  - Use X-Ray SDK's low-level API for custom subsegments, avoid auto-instrumentation overhead
- **Detection:** X-Ray service map shows latency attribution, CloudWatch metrics show increased API response time
- **Recovery:** Reduce sampling rate via X-Ray console, takes effect immediately (no redeploy)

### Low-Severity Risks

**Risk: DLQ Messages Accumulate Without Investigation**
- **Scenario:** 10 messages per day fail after 3 retries, move to DLQ, alarm fires but team ignores, DLQ grows to 300 messages over month
- **Impact:** User requests never completed, silent failures, no data corruption but poor UX
- **Likelihood:** Medium (depends on operational discipline)
- **Mitigation:**
  - CloudWatch alarm on DLQ depth >0, route to PagerDuty or Slack
  - Weekly runbook: review DLQ messages, identify common failure patterns, replay or cancel
  - Dashboard shows DLQ message age, oldest message highlighted
- **Detection:** CloudWatch alarm, custom dashboard widget
- **Recovery:** Manually inspect DLQ messages, fix root cause (e.g., LLM API key expired), replay messages or mark as cancelled

**Risk: Fargate Task Health Check False Positives**
- **Scenario:** Task is processing 60-minute LLM call, health check expects response within 5s, ECS marks task unhealthy and kills it
- **Impact:** Premature task termination, SQS message retries, wasted compute
- **Likelihood:** Low if health check designed properly
- **Mitigation:**
  - Health check only verifies process is running, not actively processing: `GET /health` returns 200 OK if event loop responsive
  - Set health check interval to 30s, unhealthy threshold to 3 consecutive failures (90s grace period)
  - Health check endpoint is lightweight: no database queries, no blocking I/O
- **Detection:** CloudWatch Logs show health check failures, ECS task state transitions to STOPPED
- **Recovery:** Adjust health check configuration, redeploy task definition

### Security Risks

**Risk: IAM Role Over-Provisioning**
- **Scenario:** Lambda execution role granted `s3:*` instead of `sqs:SendMessage`, allows Lambda to write directly to S3 or read sensitive artifacts
- **Impact:** Violates least-privilege principle, increases blast radius if Lambda code compromised
- **Likelihood:** Medium (common IAM anti-pattern)
- **Mitigation:**
  - Audit IAM policies during code review: Lambda gets only `sqs:SendMessage` on artifact queue ARN
  - Use IAM Access Analyzer to detect overly permissive policies
  - Implement SCPs (Service Control Policies) to deny wildcard permissions on production accounts
- **Detection:** IAM Access Analyzer findings, automated policy validation in CI/CD
- **Prevention:** Infrastructure-as-code templates enforce least-privilege by default

**Risk: Secrets Logged to CloudWatch**
- **Scenario:** Developer adds debug log statement that prints Secrets Manager response, LLM API key appears in CloudWatch Logs
- **Impact:** Credential leak, potential unauthorized LLM API usage if attacker gains CloudWatch access
- **Likelihood:** Low (requires developer error and CloudWatch access breach)
- **Mitigation:**
  - Code review checklist: no logging of Secrets Manager responses
  - Scrub secrets from logs: logger utility detects common secret patterns and redacts
  - Use structured logging: log only safe fields, avoid string concatenation of objects
- **Detection:** Manual code review, automated secret scanning in CI/CD (e.g., TruffleHog)
- **Recovery:** Rotate compromised credentials immediately, audit CloudWatch Logs access

**Risk: S3 Bucket Public Access Misconfiguration**
- **Scenario:** S3 bucket policy accidentally grants public read access, user artifacts exposed to internet
- **Impact:** Data breach, compliance violation, reputational damage
- **Likelihood:** Very low (requires explicit policy change) but catastrophic impact
- **Mitigation:**
  - Enable S3 Block Public Access at account level
  - Bucket policy denies public read: `"Effect": "Deny", "Principal": "*", "Action": "s3:GetObject"`
  - S3 bucket has SSE-S3 encryption enabled (or SSE-KMS for higher security)
  - Audit bucket policies in CI/CD pipeline before deployment
- **Detection:** AWS Config rule: s3-bucket-public-read-prohibited, alert on non-compliance
- **Prevention:** Terraform/CloudFormation enforces private-only bucket policies