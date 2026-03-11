# Proposal Record — T6-003: Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1
**Generated:** 2024-02-17
**Intent:** T6-003
**Context Packages:**
- Architectural: None provided
- Intent-specific: T6-003 Context Package
**Trust Tier:** 2 — Supervised (new infrastructure primitive in critical path)

---

## Interpreted Intent

When users trigger artifact generation or multi-turn AI conversations that involve heavy LLM processing, the current Lambda-based execution hits AWS's 15-minute timeout ceiling and fails. This intent shifts those long-running operations to Fargate tasks that can run indefinitely, while preserving Lambda as the HTTP request handler for fast user feedback. The architecture becomes asynchronous: Lambda accepts the request, immediately enqueues a job message to SQS, and responds with 202 Accepted. A Fargate task polls the queue, processes the job (calling Bedrock APIs for 30+ minutes if needed), writes results to DSQL and S3, and sends a WebSocket notification back to the frontend when complete.

The critical change is **decoupling user-facing HTTP latency from backend LLM processing time**. Users no longer wait minutes for a response — they get immediate confirmation that the job is queued, then receive push notifications as the task progresses through phases. This enables complex workflows (trajectory decomposition, iterative refinement, multi-agent orchestration) that would otherwise be impossible within Lambda's constraints.

What makes this non-trivial: maintaining transactional consistency across Lambda → SQS → Fargate → DSQL → S3 → WebSocket without introducing race conditions, duplicate processing, or orphaned state. The orbit status must always reflect ground truth, even when Fargate tasks crash, SQS visibility timeouts expire, or WebSocket connections go stale.

---

## Implementation Plan

### Files to Create

**Infrastructure (CDK)**
- `infrastructure/cdk/lib/fargate-task-stack.ts` — ECS cluster, Fargate task definition (4 GB memory, 2 vCPU), task role with S3/DSQL/Bedrock/Secrets Manager permissions, execution role for CloudWatch Logs and ECR pull
- `infrastructure/cdk/lib/sqs-queue-stack.ts` — Standard SQS queue `prometheus-artifact-jobs` with 60-minute visibility timeout, dead-letter queue after 3 retries, server-side encryption enabled
- `infrastructure/cdk/lib/vpc-endpoints-stack.ts` — VPC endpoints for S3, Secrets Manager, CloudWatch Logs, Bedrock (reduces NAT Gateway data transfer costs)
- `infrastructure/cdk/lib/monitoring-fargate-stack.ts` — CloudWatch alarms: SQS depth >100 for 5 min, DLQ depth >0, Fargate task failure rate >5%, OOMKilled events
- `infrastructure/cdk/tests/fargate-task-stack.test.ts` — CDK snapshot tests validating IAM policies, container environment variables, security group rules

**Fargate Container Application**
- `services/fargate-worker/src/main.ts` — Entry point: initializes SQS consumer, registers job handlers, implements graceful shutdown on SIGTERM
- `services/fargate-worker/src/handlers/artifact-generation-handler.ts` — Handler for artifact generation jobs: validates message schema, fetches intent from DSQL, calls Bedrock via shared `packages/bedrock/` client, writes artifact to S3, updates orbit status, sends WebSocket notification
- `services/fargate-worker/src/handlers/chat-continuation-handler.ts` — Handler for AI chat jobs: fetches conversation history, calls Bedrock, appends response to DSQL chat table, notifies frontend
- `services/fargate-worker/src/integrations/sqs-consumer.ts` — SQS long polling wrapper with exponential backoff, message visibility extension during processing, idempotency check via DSQL lookup
- `services/fargate-worker/src/integrations/dsql-client.ts` — Aurora DSQL connection pool (max 10 connections), prepared statements for orbit status updates with optimistic locking
- `services/fargate-worker/src/integrations/notification-client.ts` — Invokes existing Lambda notification function (`services/websocket/src/handlers/notify.ts`) via AWS SDK Lambda.invoke() with InvocationType=Event (async)
- `services/fargate-worker/Dockerfile` — Multi-stage build: Node.js 20 Alpine base, installs dependencies, copies source, sets non-root user, exposes no ports (task is a worker, not a server)
- `services/fargate-worker/package.json` — Dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `@aws-sdk/client-secrets-manager`, DSQL client, shared `packages/bedrock` and `packages/observability`
- `services/fargate-worker/.env.example` — Environment variables template: SQS queue URL, S3 bucket name, DSQL connection string (via Secrets Manager ARN), log level
- `services/fargate-worker/tests/handlers/artifact-generation-handler.test.ts` — Unit tests: valid message processing, idempotency check prevents duplicate execution, DSQL version conflict handling, S3 write failure rollback
- `services/fargate-worker/tests/integrations/sqs-consumer.test.ts` — Integration tests: message parsing, visibility timeout extension, DLQ routing after retries

**Lambda HTTP Layer Modifications**
- `services/api/src/handlers/artifacts/generate.ts` — Add routing logic: if `intent.complexityScore > 5` OR `intent.dependencies.length > 3`, enqueue to SQS and return 202; else process synchronously in Lambda as before
- `services/api/src/handlers/chat/continue.ts` — Add routing logic: if `conversation.messageCount > 10` OR `estimatedTokens > 50000`, enqueue to SQS; else process in Lambda
- `services/api/src/shared/sqs-enqueue-client.ts` — Shared utility: constructs SQS message with `{ jobType, payload: { intentId, orbitId, userId }, metadata: { idempotencyKey, enqueuedAt, requestId } }`, sends to queue, logs message ID
- `services/api/src/shared/job-routing-logic.ts` — Complexity scoring heuristics: intent size, dependency depth, trajectory context size, user tier (free tier forces Fargate for all jobs >1 min to protect Lambda concurrency)
- `services/api/tests/handlers/artifacts/generate-enqueue.test.ts` — Tests: complex intent triggers SQS enqueue, simple intent uses Lambda, SQS send failure returns 503 with retry-after header

**Database Schema**
- `database/migrations/V1.6_add_fargate_actor.sql` — Alter `orbit` table: add `actor` varchar(255) field storing Lambda ARN or Fargate task ARN; add `processing_started_at` timestamp; add index on `status` + `processing_started_at` for stuck job monitoring
- `database/schema/orbit.ts` — Update TypeScript type: `actor: string | null`, `processingStartedAt: Date | null`; add validation: actor format must match `arn:aws:(lambda|ecs):*` pattern

**Monitoring and Operations**
- `docs/runbooks/fargate-task-troubleshooting.md` — Runbook: how to identify stuck tasks, manual SQS message replay, rollback to Lambda-only mode, cost analysis queries
- `infrastructure/cdk/config/fargate-task-capacity.json` — Environment-specific configs: dev (max 2 concurrent tasks), staging (max 10), prod (max 50 with autoscaling)
- `.github/workflows/fargate-worker-deploy.yml` — CI/CD pipeline: build Docker image, push to ECR, update ECS task definition, force new deployment, health check via test SQS message

### Files to Modify

**Shared Libraries**
- `packages/core/src/entities/orbit.ts` — Add `updateStatusFromFargate(taskArn: string, newStatus: OrbitStatus, reason: string)` method with version increment and actor tracking
- `packages/observability/src/logger.ts` — Add `fargate` context field to structured logs; ensure secrets redaction applies to DSQL connection strings in Fargate environment
- `packages/bedrock/src/client.ts` — No changes needed (already supports retry logic and token counting); verify Fargate IAM role has `bedrock:InvokeModel` permission

**WebSocket Notification Service**
- `services/websocket/src/handlers/notify.ts` — Add check: if caller is Fargate task (detect via `context.invokedFunctionArn` containing `ecs-tasks`), allow notification dispatch; existing Lambda-to-Lambda invocation already works

**API Documentation**
- `docs/api/artifacts.md` — Update POST `/artifacts/generate` endpoint: add 202 response code documentation, explain async job flow, document WebSocket notification schema for job completion

### Approach

This implementation follows a **queue-backed job processor pattern** where HTTP responsibilities (request validation, authorization, response formatting) remain in Lambda, and compute-intensive LLM operations move to Fargate. The approach preserves existing code paths for simple operations (no intent left behind) while opening a new execution path for complex workloads.

**Key architectural decisions:**
1. **Lambda decides routing** — Complexity heuristics run in Lambda before enqueue; Fargate never rejects a job or routes back to Lambda
2. **SQS as the boundary** — Lambda writes once to SQS then forgets; Fargate owns the message lifecycle; no shared state between Lambda and Fargate except DSQL
3. **Idempotency at the orbit level** — Before processing, Fargate checks if orbit status is already `in_progress` with a `processing_started_at` timestamp; if found and <90 minutes old, assumes another task is handling it and deletes the SQS message
4. **Notification via Lambda invocation** — Fargate does not call API Gateway WebSocket API directly; instead, it invokes the existing `notify` Lambda function with the same payload structure Lambda uses; this reuses connection ID lookup and error handling
5. **Graceful degradation** — If Fargate cluster is at capacity (max concurrent tasks reached), SQS messages queue up; Lambda responds with 202 but includes `Retry-After: 60` header suggesting frontend poll for status

### Order of Operations

**Phase 1: Infrastructure Foundation** (1 orbit)
1. Deploy VPC endpoints stack (if not already exists from prior work)
2. Deploy SQS queue stack with DLQ and encryption
3. Deploy Fargate task definition with placeholder container image (hello-world)
4. Validate: manually send SQS message, observe Fargate task starts and completes
5. Deploy CloudWatch alarms and dashboards

**Phase 2: Fargate Worker Application** (2 orbits)
1. Implement `services/fargate-worker/src/main.ts` SQS polling loop
2. Implement artifact generation handler with Bedrock integration
3. Implement DSQL orbit status update with optimistic locking
4. Implement S3 artifact write with error rollback
5. Implement WebSocket notification via Lambda invocation
6. Write unit and integration tests
7. Build Docker image, push to ECR, update task definition

**Phase 3: Lambda Integration** (1 orbit)
1. Implement `job-routing-logic.ts` complexity scoring
2. Modify `artifacts/generate.ts` to enqueue SQS message for complex intents
3. Add 202 response handling in frontend (display "processing" state, listen for WebSocket event)
4. Write tests for enqueue path
5. Deploy to staging, validate with test intent

**Phase 4: Database Schema Update** (0.5 orbit)
1. Run migration `V1.6_add_fargate_actor.sql` in dev/staging
2. Update TypeScript types
3. Deploy code that uses new fields

**Phase 5: Monitoring and Documentation** (0.5 orbit)
1. Write runbooks for common failure scenarios
2. Set up cost monitoring dashboard
3. Configure PagerDuty alerts for critical alarms
4. Train on-call engineers on Fargate task debugging

**Phase 6: Production Rollout** (1 orbit)
1. Deploy to prod with feature flag `enableFargateRouting=false`
2. Enable for 1% of complex intents (canary)
3. Monitor error rates, latency, cost for 48 hours
4. Ramp to 10%, 50%, 100% over 1 week
5. Remove Lambda fallback code after 2 weeks of stable Fargate operation

### Dependencies

**Must be completed before execution:**
- VPC with private subnets and NAT Gateway (assumed to exist)
- Aurora DSQL cluster with `orbit` and `artifact` tables (exists)
- WebSocket notification Lambda function (exists from T5-001)
- ECR repository `prometheus-fargate-worker` created
- Secrets Manager entry with DSQL connection credentials

**External service dependencies:**
- AWS Fargate availability in us-east-1
- Bedrock API endpoint reachable from private subnets via NAT Gateway or VPC endpoint
- SQS FIFO queue (if strict ordering required) or Standard queue (if idempotent operations)

**Assumptions that must be validated:**
- Bedrock API rate limits per account: if Fargate tasks scale to 50 concurrent, we're making 50 simultaneous Bedrock calls; verify account quota supports this
- DSQL connection pool sizing: 10 connections per Fargate task; if 50 tasks run concurrently, that's 500 connections; verify DSQL cluster max_connections setting
- NAT Gateway bandwidth: Bedrock responses can be 100+ KB; 50 concurrent tasks = 5 MB/sec minimum; verify NAT Gateway is not bandwidth-constrained

---

## Risk Surface

### Edge Cases

**SQS message size exceeds 256 KB**
- **Scenario:** Intent with 100+ acceptance criteria and full trajectory context creates a message payload >256 KB
- **Mitigation:** In Lambda enqueue logic, check payload size; if >200 KB, write full intent data to S3 at `temp/job-payloads/${idempotencyKey}.json`, include only S3 key in SQS message body; Fargate fetches from S3 before processing
- **Test case:** Generate synthetic intent with 200 acceptance criteria, verify S3 spillover works

**Idempotency key collision**
- **Scenario:** Two users simultaneously click "Generate Proposal" for the same intent, both Lambda invocations generate the same `idempotencyKey` based on `intentId + userId`
- **Mitigation:** Include `requestId` from API Gateway in idempotency key calculation: `uuidv5(intentId + userId + requestId)`; ensures uniqueness even for simultaneous requests
- **Test case:** Simulate concurrent Lambda invocations with same intentId, verify two separate Fargate tasks process both (no collision)

**Fargate task receives SQS message after orbit is already completed**
- **Scenario:** User cancels artifact generation via UI; Lambda marks orbit status=`abandoned`; Fargate task starts processing message queued earlier
- **Mitigation:** First action in Fargate handler: fetch current orbit status from DSQL; if not `draft` or `in_progress`, delete SQS message without processing and log "orbit state mismatch"
- **Test case:** Enqueue SQS message, manually update orbit to `completed` in database, observe Fargate task skips processing

**WebSocket connection expires during long Fargate job**
- **Scenario:** User closes browser tab 10 minutes into a 30-minute artifact generation; Fargate completes but notification fails with 410 Gone
- **Mitigation:** In notification client, catch 410 error, delete stale connection from DSQL, log event; fallback: store "unread notification" flag in user preferences, show banner on next login
- **Test case:** Close WebSocket connection, trigger Fargate job completion, verify 410 is logged but job still marks orbit as completed

**DSQL optimistic locking conflict during status update**
- **Scenario:** Rare case where two processes (Lambda cleanup job + Fargate task) try to update same orbit simultaneously
- **Mitigation:** Retry update up to 3 times with exponential backoff; if still failing, log error with orbit ID + current version number; CloudWatch alarm triggers for investigation
- **Test case:** Simulate version conflict by manually incrementing orbit version mid-Fargate execution, verify retry succeeds

### Regressions

**Lambda timeout protection weakened**
- **Current behavior:** Lambda timeout kills long-running LLM calls cleanly; orbit status remains `in_progress` but user sees HTTP 504 error
- **Risk:** After migration, if routing logic incorrectly sends small intents to Fargate, we add unnecessary latency (Lambda 200ms vs Fargate 10+ seconds cold start)
- **Mitigation:** Comprehensive unit tests for `job-routing-logic.ts` covering all complexity score edge cases; staging deployment validates latency metrics before prod
- **Regression test:** Generate 100 simple intents (score <5), verify 0% go to Fargate

**S3 artifact path conventions broken**
- **Current behavior:** Lambda writes artifacts to `s3://prometheus-artifacts-${env}/projects/${projectId}/trajectories/${trajectoryId}/intents/${intentId}/orbits/${orbitId}/artifacts/${artifactId}.md`
- **Risk:** Fargate implementation uses different path construction, orphaning artifacts or breaking frontend S3 presigned URL generation
- **Mitigation:** Extract path construction logic to shared `packages/core/src/storage/artifact-paths.ts`, import in both Lambda and Fargate; integration test verifies Fargate-written artifacts are readable by Lambda
- **Regression test:** Generate artifact via Fargate, fetch via Lambda download endpoint, verify content matches

**WebSocket notification schema drift**
- **Current behavior:** Notifications have `{ type: 'ORBIT_COMPLETED', orbitId, data: { artifactId } }` schema
- **Risk:** Fargate adds new fields or changes field types, breaking frontend notification handlers
- **Mitigation:** Define shared TypeScript interface `NotificationPayload` in `packages/core/src/notifications/types.ts`, validate in both Lambda and Fargate before sending; JSON schema validation tests prevent drift
- **Regression test:** Send notification from Fargate, verify frontend websocket handler parses correctly

### Security Concerns

**Fargate task IAM role over-privileged**
- **Risk:** Task role granted wildcard S3 permissions (`s3:*`) instead of scoped to specific bucket/prefix
- **Mitigation:** CDK IAM policy builder uses explicit resource ARNs: `arn:aws:s3:::prometheus-artifacts-${env}/projects/${projectId}/*`; PR review checklist includes "no wildcard resource ARNs"
- **Audit:** Run `aws iam simulate-principal-policy` to verify task role cannot access unrelated S3 buckets

**Secrets Manager credentials logged**
- **Risk:** DSQL connection string (`postgres://user:pass@host/db`) appears in CloudWatch Logs during error logging
- **Mitigation:** `packages/observability/src/logger.ts` already has redaction logic for password patterns; extend to redact full connection strings matching `postgres://` pattern
- **Security test:** Trigger DSQL connection error, search CloudWatch Logs for substring `postgres://`, verify 0 results

**SQS message replay attack**
- **Risk:** Attacker with SQS `ReceiveMessage` permission replays old messages to cause duplicate processing
- **Mitigation:** Enable SQS message deduplication for FIFO queues (5-minute window); for standard queues, idempotency key check in Fargate prevents duplicate execution even if message replayed
- **Threat model:** Assumes attacker does not have DSQL write access; if they do, replay is least of concerns

**Bedrock API key exposure**
- **Risk:** API key stored in container environment variable, visible in ECS task definition JSON
- **Mitigation:** Store API key in Secrets Manager, reference ARN in task definition, AWS injects secret at runtime; never log API key even in debug mode
- **Compliance check:** Export task definition JSON, verify no plaintext secrets in `environment` section

### Performance Implications

**SQS polling latency adds overhead**
- **Expected impact:** Lambda response time increases from 150ms (synchronous) to 180ms (enqueue SQS message); frontend receives 202 Accepted immediately but waits 10-60 seconds for Fargate to start processing
- **Quantified concern:** P95 end-to-end latency (request → notification) increases from 8 minutes to 9 minutes (1 minute SQS + Fargate cold start overhead)
- **Acceptable:** Per acceptance boundaries, <10 seconds to job start is acceptable
- **Optimization:** Pre-warm 1 Fargate task in prod during business hours to reduce cold start frequency

**DSQL connection pool contention**
- **Expected impact:** Fargate tasks hold DSQL connections for 5-30 minutes (duration of job); at 50 concurrent tasks with 10 connections each = 500 total connections
- **Quantified concern:** DSQL cluster default max_connections = 1000; at 50% headroom, we're safe until 50 concurrent Fargate tasks
- **Mitigation:** Set ECS service max tasks = 50; CloudWatch alarm if RunningTaskCount >40; tune DSQL connection pool timeout to 30 seconds idle before close

**NAT Gateway bandwidth bottleneck**
- **Expected impact:** Each Fargate task makes 1-5 Bedrock API calls with 50-100 KB responses; at 50 concurrent tasks = 2.5-25 MB total payload
- **Quantified concern:** NAT Gateway supports up to 45 Gbps but bills per GB processed ($0.045/GB); 1000 jobs/day * 500 KB average = 500 MB/day = $0.02/day (negligible)
- **Optimization:** Use Bedrock VPC endpoint (if available in region) to eliminate NAT Gateway data transfer charges entirely

**S3 PUT request throttling**
- **Expected impact:** Each artifact generation does 1 S3 PUT (write artifact) + 1 DSQL INSERT (metadata); S3 supports 3500 PUT/second per prefix
- **Quantified concern:** At 50 concurrent Fargate tasks completing every 10 minutes = 5 requests/second, well below throttle limit
- **No action needed:** S3 throttling is not a risk at this scale

---

## Scope Estimate

### Complexity Assessment

**Medium-High** — This intent introduces a new asynchronous execution model with cross-service orchestration (Lambda → SQS → Fargate → DSQL → S3 → WebSocket) and requires careful transaction boundary management to maintain data consistency. The individual components (SQS queue, Fargate task, Docker container) are well-understood AWS primitives, but integrating them into an existing Lambda-centric codebase touches multiple layers:

- **Infrastructure:** New CDK stacks for SQS, Fargate, VPC endpoints, monitoring
- **Application:** New Fargate worker service with SQS consumer, job handlers, notification client
- **Shared logic:** Modifications to orbit entity, logger, routing heuristics
- **Database:** Schema migration for new actor field
- **Testing:** Unit, integration, and end-to-end tests spanning Lambda → Fargate flow
- **Operations:** Runbooks, monitoring dashboards, rollback procedures, CI/CD pipeline

**Not High complexity:** No new algorithm development, no distributed consensus, no data migration (schema is additive). The risk is primarily operational (what happens when Fargate tasks crash?) rather than architectural (the pattern is proven).

**Not Low complexity:** More than a simple feature add; introduces new failure modes and requires team training on debugging distributed async systems.

### File Count

| Category | Files Created | Files Modified | Total |
|----------|---------------|----------------|-------|
| Infrastructure (CDK) | 5 | 1 | 6 |
| Fargate Worker | 10 | 0 | 10 |
| Lambda API Layer | 2 | 2 | 4 |
| Shared Libraries | 0 | 3 | 3 |
| Database | 1 | 1 | 2 |
| Tests | 6 | 2 | 8 |
| Documentation | 2 | 1 | 3 |
| CI/CD | 1 | 0 | 1 |
| **Total** | **27** | **10** | **37** |

### Orbit Breakdown

| Phase | Description | Estimated Orbits | Rationale |
|-------|-------------|------------------|-----------|
| **Infrastructure Foundation** | Deploy SQS, Fargate task definition, VPC endpoints, monitoring | 1 | Mostly declarative CDK code; complexity is in IAM policy correctness |
| **Fargate Worker Application** | Implement SQS consumer, job handlers, integrations with DSQL/S3/Bedrock/WebSocket | 2 | Largest code volume; requires careful error handling and idempotency logic |
| **Lambda Integration** | Add routing logic, enqueue SQS messages, return 202 responses | 1 | Straightforward Lambda modifications; routing heuristics need validation |
| **Database Schema Update** | Migration + type updates | 0.5 | Simple additive schema change; zero downtime migration |
| **Monitoring and Documentation** | Runbooks, dashboards, alerts | 0.5 | Time-consuming but low technical complexity |
| **Production Rollout** | Canary deploy, ramp up, monitor | 1 | Operational work; multiple observation periods |
| **Testing and Validation** | Unit, integration, E2E tests across all phases | (embedded) | Testing effort included in each phase's orbit estimate |
| **Total** | | **6 orbits** | ~2-3 weeks of focused development |

### Test Coverage Estimate

| Test Type | Test Count | Coverage Target |
|-----------|------------|-----------------|
| **Unit Tests** | 45 | 80% line coverage for Fargate worker, 90% for routing logic |
| Lambda routing heuristics | 12 | All edge cases: boundary conditions for complexity score, dependency depth, token count |
| Fargate job handlers | 15 | Valid message, missing fields, idempotency check, DSQL version conflict, S3 failure rollback |
| SQS consumer logic | 8 | Message parsing, visibility timeout extension, DLQ routing, graceful shutdown |
| DSQL client integration | 5 | Connection pooling, prepared statements, optimistic locking retry |
| Notification client | 5 | Lambda invocation, 410 handling, payload serialization |
| **Integration Tests** | 20 | End-to-end flows in isolated environment (LocalStack or AWS dev account) |
| Lambda → SQS → Fargate flow | 8 | Enqueue message, Fargate processes, orbit status updated, WebSocket sent |
| Error scenarios | 7 | Fargate crashes mid-job, SQS message expires, DSQL connection lost, S3 timeout |
| Idempotency validation | 5 | Replay message, verify duplicate not processed |
| **E2E Tests** | 5 | Real AWS infrastructure in staging |
| Complex intent artifact generation | 2 | Full flow from frontend POST to WebSocket notification receipt |
| Long-running chat continuation | 2 | Multi-turn conversation exceeding 10 minutes |
| Canary deployment validation | 1 | 1% of prod traffic routed to Fargate, monitor error rate vs Lambda baseline |
| **CDK Infrastructure Tests** | 10 | Snapshot tests for all stacks |
| IAM policy validation | 4 | Least privilege checks, no wildcard permissions |
| Security group rules | 3 | No inbound from internet, only egress to AWS services |
| CloudWatch alarm thresholds | 3 | Validate alarm triggers at expected conditions |
| **Total** | **80** | Comprehensive coverage of happy path, error scenarios, and infrastructure correctness |

### Acceptance Validation Plan

| Acceptance Boundary | Validation Method | Success Criteria |
|---------------------|-------------------|------------------|
| **Functional: Lambda → SQS → Fargate → WebSocket flow** | E2E test with synthetic intent | Orbit status transitions from `draft` → `in_progress` → `completed`; frontend receives WebSocket event within 5 seconds of completion |
| **Functional: AI chat >10 minutes completes** | Load test with 20-turn conversation | No Lambda timeouts; conversation completes in Fargate; all turns stored in DSQL |
| **Performance: Lambda response <500ms** | Artillery load test (100 RPS) | P95 latency for POST `/artifacts/generate` <500ms when SQS enqueue path is used |
| **Performance: Fargate job start <10 seconds** | Synthetic SQS message, measure time to first log | P95 cold start <60 seconds, P95 warm start <10 seconds |
| **Reliability: Task failure rate <5%** | Chaos engineering: kill 10% of Fargate tasks mid-execution | ≥95% of killed tasks result in orbit status=`failed` within 2 minutes; SQS message moved to DLQ or retried |
| **Reliability: No duplicate processing** | Replay SQS messages manually | 0 cases of orbit processed twice (validated via DSQL audit log) |
| **Observability: X-Ray trace links** | Trigger artifact generation, inspect X-Ray console | Trace segments present for Lambda → SQS → Fargate → Bedrock → DSQL → S3 → WebSocket |
| **Operational: Rollback succeeds** | Disable Fargate routing via feature flag, redeploy Lambda | All enqueued SQS messages drained (processed by remaining Fargate tasks); new requests route to Lambda synchronous path |

---

## Human Modifications

Pending human review.