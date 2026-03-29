# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2026-03-12  
**Intent:** T6-003  
**Orbit:** 1  
**Phase:** Context  
**Package Type:** intent-specific

---

## Codebase References

### Current Repository State

**Existing Files:**
- `README.md` — repository documentation
- `backend/api/properties/search.js` — sample HTTP API endpoint (Node.js)
- `backend/database/queries/property-search.sql` — sample SQL query

**Note:** The current repository contains a minimal property search sample application. The Prometheus V1 AI orchestration platform codebase referenced in the intent is not present in this repository. The following references describe the expected structure for the Fargate migration based on typical Lambda + Fargate + SQS patterns.

### Files to Create

**Infrastructure as Code (Terraform/CDK expected):**
- `infrastructure/fargate/task-definition.tf` — ECS task definition for LLM processing containers
- `infrastructure/fargate/ecs-cluster.tf` — Fargate cluster configuration
- `infrastructure/sqs/llm-queue.tf` — SQS queue for task distribution
- `infrastructure/sqs/dlq.tf` — Dead letter queue for failed tasks
- `infrastructure/iam/fargate-execution-role.tf` — IAM role for task execution
- `infrastructure/iam/fargate-task-role.tf` — IAM role for runtime permissions

**Application Code:**
- `backend/handlers/artifact-generation-enqueue.js` — Lambda function to accept HTTP requests and enqueue SQS messages
- `backend/handlers/chat-enqueue.js` — Lambda function to handle chat requests and enqueue
- `backend/workers/fargate-task-processor/` — Container application directory
  - `backend/workers/fargate-task-processor/Dockerfile` — Container image definition
  - `backend/workers/fargate-task-processor/index.js` — Main task processing entry point
  - `backend/workers/fargate-task-processor/handlers/artifact-generation.js` — Artifact generation logic
  - `backend/workers/fargate-task-processor/handlers/chat-processing.js` — Chat processing logic
  - `backend/workers/fargate-task-processor/lib/sqs-client.js` — SQS message polling and deletion
  - `backend/workers/fargate-task-processor/lib/llm-client.js` — LLM API integration
  - `backend/workers/fargate-task-processor/lib/websocket-notifier.js` — WebSocket event publishing
  - `backend/workers/fargate-task-processor/lib/storage-client.js` — S3 and DSQL persistence

**Observability:**
- `backend/workers/fargate-task-processor/lib/logger.js` — Structured logging with correlation IDs
- `infrastructure/monitoring/cloudwatch-dashboard.tf` — Metrics dashboard definition
- `infrastructure/monitoring/alarms.tf` — CloudWatch alarms for queue depth, task failures, duration

### Files to Modify

**Existing Lambda Functions (assumed to exist in actual codebase):**
- Location unknown in current repository — Lambda functions currently handling artifact generation and chat synchronously will need modification to:
  - Validate request
  - Generate correlation ID
  - Construct SQS message payload
  - Return 202 Accepted with task tracking ID
  - Maintain backward compatibility via feature flag

---

## Architecture Context

### Current Architecture (Inferred from Intent)

**Synchronous Lambda Execution Model:**
- API Gateway → Lambda (artifact generation or chat)
- Lambda invokes LLM API directly (Bedrock or external provider)
- Lambda processes response and returns to client
- **Problem:** Lambda 15-minute timeout fails for long-running LLM operations

### Target Architecture (Post-Migration)

**Asynchronous Task Processing Model:**

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP POST /api/generate-artifact
       ▼
┌─────────────────┐
│  API Gateway    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Lambda (Enqueue Handler)            │
│ - Validate request                  │
│ - Generate correlation ID           │
│ - Publish to SQS                    │
│ - Return 202 Accepted + tracking ID │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   SQS Queue     │
│ (Visibility: 30m)│
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Fargate Task (ECS)                   │
│ - Poll SQS                           │
│ - Process LLM request                │
│ - Handle retries                     │
│ - Store result (S3 + DSQL)           │
│ - Publish WebSocket event            │
│ - Delete message from SQS            │
└────────┬─────────────────────────────┘
         │
         ├─────────────┬──────────────┐
         ▼             ▼              ▼
    ┌────────┐   ┌─────────┐   ┌──────────┐
    │   S3   │   │  DSQL   │   │WebSocket │
    │(Artifact)│   │(Metadata)│   │   API    │
    └────────┘   └─────────┘   └─────┬────┘
                                      │
                                      ▼
                                ┌──────────┐
                                │  Client  │
                                │(Progress)│
                                └──────────┘
```

**Critical Data Flow:**

1. **HTTP Request → Lambda:** Client sends POST with artifact generation request. Lambda validates, generates UUID correlation ID, constructs SQS message with payload.
2. **Lambda → SQS:** Message contains `{ correlationId, userId, intentId, operationType: "artifact_generation", payload: {...} }`. Lambda returns `202 Accepted` with `{ taskId: correlationId, status: "queued" }`.
3. **SQS → Fargate:** ECS task polls queue with long polling (WaitTimeSeconds=20). Receives message, sets visibility timeout to 30 minutes.
4. **Fargate Processing:** Task invokes LLM API (Bedrock Claude), streams tokens, assembles response. On success: writes artifact to S3, writes metadata to DSQL, publishes WebSocket event `{ taskId, status: "completed", artifactUrl }`. Deletes SQS message.
5. **Error Handling:** On LLM API failure or processing error: logs error with correlation ID, does NOT delete message (allows retry after visibility timeout). After 3 failures (via SQS Receive Count), message routes to DLQ.
6. **Timeout Protection:** Task monitors elapsed time. At 28 minutes, if still processing, task publishes WebSocket event `{ taskId, status: "timeout", partialResult }`, logs timeout, deletes message to prevent reprocessing.

**Service Boundaries:**
- **Lambda:** Request validation, authorization (JWT), SQS enqueue only. No LLM interaction.
- **Fargate:** LLM interaction, long-running processing, result persistence, WebSocket notifications. No HTTP request handling.
- **SQS:** Decoupling layer with at-least-once delivery guarantee. Message retention 4 days.
- **WebSocket API:** Real-time event delivery to client. Connection managed separately (not in scope for this intent).

**Infrastructure Constraints:**
- **Region:** Must use region with Fargate capacity for 4 vCPU tasks
- **VPC:** Fargate tasks run in private subnets with NAT Gateway for LLM API egress
- **IAM:** Principle of least privilege — task role limited to SQS read/delete, S3 write (specific bucket prefix), DSQL write (specific table), Bedrock invoke (specific model), CloudWatch Logs write
- **Cost Control:** ECS Service configured with task count limits (min=0, max=10). Auto-scaling based on SQS queue depth (target=2 tasks per 10 messages).

---

## Pattern Library

### SQS Message Structure (Standard Pattern)

```json
{
  "correlationId": "uuid-v4",
  "userId": "string",
  "projectId": "string",
  "intentId": "string",
  "operationType": "artifact_generation | chat_processing",
  "payload": {
    "promptTemplate": "string",
    "context": null,
    "modelConfig": {
      "temperature": 0.7,
      "maxTokens": 4000
    }
  },
  "metadata": {
    "enqueuedAt": "ISO-8601 timestamp",
    "apiVersion": "v1"
  }
}
```

### Lambda Response Format (Async Task Accepted)

```json
{
  "status": "accepted",
  "taskId": "correlation-id-from-sqs-message",
  "estimatedCompletionTime": "ISO-8601 timestamp (+15 minutes estimate)",
  "statusUrl": "/api/tasks/{taskId}/status"
}
```

### WebSocket Event Format

```json
{
  "event": "task_progress | task_completed | task_failed",
  "taskId": "correlation-id",
  "timestamp": "ISO-8601",
  "data": {
    "progress": 0.75,
    "message": "Generating section 3 of 4",
    "artifactUrl": "https://s3.../artifact.md" // only on completion
  }
}
```

### Structured Logging (CloudWatch Logs)

```json
{
  "timestamp": "ISO-8601",
  "level": "INFO | WARN | ERROR",
  "correlationId": "uuid",
  "service": "fargate-task-processor",
  "operation": "artifact_generation",
  "message": "Human-readable message",
  "duration_ms": 12450,
  "metadata": {
    "userId": "string",
    "modelInvoked": "claude-3-sonnet",
    "tokensUsed": 3500
  }
}
```

### Error Response Format (Lambda/WebSocket)

```json
{
  "error": {
    "code": "TASK_ENQUEUE_FAILED | LLM_API_TIMEOUT | PROCESSING_ERROR",
    "message": "Human-readable error description",
    "correlationId": "uuid",
    "retryable": true | false
  }
}
```

### Fargate Task Dockerfile Pattern

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Non-root user for security
RUN addgroup -g 1001 -S appuser && 
    adduser -S -u 1001 -G appuser appuser
USER appuser

CMD ["node", "index.js"]
```

### IAM Policy Structure (Fargate Task Role)

- **SQS:** `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` on queue ARN only
- **S3:** `s3:PutObject`, `s3:PutObjectAcl` on `arn:aws:s3:::artifacts-bucket/user-artifacts/*` prefix
- **Bedrock:** `bedrock:InvokeModel` on specific model ARN (e.g., `claude-3-sonnet`)
- **CloudWatch:** `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` on `/ecs/llm-processor` log group
- **DSQL:** Appropriate write permissions (schema-specific, not detailed in current context)

### Naming Conventions

- **SQS Queue:** `prometheus-{env}-llm-processing-queue`
- **DLQ:** `prometheus-{env}-llm-processing-dlq`
- **ECS Cluster:** `prometheus-{env}-fargate-cluster`
- **Task Definition:** `prometheus-llm-processor`
- **S3 Bucket:** `prometheus-{env}-artifacts-{account-id}`
- **CloudWatch Log Group:** `/ecs/prometheus-llm-processor`

---

## Prior Orbit References

**No prior orbits exist in this trajectory.** This is orbit 1 of intent T6-003, which is the first intent in the "Container Infrastructure (Fargate)" trajectory.

### Relevant Context from Project

- **Project:** Prometheus V1 implements the ORBITAL framework for AI-native development orchestration
- **Trust Tier 2 Assignment:** This orbit requires human review before deployment due to introduction of new asynchronous execution model in revenue-adjacent flows
- **Existing Infrastructure Assumptions:** Based on acceptance criteria and constraints:
  - WebSocket API already exists for real-time notifications
  - Lambda-based artifact generation and chat endpoints currently exist (facing timeout issues)
  - S3 bucket for artifact storage exists
  - DSQL database exists for metadata persistence
  - LLM API access (Bedrock or external) is already configured

### Known Issues to Address

- **Lambda Timeout Failures:** Current synchronous Lambda execution fails for LLM operations exceeding 15 minutes (implied by intent desired outcome)
- **No Existing Async Pattern:** This orbit introduces the first asynchronous task processing pattern into the platform
- **Cost Control Required:** Constraint explicitly requires CPU/memory limits and 30-minute forced termination

---

## Risk Assessment

### Critical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| **SQS Message Loss** | High — User task never completes, no error surfaced | Low | • DLQ configured with 4-day retention<br>• CloudWatch alarm on DLQ depth >0<br>• SQS message retention 4 days (exceeds Fargate max task duration)<br>• Idempotency: store task status in DSQL on enqueue, check before processing |
| **Fargate Cold Start Delays** | Medium — First task takes 60s to start, poor UX | Medium | • Pre-warm ECS service with min=1 task during business hours<br>• WebSocket event immediately after enqueue: "Task queued, starting processor..."<br>• Set user expectation: "This may take a few minutes" |
| **Task Runaway / Cost Overrun** | High — Task loops indefinitely, racks up charges | Low | • ECS task definition: hard timeout at 30 minutes (stopTimeout)<br>• Application-level timeout: monitor elapsed time, force-exit at 28 minutes<br>• CloudWatch alarm on task duration >30m<br>• Budget alert on Fargate spend |
| **WebSocket Connection Lost** | Medium — User misses completion notification | Medium | • Store task status in DSQL, queryable via HTTP GET /api/tasks/{id}<br>• Client polls status endpoint as fallback if WebSocket disconnects<br>• Retry WebSocket publish 3x with exponential backoff |
| **LLM API Rate Limiting** | Medium — Tasks fail due to provider rate limits | Medium | • Implement exponential backoff with jitter in Fargate task<br>• SQS visibility timeout allows automatic retry after backoff period<br>• CloudWatch metric on LLM API 429 errors<br>• Consider token bucket pattern if rate limits become chronic |

### Security Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Secrets in Logs** | Critical — LLM API keys exposed | • Never log request payloads containing secrets<br>• Use AWS Secrets Manager, inject at runtime via ECS task definition<br>• Structured logging sanitizes sensitive fields |
| **Unauthorized Task Submission** | High — Malicious actor enqueues expensive tasks | • Lambda validates JWT before enqueuing<br>• SQS queue policy restricts PutMessage to specific Lambda role ARN<br>• Rate limiting on Lambda endpoint (API Gateway throttling) |
| **Fargate Task Privilege Escalation** | High — Compromised task accesses unrelated data | • IAM task role scoped to specific S3 prefix, DSQL table, SQS queue<br>• Fargate task runs as non-root user<br>• No IMDSv1 access (use IMDSv2 with hop limit=1) |
| **Message Replay Attack** | Medium — Attacker replays captured SQS message | • Idempotency check: before processing, check DSQL if taskId already completed<br>• SQS encryption at rest (constraint requirement)<br>• Consider message signing (future enhancement) |

### Performance Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **SQS Polling Latency** | Medium — 10s delay violates acceptance | • Long polling: WaitTimeSeconds=20 in ReceiveMessage<br>• Multiple concurrent tasks polling (auto-scaling based on queue depth)<br>• CloudWatch metric on message age in queue |
| **S3 Write Latency** | Low — Artifact storage delays completion | • Use S3 Transfer Acceleration if enabled<br>• Write to S3 asynchronously while preparing WebSocket event<br>• Consider multipart upload for large artifacts |
| **DSQL Write Contention** | Low — High concurrency causes write failures | • Implement retry logic with exponential backoff<br>• Monitor DSQL throttling metrics<br>• Consider batching metadata writes (if applicable) |

### Operational Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Failed Rollback** | Critical — Cannot revert to Lambda-only | • Feature flag at enqueue handler: `ENABLE_FARGATE_PROCESSING=true/false`<br>• If false, Lambda processes synchronously (original behavior)<br>• Gradual rollout: enable for 10% of users, monitor, scale to 100%<br>• CloudWatch dashboard compares Lambda vs. Fargate success rates |
| **Fargate Capacity Exhaustion** | High — ECS cannot launch new tasks | • ECS Service max task count limit prevents runaway scaling<br>• CloudWatch alarm on ECS cluster capacity utilization >80%<br>• Use multiple AZs for task placement<br>• Document procedure: increase task limits requires IAM permission update |
| **DLQ Saturation** | Medium — DLQ fills with failed messages, no visibility | • CloudWatch alarm on DLQ depth >10<br>• Automated runbook: SNS notification to on-call with link to DLQ console<br>• Weekly scheduled Lambda to process DLQ, log failures, purge after 30 days |

### Data Integrity Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Partial Write on Task Crash** | Medium — S3 has artifact, DSQL missing metadata | • Task failure detection: if message deleted but no DSQL write, DLQ capture allows retry<br>• Health check: periodic scan of S3 artifacts without DSQL entry, trigger reconciliation<br>• Write DSQL metadata before S3 (fail early) |
| **Duplicate Task Execution** | Low — Same artifact generated twice (wasted cost) | • Idempotency check in Fargate task: query DSQL for taskId before LLM invocation<br>• If exists with status=completed, skip processing, delete message<br>• If exists with status=in_progress and timestamp >30m ago, assume prior task died, proceed |

### Monitoring Gaps

- **No baseline metrics:** Current Lambda timeout rate unknown (need to instrument before migration to measure improvement)
- **Cost attribution:** No per-user or per-intent cost tracking for Fargate tasks (consider tagging with userId, intentId)
- **LLM token usage:** No visibility into token consumption per task (log this for cost forecasting)

---

## Recommended Next Steps for Orbit Execution

1. **Instrument Current Lambda Functions:** Add metrics for timeout rate, processing duration, LLM API latency (establish baseline)
2. **Create Infrastructure Definitions:** Terraform/CDK for SQS, Fargate cluster, task definition, IAM roles
3. **Build Fargate Container:** Dockerfile, processor application with SQS polling, LLM client, S3/DSQL persistence, WebSocket publishing
4. **Modify Lambda Handlers:** Enqueue logic with feature flag, maintain backward compatibility
5. **Deploy Observability:** CloudWatch dashboards, alarms, structured logging
6. **Test Idempotency:** Verify duplicate message handling, partial write recovery
7. **Gradual Rollout:** Feature flag enables Fargate for 10% traffic, monitor for 48 hours, scale to 100%
8. **Document Runbooks:** DLQ processing, task stuck in RUNNING state, Fargate capacity expansion