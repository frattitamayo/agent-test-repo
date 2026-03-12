# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Codebase References

### Primary Implementation Surfaces

**API Layer:**
- `backend/api/properties/search.js` — Example HTTP handler pattern; new LLM endpoints will follow similar structure
- `backend/api/artifacts/generate.js` — **TO CREATE** — Lambda handler that accepts artifact generation requests, validates input, enqueues to SQS, returns 202 Accepted
- `backend/api/chat/submit.js` — **TO CREATE** — Lambda handler for AI chat session messages with SQS enqueue pattern

**Infrastructure as Code:**
- `infrastructure/fargate/task-definitions/` — **TO CREATE** — ECS task definitions for LLM worker containers
- `infrastructure/sqs/queues.tf` — **TO CREATE** — Terraform/CloudFormation for artifact-generation queue and DLQ
- `infrastructure/iam/fargate-execution-role.tf` — **TO CREATE** — IAM policies for Fargate task execution (SQS read, S3 write, DSQL access)
- `infrastructure/cloudwatch/alarms.tf` — **TO CREATE** — DLQ depth, Fargate OOM, task failure rate alarms

**Fargate Worker Services:**
- `backend/workers/artifact-generator/` — **TO CREATE** — Container entrypoint for consuming SQS messages, invoking LLM APIs, writing results to S3/DSQL, sending WebSocket notifications
- `backend/workers/chat-processor/` — **TO CREATE** — Chat message processing worker with streaming response handling

**Database Layer:**
- `backend/database/queries/property-search.sql` — Reference for SQL query pattern; new artifact metadata queries follow same conventions
- `backend/database/schema/artifacts.sql` — **TO CREATE** — Table definitions for artifact records, task status, completion timestamps
- `backend/database/connection-pool.js` — **TO VERIFY** — Existing DSQL connection logic; ensure compatibility with long-lived Fargate processes

**Shared Libraries:**
- `backend/lib/sqs-client.js` — **TO CREATE** — SQS enqueue/dequeue abstraction with retry logic and correlation ID propagation
- `backend/lib/websocket-notifier.js` — **TO CREATE** — WebSocket API Gateway client for server-initiated messages
- `backend/lib/s3-artifact-store.js` — **TO CREATE** — S3 upload with SSE, multipart for large artifacts, presigned URL generation

### Secondary Dependencies

**Observability:**
- `backend/lib/logger.js` — Structured logging utility; must emit correlation IDs and trace context
- `backend/lib/xray-middleware.js` — X-Ray instrumentation for Lambda and Fargate SDK calls

**Configuration:**
- `backend/config/env.js` — Environment variable loader; Fargate tasks will share config schema with Lambda
- `backend/config/secrets.js` — Secrets Manager client for LLM API keys (Bedrock/OpenAI credentials)

**Testing:**
- `backend/tests/integration/sqs-flow.test.js` — **TO CREATE** — End-to-end test: Lambda → SQS → mock Fargate → WebSocket delivery
- `backend/tests/unit/artifact-generator.test.js` — **TO CREATE** — Unit tests for worker message processing logic

## Architecture Context

### System Overview

Prometheus V1 currently executes all LLM operations synchronously within Lambda functions behind API Gateway. This architecture hits Lambda's 15-minute execution limit for complex artifact generation (multi-file codebase analysis, large context prompts, iterative refinement loops). The migration introduces an **asynchronous execution plane** while preserving the synchronous API contract.

### Proposed Data Flow

```
[User Request] 
    ↓ HTTPS
[API Gateway] 
    ↓
[Lambda Handler]
    ├─ Validate request
    ├─ Write task record to DSQL (status: pending)
    ├─ Enqueue message to SQS (artifact-generation-queue)
    └─ Return 202 Accepted {task_id, status_url}
    
[SQS Queue]
    ↓ Poll
[Fargate Task] (ECS on Fargate)
    ├─ Dequeue message
    ├─ Update DSQL (status: processing)
    ├─ Invoke LLM API (Bedrock Claude / OpenAI)
    ├─ Write artifact to S3 (markdown/json/yaml)
    ├─ Update DSQL (status: completed, s3_key)
    ├─ Send WebSocket notification
    └─ Delete SQS message
    
[WebSocket API Gateway]
    ↓
[Frontend Client]
    └─ Display "Artifact Ready" + download link
```

### Key Architectural Patterns

**Request/Response Decoupling:**
- Lambda layer handles HTTP semantics (auth, validation, rate limiting) and returns immediately
- Fargate layer handles compute-intensive LLM processing with generous timeout (60 minutes per task)
- SQS provides durable message queue with DLQ for poison messages

**State Management:**
- DSQL is source of truth for task status (pending/processing/completed/failed)
- S3 is source of truth for artifact content (files, logs, metadata JSON)
- SQS message body contains only task_id and lightweight context (user_id, intent_id) — no large payloads

**Notification Contract:**
- WebSocket messages follow schema: `{event: "task.completed", task_id, artifact_url, metadata}`
- At-least-once delivery: if WebSocket send fails, task remains in DSQL as completed, user can poll status API
- No strong ordering guarantee: task B may complete before task A even if submitted earlier

### Infrastructure Constraints

**Fargate Configuration:**
- Task definition: 4 vCPU, 8GB memory (Claude 3.5 Sonnet with 200k token context requires ~6GB)
- Networking: Deploy in private subnets with NAT Gateway for Bedrock egress, VPC endpoints for S3/DSQL
- Auto-scaling: Target 70% CPU utilization, min 2 tasks, max 50 tasks per region
- Container image: Based on `public.ecr.aws/docker/library/node:20-alpine`, includes Node.js SDK for AWS and LLM clients

**SQS Configuration:**
- Visibility timeout: 3600 seconds (1 hour) — longer than expected LLM completion time
- Message retention: 14 days (maximum)
- DLQ after 3 receive attempts, alarm on DLQ depth >0
- Encryption at rest: AWS managed KMS key

**Security Boundaries:**
- Lambda execution role: `sqs:SendMessage` on artifact queue only, no S3 or Fargate permissions
- Fargate execution role: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `s3:PutObject` to artifact bucket, `dsql:ExecuteStatement` on task table, `execute-api:ManageConnections` for WebSocket
- No public internet access from Fargate tasks — all AWS service calls via VPC endpoints or PrivateLink

### Rollback Strategy

Feature flag in Lambda: `ENABLE_FARGATE_MIGRATION` (default: false). When true, enqueue to SQS. When false, execute LLM call synchronously in Lambda (existing behavior). Flag can be toggled via Parameter Store without code deploy.

If rollback is required:
1. Set feature flag to false
2. Drain SQS queue (wait for in-flight tasks to complete)
3. Scale Fargate tasks to zero
4. All new requests execute in Lambda

## Pattern Library

### Lambda Handler Pattern (Existing)

Reference: `backend/api/properties/search.js`

```javascript
// All Lambda handlers follow this structure:
module.exports.handler = async (event, context) => {
    const logger = createLogger(context.requestId);
    
    try {
        // 1. Parse input
        const params = JSON.parse(event.body);
        
        // 2. Validate
        if (!params.query) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing query' }) };
        }
        
        // 3. Execute business logic (database query, external API call)
        const results = await executeQuery(params);
        
        // 4. Return structured response
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(results)
        };
    } catch (error) {
        logger.error('Handler error', { error: error.message, stack: error.stack });
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
    }
};
```

**New SQS Enqueue Handlers Must:**
- Return 202 Accepted with `task_id` and `status_url` in response body
- Write task record to DSQL before SQS enqueue (atomic transaction)
- Log correlation ID that spans Lambda → SQS → Fargate
- Include X-Ray trace context in SQS message attributes

### Database Query Pattern (Existing)

Reference: `backend/database/queries/property-search.sql`

```sql
-- All queries are stored as .sql files, loaded at runtime
-- Parameters are passed via named placeholders
SELECT id, address, price, status
FROM properties
WHERE city = :city
    AND price BETWEEN :min_price AND :max_price
ORDER BY price ASC
LIMIT :limit;
```

**New Artifact Metadata Queries Must:**
- Use parameterized queries (never string concatenation)
- Include `created_at`, `updated_at`, `correlation_id` in all write operations
- Use optimistic locking for status transitions (e.g., `WHERE status = 'pending'` on update to 'processing')

### Container Entrypoint Pattern (To Be Established)

**New Fargate Workers Must:**
- Poll SQS with long polling (WaitTimeSeconds=20)
- Process one message at a time (single-threaded to avoid memory contention)
- Update task status in DSQL at: start, 25%, 50%, 75%, completion (progress tracking)
- Write structured logs to stdout (captured by CloudWatch Logs)
- Implement graceful shutdown: finish current task on SIGTERM, reject new messages
- Include health check endpoint on port 8080 for ECS task health

Example:
```javascript
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const logger = require('./lib/logger');

async function processMessage(message) {
    const { task_id, intent_id, user_id } = JSON.parse(message.Body);
    
    try {
        await updateTaskStatus(task_id, 'processing');
        const artifact = await generateArtifact(intent_id);
        await saveToS3(artifact);
        await updateTaskStatus(task_id, 'completed');
        await notifyWebSocket(user_id, task_id);
        
        // Only delete message after all steps succeed
        await deleteMessage(message.ReceiptHandle);
    } catch (error) {
        logger.error('Task failed', { task_id, error: error.message });
        // Do NOT delete message — let it retry via visibility timeout
        throw error;
    }
}
```

### WebSocket Notification Pattern (To Be Established)

```javascript
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

async function sendWebSocketMessage(connectionId, payload) {
    const client = new ApiGatewayManagementApiClient({
        endpoint: process.env.WEBSOCKET_ENDPOINT
    });
    
    const command = new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify(payload)
    });
    
    try {
        await client.send(command);
    } catch (error) {
        if (error.statusCode === 410) {
            // Connection is stale, remove from connection table
            await removeConnection(connectionId);
        } else {
            throw error;
        }
    }
}
```

### Naming Conventions

**SQS Queue Names:**
- Primary: `prometheus-artifact-generation-{environment}` (e.g., `prometheus-artifact-generation-prod`)
- DLQ: `prometheus-artifact-generation-dlq-{environment}`

**S3 Bucket Structure:**
- Bucket: `prometheus-artifacts-{account-id}-{region}`
- Key pattern: `artifacts/{intent_id}/{orbit_id}/{artifact_id}.{ext}`

**CloudWatch Log Groups:**
- Lambda: `/aws/lambda/prometheus-api-{function-name}`
- Fargate: `/ecs/prometheus-workers/{task-family}`

**IAM Role Naming:**
- Lambda execution role: `prometheus-api-lambda-execution-{environment}`
- Fargate task role: `prometheus-fargate-task-{environment}`
- Fargate execution role: `prometheus-fargate-execution-{environment}` (for ECR pull, Secrets Manager access)

## Prior Orbit References

**T6 Trajectory Context:**
This is the **first orbit** in the Container Infrastructure (Fargate) trajectory. No prior orbits have established Fargate patterns, SQS integrations, or asynchronous execution flows within Prometheus V1.

**Relevant Historical Context (Inferred):**
- Prometheus V1 currently runs entirely on Lambda + API Gateway + DSQL
- LLM operations (artifact generation, AI chat) are synchronous and timeout at 15 minutes
- WebSocket API Gateway exists for real-time updates but is only used for client-initiated messages (chat input), not server-initiated notifications
- S3 bucket for artifact storage likely exists but may not have encryption, lifecycle policies, or access logging configured

**Patterns to Inherit:**
- Structured logging with correlation IDs (if established in existing Lambda functions)
- DSQL connection pooling strategy (if any)
- Secrets Manager usage for API keys (if already in use for Bedrock/OpenAI credentials)
- CloudWatch dashboards and alarm conventions (if any)

**Anti-Patterns to Avoid:**
- Synchronous LLM calls from Lambda (the problem this orbit solves)
- Storing large payloads in SQS message bodies (AWS limit: 256 KB)
- Hardcoding credentials in environment variables (use Secrets Manager references)
- Missing DLQ configuration (poison messages will block queue indefinitely)

## Risk Assessment

### High-Severity Risks

**Risk: Message Loss Between Lambda and SQS**
- **Scenario:** Lambda writes task record to DSQL, crashes before SQS enqueue, task status stuck in 'pending' forever
- **Mitigation:** Use DSQL transaction: write task record and enqueue SQS message atomically, or implement compensating transaction (background job that requeues tasks in 'pending' state older than 5 minutes)
- **Fallback:** DLQ alarm triggers manual investigation, task record includes creation timestamp for forensics

**Risk: Fargate Task OOM Kills During LLM Processing**
- **Scenario:** LLM response streams 200k tokens, Node.js process exceeds 8GB memory, ECS kills container, SQS message becomes visible again, infinite retry loop
- **Mitigation:** Configure ECS task memory reservation with 1GB headroom (7GB soft limit for app, 1GB buffer), implement memory monitoring with CloudWatch Container Insights, stream LLM responses to S3 instead of buffering in memory
- **Fallback:** After 3 retries, message moves to DLQ, alarm triggers, manual review determines if task needs larger instance type

**Risk: WebSocket Connection Closed Before Notification**
- **Scenario:** User closes browser tab, Fargate task completes artifact, WebSocket send fails with 410 Gone, user never learns task completed
- **Mitigation:** Task status in DSQL is source of truth, frontend polls `/api/tasks/{task_id}` on reconnect to catch missed notifications, WebSocket is optimization not requirement
- **Fallback:** User receives in-app notification on next page load when polling detects completed task

**Risk: SQS Visibility Timeout Expires, Task Processed Twice**
- **Scenario:** Fargate task takes 70 minutes (LLM API slow), visibility timeout is 60 minutes, message becomes visible again, second Fargate task starts processing same artifact
- **Mitigation:** Set visibility timeout to 90 minutes (longer than any expected LLM completion), implement idempotency: before processing, check DSQL task status, skip if not 'pending'
- **Fallback:** Duplicate processing results in two S3 objects, DSQL update is last-write-wins, no data corruption but wasted compute

### Medium-Severity Risks

**Risk: Fargate Cold Start Latency Exceeds 60s**
- **Scenario:** All tasks scaled to zero overnight, first morning request waits 90 seconds for container to pull image, extract layers, start process
- **Impact:** User experiences degraded UX, API responds 202 Accepted immediately but task sits in queue for 90s before processing starts
- **Mitigation:** Maintain 2 min tasks 24/7 (cost vs. latency tradeoff), use smaller base image (alpine vs. ubuntu), pre-warm tasks with synthetic requests during scale-up
- **Fallback:** Document expected cold start latency in API response, add `estimated_start_time` field

**Risk: DSQL Connection Pool Exhaustion**
- **Scenario:** 50 concurrent Fargate tasks, each opens 10 DSQL connections, connection pool limit is 100, new tasks fail to acquire connection
- **Impact:** Tasks log errors, retry SQS messages, some succeed eventually but system is unstable
- **Mitigation:** Configure connection pool per task: max 2 connections, connection timeout 5s, share single connection across sequential tasks, use DSQL proxy or RDS Proxy if available
- **Fallback:** Fargate auto-scaling backs off if tasks repeatedly crash, manual intervention to increase DSQL connection limit or reduce Fargate max task count

**Risk: S3 PutObject Rate Limiting**
- **Scenario:** 100 tasks complete simultaneously, all attempt S3 upload, S3 returns 503 SlowDown
- **Impact:** Task retries S3 write, eventually succeeds but adds latency, no permanent failure
- **Mitigation:** Use S3 Transfer Acceleration (if large files), implement exponential backoff with jitter on 503 errors, request S3 rate limit increase if sustained throughput >3500 PUT/s
- **Fallback:** Task retries up to 3 times, if all fail, marks task as 'failed' in DSQL, human investigates DLQ message

### Low-Severity Risks

**Risk: CloudWatch Logs Ingestion Cost Spike**
- **Scenario:** Fargate tasks emit verbose debug logs, 50 concurrent tasks × 1MB logs/minute = 50MB/min = 2.1TB/month ingestion
- **Impact:** AWS bill increases, no functional impact
- **Mitigation:** Use log level filtering (INFO in prod, DEBUG in dev), implement sampling for high-volume trace logs, set CloudWatch Logs retention to 7 days for worker logs
- **Fallback:** Budget alarm triggers, manual review reduces log verbosity

**Risk: Feature Flag Rollback Requires Code Deploy**
- **Scenario:** Parameter Store update fails due to IAM permissions, team cannot toggle feature flag without redeploying Lambda code
- **Impact:** Rollback takes 15 minutes instead of 30 seconds
- **Mitigation:** Test Parameter Store write permissions during infrastructure setup, implement fallback to environment variable if Parameter Store unavailable
- **Fallback:** Emergency deploy reverts Lambda code to synchronous LLM execution

### Security Considerations

**IAM Least Privilege:**
- Lambda role must NOT have `s3:*` or `dsql:*` wildcard permissions — only `sqs:SendMessage` to artifact queue
- Fargate role must NOT have `sqs:SendMessage` — only `ReceiveMessage` and `DeleteMessage` to prevent accidental message loops

**Encryption in Transit:**
- All SQS → Fargate communication is encrypted via HTTPS (AWS SDK default)
- Fargate → S3 uses VPC endpoint, no public internet exposure
- Fargate → DSQL uses TLS 1.2+ (DSQL requirement)

**Secrets Management:**
- LLM API keys (Bedrock/OpenAI) stored in Secrets Manager, injected into Fargate container as environment variables at task start
- Secret rotation: implement automatic rotation every 90 days, Fargate tasks fetch latest secret on startup

**Audit Logging:**
- All SQS message enqueues logged with user_id, intent_id, task_id, timestamp
- All task status transitions logged with correlation_id
- CloudTrail captures IAM role assumptions, S3 object writes, Secrets Manager access