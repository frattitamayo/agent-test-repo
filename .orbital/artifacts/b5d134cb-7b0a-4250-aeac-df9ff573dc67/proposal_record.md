# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1
**Generated:** 2024-02-17
**Intent:** T6-003
**Context Package:** CTX-T6-003
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

The system currently fails when generating complex artifacts or conducting extended AI conversations because Lambda functions time out after 15 minutes. This intent moves the actual LLM processing work to Fargate containers that can run indefinitely, while keeping Lambda as the HTTP entry point. When a user requests artifact generation or sends a chat message, Lambda validates the request, drops a message onto an SQS queue, and immediately responds with a 202 Accepted status and a correlation ID. A Fargate task picks up that message, invokes Bedrock for the actual generation work, stores the result in S3 and DSQL, and pushes a WebSocket notification back to the client with either success (including a presigned S3 URL) or failure. The client maintains a WebSocket connection subscribed to that correlation ID to receive real-time status updates without polling. This decouples request handling from execution, allowing LLM operations that exceed Lambda's time limits to complete successfully while maintaining the illusion of responsiveness through async notifications.

---

## Implementation Plan

### Phase 1: Foundation Infrastructure (Orbit 1)

**New Infrastructure Components:**

1. **SQS Queues** (`infrastructure/sqs-queues.ts`)
   - Standard queue `prometheus-artifact-generation-queue` with 1800-second visibility timeout
   - DLQ `prometheus-artifact-generation-dlq` for failed messages (3 retry limit)
   - KMS encryption with project-specific key
   - Message retention: 4 days (96 hours)

2. **Fargate Task Definition** (`infrastructure/fargate-tasks.ts`)
   - Task family: `prometheus-artifact-worker`
   - vCPU: 1.0, Memory: 2048 MB
   - Container image: built from `Dockerfile.worker`
   - Environment variables: `ARTIFACT_QUEUE_URL`, `WEBSOCKET_API_ENDPOINT`, `WEBSOCKET_CONNECTIONS_TABLE`, `ARTIFACT_BUCKET`, `DSQL_CONNECTION_STRING`
   - Task execution role: ECR pull, CloudWatch Logs write
   - Task role: Bedrock invoke, S3 write, DSQL connect, SQS receive/delete, WebSocket publish

3. **ECS Service** (`infrastructure/fargate-services.ts`)
   - Service name: `artifact-worker-service`
   - Desired count: 2 (for availability, will scale based on queue depth later)
   - Deployment: rolling update, minimum healthy 50%, maximum 200%
   - Network: private subnets from existing VPC (10.0.2.0/24, 10.0.3.0/24)
   - Service discovery: disabled (workers pull from queue, no inbound traffic)

**DSQL Schema Migration:**

```sql
-- migrations/008_add_async_artifact_status.sql
ALTER TYPE artifact_status ADD VALUE 'queued' BEFORE 'draft';
ALTER TYPE artifact_status ADD VALUE 'processing' BEFORE 'draft';
ALTER TYPE artifact_status ADD VALUE 'failed' AFTER 'published';

-- Add index for async status queries
CREATE INDEX idx_artifacts_intent_status ON artifacts(intent_id, status) 
WHERE status IN ('queued', 'processing', 'failed');

-- Add correlation_id column for WebSocket subscription tracking
ALTER TABLE artifacts ADD COLUMN correlation_id UUID;
CREATE INDEX idx_artifacts_correlation ON artifacts(correlation_id) WHERE correlation_id IS NOT NULL;
```

### Phase 2: Message Production (Orbit 2)

**New Files:**

1. **Queue Schemas** (`src/services/queue/schemas.ts`)
   ```typescript
   export interface QueueMessage<T> {
     version: '1.0';
     messageId: string;
     timestamp: string;
     userId: string;
     intentId: string;
     trajectoryId: string;
     correlationId: string;
     payload: T;
   }

   export interface ArtifactGenerationPayload {
     artifactType: 'context_package' | 'proposal' | 'test_suite' | 'deployment_plan';
     orbitNumber: number;
     entityContext: {
       project: { id: string; name: string; description: string };
       trajectory: { id: string; name: string; description: string };
       intent: { id: string; title: string; outcome: string; constraints: string; acceptance: string };
       orbit: { id: string; number: number; phase: string; summary: string };
     };
     skillReference: string;
   }

   export interface ChatMessagePayload {
     messageContent: string;
     conversationHistory: Array<{ role: string; content: string }>;
     systemPrompt: string;
     maxTokens: number;
   }
   ```

2. **Queue Producer** (`src/services/queue/producer.ts`)
   - `enqueueArtifactGeneration()`: constructs QueueMessage, sends to SQS with retry logic
   - `enqueueChatMessage()`: constructs chat payload, sends to SQS
   - Error handling: retry on throttling (3 attempts), fail fast on invalid payload

**Modified Files:**

1. **`src/functions/artifacts/create.ts`**
   - Replace direct Bedrock invocation with SQS enqueue
   - Insert artifact record with status='queued' and correlation_id
   - Return 202 Accepted with: `{ correlationId, status: 'queued', estimatedCompletionSeconds: 120 }`
   - Publish `artifact.queued` WebSocket event immediately

2. **`src/functions/chat/message.ts`**
   - Replace direct Bedrock invocation with SQS enqueue
   - Store chat message with status='pending' in DSQL
   - Return 202 Accepted with correlation_id for WebSocket subscription

### Phase 3: Worker Implementation (Orbit 3)

**New Files:**

1. **Worker Dockerfile** (`Dockerfile.worker`)
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY src/ ./src/
   COPY tsconfig.json ./
   RUN npm run build
   CMD ["node", "dist/workers/artifact-generator.js"]
   ```

2. **Artifact Generator Worker** (`src/workers/artifact-generator.ts`)
   - Main loop: poll SQS with 20-second long polling
   - Message validation: schema check, idempotency key lookup in DSQL
   - Processing flow:
     1. Parse QueueMessage payload
     2. Update artifact status to 'processing', publish WebSocket event
     3. Invoke Bedrock with skill-specific prompt construction
     4. Aggregate full response (no streaming)
     5. Write artifact JSON to S3 with server-side encryption
     6. Update DSQL artifact record: s3_location, token_count, status='completed', completed_at
     7. Generate presigned URL (15-minute expiration)
     8. Publish `artifact.completed` WebSocket event with URL
     9. Delete SQS message
   - Error handling: catch, log, publish `artifact.failed` event, do NOT delete message (retry via visibility timeout)

3. **Chat Processor Worker** (`src/workers/chat-processor.ts`)
   - Similar flow to artifact generator
   - Stores chat response in DSQL `messages` table instead of S3
   - Publishes `chat.response` WebSocket event with message content inline (no presigned URL)

4. **Bedrock Handler** (`src/workers/handlers/bedrock-handler.ts`)
   - Invokes `bedrock-runtime:InvokeModel` with Claude 3.5 Sonnet
   - Retry logic: exponential backoff (1s, 2s, 4s, 8s, 16s, 32s max) with jitter
   - Throttling detection: retry on 429 status
   - Token counting: extract from response metadata, store in DSQL

5. **Storage Handler** (`src/workers/handlers/storage-handler.ts`)
   - `writeArtifactToS3()`: S3 PutObject with metadata tags (user_id, intent_id, artifact_type, generated_at)
   - `updateArtifactMetadata()`: DSQL update transaction with optimistic locking (WHERE status='processing')
   - `generatePresignedUrl()`: S3 GetObject presigned URL with 15-minute expiration

**Modified Files:**

1. **`src/lib/websocket/events.ts`**
   - Add event schemas: `artifact.queued`, `artifact.processing`, `artifact.completed`, `artifact.failed`
   - Add event schema: `chat.processing`, `chat.response`, `chat.failed`

### Phase 4: Observability (Orbit 4)

**New Files:**

1. **CloudWatch Metrics** (`src/lib/observability/worker-metrics.ts`)
   - Custom metrics: `QueueDepth`, `TaskDuration`, `BedrockTokenCount`, `WebSocketPublishFailures`
   - Metric dimensions: IntentId, TrajectoryId, ArtifactType, Status

2. **CloudWatch Alarms** (`infrastructure/alarms.ts`)
   - Alarm: SQS queue depth > 50 for 5 minutes → SNS notification
   - Alarm: DLQ message count > 5 → SNS notification (critical)
   - Alarm: Fargate task failure rate > 10% → SNS notification
   - Alarm: WebSocket publish failure rate > 1% → SNS notification

**Modified Files:**

1. **`src/lib/observability/logger.ts`**
   - Extend with structured fields: `correlationId`, `phase`, `duration_ms`, `token_count`, `s3_location`
   - Ensure consistent format between Lambda and Fargate logs

### Phase 5: Client Fallback (Orbit 5)

**New Files:**

1. **Status Polling Endpoint** (`src/functions/artifacts/status.ts`)
   - `GET /artifacts/status/{correlationId}`
   - Query DSQL for artifact by correlation_id
   - Return: `{ status, s3_location?, presignedUrl?, error?, updatedAt }`
   - Used as fallback when WebSocket notification fails or connection drops

### Deployment Order

1. Deploy DSQL schema migration (verify with test query before proceeding)
2. Deploy SQS queues and DLQ
3. Build and push worker Docker image to ECR
4. Deploy Fargate task definition and ECS service (2 tasks initially)
5. Deploy modified Lambda functions with SQS producer logic
6. Deploy CloudWatch alarms
7. Deploy status polling endpoint
8. Run end-to-end test: create artifact, verify SQS message, observe Fargate logs, confirm WebSocket event, fetch presigned URL
9. Monitor for 24 hours with traffic shadowing (10% of requests) before full rollout

### Dependencies

**External:**
- Fargate cluster from T6-001 must exist and be healthy
- WebSocket infrastructure from T5-002 must support new event types
- Bedrock quota increase request approved (target: 50 requests/second for Claude Sonnet)

**Internal:**
- DSQL schema migration must complete before worker deployment
- Workers cannot start processing until Lambda functions deploy (prevent SQS message format mismatch)
- Status polling endpoint should deploy alongside workers for immediate fallback availability

---

## Risk Surface

### Edge Cases

1. **Idempotent Message Processing**
   - **Scenario:** Client retries HTTP request after timeout; Lambda sends duplicate SQS messages with same intent_id + artifact_type + orbit_number
   - **Mitigation:** Worker checks DSQL for existing artifact with matching composite key before processing; if found and status is 'completed', skip generation and delete message
   - **Test:** Send duplicate messages with 1-second delay; verify only one artifact generated

2. **SQS Message Visibility Timeout Expiration**
   - **Scenario:** Worker crashes after 20 minutes of processing (Bedrock extremely slow); message reappears in queue while original task still writing S3
   - **Mitigation:** Set visibility timeout to 1800 seconds (30 minutes), exceeding worst-case generation time; DSQL optimistic locking prevents duplicate writes (UPDATE WHERE status='processing')
   - **Test:** Simulate 25-minute Bedrock response; verify message does not reappear until task completes or crashes

3. **WebSocket Connection Closed During Processing**
   - **Scenario:** User closes browser tab while artifact generating; WebSocket connection terminates, notification fails
   - **Mitigation:** Worker logs publish failure but continues; artifact completes successfully; client polls status endpoint on reconnect
   - **Test:** Close WebSocket connection mid-generation; verify artifact completes; reconnect and query status endpoint

4. **S3 Presigned URL Expiration**
   - **Scenario:** Client receives WebSocket notification but delays download; presigned URL expires after 15 minutes
   - **Mitigation:** Status endpoint generates fresh presigned URL on each request; client can request new URL indefinitely
   - **Test:** Wait 20 minutes after completion; request status endpoint; verify new presigned URL works

5. **Bedrock Model Unavailable**
   - **Scenario:** Bedrock API returns 503 Service Unavailable (maintenance window)
   - **Mitigation:** Worker retries with exponential backoff up to 5 attempts; if all fail, message returns to queue after visibility timeout; after 3 queue cycles, message moves to DLQ
   - **Test:** Mock Bedrock 503 responses; verify worker retries, message cycles, and DLQ delivery

### Regressions

1. **Existing Synchronous Endpoint Breakage**
   - **Risk:** Clients using `POST /artifacts` expecting immediate response receive 202 Accepted and break
   - **Mitigation:** Deploy new endpoint at `/artifacts/async` first; leave synchronous endpoint operational with deprecation warning header; after 30-day migration period, synchronous endpoint returns 410 Gone
   - **Test:** Call old endpoint; verify response includes `Warning: 299` header with migration instructions

2. **WebSocket Connection Table Schema**
   - **Risk:** Adding `correlationId` to connections table breaks existing connection logic
   - **Mitigation:** Make `correlationId` optional (nullable column); existing connections without correlation_id continue to receive broadcast events; new connections include correlation_id for filtered subscriptions
   - **Test:** Establish connection without correlation_id; verify existing functionality; establish connection with correlation_id; verify filtered events

3. **Artifact Metadata Queries**
   - **Risk:** Queries filtering by `status='draft'` miss artifacts in `queued`, `processing` states
   - **Mitigation:** Update all queries to include new statuses: `WHERE status IN ('draft', 'queued', 'processing', 'completed')`; add migration script to audit and fix existing query logic
   - **Test:** Query artifacts by intent_id; verify results include all statuses

### Security

1. **SQS Message Payload Injection**
   - **Risk:** Attacker intercepts SQS message, modifies `userId` or `intentId`, gains unauthorized access to artifacts
   - **Mitigation:** SQS messages encrypted at rest with KMS; message payload includes HMAC signature computed with service secret; worker validates signature before processing
   - **Test:** Modify message payload after enqueue; verify worker rejects with signature mismatch error

2. **Presigned URL Exposure**
   - **Risk:** Presigned URL leaked (browser history, logs, referrer headers) allows unauthorized artifact download
   - **Mitigation:** Presigned URLs expire after 15 minutes; S3 object metadata includes `user_id` tag; CloudWatch log filter detects suspicious access patterns (same URL accessed from multiple IPs)
   - **Test:** Share presigned URL with unauthorized user; verify access succeeds (expected) but logs suspicious pattern; wait 20 minutes; verify URL returns 403

3. **Fargate Task IAM Role Privilege Escalation**
   - **Risk:** Compromised worker task uses over-permissioned IAM role to access unrelated resources
   - **Mitigation:** Task role restricted to resource-level permissions: `s3:PutObject` only on `arn:aws:s3:::prometheus-artifacts/*`; `bedrock:InvokeModel` only on `arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-3-5-sonnet-*`; no wildcard permissions
   - **Test:** Attempt S3 write outside permitted prefix; verify 403 error; attempt Bedrock invoke on different model; verify permission denied

4. **DSQL Injection via Queue Payload**
   - **Risk:** Malicious payload includes SQL injection in `artifactType` or `intentId` fields
   - **Mitigation:** Parameterized queries exclusively (no string concatenation); input validation schema (Zod) rejects payloads with non-alphanumeric intent IDs or invalid artifact types
   - **Test:** Send message with `intentId="'; DROP TABLE artifacts;--"`; verify payload rejected at schema validation stage

### Performance

1. **Cold Start Latency**
   - **Concern:** Fargate task cold start (8-12 seconds) adds delay before processing begins
   - **Mitigation:** Maintain 2 warm tasks at all times (ECS desired count = 2); optimize Docker image size (<500MB); pre-load AWS SDK v3 at module initialization
   - **Target:** P95 time-from-enqueue-to-first-Bedrock-API-call < 15 seconds
   - **Test:** Deploy to cold cluster; measure latency from SQS send to first Bedrock log entry

2. **SQS Long Polling Efficiency**
   - **Concern:** 20-second long polling introduces latency when queue is empty; task idle, wasting vCPU-hours
   - **Mitigation:** Acceptable tradeoff; long polling reduces API request costs and avoids tight polling loops; 20-second delay negligible compared to multi-minute generation time
   - **Target:** Queue depth = 0 for >80% of time (indicating efficient processing)
   - **Test:** Monitor SQS `ApproximateNumberOfMessagesVisible` metric over 24 hours

3. **Bedrock Quota Exhaustion**
   - **Concern:** 10 concurrent tasks * 1 request/task = 10 requests/second; default Claude Sonnet quota is 10 requests/second; tasks throttled, retries amplify load
   - **Mitigation:** Request quota increase to 50 requests/second before production deployment; implement jittered exponential backoff (random delay 0-2s before first retry)
   - **Target:** Bedrock throttling rate < 1% of requests
   - **Test:** Simulate 20 concurrent tasks; verify throttling rate and retry success

4. **WebSocket API Throttling**
   - **Concern:** Worker publishes 3 events per artifact (queued, processing, completed); 10 concurrent generations = 30 events/minute; API Gateway WebSocket has 1000 messages/second/connection limit
   - **Mitigation:** Publish events serially (await each PostToConnection before next); batch notifications for multiple subscribers to same correlation_id
   - **Target:** WebSocket publish failure rate < 0.1%
   - **Test:** Generate 100 artifacts concurrently; verify all WebSocket events delivered

5. **DSQL Connection Pool Exhaustion**
   - **Concern:** 10 Fargate tasks * 5 connections/task = 50 concurrent DSQL connections; default Aurora DSQL limit is 100 connections
   - **Mitigation:** Configure pgBouncer connection pooling with transaction mode (connections released after each query); limit per-task connections to 2 (1 active + 1 spare)
   - **Target:** DSQL connection pool utilization < 70%
   - **Test:** Deploy 10 tasks; monitor Aurora connection count; verify no connection refused errors

---

## Scope Estimate

### Orbit Breakdown

| Orbit | Phase | Estimated Duration | Complexity |
|-------|-------|-------------------|-----------|
| 1 | Foundation Infrastructure | 4 hours | Medium — CDK constructs for SQS, Fargate task definition, ECS service; DSQL migration with new status enum and indexes |
| 2 | Message Production | 3 hours | Low — straightforward SQS client integration; modify existing Lambda functions to enqueue instead of invoke Bedrock |
| 3 | Worker Implementation | 8 hours | High — core processing loop, Bedrock invocation with retry logic, S3/DSQL writes, WebSocket publishing; comprehensive error handling |
| 4 | Observability | 2 hours | Low — CloudWatch metrics and alarms using established patterns; log format standardization |
| 5 | Client Fallback | 2 hours | Low — single GET endpoint for status polling; simple DSQL query and response formatting |
| **Total** | | **19 hours** | **Medium-High** |

### Complexity Justification

**Medium-High** because:
- Introduces new execution model (async task-based) requiring mental model shift from synchronous Lambda
- Coordination between multiple services (Lambda, SQS, Fargate, S3, DSQL, WebSocket) increases integration complexity
- Error handling spans distributed system (message loss, task crashes, notification failures) requiring idempotency and retry logic throughout
- IAM permissions span 5 services with resource-level restrictions, increasing security review surface
- However, leverages existing infrastructure (VPC, WebSocket, DSQL) and established patterns (structured logging, metric publishing)

### Files Affected

| Category | Files Created | Files Modified | Total |
|----------|---------------|----------------|-------|
| Infrastructure | 4 | 1 | 5 |
| Application | 8 | 4 | 12 |
| Tests | 6 | 0 | 6 |
| **Total** | **18** | **5** | **23** |

### Test Coverage

| Test Type | Count | Description |
|-----------|-------|-------------|
| Unit Tests | 12 | Queue producer, message schema validation, Bedrock handler, storage handler, idempotency checks |
| Integration Tests | 8 | End-to-end flow from Lambda to Fargate to S3/DSQL/WebSocket; SQS message lifecycle; error scenarios |
| Load Tests | 3 | Concurrent task processing, Bedrock throttling simulation, WebSocket fanout |
| Security Tests | 5 | IAM role restriction validation, payload injection attempts, presigned URL expiration |
| **Total** | **28** | |

---

## Human Modifications

Pending human review.