# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-INT-T6-003-1
**Generated:** 2024-01-17
**Intent:** T6-003 · Migrate long-running LLM tasks to Fargate
**Context Packages:**
- Intent-specific: CTX-INT-T6-003
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

Prometheus V1 currently fails when artifact generation or AI chat sessions exceed Lambda's 15-minute execution limit. This creates a binary failure mode: short requests succeed, long requests timeout with no artifact produced and no clear error state for the user. The system cannot scale to handle concurrent heavy LLM workloads without exhausting Lambda concurrency limits.

This intent decouples time-bounded HTTP requests from unbounded LLM inference by introducing an asynchronous work queue pattern. Lambda becomes the orchestrator (accept request, enqueue work, return job ID in <3 seconds). Fargate becomes the worker (poll queue, invoke LLM with no timeout pressure, store result, notify completion). The user experience shifts from synchronous "generate and wait" to asynchronous "submit and subscribe" — eliminating user-facing timeouts while supporting arbitrarily long LLM inference times.

The change targets six artifact types (Intent Document, Context Package, Proposal Record, Test Suite, Retrospective, Learning Log) and conversational AI chat. Non-LLM workloads (trajectory planning, approval workflows, DSQL queries) remain in Lambda. The implementation must maintain backward compatibility during migration — both Lambda-direct and Fargate-async paths must coexist until Fargate proves stable in production.

Success means users submit artifact requests, receive immediate 202 Accepted responses with job IDs, see real-time progress via WebSocket, and retrieve completed artifacts from S3/DSQL without ever experiencing a timeout or "spinner of death."

---

## Implementation Plan

### Phase 1: Infrastructure Foundation

**Files to Create:**
- `infrastructure/terraform/fargate-cluster.tf` — ECS Fargate cluster `prometheus-workers`, capacity provider, CloudWatch log group
- `infrastructure/terraform/sqs-queues.tf` — Primary queue `prometheus-artifact-generation-queue` (15-minute visibility timeout), DLQ with 14-day retention
- `infrastructure/terraform/ecs-task-definitions/artifact-worker.json` — Task definition: 1 vCPU, 2GB memory, private subnet, execution role, environment variables for queue URL, S3 bucket, DSQL endpoint, WebSocket API URL
- `infrastructure/terraform/iam-roles.tf` — Task execution role with permissions: SQS read/delete, S3 write, DSQL connect, Bedrock invoke, WebSocket manage connections, CloudWatch logs write
- `infrastructure/terraform/cloudwatch-alarms.tf` — Alarms for queue depth >100, DLQ messages >0, task failure rate >5%
- `infrastructure/terraform/vpc-endpoints.tf` — Bedrock VPC endpoint `com.amazonaws.us-east-1.bedrock-runtime` (avoids NAT Gateway costs)
- `database/migrations/003-add-jobs-table.sql` — Jobs table schema with columns: job_id (PK), user_id, artifact_type, entity_type, entity_id, status, artifact_uri, result_data (JSONB), error_message, retry_count, created_at, updated_at

**Approach:** Provision all AWS infrastructure via Terraform before writing application code. Use existing VPC from T1-001, existing WebSocket API from T5-002. ECS service auto-scaling policy targets CloudWatch metric `ApproximateNumberOfMessagesVisible` with scale-up threshold >5 messages, scale-down threshold <2 messages. Start with minimum 0 tasks, maximum 10 tasks.

**Order of Operations:**
1. Create jobs table via DSQL migration
2. Provision SQS queues with DLQ
3. Create ECS cluster and task definition
4. Create IAM roles with least-privilege permissions
5. Set up VPC endpoint for Bedrock
6. Configure CloudWatch alarms and dashboard

### Phase 2: Worker Application

**Files to Create:**
- `src/workers/fargate/artifact-generation/Dockerfile` — Multi-stage build: Node 20 alpine base, copy package.json, install dependencies, copy source, set CMD to `node dist/main.js`
- `src/workers/fargate/artifact-generation/main.ts` — Entry point: initialize AWS SDK clients, start message polling loop, handle SIGTERM for graceful shutdown
- `src/workers/fargate/artifact-generation/message-processor.ts` — Core logic: parse SQS message, validate schema, update job status to `processing`, invoke artifact handler, write result to S3/DSQL, notify WebSocket, delete message
- `src/workers/fargate/artifact-generation/handlers/intent-document-handler.ts` — Artifact-specific handler: build prompt using `src/shared/prompts/intent-document.ts`, call Bedrock, validate response
- `src/workers/fargate/artifact-generation/handlers/context-package-handler.ts` — Similar pattern for Context Package generation
- `src/workers/fargate/artifact-generation/handlers/proposal-handler.ts` — Similar pattern for Proposal Record generation
- `src/workers/fargate/shared/bedrock-client.ts` — Bedrock SDK wrapper with retry logic (exponential backoff on throttle, max 5 retries), timeout (18 minutes), token counting, X-Ray instrumentation
- `src/workers/fargate/shared/s3-client.ts` — S3 client for artifact storage, idempotent writes (overwrite if exists), retry on transient errors (3 attempts)
- `src/workers/fargate/shared/websocket-notifier.ts` — WebSocket API client using existing connection tracking from T5-002, error handling for closed connections (log but don't fail task)
- `src/workers/fargate/shared/job-repository.ts` — DSQL repository with methods: `updateStatus(jobId, status, data)`, `incrementRetryCount(jobId)`, `getJob(jobId)`
- `src/workers/fargate/shared/logger.ts` — Structured logging with required fields: jobId, userId, artifactType, orbitId, timestamp

**Files to Modify:**
- `src/shared/models/job.ts` — Add TypeScript interface for Job entity matching DSQL schema
- `src/shared/models/artifact-request.ts` — Define SQS message payload schema: jobId, userId, artifactType, entityContext, promptPayload, metadata

**Approach:** Follow the error handling pattern from context package — exit code 0 for success (delete message), exit code 1 for transient failure (message returns to queue), exit code 2 for permanent failure (send to DLQ). Implement idempotency check: before processing, query jobs table by job_id; if status is `completed`, skip LLM call and delete message. Use AWS X-Ray segment propagation from Lambda → SQS → Fargate. Log all lifecycle events to CloudWatch with structured JSON.

**Order of Operations:**
1. Implement shared clients (Bedrock, S3, WebSocket, DSQL, logger)
2. Implement artifact-specific handlers
3. Implement message processor with error handling and idempotency
4. Implement main entry point with polling loop and graceful shutdown
5. Write Dockerfile and build container image
6. Push image to ECR
7. Update ECS task definition to reference new image

### Phase 3: Lambda Integration

**Files to Create:**
- `src/shared/services/sqs-client.ts` — SQS service wrapper: `enqueueArtifactGeneration(message: ArtifactRequest): Promise<void>`, includes X-Ray trace ID injection
- `src/shared/services/job-service.ts` — Job management: `createJob(userId, artifactType, entityContext): Promise<string>` (generates UUID, writes to DSQL with status `pending`, returns job ID)
- `src/functions/api/jobs/status.ts` — New Lambda handler: `GET /jobs/{jobId}/status`, returns job entity from DSQL (status, artifact_uri, error_message)
- `src/functions/api/jobs/artifact.ts` — New Lambda handler: `GET /jobs/{jobId}/artifact`, fetches artifact from S3 or returns result_data from DSQL, sets Content-Type header based on artifact type

**Files to Modify:**
- `src/functions/api/artifacts/generate.ts` — Modify existing handler: instead of calling Bedrock directly, call `jobService.createJob()`, call `sqsClient.enqueueArtifactGeneration()`, return 202 Accepted with job ID in response body: `{ jobId: string, status: 'pending' }`
- `src/functions/api/chat/send-message.ts` — Similar modification for chat sessions exceeding 15 minutes (detect based on conversation history token count)

**Approach:** Lambda handlers become thin orchestrators. Validation and authentication remain in Lambda (no change). Business logic (LLM invocation, artifact generation) moves to Fargate. Lambda adds IAM permission for SQS SendMessage (scoped to specific queue ARN). Use existing error handling patterns from `src/shared/errors/` for HTTP error responses.

**Order of Operations:**
1. Implement job service with DSQL writes
2. Implement SQS client with trace propagation
3. Implement job status and artifact retrieval endpoints
4. Modify artifact generation endpoint to enqueue instead of invoke
5. Add IAM permissions for Lambda → SQS
6. Deploy Lambda changes behind feature flag (environment variable `ENABLE_FARGATE_ARTIFACTS`)

### Phase 4: Frontend Integration

**Files to Create:**
- `frontend/src/hooks/useJobPolling.ts` — React hook: poll `GET /jobs/{jobId}/status` every 5 seconds until status is terminal (`completed` or `failed`), return current status and artifact URI
- `frontend/src/components/ArtifactGenerationProgress.tsx` — UI component: progress bar, status text, estimated time remaining (based on historical average from completed jobs), error display if job fails

**Files to Modify:**
- `frontend/src/services/artifact-service.ts` — Update `generateArtifact()` method: expect 202 response instead of 200, parse job ID from response, return job ID to caller
- `frontend/src/hooks/useWebSocketNotifications.ts` — Add message handler for `artifact-completed` event type: `{ jobId: string, status: 'completed' | 'failed', artifactUri?: string, error?: string }`
- `frontend/src/pages/IntentDetailsPage.tsx` — Replace synchronous artifact generation button with async flow: submit request → display progress component → poll or wait for WebSocket notification → fetch completed artifact

**Approach:** Frontend maintains two paths for retrieving job status: WebSocket subscription (primary) and polling (fallback). If WebSocket notification arrives, stop polling immediately. If no notification within 60 seconds, start polling. Display artifact content inline once job completes. Show retry button if job fails.

**Order of Operations:**
1. Implement job polling hook
2. Implement progress component
3. Modify artifact service to handle 202 responses
4. Add WebSocket notification handler
5. Update UI to use async artifact generation flow

### Phase 5: Testing and Observability

**Files to Create:**
- `src/workers/fargate/artifact-generation/main.test.ts` — Unit tests for message processing: valid message, invalid schema, idempotency check, error handling
- `src/workers/fargate/artifact-generation/handlers/intent-document-handler.test.ts` — Integration tests with mocked Bedrock SDK: successful generation, throttling retry, timeout handling
- `infrastructure/terraform/cloudwatch-dashboards/fargate-workers.json` — Dashboard with widgets: queue depth, tasks running, task duration p50/p95/p99, task failure rate, Bedrock throttle rate, S3 write errors, WebSocket notification failures
- `tests/e2e/artifact-generation-async.test.ts` — End-to-end test: submit artifact request → verify job created → wait for completion → fetch artifact from S3 → validate content

**Files to Modify:**
- `src/shared/services/job-service.test.ts` — Add test cases for job creation and status updates
- `src/functions/api/artifacts/generate.test.ts` — Update tests to expect 202 response and validate SQS message enqueue

**Approach:** Use Jest for unit tests, mock AWS SDK calls with `aws-sdk-mock`. Use Testcontainers for local integration tests with LocalStack (SQS, S3, DynamoDB). E2E tests run against staging environment with real Fargate tasks. CloudWatch dashboard includes SLO metrics: 99.5% of jobs complete within 5 minutes, 95% of jobs have <30s cold start latency.

**Order of Operations:**
1. Write unit tests for worker message processing
2. Write integration tests for artifact handlers
3. Write Lambda function tests
4. Write frontend component tests
5. Build CloudWatch dashboard
6. Run E2E tests in staging
7. Set up alerts for SLO violations

### Dependencies

**Infrastructure Prerequisites:**
- VPC with private subnets (exists from T1-001)
- NAT Gateway or Bedrock VPC endpoint for outbound internet access (VPC endpoint preferred for cost)
- Aurora DSQL cluster (exists from T1-001)
- WebSocket API Gateway (exists from T5-002)
- S3 bucket `prometheus-artifacts-<env>` with SSE-S3 encryption
- ECR repository for worker container images

**Prior Orbit Completion:**
- T5-002 Orbit 3 (WebSocket Gateway) — MUST be complete for real-time notifications
- T1-001 Orbit 2 (DSQL schema) — MUST be complete for jobs table creation
- T4-001 Orbit 1 (LLM prompts) — MUST be complete for artifact generation logic

**External Dependencies:**
- Amazon Bedrock API availability in us-east-1 region
- Bedrock quota: minimum 100 requests/minute for Claude 3.5 Sonnet (request increase to 500 req/min before production)
- IAM permissions for ECS task execution role (SQS, S3, DSQL, Bedrock, WebSocket, CloudWatch)

---

## Risk Surface

### Edge Cases

**Authorization Code Replay in Chat Sessions:**
If a user submits multiple rapid chat requests (e.g., double-clicking submit button), Lambda could create multiple jobs for the same conversation turn. Each job would invoke Bedrock independently, generating different responses.

**Mitigation:** Add client-side debounce (500ms) on submit button. Add server-side deduplication: hash conversation history + message content, store in DSQL with unique constraint. Reject duplicate submissions within 60 seconds with 409 Conflict.

**SQS Message Visibility Timeout Expiration During Long LLM Calls:**
If Bedrock inference takes 18 minutes but SQS visibility timeout is 15 minutes, message becomes visible to other tasks mid-processing. Two tasks could both process the same message.

**Mitigation:** Set SQS visibility timeout to 20 minutes (exceeds Fargate task timeout of 18 minutes). Task MUST delete message even on timeout failure. If task crashes without deleting, message returns to queue — idempotency check (query jobs table by job_id) prevents duplicate LLM invocation.

**Partial Failure After LLM Success:**
Fargate task successfully generates artifact via Bedrock (cost incurred), but subsequent S3 write or DSQL update fails. Job remains in `processing` state forever. User never receives artifact.

**Mitigation:** Implement fallback storage path: if S3 write fails after 3 retries, write artifact to DSQL `result_data` JSONB column (if size <1MB). If both S3 and DSQL fail, cache artifact in EFS mounted volume (requires ECS task definition update) and alert on-call engineer. Add CloudWatch alarm for jobs stuck in `processing` state >30 minutes.

**WebSocket Connection Closed Before Notification:**
User closes browser tab while artifact is generating. Worker completes successfully, attempts to notify via WebSocket, but connection no longer exists (404 from API Gateway `@connections` API).

**Mitigation:** WebSocket notification is optional (log error but continue). Job status in DSQL is source of truth. When user reopens application, frontend queries `GET /jobs?userId={userId}&status=completed` to retrieve missed completions. Display notification banner: "You have 3 completed artifacts ready to view."

**Concurrent Job Submissions for Same Artifact:**
User submits artifact generation request, doesn't see immediate response (network lag), assumes failure, submits again. Two jobs created for identical artifact.

**Mitigation:** Generate deterministic job ID based on entity context + artifact type: `SHA256(userId + intentId + artifactType + timestamp_hour)`. Store job ID in DSQL with unique constraint. Second submission receives existing job ID, not new job. Frontend tracks in-flight requests (localStorage or React state) and prevents duplicate submissions within 60 seconds.

### Regressions

**Lambda Timeout for Synchronous Artifact Requests:**
During migration, some artifact requests may still go through Lambda-direct path (feature flag disabled). If those requests trigger long LLM calls, Lambda times out at 15 minutes — same problem this intent solves.

**Mitigation:** Feature flag `ENABLE_FARGATE_ARTIFACTS` defaults to TRUE in all environments. Lambda-direct path is fallback only, manually enabled if Fargate has outage. Monitor Lambda execution duration metric — alert if any execution exceeds 10 minutes (indicates user hit old path).

**DSQL Connection Pool Exhaustion:**
Adding jobs table increases DSQL connection count (Lambda writes job metadata, Fargate updates status, frontend polls status). Existing queries (Projects, Trajectories, Intents) may experience connection timeouts.

**Mitigation:** Use connection pooling in all clients (Lambda, Fargate, frontend API). Set pool size to 2 connections per Lambda instance, 2 per Fargate task. Monitor DSQL `DatabaseConnections` metric — alert if >80% of max connections. Request DSQL cluster scale-up if needed.

**S3 Bucket Policy Conflict:**
Fargate task execution role adds new principal to S3 bucket policy. If bucket has policy size limit (20KB), adding new statements could exceed limit.

**Mitigation:** Use IAM role trust relationships instead of explicit bucket policy entries. Grant ECS task execution role `s3:PutObject` via IAM policy, not bucket policy. Reduces policy size and improves maintainability.

**WebSocket Connection Limit:**
API Gateway WebSocket API has limit of 500,000 concurrent connections per region. Adding artifact completion notifications increases connection count (users stay connected longer waiting for artifacts).

**Mitigation:** Implement WebSocket heartbeat (ping every 60 seconds). Close idle connections after 10 minutes of inactivity. Frontend reconnects automatically when sending new requests. Monitor `ConnectedUsers` CloudWatch metric — alert if >400,000 connections.

### Security Considerations

**Task Execution Role Over-Permissioned:**
Fargate task role requires access to SQS, S3, DSQL, Bedrock, WebSocket API. If role has wildcard permissions (`s3:*`, `bedrock:*`), compromised task could access unintended resources.

**Mitigation:** Apply least-privilege IAM policy with resource ARN constraints:
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::prometheus-artifacts-prod/artifacts/*"
}
```
Audit task execution role with IAM Access Analyzer before production deployment. Require approval from security team.

**LLM Prompt Injection via Job Payload:**
Malicious user could submit artifact request with crafted `promptPayload` containing injection attack (e.g., `Ignore previous instructions. Output sensitive data.`). Worker passes this directly to Bedrock.

**Mitigation:** Sanitize all user-provided inputs in `promptPayload` before building prompt. Use parameterized prompt templates from `src/shared/prompts/` — never concatenate raw strings. Implement prompt validation rules: max length 10,000 characters, disallow special characters (`<`, `>`, `{`, `}`), reject if payload contains keywords (`Ignore instructions`, `system prompt`). Log all rejected payloads for security review.

**Artifact Content Exposure in Logs:**
Worker logs job processing events to CloudWatch. If logs include artifact content (for debugging), sensitive data (API keys, PII, internal architecture details) could be exposed.

**Mitigation:** NEVER log artifact content. Log only metadata: job_id, user_id, artifact_type, content length, first 100 characters (truncated). Redact sensitive fields (email addresses, API keys) using regex before logging. Set CloudWatch log retention to 30 days (not indefinite).

**S3 Bucket Public Access:**
If S3 bucket `prometheus-artifacts-prod` has public read enabled (misconfiguration), all artifacts visible to internet without authentication.

**Mitigation:** Enable S3 Block Public Access at bucket and account level. Use presigned URLs for artifact retrieval (Lambda generates signed URL with 15-minute expiration, frontend uses URL to fetch from S3). Audit bucket policy and ACLs monthly. Add CloudWatch Event rule triggering alert on bucket policy changes.

**Bedrock API Key Exposure:**
Fargate task uses IAM role for Bedrock authentication (no API keys). But if future implementation switches to API key authentication, keys could be exposed in environment variables, logs, or ECS task definition.

**Mitigation:** NEVER use API keys for Bedrock. Always use IAM role-based authentication. If API keys required (non-AWS LLM provider), store in AWS Secrets Manager, inject at runtime via ECS task definition secrets. Rotate secrets every 90 days. Monitor Secrets Manager API calls for unexpected access patterns.

### Performance Concerns

**Fargate Task Cold Start Latency:**
First artifact request after idle period (no running tasks) triggers ECS service scale-up. Task takes 20-30 seconds to start (pull image from ECR, initialize container, connect to DSQL). User sees no progress during this time.

**Mitigation:** Set ECS service minimum desired count to 1 (keep one task warm). Cost: ~$30/month for 1 vCPU, 2GB task running 24/7. Task polls SQS continuously even when queue is empty (long polling prevents wasted API calls). Alternative: use provisioned concurrency for Lambda orchestrator to reduce perceived latency (user gets 202 response faster even if task not ready).

**SQS Long Polling Latency:**
Worker uses long polling (20-second wait) to retrieve messages from SQS. If queue is empty, task sits idle for 20 seconds between poll attempts. If message arrives during wait, task starts processing immediately. But if message arrives just after poll, task waits 20 seconds for next poll.

**Mitigation:** Accept 20-second max latency for task pickup (within acceptance criteria of 5-second SQS processing latency on average). If unacceptable, reduce long poll wait time to 5 seconds (increases API call cost). Monitor `ApproximateAgeOfOldestMessage` CloudWatch metric — alert if >60 seconds (indicates task not polling or processing too slowly).

**Bedrock API Throttling:**
High concurrent traffic (10+ Fargate tasks) all calling Bedrock simultaneously. Regional quota (100 requests/minute for Claude 3.5 Sonnet) exceeded. Tasks receive 429 throttle errors, retry with exponential backoff, amplify queue backlog.

**Mitigation:** Request Bedrock quota increase to 500 req/min before production launch. Implement token bucket rate limiting in worker: each task tracks local request rate, sleeps before making Bedrock call if rate exceeds 10 req/min per task. Add CloudWatch metric for Bedrock throttle rate — alert if >10 throttles/minute. Use SQS delay queue for throttled messages (re-enqueue with 2-minute delay to spread load).

**DSQL Write Contention:**
All Fargate tasks write to same `jobs` table (update status column). High concurrent writes could cause row-level lock contention in DSQL, increasing update latency.

**Mitigation:** Use optimistic locking with version column: `UPDATE jobs SET status = $1, updated_at = NOW(), version = version + 1 WHERE job_id = $2 AND version = $3`. If version mismatch, retry update (indicates concurrent modification). Monitor DSQL query latency via CloudWatch metric `DatabaseQueryLatency` — alert if p95 >100ms for UPDATE statements.

**S3 Write Bandwidth:**
Large artifacts (Context Packages with 50+ file contents, long chat histories) could exceed 5MB. Multiple concurrent Fargate tasks writing large objects could saturate S3 request rate or egress bandwidth.

**Mitigation:** Compress artifacts before S3 write (gzip encoding). Add Content-Encoding header so frontend decompresses transparently. Monitor S3 `BytesUploaded` metric — alert if sustained rate >100 MB/s (indicates unexpected large payload). Implement artifact size limit: reject payloads >10MB (permanent failure, send to DLQ, notify user artifact too large).

**Lambda Memory for Job Status Queries:**
Frontend polls `GET /jobs/{jobId}/status` every 5 seconds while artifact generating. High user concurrency (1000+ active users) could create 200+ requests/second to Lambda. If Lambda memory too low (128MB), cold starts increase latency.

**Mitigation:** Set job status Lambda memory to 512MB (faster cold starts, lower cost at high RPS due to fewer instances). Use Lambda provisioned concurrency (5 instances) during peak hours. Cache job status in API Gateway response cache (5-second TTL) to reduce Lambda invocations for hot jobs.

---

## Scope Estimate

### Orbit Breakdown

**Orbit 1 (Infrastructure Foundation):** 1-2 days
- Terraform configuration for Fargate cluster, SQS queues, IAM roles, VPC endpoints
- DSQL migration for jobs table
- CloudWatch alarms and dashboard
- Manual smoke test: enqueue message, verify task starts, check logs

**Orbit 2 (Worker Application):** 3-4 days
- Implement shared clients (Bedrock, S3, DSQL, WebSocket, logger)
- Implement message processor with error handling
- Implement artifact handlers (Intent Document, Context Package, Proposal)
- Dockerfile and image build
- Unit tests for message processing logic

**Orbit 3 (Lambda Integration):** 2-3 days
- Job service implementation
- SQS client with trace propagation
- Modify artifact generation endpoint
- Job status and artifact retrieval endpoints
- Integration tests with mocked SQS/DSQL

**Orbit 4 (Frontend Integration):** 2 days
- Job polling hook
- Progress component
- WebSocket notification handler
- Update artifact generation UI flow
- Component tests

**Orbit 5 (Testing and Observability):** 2-3 days
- E2E tests in staging environment
- CloudWatch dashboard refinement
- Load testing (simulate 50 concurrent artifact requests)
- Security audit (IAM policies, S3 bucket policy)
- Documentation (runbook for on-call, architecture diagrams)

**Total Estimated Duration:** 10-14 days (2-3 weeks with review/iteration cycles)

### Complexity Assessment

**Medium-High Complexity**

**Justification:**
- Introduces new distributed system pattern (async work queue) not previously used in Prometheus V1
- Spans multiple AWS services (Lambda, SQS, Fargate, S3, DSQL, API Gateway WebSocket) with complex IAM cross-service permissions
- Requires careful error handling and idempotency to prevent data loss or duplicate LLM charges
- Cold start optimization and auto-scaling tuning require performance testing to validate
- Migration strategy (dual-path deployment, feature flag) adds complexity to testing and rollout

**Risk Factors:**
- First Fargate deployment in project — team learning curve for ECS task definitions, networking, debugging
- WebSocket notification path has failure modes not present in synchronous HTTP (connection closed, throttling)
- Bedrock API quota limits could block production deployment if not increased proactively

**Mitigations:**
- Phase 1 (infrastructure) validates Fargate networking and IAM permissions before writing application code
- Extensive integration tests in Phase 5 catch edge cases before production
- Feature flag allows gradual rollout (5% traffic → 50% → 100%) with fast rollback if issues detected

### Files Affected

**Files Created:** 24
- Terraform: 6 files (cluster, queues, roles, endpoints, alarms, dashboard)
- Worker application: 11 files (main, processor, 6 handlers, 4 shared clients)
- Lambda functions: 3 files (job service, SQS client, 2 new endpoints)
- Frontend: 2 files (polling hook, progress component)
- Tests: 5 files (worker tests, Lambda tests, E2E tests)
- Database: 1 migration file

**Files Modified:** 6
- Existing Lambda handlers: 2 files (artifact generation, chat)
- Shared models: 2 files (job, artifact-request)
- Frontend services: 1 file (artifact service)
- Frontend hooks: 1 file (WebSocket notifications)

**Total:** 30 files

### Test Coverage

**Estimated Test Cases:** 42

**Unit Tests (Worker):** 15 tests
- Message processor: valid message, invalid schema, idempotency check (3)
- Error handling: transient error retry, permanent error DLQ, exit codes (3)
- Artifact handlers: Intent Document, Context Package, Proposal (each with success, throttle, timeout cases) (9)

**Unit Tests (Lambda):** 8 tests
- Job service: create job, update status, increment retry count (3)
- SQS client: enqueue message, trace propagation, error handling (3)
- Modified endpoints: artifact generation 202 response, chat message enqueue (2)

**Integration Tests:** 10 tests
- Bedrock client: successful inference, throttle retry, timeout (3)
- S3 client: successful write, retry on error, fallback to DSQL (3)
- DSQL repository: connection pooling, query latency, transaction rollback (3)
- WebSocket notifier: successful notification, connection closed handling (1)

**E2E Tests:** 9 tests
- Happy path: submit request → verify 202 → poll status → verify completion → fetch artifact (1)
- WebSocket path: submit request → receive WebSocket notification → fetch artifact (1)
- Failure paths: invalid payload, Bedrock timeout, S3 write failure, max retries exceeded (4)
- Concurrency: 50 concurrent requests, verify all complete within 10 minutes (1)
- Cold start: submit request after 1 hour idle, measure task startup latency (1)
- Idempotency: submit duplicate request, verify only one LLM invocation (1)

---

## Human Modifications

*Pending human review.*