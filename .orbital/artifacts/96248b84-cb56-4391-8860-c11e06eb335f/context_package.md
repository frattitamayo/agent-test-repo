# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Primary Files (to be created or modified)

**SQS Message Publishing (Lambda layer):**
- `backend/api/artifacts/generate.js` — artifact generation endpoint, will add SQS publish logic
- `backend/api/chat/message.js` — AI chat endpoint, will add SQS publish logic
- `backend/services/queue-client.js` — new shared module for SQS SDK operations

**Fargate Task Implementation:**
- `backend/workers/fargate-llm-processor/` — new directory for Fargate task code
  - `index.js` — task entry point, SQS message polling and processing loop
  - `handlers/artifact-generator.js` — LLM invocation and artifact assembly logic
  - `handlers/chat-processor.js` — LLM conversation handling
  - `services/bedrock-client.js` — Bedrock SDK wrapper with retry logic
  - `services/s3-client.js` — S3 upload with atomic write guarantees
  - `services/database-client.js` — DSQL connection and status update queries
  - `services/websocket-notifier.js` — WebSocket notification dispatch
  - `Dockerfile` — container image definition

**Infrastructure as Code:**
- `infrastructure/fargate/` — new directory for Fargate resources
  - `task-definition.json` or `cdk-stack.ts` — ECS task definition
  - `iam-roles.json` or `iam-roles.ts` — Lambda and Fargate IAM policies
  - `sqs-queues.json` or `sqs-queues.ts` — main queue + DLQ configuration

### Secondary Files (dependencies and interfaces)

**Existing Lambda Handlers (preserve as fallback):**
- `backend/api/properties/search.js` — reference pattern for Lambda HTTP handlers
- All files in `backend/api/` — must remain operational, do not remove

**Database Schema:**
- `backend/database/queries/property-search.sql` — reference pattern for SQL query structure
- `backend/database/queries/` — add new queries for artifact status updates
  - `artifact-update-status.sql` — update artifact record with status/s3_key
  - `chat-message-update-status.sql` — update chat message record

**Configuration:**
- `backend/config/aws.js` — AWS SDK configuration (region, credentials source)
- `backend/config/environment.js` — environment variable mapping for queue URLs, bucket names

**Observability:**
- `backend/utils/logger.js` — structured logging utility with correlation ID support
- `backend/utils/metrics.js` — CloudWatch metrics client wrapper

### Test Files (to be created)

- `backend/workers/fargate-llm-processor/__tests__/artifact-generator.test.js`
- `backend/workers/fargate-llm-processor/__tests__/chat-processor.test.js`
- `backend/services/__tests__/queue-client.test.js`
- `backend/api/artifacts/__tests__/generate.integration.test.js` — end-to-end SQS publish test

## Architecture Context

### Current State

Prometheus V1 currently uses AWS Lambda for all HTTP request handling, including artifact generation and AI chat operations. Lambda functions invoke Amazon Bedrock synchronously and return results within the 29-second API Gateway timeout window. This architecture fails for LLM operations requiring >29 seconds of processing, resulting in user-facing timeout errors.

**Data Flow (Current):**
```
Frontend → API Gateway → Lambda → Bedrock (sync) → S3 + DSQL → Lambda response → Frontend
```

**Constraints:**
- Lambda max execution: 15 minutes (but API Gateway timeout at 29s forces earlier termination)
- No persistent connections for streaming or progress updates
- All work must complete within single Lambda invocation

### Target Architecture

This intent introduces asynchronous processing for long-running LLM operations using Fargate tasks as durable workers. Lambda remains the HTTP entry point but offloads compute-intensive work to SQS → Fargate pipeline.

**Data Flow (Target):**
```
Frontend → API Gateway → Lambda (HTTP handler)
                          ↓
                       SQS Queue
                          ↓
                   Fargate Task (ECS)
                          ↓
               Bedrock + S3 + DSQL
                          ↓
              WebSocket Notification → Frontend
```

**Request Path Decision:**
- Requests estimated <20s execution time: Lambda handles synchronously (existing path)
- Requests estimated >20s execution time: Lambda publishes to SQS, returns 202 Accepted
- Frontend subscribes to WebSocket for completion notification

**Infrastructure Boundaries:**
- **VPC:** Fargate tasks run in private subnets (no public IP)
- **Service Access:** VPC endpoints for Bedrock, S3, SQS, DSQL required (or NAT Gateway)
- **IAM Separation:**
  - Lambda role: `sqs:SendMessage` only
  - Fargate role: `bedrock:InvokeModel`, `s3:PutObject`, `dsql:ExecuteStatement`, `execute-api:Invoke` (WebSocket)
- **Queue Configuration:** Standard SQS queue (not FIFO) for higher throughput, visibility timeout 4 hours (matches task timeout)

**State Management:**
- Database artifact/chat records include `status` field: `pending` → `processing` → `completed`/`failed`
- Fargate updates status at: task start (→ `processing`), task completion (→ `completed`), task failure (→ `failed`)
- S3 key written only on success; database `completed` status set only after S3 write verified
- Idempotency: Lambda generates unique request ID, Fargate checks if request already processed before invoking Bedrock

**Rollback Strategy:**
- Feature flag `USE_FARGATE_FOR_LLM` (default: `false`) controls routing
- If `false`, all requests handled by existing Lambda path regardless of duration
- If `true`, duration-based routing to SQS → Fargate
- Lambda handlers must remain unchanged except for SQS publish addition

### Service Dependencies

**AWS Services:**
- **SQS:** Message queue for Lambda → Fargate communication
- **ECS (Fargate):** Container orchestration for worker tasks
- **ECR:** Container image registry for Fargate task images
- **Bedrock:** LLM service (existing dependency)
- **S3:** Artifact storage (existing dependency)
- **Aurora DSQL:** Metadata and status tracking (existing dependency)
- **API Gateway WebSocket API or IoT Core:** Real-time notifications (must exist or be created)
- **CloudWatch Logs:** Task execution logging

**Network Path:**
```
Fargate Task (private subnet)
  → VPC Endpoint (Bedrock/S3/SQS/DSQL)
  → AWS Service
```

## Pattern Library

### Existing Patterns (from Repository)

**1. Lambda HTTP Handler Structure (reference: `backend/api/properties/search.js`):**
```javascript
// Expected pattern for API endpoints
exports.handler = async (event) => {
  try {
    // Parse request
    // Invoke business logic
    // Return structured response
    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

**2. SQL Query Organization (reference: `backend/database/queries/property-search.sql`):**
- Queries stored as `.sql` files in `backend/database/queries/`
- Loaded at runtime by database client
- Parameterized with `$1`, `$2` placeholders for Aurora DSQL

### Required New Patterns

**3. SQS Message Structure (to be established):**
```javascript
// Standard message envelope for Lambda → Fargate
{
  "requestId": "uuid-v4",           // Idempotency key
  "correlationId": "uuid-v4",       // Tracing across services
  "operation": "GENERATE_ARTIFACT", // or "PROCESS_CHAT"
  "userId": "string",
  "payload": {
    // Operation-specific parameters
    "artifactType": "context-package",
    "intentId": "T6-003",
    "templateParams": null
  },
  "metadata": {
    "timestamp": "2024-01-01T00:00:00Z",
    "source": "lambda-artifact-api",
    "websocketConnectionId": "string" // For notification routing
  }
}
```

**4. Fargate Task Logging (to be established):**
```javascript
// Structured CloudWatch logs with correlation
logger.info("Task started", {
  requestId: message.requestId,
  correlationId: message.correlationId,
  operation: message.operation,
  userId: message.userId,
  taskArn: process.env.ECS_TASK_ARN
});
```

**5. Atomic S3 + Database Write (to be implemented):**
```javascript
// Ensure database shows "completed" only if S3 write succeeds
async function completeArtifact(artifactId, s3Key, content) {
  // 1. Write to S3
  await s3Client.putObject({ Key: s3Key, Body: content });
  
  // 2. Verify S3 object exists
  await s3Client.headObject({ Key: s3Key });
  
  // 3. Update database only after verification
  await dbClient.execute(
    "UPDATE artifacts SET status = 'completed', s3_key = $1, completed_at = NOW() WHERE id = $2",
    [s3Key, artifactId]
  );
}
```

**6. WebSocket Notification Payload (to be established):**
```javascript
// Notification sent to frontend on task completion
{
  "event": "ARTIFACT_COMPLETED", // or "CHAT_MESSAGE_COMPLETED"
  "data": {
    "requestId": "uuid-v4",
    "artifactId": "string",
    "s3Key": "string",
    "status": "completed" // or "failed"
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Anti-Patterns to Avoid

- **No hardcoded queue URLs or bucket names in code** — use environment variables
- **No synchronous polling from Lambda** — Lambda must return 202 immediately after SQS publish
- **No partial artifact visibility** — do not expose S3 keys to frontend until database shows `completed`
- **No missing correlation IDs** — every log entry must include `correlationId` for distributed tracing
- **No swallowing Bedrock errors** — distinguish throttling (retry) from model errors (fail immediately)

## Prior Orbit References

### T6-001 and T6-002 (Prerequisites)

**Status:** Assumed complete but not documented in provided context.

**Expected Artifacts from T6-001/T6-002:**
- Fargate cluster provisioned in target AWS account/region
- ECS task definition template with baseline IAM role
- VPC configuration: private subnets, NAT Gateway or VPC endpoints
- ECR repository for container images

**Validation Needed Before Execution:**
- Confirm VPC has connectivity to Bedrock, S3, SQS, DSQL services
- Confirm ECS cluster exists and can launch tasks
- Review IAM role policies from T6-001/T6-002 for least-privilege patterns

**Gaps if T6-001/T6-002 Incomplete:**
- Infrastructure provisioning becomes blocking dependency for T6-003
- Network connectivity failures will manifest during Fargate task execution
- Recommend delaying T6-003 execution until T6-001/T6-002 validated in test environment

### Intent Document (Sibling Artifact)

**Key Constraints from Intent Document:**
- Fargate task execution time capped at 4 hours
- SQS visibility timeout must match task timeout to prevent duplicate processing
- Lambda-to-SQS publish latency <500ms p99
- Fargate cold start <45s from message visibility to first Bedrock call
- WebSocket notification within 3 seconds of task completion
- Zero orphaned S3 artifacts (S3 exists without database record)
- Cost increase capped at <30% vs. current Lambda-only spend

**Acceptance Boundaries:**
- <2% failure rate for requests >29s execution time (excluding Bedrock errors)
- CloudWatch dashboard must show: queue depth, task count, duration p50/p95/p99, failure rate, WebSocket success rate
- Deployment runbook required: manual scaling, DLQ inspection, rollback to Lambda-only

## Risk Assessment

### High-Risk Areas

**1. Asynchronous State Coordination (Database + S3 + WebSocket)**

**Risk:** Database record shows "completed" but S3 artifact missing or corrupted, leading users to broken download links.

**Impact:** Medium — data integrity violation, user frustration, requires manual cleanup.

**Mitigation:**
- Implement atomic write pattern: S3 upload → S3 head verification → database update (see Pattern Library)
- Add database constraint: `CHECK (status = 'completed' IMPLIES s3_key IS NOT NULL)`
- CloudWatch alarm on S3 object count vs. completed database records (should match within tolerance)
- Retry logic for S3 writes (idempotent keys prevent duplicates)
- Rollback plan: database migration to add `s3_verified_at` timestamp field if atomic pattern fails

**2. Fargate Task Failure Without Notification**

**Risk:** Task crashes before updating database or sending WebSocket notification, leaving request in `processing` state indefinitely.

**Impact:** Medium — user waits forever, no feedback on failure, database pollution.

**Mitigation:**
- SQS DLQ (dead-letter queue) after 3 failed delivery attempts captures unprocessable messages
- ECS task failure triggers CloudWatch alarm
- Background job (separate Lambda or Fargate task) scans for `processing` records older than 4.5 hours, marks as `failed`, sends notification
- Fargate task uses `try/catch/finally` to guarantee status update even on exception
- Feature flag rollback to Lambda-only if failure rate >5%

**3. IAM Permission Drift**

**Risk:** Fargate task IAM role lacks required permissions (e.g., Bedrock invoke, S3 write, WebSocket post), causing all tasks to fail silently.

**Impact:** High — complete feature outage, no artifacts generated, cascading user impact.

**Mitigation:**
- Pre-deployment IAM policy dry-run using AWS IAM Policy Simulator
- Canary deployment: route 1% of traffic to Fargate path, monitor for IAM-related CloudWatch errors
- Least-privilege roles defined in IaC with explicit resource ARNs (no `*` wildcards)
- Post-deployment validation: synthetic test that exercises full request path (Lambda → SQS → Fargate → S3 → DSQL → WebSocket)
- Immediate rollback if CloudWatch shows `AccessDenied` errors on Fargate tasks

**4. SQS Message Loss or Duplication**

**Risk (Standard Queue):** SQS delivers message multiple times, causing duplicate artifact generation and Bedrock cost inflation.

**Risk (FIFO Queue):** SQS throughput limited to 300 messages/sec, bottlenecks high-volume periods.

**Impact:** Medium (Standard) or High (FIFO) — duplicate charges, user confusion, or performance degradation.

**Mitigation:**
- Use Standard SQS queue for higher throughput (FIFO not justified unless ordering required)
- Implement idempotency in Fargate task: check database for existing `requestId` before invoking Bedrock
- If duplicate detected, skip processing, return existing result, send WebSocket notification
- SQS message deduplication ID set to `requestId` (5-minute deduplication window for Standard)
- Monitor CloudWatch metric: `NumberOfMessagesSent` vs. unique `requestId` count in database (should match)

**5. Fargate Cold Start Latency**

**Risk:** Task takes >45 seconds to start (pulling image, network setup), violating acceptance criteria.

**Impact:** Low — user waits longer, but not a failure; WebSocket provides feedback.

**Mitigation:**
- Use small base image (Alpine Linux) to reduce image pull time
- Pre-warm ECS service with minimum task count = 1 (always one task ready)
- Consider ECS Fargate Spot for cost savings (acknowledges potential task eviction)
- CloudWatch alarm if p95 cold start duration >60 seconds
- If cold start remains issue, split into two task definitions: fast-start (small image) and slow-start (full dependencies)

**6. WebSocket Connection Staleness**

**Risk:** User closes browser tab before task completes; WebSocket connection ID invalid when notification sent.

**Impact:** Low — user must poll or refresh to see result, notification lost.

**Mitigation:**
- Fargate task gracefully handles WebSocket post failure (logs error, does not fail task)
- Database update occurs regardless of WebSocket success (artifact still available)
- Frontend polls for status updates every 10 seconds as fallback (WebSocket is optimization, not requirement)
- CloudWatch metric: WebSocket notification success rate (target >98%)

### Medium-Risk Areas

**7. Bedrock Throttling or Model Unavailability**

**Risk:** Bedrock service throttles requests or model unavailable, causing task failures.

**Impact:** Medium — user-facing errors, but not Prometheus platform's fault.

**Mitigation:**
- Implement exponential backoff with jitter for Bedrock API calls (max 3 retries)
- Distinguish throttling (429) from model errors (4xx) — retry only throttles
- SQS DLQ captures messages that fail after retries
- CloudWatch alarm on DLQ depth >10 messages
- User-facing error message: "LLM service temporarily unavailable, please try again"

**8. Cost Overrun (Fargate + Bedrock)**

**Risk:** Fargate vCPU-hours and Bedrock token costs exceed 30% increase budget.

**Impact:** Low — operational concern, not user-facing.

**Mitigation:**
- Tag all Fargate tasks with `cost-center:llm-processing` for spend tracking
- CloudWatch dashboard shows: Fargate vCPU-hours, Bedrock token count, S3 PUT requests
- Set AWS Budget alert at 25% increase threshold (early warning before 30% limit)
- Optimize Bedrock prompts to reduce token count (separate effort, not blocking)

### Low-Risk Areas

**9. Lambda Fallback Path Regression**

**Risk:** Adding SQS publish logic to Lambda breaks existing synchronous path.

**Impact:** Low — mitigated by feature flag; synchronous path remains default.

**Mitigation:**
- Feature flag `USE_FARGATE_FOR_LLM=false` by default in all environments
- Integration tests validate Lambda synchronous path unchanged (response structure, latency)
- Canary deployment: enable Fargate only in staging environment for 72 hours before production

**10. Docker Image Build Failures**

**Risk:** Fargate task Dockerfile fails to build or image exceeds size limit.

**Impact:** Low — caught in CI/CD pipeline before deployment.

**Mitigation:**
- CI/CD pipeline includes Docker build step with automated tests
- Image size limit: <1 GB (Fargate limit: 10 GB, but aim smaller for faster pulls)
- Multi-stage Docker build to exclude dev dependencies from production image