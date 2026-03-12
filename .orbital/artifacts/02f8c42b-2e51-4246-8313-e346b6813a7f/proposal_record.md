# Proposal Record — T6-003: Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Context Packages:**
- Architectural: Not provided (inferred from codebase context)
- Intent-specific: CTX-T6-003 (provided inline)  
**Trust Tier:** 2 — Supervised (infrastructure change affecting revenue-adjacent AI workflows)

---

## Interpreted Intent

When users request AI-generated artifacts (Intent Documents, Test Plans, Context Packages) or engage in extended chat sessions, the system currently blocks Lambda execution for the entire LLM operation duration. This creates timeout failures beyond 15 minutes, exhausts Lambda concurrency pools, and forces clients to wait synchronously for operations that may require multi-turn reasoning loops.

This proposal transitions those operations to a queue-driven, Fargate-based architecture where HTTP APIs remain fast and responsive while background tasks handle computationally intensive LLM work. The user receives an immediate `202 Accepted` response with a job identifier, then gets notified via WebSocket when processing completes. Failed tasks retry automatically through SQS message redelivery, and exhausted retries move to a dead-letter queue with alerting.

The observable change: artifact generation requests that previously timed out at 15 minutes will complete successfully within 5 minutes via background processing. Users will see real-time progress notifications through WebSocket events rather than staring at loading spinners. The system will scale from zero to handle variable workload durations without manual capacity planning.

---

## Implementation Plan

### Files to Create

**Infrastructure (Terraform):**

- `infrastructure/fargate/task-definitions/artifact-generator.tf`  
  Fargate task definition for artifact generation workloads. Specifies t4g.small equivalent compute (2 vCPU, 4GB RAM), private subnet placement, IAM task role reference, CloudWatch Logs configuration. Task timeout set to 30 minutes with stop timeout of 2 minutes.

- `infrastructure/fargate/task-definitions/ai-chat-processor.tf`  
  Fargate task definition for long-running chat sessions. Similar compute profile to artifact-generator but with different CloudWatch log group and task role scoped to chat-specific DSQL tables.

- `infrastructure/sqs/artifact-queue.tf`  
  SQS standard queue for artifact generation jobs. Visibility timeout: 120 seconds (accommodates Fargate cold start). Dead-letter queue configured with maxReceiveCount: 3. Message retention: 4 hours. Encryption at rest with AWS-managed KMS key.

- `infrastructure/sqs/chat-queue.tf`  
  SQS standard queue for chat processing jobs. Configuration mirrors artifact-queue but with separate CloudWatch metrics namespace for independent alerting.

- `infrastructure/sqs/dlq-artifact.tf`  
  Dead-letter queue for failed artifact jobs. CloudWatch alarm fires when `ApproximateNumberOfMessagesVisible` > 0 for 5 minutes. Alarm routes to SNS topic for incident response.

- `infrastructure/sqs/dlq-chat.tf`  
  Dead-letter queue for failed chat jobs. Independent alarm from artifact DLQ.

- `infrastructure/iam/fargate-task-roles.tf`  
  IAM roles for Fargate tasks with least-privilege policies. Artifact task role: S3 read/write scoped to `prometheus-artifacts-${env}/${intent_id}/*`, DSQL write to `jobs` table, Secrets Manager read for `prometheus/bedrock-api-key`, CloudWatch Logs write. Chat task role: similar but with S3 scope adjusted for chat-specific artifacts.

- `infrastructure/cloudwatch/fargate-alarms.tf`  
  CloudWatch alarms for operational monitoring:
  - Queue depth > 50 messages for 10 minutes (backlog alert)
  - Task failure rate > 50% over 10 minutes (quality degradation)
  - DLQ message age > 5 minutes (unprocessed failures)
  - Task duration p99 > 20 minutes (performance regression)

- `infrastructure/ecs/cluster.tf`  
  ECS cluster definition for Fargate tasks. Cluster name: `prometheus-workers-${env}`. Container Insights enabled for metrics collection.

- `infrastructure/ecs/service-artifact-generator.tf`  
  ECS service for artifact generator tasks. Desired count: 0 (scale from zero). Auto-scaling policy: target tracking on `artifact-queue` `ApproximateNumberOfMessagesVisible` metric. Scale out when > 5 messages, scale in when < 2 messages. Max capacity: 10 tasks.

- `infrastructure/ecs/service-chat-processor.tf`  
  ECS service for chat processor tasks. Configuration mirrors artifact generator service but targets `chat-queue` metrics.

**Backend API (Lambda Modifications):**

- `backend/api/artifacts/generate.js` (MODIFY)  
  Transform from synchronous artifact generation to job enqueue pattern:
  1. Validate request (artifact type, intent ID authorization)
  2. Generate `job_id` (UUID v4)
  3. Insert job record in DSQL: `{ job_id, intent_id, job_type: 'artifact_generation', status: 'pending', created_at }`
  4. Publish SQS message to `artifact-queue`: `{ job_id, intent_id, artifact_type, user_id, correlation_id }`
  5. Return `202 Accepted` with `{ job_id, status: 'pending', check_status_url: '/api/jobs/{job_id}/status' }`
  6. Log enqueue event with correlation ID

- `backend/api/chat/message.js` (MODIFY)  
  Add duration threshold check: if message processing time exceeds 2 minutes (based on previous conversation context or model complexity), enqueue to `chat-queue` instead of synchronous Bedrock call. For messages under threshold, keep existing synchronous flow.

- `backend/api/jobs/status.js` (CREATE)  
  New endpoint for polling job status. Query DSQL `jobs` table by `job_id`, return current status and result details. If status is `completed`, include presigned S3 URL for artifact download (1-hour expiration). Returns `404` if job not found, `200` with job details otherwise.

**Fargate Task Containers:**

- `backend/workers/artifact-generator/index.js` (CREATE)  
  SQS message consumer and artifact generation orchestrator:
  1. Poll SQS queue with long-polling (20-second WaitTimeSeconds)
  2. Extract message body: `{ job_id, intent_id, artifact_type, correlation_id }`
  3. Fetch secrets from Secrets Manager (Bedrock API key, cached for task lifetime)
  4. Update job status to `processing` in DSQL
  5. Load intent context from DSQL (intent description, constraints, acceptance boundaries)
  6. Call Bedrock API for artifact generation (use Claude 3.5 Sonnet with system prompt from `docs/artifact-schemas/{artifact_type}.md`)
  7. Validate generated artifact against schema using `artifact-validator.js`
  8. Write artifact to S3: `s3://prometheus-artifacts-${env}/{intent_id}/{artifact_type}-{job_id}.md`
  9. Update job status to `completed`, store `result_s3_key` in DSQL
  10. Generate presigned S3 URL (1-hour expiration)
  11. Notify WebSocket connection via `websocket-notifier.js`: `{ event: 'artifact_ready', job_id, artifact_url }`
  12. Delete SQS message to prevent redelivery
  13. Log completion event with correlation ID

- `backend/workers/artifact-generator/Dockerfile` (CREATE)  
  Multi-stage Docker build:
  1. Base: Node.js 20 Alpine
  2. Install dependencies with `npm ci --omit=dev`
  3. Copy application code
  4. Set CMD to `node index.js`
  5. Healthcheck: none (task runs to completion, not long-lived service)

- `backend/workers/artifact-generator/package.json` (CREATE)  
  Dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-secrets-manager`, `@anthropic-ai/sdk` (or equivalent Bedrock client), `pg` (for DSQL access)

- `backend/workers/chat-processor/index.js` (CREATE)  
  Similar structure to artifact-generator but handles multi-turn chat conversations. Maintains conversation context in memory, makes multiple Bedrock calls if needed for follow-up questions, writes conversation transcript to S3 after completion.

- `backend/workers/chat-processor/Dockerfile` (CREATE)  
  Mirrors artifact-generator Dockerfile structure.

- `backend/workers/chat-processor/package.json` (CREATE)  
  Same dependencies as artifact-generator.

**Shared Libraries:**

- `backend/lib/job-tracker.js` (CREATE)  
  DSQL client for job status persistence:
  - `createJob(jobId, intentId, jobType)` — Insert new job record with status `pending`
  - `updateJobStatus(jobId, status, errorMessage?)` — Atomic status transition with timestamp
  - `getJobStatus(jobId)` — Query current job state
  - `getJobResult(jobId)` — Fetch completed job result including S3 key
  - Connection pooling: maintain single DSQL connection pool per Lambda invocation or Fargate task

- `backend/lib/websocket-notifier.js` (CREATE)  
  API Gateway WebSocket client for result notifications:
  - `notifyClient(connectionId, payload)` — Send message to connected WebSocket client
  - `getConnectionId(userId)` — Lookup active WebSocket connection for user (query from connection registry maintained by T6-002)
  - Error handling: if connection no longer exists (client disconnected), log warning but do not fail task

- `backend/lib/s3-artifact-writer.js` (CREATE)  
  S3 client wrapper with presigned URL generation:
  - `writeArtifact(intentId, artifactType, jobId, content)` — Write artifact to S3 with proper key structure
  - `generatePresignedUrl(s3Key, expirationSeconds)` — Generate presigned GET URL for client download
  - Encryption at rest: use AWS-managed S3 encryption (SSE-S3)

- `backend/lib/artifact-validator.js` (CREATE)  
  Schema validation for generated artifacts. Loads schema from `docs/artifact-schemas/{artifact_type}.md` (markdown frontmatter + structure rules), validates generated content matches schema. Returns validation result with specific error messages for schema violations.

**Database Schema (DSQL):**

- `backend/database/schema/jobs.sql` (CREATE)  
  ```sql
  CREATE TABLE jobs (
    job_id UUID PRIMARY KEY,
    intent_id UUID NOT NULL,
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('artifact_generation', 'chat_session')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    result_s3_key VARCHAR(500),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    correlation_id UUID,
    CONSTRAINT unique_job_id UNIQUE (job_id)
  );
  CREATE INDEX idx_jobs_intent_id ON jobs(intent_id);
  CREATE INDEX idx_jobs_status ON jobs(status);
  CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
  ```

**Configuration:**

- `backend/config/fargate.js` (CREATE)  
  Configuration module for Fargate task environment variables:
  - `ARTIFACT_QUEUE_URL` — SQS queue URL for artifact jobs
  - `CHAT_QUEUE_URL` — SQS queue URL for chat jobs
  - `ARTIFACTS_BUCKET_NAME` — S3 bucket name for artifact storage
  - `DSQL_ENDPOINT` — DSQL database connection endpoint
  - `DSQL_DATABASE` — Database name
  - `AWS_REGION` — AWS region for service calls
  - `BEDROCK_MODEL_ID` — Model identifier for LLM calls
  - `LOG_LEVEL` — Logging verbosity (info, debug, error)

- `.env.example` (MODIFY)  
  Add new environment variables for local testing:
  ```
  ARTIFACT_QUEUE_URL=http://localhost:4566/000000000000/artifact-queue-local
  CHAT_QUEUE_URL=http://localhost:4566/000000000000/chat-queue-local
  ARTIFACTS_BUCKET_NAME=prometheus-artifacts-local
  DSQL_ENDPOINT=localhost:5432
  BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
  ```

**Operational Scripts:**

- `backend/scripts/replay-dlq.js` (CREATE)  
  Manual DLQ reprocessing script for incident response. Reads messages from DLQ, resubmits to primary queue with increased retry count metadata, deletes from DLQ after successful resubmission.

### Files to Modify

- `backend/api/artifacts/generate.js` — Replace synchronous Bedrock call with job enqueue pattern (detailed above)
- `backend/api/chat/message.js` — Add duration threshold check for async offload (detailed above)
- `.env.example` — Add Fargate-related environment variables

### Approach

Follow a layered implementation strategy mirroring the system's architectural boundaries:

1. **Infrastructure First:** Provision Fargate cluster, task definitions, SQS queues, IAM roles, and CloudWatch alarms. Validate infrastructure with smoke tests (manual SQS message publish → Fargate task pickup).

2. **Shared Libraries:** Build job-tracker, websocket-notifier, s3-artifact-writer, and artifact-validator libraries. These are the contracts between API layer and execution layer. Unit test each library independently.

3. **Database Schema:** Deploy DSQL schema with job tracking table. Verify unique constraint on job_id prevents duplicate processing.

4. **Fargate Workers:** Implement artifact-generator and chat-processor tasks. Containerize and push to ECR. Test locally with LocalStack for SQS/S3/Secrets Manager simulation.

5. **API Layer Modifications:** Update Lambda handlers to enqueue jobs instead of synchronous processing. Deploy behind feature flag (default: disabled).

6. **Integration Testing:** End-to-end test with real Bedrock API calls in staging environment. Verify WebSocket notification delivery, presigned URL access, job status transitions.

7. **Gradual Rollout:** Enable feature flag for 10% of artifact requests, monitor error rates and queue depths for 24 hours. Increment to 50%, then 100% over 3 days.

8. **Deprecation:** After 7 days of stable operation, remove synchronous artifact generation code path from Lambda handlers.

### Order of Operations

**Phase 1 — Infrastructure Foundation (Orbit 1, Days 1-2):**
1. Create Terraform modules for ECS cluster, SQS queues, IAM roles, CloudWatch alarms
2. Apply Terraform to staging environment
3. Validate: Manually publish SQS message, observe CloudWatch Logs for queue visibility

**Phase 2 — Data Layer (Orbit 1, Days 2-3):**
1. Create DSQL schema for jobs table
2. Implement job-tracker library with connection pooling
3. Write unit tests for job status transitions
4. Deploy schema to staging DSQL instance

**Phase 3 — Shared Libraries (Orbit 1, Days 3-4):**
1. Implement websocket-notifier (depends on T6-002 completion)
2. Implement s3-artifact-writer with presigned URL generation
3. Implement artifact-validator with schema loading
4. Unit test each library with mocked AWS SDK clients

**Phase 4 — Fargate Workers (Orbit 2, Days 5-7):**
1. Implement artifact-generator task with SQS polling, Bedrock calls, S3 writes
2. Implement chat-processor task (similar pattern)
3. Create Dockerfiles and build container images
4. Push images to ECR staging repository
5. Deploy ECS services with auto-scaling policies
6. Integration test: Publish SQS message → verify artifact written to S3 → verify WebSocket event

**Phase 5 — API Modifications (Orbit 2, Days 7-8):**
1. Modify artifacts/generate.js to enqueue jobs (keep synchronous code path behind feature flag)
2. Modify chat/message.js with duration threshold check
3. Create jobs/status.js polling endpoint
4. Deploy Lambda functions to staging
5. Integration test: API request → job enqueue → Fargate processing → WebSocket notification

**Phase 6 — Rollout and Monitoring (Orbit 3, Days 9-12):**
1. Enable feature flag for 10% traffic in production
2. Monitor CloudWatch metrics: queue depth, task failure rate, DLQ messages
3. Validate no increase in API error rates or latency
4. Increment to 50% traffic after 24 hours of stable operation
5. Increment to 100% traffic after another 24 hours
6. Deprecate synchronous code path after 7 days

**Phase 7 — Cleanup (Orbit 3, Day 13):**
1. Remove feature flag and synchronous processing code
2. Archive Lambda-based artifact generation logs
3. Document runbooks for DLQ replay and queue depth alerting

### Dependencies

**Upstream:**
- **T6-002 (WebSocket Infrastructure):** Must be complete before Phase 5. If incomplete, implement jobs/status.js polling endpoint as primary notification mechanism and defer WebSocket integration to follow-on orbit.
- **DSQL instance provisioned:** Staging and production DSQL clusters must exist with network connectivity from Lambda and Fargate subnets.
- **S3 bucket with lifecycle policies:** `prometheus-artifacts-{env}` bucket must exist with 30-day expiration policy on draft artifacts.
- **Secrets Manager secret:** `prometheus/bedrock-api-key` must exist with valid Bedrock credentials (or configure IAM-based Bedrock auth to eliminate secret dependency).

**External:**
- **Amazon Bedrock service quota:** Request increase to 50 requests/second before production rollout to avoid throttling under load.
- **NAT Gateway:** Fargate tasks in private subnets require NAT Gateway for egress-only internet access to Bedrock API endpoints.
- **ECR repository:** Container registry for Fargate images must be provisioned in each AWS account/region.

**Parallel Work:**
- This implementation can proceed in parallel with other trajectory intents (T6-001, T6-004) as long as shared VPC infrastructure (subnets, NAT Gateway) exists.
- If T6-001 (ECS/Fargate Foundation) is incomplete, the Terraform modules in this proposal will include VPC and subnet provisioning.

---

## Risk Surface

### Edge Cases

**1. Authorization code replay during artifact generation:**

When a user requests an artifact for an intent they no longer have access to (authorization revoked between request and Fargate processing), the task must reject cleanly without creating a partial artifact.

**Mitigation:** Fargate task re-checks user authorization against intent before starting Bedrock call. If authorization fails, update job status to `failed` with `error_message: "Authorization expired"`, notify WebSocket with failure event, do NOT write artifact to S3.

**2. Duplicate SQS message delivery (at-least-once semantics):**

SQS may deliver the same message twice (network retry, visibility timeout expiration during processing). Fargate task must not generate duplicate artifacts or double-charge Bedrock API usage.

**Mitigation:** Query DSQL `jobs` table at task start using `job_id` as deduplication key. If status is already `processing` or `completed`, skip processing and delete message. Unique constraint on `job_id` in database schema prevents race conditions.

**3. Fargate task crash mid-processing:**

Task crashes after calling Bedrock but before writing artifact to S3. User sees job stuck in `processing` state. SQS message visibility timeout expires and message redelivers.

**Mitigation:** SQS visibility timeout (120 seconds) is shorter than task processing time but longer than cold start. Message redelivers on crash. Task re-checks job status and resumes from last committed state. Idempotency key on Bedrock calls (if supported by model API) prevents duplicate generation. If Bedrock response is lost, task regenerates (acceptable for async work).

**4. WebSocket connection closed during Fargate processing:**

User navigates away from page before artifact completes. WebSocket connection no longer exists. Notification event cannot be delivered.

**Mitigation:** `websocket-notifier.js` logs warning but does not fail task. Job status remains `completed` in DSQL. User can poll `/api/jobs/{job_id}/status` endpoint to retrieve result. Implement frontend logic to check job status on page load (query for pending jobs associated with current user).

**5. Concurrent requests for the same artifact:**

User double-clicks "Generate Artifact" button. Two jobs enqueue for identical artifact generation. Both tasks process, creating duplicate artifacts.

**Mitigation:** API layer checks for existing `pending` or `processing` jobs for the same `intent_id` + `artifact_type` combination before creating new job. If found, return existing `job_id` in 202 response. Frontend implements button debounce to prevent double-submission.

### Regressions

**1. Lambda concurrency exhaustion:**

Enqueuing jobs to SQS requires Lambda invocations. If SQS publish rate exceeds Lambda concurrency limits, new artifact requests fail with 429 errors.

**Current behavior:** Synchronous artifact generation consumes Lambda concurrency for 5-15 minutes per request.  
**New behavior:** Enqueue operation completes in <500ms, freeing concurrency.  
**Regression risk:** Low. SQS enqueue is faster than Bedrock call, reducing concurrency pressure.  
**Mitigation:** Monitor Lambda concurrent executions metric. If approaching account limit, request quota increase.

**2. Existing artifact references broken:**

If artifact URL format changes (S3 key structure or presigned URL generation), previously generated artifact links in frontend or notifications may 404.

**Current behavior:** Artifacts returned inline in API response (no S3 storage).  
**New behavior:** Artifacts stored in S3 with presigned URLs.  
**Regression risk:** Medium. Any hardcoded artifact URL references in frontend will break.  
**Mitigation:** Audit frontend for artifact URL references. Update to use `/api/jobs/{job_id}/status` to fetch latest presigned URL. Implement 7-day S3 key format migration window where both old and new formats are supported (if old format exists).

**3. Artifact schema validation enforcement:**

Introducing artifact-validator.js rejects malformed artifacts that previously succeeded. Users may see more generation failures.

**Current behavior:** No schema validation on generated artifacts.  
**New behavior:** Artifacts rejected if schema validation fails.  
**Regression risk:** Medium. If Bedrock generates non-compliant artifacts, validation fails and job status becomes `failed`.  
**Mitigation:** Log validation errors with artifact content to CloudWatch for debugging. Implement schema validation in phases: log-only mode first (alert on validation failures but allow artifact storage), then enforce mode after 1 week of stable logging.

### Security

**1. IAM task role over-permissioning:**

Fargate task role with wildcard S3 or DSQL permissions allows artifact leakage across intents or projects.

**Attack vector:** Malicious user submits job with manipulated `intent_id` in SQS message, task writes artifact to another tenant's S3 prefix.  
**Impact:** Data breach, PII exposure, loss of tenant isolation.  
**Mitigation:**
- IAM policy scoped to `arn:aws:s3:::prometheus-artifacts-${env}/${intent_id}/*` using resource-based constraints.
- Terraform validation rule: fail `terraform plan` if IAM policy contains wildcard `*` resource without `Condition` block.
- Task code validates `intent_id` ownership before S3 write: query DSQL for intent metadata, verify user from job record has access.
- Tier 2 (Supervised) review: human architect reviews IAM policy diff before merge.

**2. Secrets leakage in CloudWatch Logs:**

Bedrock API key or internal credentials logged to CloudWatch (accidentally printed in debug statements or exception stack traces).

**Attack vector:** Attacker with CloudWatch Logs read access extracts credentials from log streams.  
**Impact:** Unauthorized Bedrock usage, billing fraud, credential exposure.  
**Mitigation:**
- Implement structured logging with secrets redaction: mask any string matching regex `/sk-[A-Za-z0-9]{40}/` or `/arn:aws:secretsmanager:.+/`.
- Enable CloudWatch Logs encryption at rest with KMS key.
- IAM policy denies `logs:GetLogEvents` for Fargate task role (tasks write logs but cannot read them).
- Pre-deployment code review: scan Fargate worker code for `console.log(secret)` patterns using ESLint rule.

**3. Presigned URL expiration bypass:**

User fetches presigned URL from job status endpoint, shares URL publicly. URL remains valid for 1 hour, exposing artifact to unauthorized viewers.

**Attack vector:** User shares artifact URL in public Slack channel or Pastebin. Artifact contains PII or proprietary information.  
**Impact:** Data leak, compliance violation.  
**Mitigation:**
- Presigned URL expiration hardcoded to 1 hour (cannot be extended).
- Artifact S3 objects have public access blocked at bucket policy level (presigned URL is only access path).
- Log presigned URL generation events with `user_id` and `job_id` for audit trail.
- Consider: Implement artifact access audit log — record every presigned URL fetch with timestamp and client IP.

**4. SQS message tampering:**

Attacker with SQS write access publishes malicious message with arbitrary `intent_id` or `artifact_type` to steal data or trigger arbitrary Bedrock API calls.

**Attack vector:** Compromised AWS credentials with `sqs:SendMessage` permission. Attacker enqueues messages with manipulated payloads.  
**Impact:** Unauthorized artifact generation, LLM API abuse, cross-tenant data access.  
**Mitigation:**
- SQS queue policy restricts `sqs:SendMessage` to specific Lambda execution role ARNs only (deny all other principals).
- API layer validates `intent_id` ownership before enqueue: query DSQL to verify requesting user has access to intent.
- Fargate task re-validates `intent_id` ownership from job record (defense in depth).
- Enable AWS CloudTrail logging for SQS API calls. Alert on `SendMessage` calls from unexpected principals.

### Performance

**1. Fargate cold start latency:**

First task in idle ECS service takes 60+ seconds to start (task provisioning, image pull, container startup). User sees extended "pending" duration.

**Impact:** First artifact generation after idle period (e.g., Monday morning after weekend) has 60-90 second startup delay. Subsequent requests are fast (task pool warm).  
**Mitigation:**
- Set SQS visibility timeout to 120 seconds (accommodates cold start without premature message redelivery).
- CloudWatch metric tracks "time to first log line" as proxy for cold start duration. Dashboard visualizes cold start frequency.
- Consider: Pre-warm 1 task on schedule (e.g., weekday mornings) to eliminate first-request cold start. Trade-off: $0.10/day for standby task vs. user experience improvement.

**2. Bedrock API throttling under concurrent load:**

Multiple Fargate tasks call Bedrock simultaneously, exceeding service quota (default: 10 requests/second). Throttle errors cause job failures.

**Impact:** During traffic spikes (e.g., team onboarding, batch artifact requests), >50% of jobs fail with throttle errors. SQS retries exacerbate problem.  
**Mitigation:**
- Request Bedrock quota increase to 50 requests/second before production rollout (submit service quota increase case in AWS Console).
- Implement exponential backoff with jitter in Bedrock client (AWS SDK v3 includes this by default, verify configuration).
- CloudWatch alarm on Bedrock throttle rate: parse logs for `ThrottlingException`, alert if >5 throttles/minute.
- SQS FIFO queue alternative (future): Use FIFO queue with message group ID = `intent_id` to serialize requests per intent, reducing concurrent Bedrock calls. Trade-off: Throughput limit (300 messages/second for FIFO vs. unlimited for standard queue).

**3. DSQL connection exhaustion:**

Each Fargate task opens DSQL connection. Auto-scaling to 10+ tasks exhausts DSQL connection pool (default: 100 connections).

**Impact:** Fargate tasks fail with "connection pool exhausted" errors. Jobs stuck in `pending` state.  
**Mitigation:**
- job-tracker.js uses connection pooling: single connection pool per task, reused for all job updates.
- Configure DSQL connection pool: max_connections = 200 (reserve 50 for API Lambda, 150 for Fargate).
- ECS service max capacity limited to 10 tasks (10 connections per task x 5 concurrent jobs = 50 connections, well under limit).
- Monitor DSQL active connections metric. Alert if approaching 80% of max_connections.

**4. S3 write latency variability:**

S3 PutObject calls occasionally spike to 2-5 seconds (p99), delaying job completion and WebSocket notification.

**Impact:** User sees 5-second delay between "processing complete" and artifact download link appearing. Perception of slow system.  
**Mitigation:**
- S3 Standard storage class (not Intelligent-Tiering or Glacier, which have higher PUT latency).
- Artifact size typically <1MB (Intent Document markdown), S3 PUT latency p99 <500ms for objects <1MB.
- CloudWatch metric tracks S3 write duration: log S3 PutObject latency in Fargate task, send custom metric to CloudWatch. Dashboard visualizes p50/p95/p99.
- If S3 latency exceeds 2 seconds, investigate S3 request rate throttling (S3 automatically scales but may lag on sudden traffic spikes). Mitigation: Implement S3 prefix randomization in artifact keys (e.g., `{hash-prefix}/{intent_id}/...`) to distribute requests across S3 partitions.

**5. SQS polling overhead:**

Fargate tasks long-poll SQS with 20-second WaitTimeSeconds. If no messages available, task idles for 20 seconds before next poll, wasting CPU cycles.

**Impact:** Fargate tasks consume CPU even when no work is available. Cost: minimal (<$0.01/day per idle task).  
**Mitigation:**
- ECS service auto-scales to zero when queue is empty (desired count = 0, scale out on queue depth > 5 messages). No idle tasks = no polling overhead.
- If maintaining warm task pool (1 task always running), long-polling overhead is acceptable trade-off for reduced cold start latency.

---

## Scope Estimate

### Files Affected

| Category | Files Created | Files Modified | Total |
|----------|--------------|----------------|-------|
| Infrastructure (Terraform) | 11 | 0 | 11 |
| Backend API (Lambda) | 1 | 2 | 3 |
| Fargate Workers | 6 | 0 | 6 |
| Shared Libraries | 4 | 0 | 4 |
| Database Schema | 1 | 0 | 1 |
| Configuration | 1 | 1 | 2 |
| Operational Scripts | 1 | 0 | 1 |
| **Total** | **25** | **3** | **28** |

### Complexity Assessment

**Rating:** High

**Justification:**

This intent introduces a fundamentally new execution model (async queue-driven processing) that crosses multiple architectural boundaries:

1. **Infrastructure provisioning:** Fargate, SQS, IAM, CloudWatch alarms — 11 Terraform modules with cross-service dependencies and state management.
2. **Distributed system concerns:** Message delivery guarantees, idempotency, retry logic, dead-letter handling — each requiring careful design and testing.
3. **Integration with external services:** Bedrock API (rate limiting, error handling), Secrets Manager (caching strategy), WebSocket (connection lifecycle).
4. **Data consistency:** Job state machine across API → SQS → Fargate → DSQL, with potential race conditions and partial failure modes.
5. **Operational complexity:** Auto-scaling policies, CloudWatch dashboards, DLQ replay scripts, gradual rollout with feature flags.
6. **Security posture:** IAM role scoping, secrets management, audit logging — each requiring human review (Tier 2 supervised).

While individual components follow established patterns (CQRS command handling, Terraform module structure), the orchestration of these components into a reliable async execution pipeline represents significant architectural change. The high complexity rating reflects the need for extensive integration testing, staged rollout, and monitoring before full production adoption.

### Estimated Test Count

**Total test cases:** 47

**Breakdown by category:**

| Test Category | Count | Examples |
|--------------|-------|----------|
| Unit tests (shared libraries) | 12 | job-tracker state transitions, websocket-notifier connection lookup, artifact-validator schema parsing, s3-artifact-writer presigned URL generation |
| Unit tests (Fargate workers) | 10 | Artifact-generator SQS message parsing, error handling for Bedrock throttle, chat-processor conversation context management |
| Integration tests (API → SQS) | 5 | artifacts/generate.js enqueue success, authorization check before enqueue, duplicate job detection |
| Integration tests (SQS → Fargate → S3) | 8 | End-to-end artifact generation, DLQ message routing on failure, idempotency on duplicate message delivery, WebSocket notification delivery |
| Contract tests (Bedrock API) | 4 | Valid artifact generation request, throttle error handling, model not found error, content policy violation |
| Infrastructure smoke tests | 5 | Manual SQS message publish, Fargate task startup verification, CloudWatch alarm fire test, IAM role permission validation |
| Load tests | 3 | Concurrent artifact generation (10 simultaneous jobs), sustained load (100 jobs over 10 minutes), auto-scaling validation (queue depth triggers task scale-out) |

### Orbit Breakdown

**Estimated orbit count:** 3

**Orbit 1 — Infrastructure and Data Layer (5-7 days):**
- Provision Fargate, SQS, IAM, CloudWatch infrastructure via Terraform
- Deploy DSQL schema
- Implement shared libraries (job-tracker, websocket-notifier, s3-artifact-writer, artifact-validator)
- Unit tests and infrastructure smoke tests
- **Exit criteria:** Manually published SQS message results in Fargate task processing and S3 artifact write (no API integration)

**Orbit 2 — Fargate Workers and API Integration (5-6 days):**
- Implement artifact-generator and chat-processor Fargate tasks
- Modify Lambda API handlers (artifacts/generate.js, chat/message.js, jobs/status.js)
- Containerize Fargate workers, push to ECR
- Integration tests (API → SQS → Fargate → S3 → WebSocket)
- **Exit criteria:** End-to-end flow complete in staging environment, all integration tests passing

**Orbit 3 — Rollout and Stabilization (3-4 days):**
- Deploy to production with feature flag (default: disabled)
- Gradual rollout: 10% → 50% → 100% over 3 days
- Monitor CloudWatch metrics, respond to alerts
- Implement DLQ replay runbook if failures detected
- Deprecate synchronous code path after 7 days of stable operation
- **Exit criteria:** 100% of artifact generation traffic on Fargate, zero DLQ messages over 24 hours, API p99 latency unchanged

**Total estimated duration:** 13-17 days

**Confidence level:** Medium. Complexity arises from distributed system integration and operational concerns (auto-scaling, monitoring, graceful degradation) rather than algorithmic complexity. Risk of scope creep if WebSocket infrastructure (T6-002) is incomplete or if DSQL connection pooling issues surface during load testing. Buffer 20% for unexpected integration challenges.

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by | _Pending human review_ |
| Timestamp | _Pending authorization_ |

---

## Human Modifications

_This section will be populated during human review. Any modifications to the interpreted intent, implementation plan, risk surface, or scope estimate will be recorded here with justification._

Human review requirements for Tier 2 (Supervised) approval:

1. **IAM policy verification:** Architect must review Fargate task role policies for least-privilege compliance and resource-based scoping.
2. **Retry and DLQ configuration:** Validate SQS maxReceiveCount, visibility timeout, and DLQ alarm thresholds for production readiness.
3. **Cost projection:** Estimate monthly Fargate + SQS costs based on expected artifact generation volume (target: <$50/month at current trajectory scale).
4. **Rollback plan:** Confirm feature flag implementation allows safe rollback to Lambda-based artifact generation without data loss.
5. **Security boundary validation:** Verify secrets management strategy (Secrets Manager vs. IAM roles), presigned URL expiration, and S3 bucket policy enforcement.

Human may approve, approve with modifications, or reject based on risk assessment and architectural fit.