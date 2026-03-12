# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Intent:** T6-003  
**Orbit:** 1  
**Package Type:** intent-specific  
**Generated:** 2026-03-12

---

## Codebase References

### Primary (will be created or modified)

**Lambda Entry Points:**
- `backend/api/artifacts/generate.js` — NEW: HTTP endpoint that receives artifact generation requests, validates auth, enqueues to SQS, returns 202 with task_id
- `backend/api/chat/message.js` — NEW: HTTP endpoint for chat message submission with LLM processing flag
- `backend/api/tasks/status.js` — NEW: Polling endpoint for retrieving task status when WebSocket unavailable

**Fargate Worker Implementation:**
- `backend/workers/fargate/artifact-generator.js` — NEW: Main worker process that polls SQS, invokes LLM via Bedrock, writes results to S3
- `backend/workers/fargate/chat-processor.js` — NEW: Worker for extended chat sessions requiring >15min LLM context
- `backend/workers/fargate/task-handler.js` — NEW: Shared task lifecycle management (status updates, error handling, notifications)

**Shared Infrastructure Modules:**
- `backend/infrastructure/sqs/client.js` — NEW: SQS wrapper with message enqueue, visibility timeout handling, DLQ routing
- `backend/infrastructure/s3/artifacts.js` — NEW: S3 client for storing generation results with pre-signed URL generation
- `backend/infrastructure/websocket/notifier.js` — NEW: WebSocket message dispatch to connected clients by user_id
- `backend/infrastructure/secrets/manager.js` — NEW: AWS Secrets Manager integration for LLM API keys and database credentials

**Data Layer:**
- `backend/database/queries/task-executions-create.sql` — NEW: Insert task execution record with status tracking
- `backend/database/queries/task-executions-update.sql` — NEW: Update task status with timestamp transitions
- `backend/database/queries/task-executions-get.sql` — NEW: Retrieve task details for status polling

**Infrastructure as Code:**
- `infrastructure/terraform/sqs-queues.tf` — NEW: Queue definitions for artifact-generation and chat-processing with DLQ configuration
- `infrastructure/terraform/fargate-tasks.tf` — NEW: ECS task definitions for worker containers
- `infrastructure/terraform/iam-fargate.tf` — NEW: IAM roles granting Fargate access to SQS, S3, Secrets Manager, Bedrock

### Secondary (dependencies)

**Existing API Structure:**
- `backend/api/properties/search.js` — Reference for API handler pattern (HTTP server setup, request parsing, response formatting)

**Database Layer:**
- `backend/database/queries/` — Existing SQL query organization pattern
- `backend/database/connection.js` — ASSUMED: Database connection pooling (not present in sample repo; needs creation if not exists)

**Configuration:**
- `backend/config/aws.js` — NEW: AWS SDK configuration, region settings, endpoint overrides for local development
- `backend/config/environment.js` — NEW: Environment variable loading (NODE_ENV, AWS_REGION, SQS_QUEUE_URLS, S3_BUCKET)

### Tests

**Integration Tests:**
- `backend/tests/integration/api-to-sqs.test.js` — NEW: Verify Lambda enqueues message with correct payload structure
- `backend/tests/integration/fargate-to-s3.test.js` — NEW: Verify worker reads SQS, processes, writes S3, updates DSQL
- `backend/tests/integration/websocket-notification.test.js` — NEW: Verify completion events delivered to connected clients

**Unit Tests:**
- `backend/tests/unit/sqs-client.test.js` — NEW: Mock SQS operations, validate retry logic
- `backend/tests/unit/artifact-generator.test.js` — NEW: Mock Bedrock calls, validate output formatting

---

## Architecture Context

### Current System State

The repository currently implements a simple Node.js API with backend handlers in `backend/api/` following a straightforward module-per-endpoint pattern (see `backend/api/properties/search.js`). There is NO existing infrastructure for:
- Asynchronous task processing
- WebSocket connections
- AWS service integrations (SQS, Fargate, S3, Secrets Manager)
- LLM API clients

This intent represents a **foundational architectural shift** from synchronous request-response to asynchronous job processing.

### Target Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP POST /api/artifacts/generate
       ▼
┌─────────────────────┐
│  Lambda/API Handler │ ◄──── JWT validation
└──────┬──────────────┘
       │ Enqueue message
       ▼
┌─────────────┐        ┌──────────────┐
│  SQS Queue  │───────▶│ Fargate Task │ ◄──── Bedrock LLM
└─────────────┘        └──────┬───────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              ┌──────────┐ ┌────┐ ┌──────────┐
              │   DSQL   │ │ S3 │ │WebSocket │
              │ (status) │ │(data)│ │ (notify) │
              └──────────┘ └────┘ └──────────┘
```

### Data Flow

1. **HTTP Request Phase:**
   - Client sends POST to `/api/artifacts/generate` with `{ intent_id, artifact_type, parameters }`
   - Lambda validates JWT, extracts `user_id` and `workspace_id`
   - Lambda generates `task_id`, writes initial DSQL record (`status: queued`)
   - Lambda enqueues SQS message: `{ task_id, user_id, workspace_id, intent_id, parameters }`
   - Lambda returns `202 Accepted` with `{ task_id, status: "queued", poll_url: "/api/tasks/{task_id}" }`

2. **Fargate Processing Phase:**
   - Fargate worker polls SQS with long-polling (20s wait time)
   - Worker receives message, updates DSQL (`status: processing, started_at: NOW()`)
   - Worker retrieves LLM API key from Secrets Manager
   - Worker invokes Bedrock API with prompt constructed from parameters
   - Worker streams LLM response chunks into memory buffer
   - Worker writes complete artifact to S3: `s3://artifacts/{workspace_id}/{intent_id}/{task_id}.json`
   - Worker updates DSQL (`status: completed, completed_at: NOW(), s3_key: <path>`)
   - Worker sends WebSocket notification: `{ type: "artifact.completed", task_id, artifact_url }`
   - Worker deletes SQS message (ACK)

3. **Error Handling:**
   - Bedrock throttling (429): Worker does NOT delete message; SQS visibility timeout expires → retry
   - Invalid payload: Worker deletes message, updates DSQL (`status: failed, error: "validation_error"`)
   - Worker crash: SQS message not deleted → redelivery after visibility timeout (max 3 attempts → DLQ)

### Integration Boundaries

- **Authentication boundary:** JWT validation happens ONLY in Lambda; Fargate trusts `user_id` from SQS message
- **Data access boundary:** Fargate workers read/write only data belonging to `workspace_id` in message payload
- **Network boundary:** Fargate tasks run in private subnets; outbound internet via NAT gateway for Bedrock API calls; no inbound internet

---

## Pattern Library

### Conventions (follow these)

**Node.js API Handler Pattern:**
- **Example:** `backend/api/properties/search.js`
- **Convention:** 
  ```javascript
  const http = require('http');
  const handler = async (req, res) => {
    // Parse body, validate, execute business logic, return JSON
  };
  http.createServer(handler).listen(PORT);
  ```
- **Apply here:** New Lambda handlers follow same structure with added JWT validation middleware and SQS enqueue step

**SQL Query Externalization:**
- **Example:** `backend/database/queries/property-search.sql`
- **Convention:** SQL statements live in `.sql` files, loaded at runtime, parameterized with `$1, $2...` syntax
- **Apply here:** All DSQL operations (`task-executions-create.sql`, `task-executions-update.sql`) follow this pattern

**Environment-Based Configuration:**
- **Inferred from README:** Application expects configuration via environment variables (Node.js standard)
- **Convention:** Use `process.env.VARIABLE_NAME` with fallback defaults in `backend/config/environment.js`
- **Apply here:** SQS queue URLs, S3 bucket names, DSQL connection strings, AWS region all configured via env vars

**Error Response Format:**
- **Inferred:** JSON responses with consistent structure
- **Convention:** 
  ```javascript
  { error: { code: "ERROR_CODE", message: "Human-readable description" } }
  ```
- **Apply here:** Lambda returns 500 with structured error if SQS enqueue fails; Fargate logs errors to CloudWatch in JSON format

**Asynchronous Task Status Enum:**
- **New pattern established by this intent:**
  ```
  queued → processing → completed
                     ↘ failed
  ```
- **Convention:** DSQL `status` column uses lowercase string values; transitions logged with timestamps

### Anti-Patterns (avoid these)

**Do not block Lambda on task completion:**
- Lambda MUST return immediately after enqueuing to SQS
- Waiting for Fargate result defeats the purpose and risks 15-minute timeout

**Do not store large artifacts in DSQL:**
- DSQL records store only metadata (`task_id`, `status`, `s3_key`)
- Actual artifact content goes to S3; DSQL has reference to location

**Do not retry indefinitely on LLM failures:**
- Bedrock throttling (429): Let SQS handle retry with visibility timeout (transient error)
- Bedrock invalid request (400): Mark failed immediately, do not retry (permanent error)
- Max 3 retry attempts via SQS; after that, message moves to DLQ

**Do not send sensitive data via WebSocket:**
- WebSocket notification includes `task_id` and pre-signed S3 URL (expires in 1 hour)
- Do NOT send raw artifact content through WebSocket; client fetches from S3

**Do not assume WebSocket delivery:**
- Client may disconnect during long-running task
- Status polling endpoint (`/api/tasks/{task_id}`) is fallback mechanism
- Frontend polls every 5 seconds if WebSocket connection lost

---

## Prior Orbit References

### T6-001 Orbit: Fargate Cluster Provisioning
- **Status:** ASSUMED COMPLETED (referenced as dependency in intent)
- **Relevance:** Established ECS cluster, VPC configuration, security groups for Fargate tasks
- **Key artifacts:** `infrastructure/terraform/fargate-cluster.tf`, `infrastructure/terraform/vpc.tf`
- **Lessons:**
  - Fargate tasks require private subnets with NAT gateway for outbound API calls
  - CloudWatch log groups must be created before task definition references them
  - Task execution role (pulls container image) vs task role (runtime permissions) — distinct IAM roles required

### T6-002 Orbit: SQS Queue Setup
- **Status:** ASSUMED COMPLETED (referenced as dependency in intent)
- **Relevance:** Created queues with dead-letter queue configuration
- **Key artifacts:** `infrastructure/terraform/sqs-queues.tf`
- **Lessons:**
  - Visibility timeout MUST exceed maximum expected task duration (set to 4.5 hours for 4-hour max task)
  - Dead-letter queue receives messages after 3 failed delivery attempts
  - Message retention period: 14 days (allows manual recovery from DLQ)

### Known Lambda Timeout Issues
- **Background:** Intent document references "documented max execution time failures for specific artifact types"
- **Assumption:** Prior attempts to generate large intent documents or multi-agent collaboration logs hit Lambda 15-minute limit
- **Relevance:** Identifies which artifact types should route to Fargate vs remain in Lambda
- **Action:** Implement routing logic in Lambda handler:
  ```javascript
  if (estimatedDuration > 600) { // 10 minutes
    enqueueFargate();
  } else {
    processInLambda();
  }
  ```

---

## Risk Assessment

### Risk: SQS Message Loss on Fargate Task Crash
**Impact:** User submits artifact generation request; Lambda returns 202; Fargate crashes before processing; user never receives result; task stuck in "processing" status forever  
**Likelihood:** Medium (OOM kill, unhandled exception, network partition during S3 write)  
**Mitigation:**
- Set SQS visibility timeout > max task duration (4.5 hours for 4-hour limit)
- Implement graceful shutdown handler: catch SIGTERM, finish current message, mark status as `interrupted`
- Update DSQL status BEFORE deleting SQS message (order: persist → notify → ACK)
- CloudWatch alarm: if task in "processing" state >5 hours → alert ops team
- Dead-letter queue alarm: if >5 messages in DLQ → investigate failed tasks

### Risk: Fargate Cold Start Exceeds 30-Second Target
**Impact:** User perceives task as "stuck"; expects processing to start immediately; waits 60+ seconds for Fargate to scale from 0→1  
**Likelihood:** High on first deployment; medium ongoing (depends on traffic patterns)  
**Mitigation:**
- Pre-warm 1 Fargate task during deployment window (keep 1 task always running for first 24 hours)
- Use provisioned concurrency: maintain min capacity = 1 during business hours
- Optimize Docker image: multi-stage build, minimize layers, cache dependencies
- CloudWatch alarm: if task start latency p95 >30s for 10 minutes → page on-call

### Risk: Unbounded Fargate Autoscaling Cost
**Impact:** Bug causes queue to fill infinitely (circular enqueue loop); Fargate scales to 100+ tasks; unexpected AWS bill >$5k  
**Likelihood:** Low (requires code bug that enqueues messages in worker itself)  
**Mitigation:**
- Set hard max capacity in ECS service definition (max_tasks = 20)
- AWS Budget alert: if projected monthly cost >$300 → email engineering team
- Circuit breaker in Lambda: if SQS enqueue fails 5 times in 60 seconds → return 503, stop accepting requests
- Monitor queue depth: if >200 messages for 15 minutes → alarm (investigate why tasks not draining)

### Risk: S3 Pre-Signed URL Expiration Before Client Fetches
**Impact:** Fargate completes task, sends WebSocket notification with URL; client disconnected; reconnects 2 hours later; URL expired (1-hour expiration); user sees "artifact not found"  
**Likelihood:** Medium (mobile app backgrounded, laptop sleep, network disruption)  
**Mitigation:**
- Store S3 key (not pre-signed URL) in DSQL `task_executions` table
- Status polling endpoint (`/api/tasks/{task_id}`) regenerates fresh pre-signed URL on each request
- WebSocket notification includes URL with `expires_at` timestamp
- Frontend shows warning 10 minutes before expiration: "Download artifact now"
- Artifact files remain in S3 for 90 days (lifecycle policy); URL can be regenerated anytime within window

### Risk: Bedrock API Quota Exhaustion
**Impact:** Organization hits monthly Bedrock token quota; new tasks fail with 403 Forbidden; all artifact generation blocked for remainder of billing cycle  
**Likelihood:** Medium (depends on user adoption rate and artifact complexity)  
**Mitigation:**
- Request Bedrock quota increase before production launch (document current limits: X tokens/month)
- Implement per-user rate limiting in Lambda: max 10 concurrent tasks per user
- CloudWatch alarm: if Bedrock 403 errors >5 in 10 minutes → page on-call
- Graceful degradation: if quota exceeded, Lambda returns 429 with `Retry-After: <timestamp>` header
- Consider fallback LLM provider (OpenAI, Anthropic direct) if Bedrock unavailable

### Risk: WebSocket Connection Table Lookup Failure
**Impact:** Fargate completes task, attempts to send WebSocket notification; connection table query fails (DynamoDB throttling); user never notified; perceives task as incomplete  
**Likelihood:** Low at current scale; medium if >1000 concurrent users  
**Mitigation:**
- WebSocket notification is BEST-EFFORT, not guaranteed delivery
- Always persist completion status to DSQL BEFORE attempting WebSocket send
- Frontend polls status endpoint every 5 seconds as fallback if WebSocket silent >30 seconds
- Implement retry logic in WebSocket notifier: 3 attempts with exponential backoff (1s, 4s, 16s)
- CloudWatch alarm: if WebSocket send failures >10% over 5 minutes → investigate DynamoDB capacity

### Risk: DSQL Connection Pool Exhaustion
**Impact:** Fargate tasks make concurrent DSQL queries for status updates; connection pool saturated; queries timeout; tasks fail to mark completion  
**Likelihood:** Low at 10 tasks; high at 50+ concurrent tasks  
**Mitigation:**
- Configure connection pool in `backend/database/connection.js`: max_connections = 50, idle_timeout = 30s
- Each Fargate task maintains single connection (not per-query); reuse connection for all DSQL operations
- Implement query timeout (5s); if exceeded, log error but do not crash worker
- DSQL provisioned capacity: scale up to support peak concurrent task count (calculate: 50 tasks × 2 queries/task = 100 qps)
- Monitor DSQL connection count via CloudWatch; alert if >80% pool utilization

### Risk: Auth Context Lost Between Lambda and Fargate
**Impact:** Lambda validates JWT, enqueues message with `user_id`; Fargate reads message but does not enforce row-level security; worker accesses artifacts from other users' workspaces  
**Likelihood:** Medium (requires developer error in Fargate worker SQL queries)  
**Mitigation:**
- SQS message payload MUST include: `{ user_id, workspace_id, intent_id }` — validated in Lambda before enqueue
- Fargate worker MUST validate presence of `workspace_id` before processing; if missing, reject message
- All DSQL queries in worker include `WHERE workspace_id = $1` filter
- Integration test: enqueue task as User A → verify Fargate cannot read User B's data
- Code review checklist: verify every new SQL query includes workspace isolation filter

### Risk: Docker Image Vulnerabilities
**Impact:** Fargate task pulls vulnerable base image; container compromised; attacker exfiltrates Bedrock API keys or database credentials  
**Likelihood:** Low (requires targeted attack + vulnerable dependency)  
**Mitigation:**
- Use AWS-maintained base images: `public.ecr.aws/lambda/nodejs:20` (automatically patched)
- Scan images with `docker scan` or AWS ECR image scanning before deployment
- Rotate Secrets Manager credentials every 90 days
- Implement least-privilege IAM: task role grants ONLY Bedrock invoke, S3 write to specific bucket, DSQL query to specific table
- Network isolation: Fargate tasks in private subnets; no SSH access; logs only via CloudWatch