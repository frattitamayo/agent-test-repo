# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Package Type:** intent-specific  
**Intent Reference:** T6-003  
**Generated:** 2026-03-12  
**Orbit:** 1

## Codebase References

### Primary Files (will be created or modified)

**Lambda HTTP Handlers (SQS integration):**
- `backend/api/artifacts/generate.js` — artifact generation endpoint, add SQS message publishing
- `backend/api/chat/process.js` — AI chat endpoint, add SQS message publishing
- `backend/services/queue-publisher.js` — shared SQS publishing logic with retry and correlation ID generation

**Fargate Worker Implementation:**
- `backend/workers/llm-processor/` — new directory for Fargate task application
  - `index.js` — task entry point, SQS message polling loop
  - `handlers/artifact-handler.js` — artifact generation orchestration
  - `handlers/chat-handler.js` — chat message processing orchestration
  - `services/bedrock.js` — Bedrock SDK client with exponential backoff
  - `services/storage.js` — S3 upload with atomic write verification
  - `services/database.js` — Aurora DSQL connection and transaction management
  - `services/websocket.js` — WebSocket notification dispatch via API Gateway
  - `utils/correlation.js` — correlation ID propagation and structured logging
  - `Dockerfile` — container image definition (Alpine-based Node.js)
  - `package.json` — dependencies and scripts

**Infrastructure as Code:**
- `infrastructure/fargate-llm/` — new directory for Fargate resources
  - `task-definition.json` — ECS task definition (CPU, memory, environment variables)
  - `service-definition.json` — ECS service configuration (task count, health checks)
  - `iam-lambda-role.json` — Lambda execution role with SQS send permissions
  - `iam-fargate-role.json` — Fargate task role with Bedrock, S3, DSQL, WebSocket permissions
  - `sqs-queue.json` — Standard queue configuration with DLQ
  - `cloudwatch-dashboard.json` — operational metrics dashboard

**Database Schema Migrations:**
- `backend/database/migrations/` — new directory for schema changes
  - `add-async-status-fields.sql` — add `status`, `fargate_task_arn`, `processing_started_at` columns to artifacts and chat_messages tables

### Secondary Files (dependencies and interfaces)

**Existing Lambda Handler Pattern:**
- `backend/api/properties/search.js` — reference for Lambda HTTP response structure and error handling

**Database Query Pattern:**
- `backend/database/queries/property-search.sql` — reference for parameterized SQL query structure
- `backend/database/queries/artifact-update-status.sql` — new query for atomic status updates
- `backend/database/queries/artifact-mark-completed.sql` — new query for completion with S3 key validation

**Configuration and Utilities:**
- `backend/config/aws.js` — AWS SDK configuration (region, credentials provider)
- `backend/config/environment.js` — environment variable mapping (SQS_QUEUE_URL, S3_BUCKET_NAME, WEBSOCKET_API_ENDPOINT)
- `backend/utils/logger.js` — structured logging with correlation ID support
- `backend/utils/retry.js` — exponential backoff implementation

**Feature Flags:**
- `backend/config/features.js` — feature flag definitions
  - `USE_FARGATE_FOR_LLM` — boolean flag to route long-running requests to Fargate (default: false)
  - `FARGATE_DURATION_THRESHOLD_SECONDS` — threshold for routing decision (default: 20)

### Test Files (to be created)

**Unit Tests:**
- `backend/services/__tests__/queue-publisher.test.js` — SQS publishing logic with correlation ID validation
- `backend/workers/llm-processor/handlers/__tests__/artifact-handler.test.js` — artifact generation orchestration
- `backend/workers/llm-processor/handlers/__tests__/chat-handler.test.js` — chat processing orchestration
- `backend/workers/llm-processor/services/__tests__/storage.test.js` — atomic S3 write pattern validation

**Integration Tests:**
- `backend/__tests__/integration/fargate-e2e.test.js` — end-to-end test: Lambda → SQS → mock Fargate → S3 → DSQL → WebSocket
- `backend/__tests__/integration/lambda-fallback.test.js` — verify Lambda synchronous path unchanged when feature flag disabled

**Load Tests:**
- `backend/__tests__/load/concurrent-requests.test.js` — simulate 100 concurrent long-running requests, measure queue depth and task completion rate

## Architecture Context

### System Overview

Prometheus V1 currently operates as a serverless application where AWS Lambda handles all HTTP requests, including artifact generation and AI chat operations powered by Amazon Bedrock. Lambda functions execute synchronously, constrained by the 29-second API Gateway timeout limit. When LLM operations exceed this window, requests fail with timeout errors, degrading the user experience.

This intent introduces **asynchronous processing** via AWS Fargate for long-running LLM operations while preserving the existing Lambda-based synchronous path as the default and fallback mechanism.

### Target Architecture

**Request Flow Decision Tree:**

```
User Request → API Gateway → Lambda Handler
                                 ↓
                    ┌────────────┴────────────┐
                    ↓                         ↓
          Estimated <20s?              Estimated >20s?
                    ↓                         ↓
          Execute synchronously      Publish to SQS Queue
          (existing path)            Return 202 Accepted
                    ↓                         ↓
          Return 200 OK              Frontend subscribes to WebSocket
                                              ↓
                                     Fargate Task Polls SQS
                                              ↓
                                     Process via Bedrock
                                              ↓
                                   Write S3 → Verify → Update DSQL
                                              ↓
                                     Send WebSocket Notification
                                              ↓
                                     Frontend Receives Completion Event
```

**Infrastructure Layers:**

1. **HTTP Entry Point (Lambda):**
   - Receives API Gateway requests
   - Generates unique `requestId` and `correlationId`
   - Routes to synchronous or asynchronous path based on feature flag and estimated duration
   - For async path: publishes SQS message, returns 202 with tracking URL

2. **Message Queue (SQS Standard):**
   - Decouples Lambda from Fargate execution
   - Standard queue (not FIFO) for higher throughput
   - Visibility timeout: 4 hours (matches Fargate task timeout)
   - Dead-letter queue (DLQ) after 3 failed processing attempts

3. **Compute Layer (Fargate):**
   - ECS tasks run in private subnets (no public IP)
   - Tasks poll SQS queue in long-polling mode (20-second waits)
   - Container lifecycle: start → poll message → process → update state → delete message → poll next
   - Task definition: 2 vCPU, 4 GB memory (tunable based on load testing)

4. **Data Persistence (S3 + Aurora DSQL):**
   - S3 stores artifact content (Markdown documents, JSON structures)
   - Aurora DSQL stores artifact metadata and status tracking
   - Atomic write pattern enforces consistency: S3 write → HEAD verification → database update

5. **User Notification (WebSocket):**
   - API Gateway WebSocket API (if exists) or AWS IoT Core (fallback)
   - Fargate posts completion event to WebSocket connection ID stored in database
   - Frontend subscribes to WebSocket connection on page load, displays real-time progress

**Service Access Patterns:**

Fargate tasks run in private subnets and access AWS services via:
- **VPC Endpoints (preferred):** Bedrock, S3, SQS, DSQL, API Gateway (WebSocket)
- **NAT Gateway (fallback):** If VPC endpoints unavailable in region

**IAM Role Separation:**

| Role | Permissions | Rationale |
|------|-------------|-----------|
| `LambdaExecutionRole` | `sqs:SendMessage`, `logs:CreateLogStream` | Lambda only publishes messages, no data access |
| `FargateTaskRole` | `bedrock:InvokeModel`, `s3:PutObject`, `s3:GetObject`, `dsql:ExecuteStatement`, `execute-api:ManageConnections` | Fargate needs full workflow permissions |
| `FargateExecutionRole` | `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `logs:CreateLogStream` | ECS service needs container image pull permissions |

**State Machine:**

```
artifact.status lifecycle:
  pending → processing → completed
             ↓
            failed (retry exhausted or unrecoverable error)

Fargate task responsibilities:
  1. Update status to "processing" on message receipt
  2. Invoke Bedrock with retry logic (max 3 attempts for throttling)
  3. Write artifact to S3, verify with HEAD request
  4. Update status to "completed" with s3_key only if S3 verified
  5. Send WebSocket notification (best-effort, non-blocking)
  6. Delete SQS message only after database update succeeds
```

**Rollback Strategy:**

Feature flag `USE_FARGATE_FOR_LLM` controls routing:
- `false` (default): All requests processed synchronously via Lambda, no SQS publishing
- `true`: Long-running requests (>20s estimated) routed to Fargate path

Existing Lambda handlers remain unmodified except for SQS publishing logic wrapped in feature flag conditional. Rollback procedure:
1. Set `USE_FARGATE_FOR_LLM=false` in environment variables
2. Redeploy Lambda functions
3. Drain SQS queue (let running Fargate tasks complete, no new messages enqueued)
4. Scale Fargate service to 0 tasks

## Pattern Library

### Established Patterns (from Repository)

**1. Lambda HTTP Handler Structure**

Reference: `backend/api/properties/search.js`

```javascript
exports.handler = async (event) => {
  try {
    // Parse request parameters
    const params = JSON.parse(event.body || 'null');
    
    // Execute business logic
    const result = await performOperation(params);
    
    // Return structured response
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

**Pattern Guidance:**
- Always return `statusCode`, `headers`, `body`
- Parse `event.body` for POST/PUT requests
- Catch exceptions and return 500 with error message
- Log errors to CloudWatch with `console.error`

**2. SQL Query Organization**

Reference: `backend/database/queries/property-search.sql`

```sql
-- Queries stored as separate .sql files
-- Parameterized with $1, $2, etc. for Aurora DSQL
SELECT *
FROM properties
WHERE city = $1
  AND price_range = $2;
```

**Pattern Guidance:**
- One query per file, descriptive filename (e.g., `artifact-update-status.sql`)
- Use positional parameters (`$1`, `$2`) for prepared statements
- Include comments for complex logic
- Load queries at runtime using `fs.readFileSync`

### Required New Patterns

**3. Asynchronous Response (Lambda → Frontend)**

```javascript
// Lambda handler for async path
exports.handler = async (event) => {
  const requestId = generateUUID();
  const correlationId = generateUUID();
  
  // Publish to SQS
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL,
    MessageBody: JSON.stringify({
      requestId,
      correlationId,
      operation: 'GENERATE_ARTIFACT',
      userId: event.requestContext.authorizer.userId,
      payload: JSON.parse(event.body)
    }),
    MessageDeduplicationId: requestId, // For Standard queue
    MessageGroupId: 'llm-processing' // Optional, for FIFO
  }));
  
  // Return 202 Accepted with tracking URL
  return {
    statusCode: 202,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId,
      status: 'pending',
      trackingUrl: `/api/artifacts/${requestId}/status`,
      estimatedCompletionSeconds: 300
    })
  };
};
```

**4. SQS Message Schema (Lambda → Fargate)**

```javascript
// Standard message envelope
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000", // UUID v4
  "correlationId": "660e8400-e29b-41d4-a716-446655440001", // UUID v4
  "operation": "GENERATE_ARTIFACT", // or "PROCESS_CHAT"
  "userId": "user_abc123",
  "timestamp": "2026-03-12T10:30:00Z",
  "payload": {
    // Operation-specific parameters
    "artifactType": "context-package",
    "intentId": "T6-003",
    "orbitNumber": 1,
    "templateParameters": null
  },
  "metadata": {
    "websocketConnectionId": "abc123def456", // For notification routing
    "estimatedDurationSeconds": 180,
    "retryCount": 0
  }
}
```

**5. Atomic S3 + Database Write Pattern**

```javascript
async function completeArtifact(artifactId, content, requestId, correlationId) {
  const s3Key = `artifacts/${artifactId}.md`;
  
  // Step 1: Write to S3
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key,
    Body: content,
    ContentType: 'text/markdown',
    Metadata: {
      'request-id': requestId,
      'correlation-id': correlationId
    }
  }));
  
  // Step 2: Verify S3 object exists and is readable
  await s3Client.send(new HeadObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: s3Key
  }));
  
  // Step 3: Update database ONLY after S3 verification
  await dbClient.execute(
    `UPDATE artifacts 
     SET status = 'completed', 
         s3_key = $1, 
         completed_at = NOW() 
     WHERE id = $2 AND status = 'processing'`,
    [s3Key, artifactId]
  );
  
  logger.info('Artifact completed', {
    artifactId,
    s3Key,
    requestId,
    correlationId
  });
}
```

**6. Fargate Task Structured Logging**

```javascript
// Use structured JSON logs for CloudWatch Logs Insights queries
const logger = {
  info: (message, metadata) => {
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...metadata,
      taskArn: process.env.ECS_TASK_ARN // Injected by ECS
    }));
  },
  error: (message, error, metadata) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      error: error.message,
      stack: error.stack,
      ...metadata,
      taskArn: process.env.ECS_TASK_ARN
    }));
  }
};

// Usage in Fargate task
logger.info('Task started', {
  requestId: message.requestId,
  correlationId: message.correlationId,
  operation: message.operation
});
```

**7. Bedrock Invocation with Retry**

```javascript
async function invokeBedrock(prompt, requestId, correlationId) {
  const maxRetries = 3;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await bedrockClient.send(new InvokeModelCommand({
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 10000,
          messages: [{ role: 'user', content: prompt }]
        })
      }));
      
      logger.info('Bedrock invocation succeeded', {
        requestId,
        correlationId,
        attempt: attempt + 1,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens
      });
      
      return JSON.parse(new TextDecoder().decode(response.body));
      
    } catch (error) {
      attempt++;
      
      // Retry only on throttling (429) or transient errors (500, 503)
      if (error.name === 'ThrottlingException' || error.$metadata?.httpStatusCode >= 500) {
        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30000) + Math.random() * 1000;
          logger.warn('Bedrock invocation failed, retrying', {
            requestId,
            correlationId,
            attempt,
            backoffMs,
            error: error.message
          });
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        } else {
          logger.error('Bedrock invocation failed after retries', error, {
            requestId,
            correlationId,
            attempts: maxRetries
          });
          throw error;
        }
      } else {
        // Non-retryable error (4xx client error)
        logger.error('Bedrock invocation failed with non-retryable error', error, {
          requestId,
          correlationId
        });
        throw error;
      }
    }
  }
}
```

**8. WebSocket Notification Dispatch**

```javascript
async function notifyCompletion(websocketConnectionId, artifactId, status, requestId) {
  try {
    await apiGatewayClient.send(new PostToConnectionCommand({
      ConnectionId: websocketConnectionId,
      Data: JSON.stringify({
        event: 'ARTIFACT_COMPLETED',
        data: {
          requestId,
          artifactId,
          status, // 'completed' or 'failed'
          timestamp: new Date().toISOString()
        }
      })
    }));
    
    logger.info('WebSocket notification sent', {
      requestId,
      artifactId,
      websocketConnectionId,
      status
    });
  } catch (error) {
    // WebSocket failure is non-fatal — user can poll for status
    logger.warn('WebSocket notification failed', {
      requestId,
      artifactId,
      websocketConnectionId,
      error: error.message
    });
  }
}
```

### Anti-Patterns to Avoid

**Do NOT:**
- Store sensitive data (user tokens, API keys) in SQS message body — use reference IDs only
- Return synchronous response from Lambda after SQS publish — must return 202 immediately
- Update database to "completed" before S3 write verification — enforces atomicity
- Swallow Bedrock errors — distinguish throttling (retry) from client errors (fail fast)
- Hardcode AWS resource names — use environment variables for queue URLs, bucket names
- Skip correlation ID propagation — every log entry must include `correlationId`
- Delete SQS message before database update — ensures at-least-once processing
- Block Fargate task on WebSocket notification failure — notification is best-effort

## Prior Orbit References

### T6-001 and T6-002 (Prerequisites)

**Status:** Assumed complete (no artifacts provided in context).

**Expected Deliverables from Prior Orbits:**
- ECS Fargate cluster provisioned in target AWS account and region
- VPC with private subnets for Fargate tasks
- NAT Gateway or VPC endpoints for Bedrock, S3, SQS, DSQL, API Gateway
- ECR repository for Fargate container images
- Base Fargate task definition with CloudWatch Logs configuration
- IAM role templates for task execution and task role

**Validation Required Before Execution:**

1. **VPC Connectivity Test:**
   - Verify Fargate tasks can reach Bedrock endpoint (VPC endpoint or NAT Gateway)
   - Verify S3, SQS, DSQL access from private subnets
   - Test WebSocket API invocation from Fargate task subnet

2. **ECR Repository Access:**
   - Confirm repository exists: `<account-id>.dkr.ecr.<region>.amazonaws.com/prometheus-llm-processor`
   - Verify IAM permissions for `docker push` from CI/CD pipeline
   - Test image pull from Fargate task execution role

3. **IAM Role Structure Review:**
   - Review T6-001/T6-002 IAM role policies for least-privilege patterns
   - Confirm no wildcards (`*`) in resource ARNs
   - Validate CloudWatch Logs write permissions scope

**Known Gaps:**

If T6-001/T6-002 incomplete or documentation missing:
- **Blocking:** This orbit cannot proceed without functional Fargate cluster
- **Workaround:** Provision minimal Fargate infrastructure within this orbit (extends timeline, violates dependency order)
- **Recommendation:** Halt T6-003 execution until T6-001/T6-002 validated in test environment

### No Prior Orbits for This Intent

This is Orbit 1 for intent T6-003. No previous attempts or learnings exist. Future orbits should reference this Context Package to avoid repeating analysis.

### Related Intents (Trajectory Context)

**Trajectory:** Container Infrastructure (Fargate)

Likely sibling intents in this trajectory:
- T6-001: Provision Fargate cluster and VPC infrastructure
- T6-002: Establish container image build and deployment pipeline
- T6-004: (Future) Auto-scaling Fargate tasks based on SQS queue depth
- T6-005: (Future) Streaming LLM responses via WebSocket during generation

**Lessons for Future Orbits:**
- Document VPC endpoint decisions (cost vs. NAT Gateway throughput)
- Capture Fargate task cold start metrics for right-sizing task definition
- Record SQS queue depth patterns to inform auto-scaling thresholds

## Risk Assessment

### High-Risk Areas

**Risk 1: Orphaned Artifacts (S3 exists without database record)**

**Description:** S3 write succeeds but database update fails due to connection timeout, row lock, or DSQL service error. Artifact exists in S3 but database still shows `status = 'processing'` or has no record.

**Impact:** 
- User never receives completion notification
- Artifact unreachable via API (no database mapping)
- S3 storage costs for inaccessible objects
- Data integrity violation

**Mitigation:**
- Implement atomic write pattern: S3 → verify → database (see Pattern Library #5)
- Database update within transaction; rollback on failure
- Background reconciliation job: scan S3 bucket for objects without database records, either create records or delete orphans
- CloudWatch alarm: S3 object count vs. completed database records (should match ±5%)
- SQS message not deleted until database update confirmed → reprocessing on failure

**Rollback:** 
- Manual S3 cleanup script: list objects, cross-reference with database, delete unmatched
- Database query: `SELECT id FROM artifacts WHERE status = 'completed' AND s3_key IS NULL` (should return zero rows)

---

**Risk 2: Phantom Completions (Database shows "completed" but S3 missing)**

**Description:** Database updated to `status = 'completed'` with `s3_key` populated, but S3 object never written or deleted due to timing race condition, S3 eventual consistency lag, or accidental deletion.

**Impact:**
- User receives completion notification
- API returns 200 but S3 GET request returns 404
- User-facing error on artifact download
- Data integrity violation

**Mitigation:**
- Enforce S3 HEAD verification before database update (atomic pattern)
- Use S3 Object Lock or Versioning to prevent accidental deletion
- API endpoint `/artifacts/{id}/download` performs S3 existence check before returning pre-signed URL
- If S3 missing on download request: mark database record as `failed`, trigger reprocessing via new SQS message
- CloudWatch alarm: 404 rate on artifact download endpoint (should be <0.1%)

**Rollback:**
- Database constraint: `CHECK (status = 'completed' IMPLIES s3_key IS NOT NULL AND s3_verified_at IS NOT NULL)`
- Add `s3_verified_at` timestamp column to audit trail

---

**Risk 3: SQS Message Duplication (Standard Queue)**

**Description:** SQS Standard queue delivers message multiple times (at-least-once semantics), causing Fargate to invoke Bedrock repeatedly for same request, inflating costs and potentially generating different artifact content on each invocation.

**Impact:**
- Bedrock token costs multiplied by duplication factor
- Multiple S3 objects for same artifact (overwriting previous)
- Database row updated multiple times (last write wins)
- User confusion if artifact content changes between downloads

**Mitigation:**
- Implement idempotency check in Fargate task: query database for existing `requestId` before processing
- If record exists with `status = 'completed'`: skip Bedrock invocation, send WebSocket notification with existing result, delete SQS message
- If record exists with `status = 'processing'`: check `processing_started_at` timestamp; if >5 minutes ago, assume previous task crashed and reprocess; if <5 minutes, skip (duplicate message)
- SQS message deduplication: set `MessageDeduplicationId = requestId` (5-minute deduplication window)
- CloudWatch metric: `DuplicateMessagesProcessed` (log when idempotency check prevents reprocessing)

**Rollback:**
- Switch to FIFO queue if duplication rate >5% (trades throughput for exactly-once delivery)
- Cost tracking: tag Bedrock API calls with `request-id` to identify duplicate invocations

---

**Risk 4: Fargate Task OOM or CPU Throttling**

**Description:** Task definition allocates insufficient memory (4 GB) or CPU (2 vCPU), causing task to crash mid-processing or take >4 hours to complete. Large artifact generation (e.g., 50-page documents) or complex LLM prompts exhaust resources.

**Impact:**
- Task crashes with exit code 137 (OOM) or 139 (segmentation fault)
- SQS message returns to queue after visibility timeout, retries up to 3 times, then moves to DLQ
- User never receives completion notification
- Partial work lost (no S3 write)

**Mitigation:**
- Start with conservative task definition: 2 vCPU, 4 GB memory (Fargate minimum: 0.25 vCPU, 512 MB)
- Monitor CloudWatch Container Insights: `CpuUtilized`, `MemoryUtilized` p95/p99
- If p95 >80% of allocated: increase task definition resources incrementally
- Implement progress checkpointing: write partial results to S3 with `status = 'processing'`, resume from checkpoint on retry
- SQS message includes estimated duration; reject messages exceeding 3.5 hours at task entry (fail fast vs. timeout)

**Rollback:**
- Reduce task definition resources if costs exceed budget
- Split large artifacts into smaller chunks processed sequentially

---

**Risk 5: IAM Permission Drift**

**Description:** Fargate task IAM role lacks required permissions (e.g., `bedrock:InvokeModel` missing region restriction, `s3:PutObject` missing bucket ARN), causing all tasks to fail with `AccessDeniedException` immediately after deployment.

**Impact:**
- Complete feature outage
- No artifacts generated via Fargate path
- SQS queue depth increases unbounded
- Users receive timeout errors despite async path

**Mitigation:**
- Pre-deployment IAM policy dry-run using AWS IAM Policy Simulator
- Test IAM roles in staging environment with synthetic request before production deployment
- Canary deployment: enable feature flag for 1% of traffic, monitor CloudWatch errors for IAM failures
- Explicit resource ARNs in IAM policies (no `*` wildcards): `arn:aws:s3:::prometheus-artifacts-prod/*`, `arn:aws:bedrock:us-east-1:<account>:model/*`
- Post-deployment validation: execute test request end-to-end within 5 minutes of deploy

**Rollback:**
- Disable feature flag immediately if IAM errors detected
- Revert IAM role policy to previous version via IaC (CloudFormation/Terraform)

---

**Risk 6: WebSocket Connection Staleness**

**Description:** User closes browser tab before artifact completes. Fargate attempts to send WebSocket notification to stale `connectionId`, receives `GoneException` (410), but artifact still completed successfully in S3/database.

**Impact:**
- Low — artifact completed, just no real-time notification
- User must refresh page or poll status endpoint to see result
- CloudWatch logs filled with WebSocket failures (false-positive alerts)

**Mitigation:**
- WebSocket notification is best-effort, non-blocking (see Pattern Library #8)
- Log WebSocket failures as `WARN`, not `ERROR` — do not fail task
- Database stores artifact status independently of notification success
- Frontend implements fallback: poll `/artifacts/{id}/status` every 10 seconds if WebSocket connection lost
- CloudWatch dashboard: WebSocket notification success rate metric (expected ~85%, accounting for user disconnections)

**Rollback:**
- Remove WebSocket notification entirely, rely on polling-only UI (graceful degradation)

### Medium-Risk Areas

**Risk 7: SQS Visibility Timeout Mismatch**

**Description:** SQS visibility timeout (e.g., 1 hour) shorter than Fargate task processing time (e.g., 2 hours). Message becomes visible again while first task still processing, causing duplicate processing.

**Impact:**
- Two Fargate tasks process same request concurrently
- Race condition on S3 writes (last write wins)
- Database updates conflict (optimistic locking failure)

**Mitigation:**
- Set SQS visibility timeout to maximum: 4 hours (matches Fargate task timeout)
- Fargate task extends visibility timeout every 30 minutes using `ChangeMessageVisibility` API
- Implement optimistic locking on database updates: `UPDATE artifacts SET ... WHERE id = $1 AND status = 'processing'` (fails if row already updated)

---

**Risk 8: Bedrock Model Unavailability**

**Description:** Bedrock service experiences regional outage or model (Claude 3 Sonnet) temporarily unavailable, causing all Fargate tasks to fail with `ServiceUnavailableException`.

**Impact:**
- SQS messages retry, eventually move to DLQ
- Users receive error notifications: "LLM service unavailable"
- Platform reputation damage if prolonged outage

**Mitigation:**
- Retry logic with exponential backoff (see Pattern Library #7)
- After 3 retries: fail gracefully, update database to `status = 'failed'`, send WebSocket notification with error message
- CloudWatch alarm: DLQ depth >10 messages (indicates systemic Bedrock issue)
- Operations runbook: manual intervention to pause SQS queue, notify users, resume after service recovery

---

**Risk 9: Cost Overrun (Fargate + Bedrock Tokens)**

**Description:** Fargate vCPU-hour costs and Bedrock token consumption exceed 30% increase budget constraint due to higher-than-expected request volume or inefficient prompts.

**Impact:**
- Budget overrun, requires infrastructure cost optimization
- Potential service throttling or manual task count reduction
- Not user-facing, but operational concern

**Mitigation:**
- Tag all Fargate tasks: `cost-center=llm-processing`, `intent=T6-003`
- CloudWatch dashboard: daily Fargate vCPU-hours, Bedrock token count, projected monthly cost
- AWS Budget alert at 25% increase (early warning before 30% limit)
- Optimize Bedrock prompts: reduce token count via prompt engineering (separate initiative, not blocking)
- Cost-saving options: Fargate Spot (60% discount, accepts task eviction), reserved capacity (long-term commit)

### Low-Risk Areas

**Risk 10: Container Image Build Failures**

**Description:** Dockerfile fails to build in CI/CD pipeline due to missing dependencies, network errors, or base image unavailability.

**Impact:**
- Deployment blocked until build fixed
- No production impact if caught in CI/CD

**Mitigation:**
- Multi-stage Docker build: separate build stage from runtime stage
- Pin base image versions: `FROM node:20-alpine3.19` (avoid `latest` tag)
- CI/CD pipeline runs Docker build + smoke test before deployment
- ECR image scanning enabled: fail build if critical vulnerabilities detected

---

**Risk 11: Lambda Fallback Path Regression**

**Description:** Adding SQS publishing logic to Lambda handler introduces latency or errors in existing synchronous path, degrading short-request performance.

**Impact:**
- Users experience slower response times for short requests (<20s)
- Potential 500 errors on Lambda-only path

**Mitigation:**
- Feature flag guards SQS publishing logic: `if (USE_FARGATE_FOR_LLM && estimatedDuration > 20) { ... }`
- Integration tests validate Lambda synchronous path unchanged when flag disabled
- Canary deployment: enable flag in staging for 72 hours before production
- Rollback: disable flag immediately if p95 latency increases >10%