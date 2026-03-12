# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

## Codebase References

### Primary Surfaces (will be created or modified)

**Infrastructure (Terraform):**
- `infrastructure/fargate/task-definitions/artifact-generator.tf` — Fargate task definition for artifact generation workloads
- `infrastructure/fargate/task-definitions/ai-chat-processor.tf` — Fargate task definition for long-running chat sessions
- `infrastructure/sqs/artifact-queue.tf` — SQS queue for artifact generation jobs
- `infrastructure/sqs/chat-queue.tf` — SQS queue for AI chat processing jobs
- `infrastructure/iam/fargate-task-roles.tf` — IAM roles for Fargate tasks (S3, DSQL, Secrets Manager, Bedrock access)
- `infrastructure/cloudwatch/fargate-alarms.tf` — CloudWatch alarms for queue depth, task failure rate, DLQ age

**Backend API (Lambda):**
- `backend/api/artifacts/generate.js` — Existing artifact generation endpoint (modify to enqueue SQS message instead of synchronous LLM call)
- `backend/api/chat/message.js` — Existing chat endpoint (modify for async offload pattern)
- `backend/api/jobs/status.js` — New endpoint for polling job status (fallback if WebSocket unavailable)

**Fargate Task Containers:**
- `backend/workers/artifact-generator/` — New directory for Fargate task code
  - `index.js` — SQS message consumer, artifact generation orchestrator
  - `Dockerfile` — Container image definition
  - `package.json` — Node.js dependencies (AWS SDK v3, @anthropic-ai/sdk or equivalent)
- `backend/workers/chat-processor/` — New directory for chat processing task
  - `index.js` — SQS message consumer, multi-turn chat handler
  - `Dockerfile`
  - `package.json`

**Shared Libraries:**
- `backend/lib/job-tracker.js` — DSQL client for job status persistence (create/update job records)
- `backend/lib/websocket-notifier.js` — API Gateway WebSocket client for result notifications
- `backend/lib/s3-artifact-writer.js` — S3 client for artifact persistence with presigned URL generation

### Secondary Surfaces (dependencies and integrations)

**Database Schema (DSQL):**
- `backend/database/schema/jobs.sql` — Job tracking table definition
  - Columns: `job_id (UUID PK)`, `intent_id (UUID FK)`, `job_type (enum: artifact_generation, chat_session)`, `status (enum: pending, processing, completed, failed)`, `created_at`, `started_at`, `completed_at`, `result_s3_key`, `error_message`, `retry_count`

**S3 Buckets:**
- `prometheus-artifacts-{env}` — Artifact storage with lifecycle policies (referenced, not defined in repo)

**WebSocket Infrastructure (T6-002 dependency):**
- `backend/api/websocket/connection-manager.js` — WebSocket connection registry (must exist for notifications)
- `infrastructure/api-gateway/websocket.tf` — API Gateway WebSocket API definition

**Existing Authentication/Authorization:**
- `backend/middleware/auth.js` — JWT validation middleware (unchanged, but Fargate tasks bypass this for queue-driven work)

### Configuration and Secrets

- `infrastructure/secrets-manager/bedrock-credentials.tf` — Secrets Manager secret for Bedrock API keys (if not using IAM auth)
- `backend/config/fargate.js` — Fargate task configuration (queue URLs, S3 bucket names, DSQL endpoint)
- `.env.example` — Update with new environment variables for local Fargate task testing

## Architecture Context

### Current State: Lambda-Synchronous Pattern

Prometheus currently executes all AI operations synchronously within Lambda functions. When a user requests an artifact (Intent Document, Test Plan, Context Package), the API Gateway → Lambda → Bedrock → Lambda → API Gateway flow completes before the HTTP response returns. This creates three failure modes:

1. **Timeout failures:** Lambda 15-minute limit causes 504 errors on complex artifacts requiring multi-turn LLM reasoning
2. **Concurrency exhaustion:** Long-running LLM calls consume Lambda concurrency, throttling unrelated API requests
3. **Client timeout risk:** Frontend must wait for full artifact generation, leading to poor UX and retry storms

### Target State: Queue-Driven Async Pattern

The new architecture decouples HTTP request handling from LLM execution:

```
[Client] → [API Gateway] → [Lambda: Enqueue] → [SQS Queue] → [Fargate Task] → [Bedrock]
                ↓                                                        ↓
         [202 Accepted + Job ID]                              [S3 Artifact Write]
                                                                         ↓
         [WebSocket Connection] ← [API Gateway WS] ← [Lambda: Notify] ← [S3 Event]
```

**Data Flow:**

1. Client POSTs to `/intents/{id}/artifacts` with artifact type in request body
2. Lambda handler validates request, generates `job_id`, inserts `jobs` record (status: `pending`)
3. Lambda publishes SQS message: `{ job_id, intent_id, artifact_type, user_id }`
4. Lambda returns `202 Accepted` with `{ job_id, status: "pending", check_status_url }`
5. Fargate task polls SQS queue, receives message, updates job status to `processing`
6. Fargate task calls Bedrock API (potentially multiple rounds for complex artifacts)
7. Fargate task writes artifact to S3: `s3://prometheus-artifacts-{env}/{intent_id}/{artifact_type}-{job_id}.md`
8. Fargate task updates job status to `completed`, stores `result_s3_key`
9. Fargate task notifies WebSocket connection with presigned S3 URL
10. Client receives WebSocket event, fetches artifact from S3

**Failure Handling:**

- Fargate task crash or timeout → SQS message visibility timeout expires → message redelivers (max 3 attempts)
- After 3 retries → message moves to dead-letter queue → CloudWatch alarm fires → manual investigation
- Duplicate message delivery (SQS at-least-once) → `job_id` deduplication key prevents duplicate LLM calls (check `jobs` table before starting work)

**Service Boundaries:**

- **Lambda (API Layer):** Authentication, request validation, job creation, SQS enqueue, WebSocket notification dispatch
- **Fargate (Execution Layer):** LLM orchestration, artifact schema validation, S3 persistence, job status updates
- **DSQL:** Job state machine (pending → processing → completed/failed)
- **S3:** Immutable artifact storage with TTL-based cleanup
- **SQS:** Reliable message delivery with retry and DLQ semantics

**Infrastructure Constraints:**

- Fargate tasks run in **private subnets** with egress-only internet via NAT Gateway (Bedrock API calls)
- No inbound internet access to Fargate tasks (pull model from SQS)
- IAM task roles scoped to specific S3 prefixes: `prometheus-artifacts-{env}/{intent_id}/*`
- Fargate task definitions target **t4g.small equivalent** (2 vCPU, 4GB RAM) to stay within cost envelope
- Auto-scaling based on SQS `ApproximateNumberOfMessagesVisible` metric: scale out at >5 messages, scale to zero when queue empty
- CloudWatch Logs retention: 30 days for Fargate task logs, 90 days for SQS DLQ messages

## Pattern Library

### Established Patterns (from Prometheus codebase)

**1. CQRS with Intent Orientation:**
- Commands and queries are organized by intent lifecycle phase (create, refine, execute, verify)
- File structure: `backend/api/{domain}/{action}.js` (e.g., `backend/api/intents/create.js`, `backend/api/artifacts/generate.js`)
- Apply to Fargate workers: `backend/workers/{job-type}/index.js` as the command handler

**2. Artifact Schema Adherence:**
- All artifacts follow markdown-with-frontmatter schema defined in `docs/artifact-schemas/{type}.md`
- Validation happens in shared library: `backend/lib/artifact-validator.js` (create if missing)
- Fargate tasks MUST validate generated artifacts against schema before S3 write

**3. Job State Machine Pattern:**
- Job status transitions: `pending → processing → completed` OR `pending → processing → failed`
- State transitions are atomic DSQL updates with `updated_at` timestamp
- Never skip states (e.g., pending → completed without processing)

**4. Correlation ID Propagation:**
- All API requests carry `x-correlation-id` header (generated by API Gateway or client)
- Lambda handlers log correlation ID at INFO level: `{ correlationId, event: "job_enqueued", jobId }`
- SQS messages include correlation ID in message attributes: `MessageAttributes: { CorrelationId: { DataType: "String", StringValue: correlationId } }`
- Fargate tasks extract correlation ID from SQS message and log with every structured log entry

**5. Secrets Retrieval at Runtime:**
- No credentials in environment variables or Dockerfile
- Secrets Manager client fetches secrets on task startup: `const bedrockKey = await getSecret("prometheus/bedrock-api-key")`
- Cache secrets in memory for task lifetime (no refetch on every LLM call)

**6. Presigned URL Generation:**
- S3 artifacts are never publicly readable
- API generates presigned URLs with 1-hour expiration for GET operations
- WebSocket notification payload includes presigned URL: `{ event: "artifact_ready", job_id, artifact_url }`

### Anti-Patterns (avoid these)

**1. Lambda-style polling from Fargate:**
- Do NOT poll SQS from Lambda handlers — use Lambda SQS event source mapping
- Do NOT poll SQS from Fargate with short-polling intervals — use long-polling (20-second WaitTimeSeconds)

**2. Synchronous LLM calls in Lambda:**
- Do NOT call Bedrock synchronously from API handlers after this change
- Existing Lambda-based artifact generation must be deprecated or moved to Fargate

**3. Unbounded retry loops:**
- Do NOT implement infinite retry logic in Fargate tasks — rely on SQS DLQ after max retries
- Do NOT retry on non-retryable Bedrock errors (e.g., invalid model ID, content policy violation)

**4. Direct S3 links in responses:**
- Do NOT return raw S3 URLs in API responses — always use presigned URLs
- Do NOT expose S3 bucket structure in client-facing payloads

## Prior Orbit References

### Orbit 1 (Current Orbit)

This is the first orbit for Intent T6-003. No prior orbit learnings exist. Baseline context:

- **Lambda-based artifact generation:** Current implementation (not in provided repo structure but referenced in intent) lives in `backend/api/artifacts/generate.js`. This handler calls Bedrock synchronously and returns artifact content in HTTP response. Pattern to migrate: enqueue job instead of blocking.

### Related Prior Intents (from Trajectory)

- **T6-002 (WebSocket Infrastructure):** Upstream dependency. Orbit status unknown but intent assumes WebSocket connection manager exists. If incomplete, fallback pattern required: `/api/jobs/{job_id}/status` polling endpoint for clients without WebSocket support.

- **T6-001 (ECS/Fargate Foundation):** Assumed complete. If this intent exists, it should have established Fargate cluster, VPC subnets, IAM base roles, and CloudWatch log groups. Reference its Terraform modules for reuse.

### Known Technical Debt (from repository inference)

- **No structured logging framework:** If Prometheus lacks a structured logging library (e.g., `pino`, `winston`), Fargate tasks will emit unstructured logs to CloudWatch. Priority: introduce structured logging before Fargate rollout to enable log aggregation and alerting.

- **No job deduplication strategy:** If `jobs` table lacks unique constraint on `job_id`, duplicate SQS message processing could create duplicate artifacts and double-charge LLM API usage. Mitigation: add UNIQUE constraint on `job_id` column in `jobs.sql`.

## Risk Assessment

### Operational Risks

**1. SQS Message Loss (Low Probability, High Impact)**

**Risk:** SQS delivers message, Fargate task crashes before updating job status, message exceeds max retries and moves to DLQ without completion.

**Impact:** User never receives artifact, sees "pending" status forever. No automatic recovery.

**Mitigations:**
- DLQ alarm fires within 5 minutes of message arrival (CloudWatch alarm → SNS → PagerDuty)
- Manual DLQ reprocessing script: `backend/scripts/replay-dlq.js` (resubmit to primary queue with increased retry count)
- Job status dashboard shows "stuck pending" jobs older than 30 minutes (CloudWatch Insights query)

**2. WebSocket Connection Lost During Processing (Medium Probability, Low Impact)**

**Risk:** User closes browser tab or network drops WebSocket connection before artifact completion. Notification event is lost.

**Impact:** User must manually refresh or check job status via polling endpoint.

**Mitigations:**
- Implement `/api/jobs/{job_id}/status` polling endpoint as fallback (documented in API reference)
- Frontend retries WebSocket connection on disconnect, resubscribes to job ID
- Job status persisted in DSQL — client can always query latest status

**3. Fargate Cold Start Latency Spike (High Probability, Low Impact)**

**Risk:** First Fargate task in idle cluster takes 60+ seconds to start (ECS task provisioning, image pull, container startup).

**Impact:** User sees longer-than-expected "pending" duration for first job after idle period.

**Mitigations:**
- Set SQS visibility timeout to 120 seconds (allows cold start without premature retry)
- CloudWatch metric tracks "time to first log line" as proxy for cold start duration
- Consider Fargate Spot for cost optimization, accept occasional 2-minute interruptions (tolerable for async work)

### Security Risks

**4. Overly Permissive IAM Task Role (Medium Probability, High Impact)**

**Risk:** Fargate task role grants `s3:*` or cross-intent data access, allowing artifact leakage or PII exposure.

**Impact:** Data breach, compliance violation, loss of tenant isolation.

**Mitigations:**
- IAM policy MUST use resource-based constraints: `arn:aws:s3:::prometheus-artifacts-{env}/${intent_id}/*`
- Terraform `aws_iam_policy_document` with explicit `Condition` blocks for intent-level isolation
- Automated policy review via `terraform plan` output check — fail CI if wildcard `*` resources detected
- Tier 2 (Supervised) requires human review of IAM policy before merge

**5. Secrets Leakage in CloudWatch Logs (Low Probability, Critical Impact)**

**Risk:** Fargate task logs Bedrock API key or internal service credentials to CloudWatch.

**Impact:** Credential exposure, unauthorized API usage, billing fraud.

**Mitigations:**
- Implement secrets redaction in logging framework: mask any string matching regex `/sk-[A-Za-z0-9]{40}/`
- Enable CloudWatch Logs encryption at rest (KMS key)
- IAM policy denies `logs:GetLogEvents` for Fargate task role (tasks write logs but cannot read them)
- Secrets Manager rotation policy: rotate Bedrock credentials every 90 days

### Performance Risks

**6. Bedrock API Throttling Under Load (High Probability, Medium Impact)**

**Risk:** Concurrent Fargate tasks exceed Bedrock service quota (e.g., 10 requests/second), causing 429 throttling errors.

**Impact:** Job failures, SQS retries, increased DLQ volume, user-visible delays.

**Mitigations:**
- Implement exponential backoff with jitter in Fargate task Bedrock client (AWS SDK v3 includes this by default)
- Request Bedrock quota increase to 50 requests/second before production rollout
- CloudWatch alarm on Bedrock throttle rate (`Throttles` metric from CloudWatch Logs Insights)
- SQS queue depth metric triggers alarm at >50 messages (indicates backlog from throttling)

**7. S3 Eventual Consistency Delays (Low Probability, Low Impact)**

**Risk:** Fargate task writes artifact to S3, immediately notifies WebSocket, client fetches presigned URL but S3 returns 404 (eventual consistency delay).

**Impact:** User sees "artifact ready" notification but download fails. Requires manual retry.

**Mitigations:**
- S3 read-after-write consistency for PUTs (AWS S3 strong consistency since Dec 2020) eliminates this risk in most regions
- If using cross-region replication, add 5-second delay between S3 write and WebSocket notification
- Presigned URL includes `x-amz-request-id` for debugging 404 errors

### Cost Risks

**8. Runaway Fargate Task Duration (Medium Probability, High Impact)**

**Risk:** Bug in artifact generation logic causes infinite loop, Fargate task runs for hours, burns through cost budget.

**Impact:** Unexpected $500+ AWS bill, cost alert fatigue, budget exhaustion.

**Mitigations:**
- Fargate task definition includes `stopTimeout: 30m` (hard limit on task duration)
- CloudWatch alarm on task duration p99 > 20 minutes (artifact generation should complete in <10 minutes)
- Cost anomaly detection via AWS Cost Anomaly Detection service (alert on >50% daily spend increase)
- Implement task-level timeout in code: `setTimeout(() => { throw new Error("Task timeout exceeded"); }, 25 * 60 * 1000)`

**9. SQS Queue Depth Explosion (Low Probability, Critical Impact)**

**Risk:** Traffic spike or Fargate task failure causes SQS queue to grow unbounded (1M+ messages), incurring high SQS storage costs.

**Impact:** SQS charges exceed $100/day, Fargate cannot scale fast enough to drain queue, user delays exceed SLA.

**Mitigations:**
- Set SQS `MessageRetentionPeriod: 4 hours` (messages expire after 4 hours if not processed)
- CloudWatch alarm on queue depth > 1000 messages (indicates sustained backlog)
- Auto-scaling policy scales Fargate tasks to 10x capacity if queue depth > 100 (aggressive catch-up scaling)
- Manual intervention playbook: pause new job submissions via feature flag, drain queue with dedicated "burst" Fargate cluster

### Rollback and Degradation Risks

**10. Cannot Rollback to Lambda After Data Migration (Medium Probability, Medium Impact)**

**Risk:** After enabling Fargate-based artifact generation, job status data exists in DSQL but no Lambda handler can process pending jobs (one-way migration).

**Impact:** Rollback requires data migration or manual job reprocessing. Downtime during rollback.

**Mitigations:**
- Implement feature flag: `ENABLE_FARGATE_ARTIFACTS=true|false` (default: false during rollout)
- Lambda handler checks feature flag: if false, falls back to synchronous artifact generation with timeout warning to user
- Feature flag stored in AWS AppConfig for runtime toggle without deployment
- Staged rollout: 10% traffic → 50% traffic → 100% traffic over 3 days, with automated rollback on error rate spike