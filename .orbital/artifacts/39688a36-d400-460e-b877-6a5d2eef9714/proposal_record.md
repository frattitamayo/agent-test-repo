# Proposal Record: T6-003 · Migrate long-running LLM tasks to Fargate

**Proposal ID:** PROP-T6-003-1  
**Generated:** 2024-02-17  
**Intent:** T6-003  
**Context Package:** CTX-T6-003  
**Trust Tier:** 2 — Supervised

---

## Interpreted Intent

When users request AI-generated artifacts or engage in conversational chat, the system currently executes these operations synchronously within Lambda functions that are constrained by a 15-minute timeout and 10GB memory limit. This architectural ceiling has caused production failures when complex prompts trigger long-running Bedrock invocations that exceed Lambda's hard boundaries.

The desired outcome is an asynchronous processing architecture where HTTP requests return immediately with acknowledgment while LLM operations execute in Fargate containers that have no practical timeout limit and can scale to 30GB memory. Users perceive no degradation — they still receive results via WebSocket notifications — but the platform gains operational headroom to handle arbitrarily complex prompts, concurrent workloads, and future model upgrades that may require even more compute resources.

The critical constraint is that this migration must be invisible to frontend clients: no API contract changes, no new endpoints, no breaking changes to WebSocket event schemas. The existing Lambda handlers become thin enqueue-and-acknowledge adapters while Fargate tasks inherit all the LLM processing logic previously embedded in those handlers.

---

## Implementation Plan

### Files to Create

#### Infrastructure Layer
- `infrastructure/lib/constructs/fargate-service.ts` — Reusable CDK construct for ECS Fargate service configuration with auto-scaling policies based on SQS depth. Encapsulates task definition, service, CloudWatch alarms, and scaling triggers.
- `infrastructure/lib/constructs/sqs-queue.ts` — CDK construct for SQS standard queue with dead-letter queue, retry policy (maxReceiveCount: 3), and message retention (4 days standard, 14 days DLQ).
- `infrastructure/lib/stacks/fargate-worker-stack.ts` — Stack definition that instantiates Fargate service construct, wires SQS queue, grants IAM permissions, and configures CloudWatch dashboard.

#### Fargate Application
- `services/fargate-worker/src/main.ts` — Entry point for Fargate container. Implements SQS long-polling loop, message deserialization, routing to appropriate handler based on `operation` field, X-Ray trace propagation, graceful shutdown on SIGTERM.
- `services/fargate-worker/src/processor.ts` — Message routing orchestrator. Validates message schema, delegates to handler, manages transaction boundaries (Bedrock → S3 → DSQL → SQS delete), emits CloudWatch metrics.
- `services/fargate-worker/src/handlers/artifact-generator.ts` — Extracted artifact generation logic. Accepts message parameters, invokes Bedrock with prompt construction, writes result to S3 at `s3://prometheus-artifacts/{intentId}/output.json`, inserts DSQL record with artifact metadata.
- `services/fargate-worker/src/handlers/chat-processor.ts` — Extracted chat completion logic. Manages conversation history, invokes Bedrock streaming API, writes message to DSQL `chat_messages` table, constructs WebSocket notification payload.
- `services/fargate-worker/src/lib/bedrock-client.ts` — Bedrock SDK wrapper with request timeout (50 minutes), exponential backoff retry (3 attempts), token usage logging, X-Ray subsegment tracing.
- `services/fargate-worker/src/lib/s3-storage.ts` — S3 persistence layer with multipart upload for large artifacts, idempotency key metadata (`x-amz-meta-idempotency-key: {intentId}`), retry on throttling errors.
- `services/fargate-worker/src/lib/dsql-client.ts` — DSQL connection pool (10 connections), upsert queries with `ON CONFLICT` for idempotency, circuit breaker pattern after 3 consecutive failures.
- `services/fargate-worker/src/lib/websocket-notifier.ts` — WebSocket notification client. Invokes existing `/notify` Lambda function asynchronously via AWS SDK, includes retry logic (2 attempts), logs delivery failures.
- `services/fargate-worker/Dockerfile` — Multi-stage build. Builder stage: `npm ci --only=production`, TypeScript compilation. Runtime stage: Node.js 20 Alpine, non-root `node` user, health check endpoint on port 3000.
- `services/fargate-worker/package.json` — Dependencies: `@aws-sdk/client-sqs`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `@aws-sdk/client-secrets-manager`, `aws-xray-sdk-core`, `zod` for schema validation.
- `services/fargate-worker/tsconfig.json` — TypeScript configuration matching Lambda environment: target ES2022, strict mode enabled, path aliases for `@/lib/*` imports.

#### Shared Libraries
- `services/shared/src/schemas/sqs-messages.ts` — Zod schemas for `ArtifactGenerationMessage` and `ChatCompletionMessage`. Exported validation functions `validateArtifactMessage()` and `validateChatMessage()` used by both Lambda and Fargate.
- `services/shared/src/lib/sqs-client.ts` — SQS client wrapper for Lambda. Handles message publishing with trace ID propagation, message attribute injection, error handling with circuit breaker.

#### Monitoring
- `infrastructure/lib/constructs/fargate-alarms.ts` — CloudWatch alarms: DLQ depth >0 (critical), task failure rate >0.1% (warning), task run duration >45 minutes (warning), memory utilization >90% (warning), CPU utilization >80% (info).
- `infrastructure/lib/stacks/monitoring-stack.ts` — Add Fargate-specific widgets to existing CloudWatch dashboard: SQS depth graph, task count graph, success/failure rate pie chart, p50/p95/p99 latency line graph, cost per 1000 operations bar chart.

#### API Layer Modifications
- `services/api/src/lib/sqs-client.ts` — Create shared SQS client instance with environment variable `FARGATE_QUEUE_URL`, retry configuration, X-Ray instrumentation.

#### Tests
- `services/fargate-worker/src/__tests__/handlers/artifact-generator.test.ts` — Unit tests with mocked Bedrock/S3/DSQL clients. Test cases: successful generation, Bedrock timeout, S3 write failure, DSQL upsert, idempotency key handling.
- `services/fargate-worker/src/__tests__/handlers/chat-processor.test.ts` — Unit tests for chat flow. Test cases: streaming response parsing, conversation history truncation, WebSocket notification construction.
- `services/fargate-worker/src/__tests__/integration/sqs-polling.test.ts` — Integration test with LocalStack. Publishes message to SQS, verifies Fargate main loop retrieves and processes, confirms message deletion.
- `services/api/src/__tests__/handlers/artifacts/generate.test.ts` — Update existing tests. Replace assertions on direct Bedrock invocation with assertions on SQS message publishing. Verify HTTP 202 response with correlation ID.

### Files to Modify

#### Lambda Handlers (Extract-to-SQS Pattern)
- `services/api/src/handlers/artifacts/generate.ts`  
  **Changes:** Remove Bedrock invocation logic. Add SQS message publishing with schema from `services/shared`. Return HTTP 202 Accepted with `{correlationId, status: 'processing'}` payload. Preserve existing JWT validation and request validation middleware.

- `services/api/src/handlers/chat/complete.ts`  
  **Changes:** Remove Bedrock streaming invocation logic. Add SQS message publishing with conversation history and user message. Return HTTP 202 Accepted. Frontend already handles async responses via WebSocket.

#### Infrastructure Configuration
- `infrastructure/lib/stacks/compute-stack.ts`  
  **Changes:** Instantiate `FargateWorkerStack` and `SQSQueue` constructs. Pass references to existing S3 artifact bucket, DSQL cluster ARN, WebSocket notify function ARN. Grant Lambda handlers permission to publish to SQS queue (add `sqs:SendMessage` policy).

- `infrastructure/lib/stacks/iam-stack.ts`  
  **Changes:** Export new `FargateWorkerTaskRole` with inline policies for Bedrock (`bedrock:InvokeModel`), S3 (`s3:PutObject`, `s3:GetObject`), DSQL (`dsql:ExecuteStatement`), SQS (`sqs:ReceiveMessage`, `sqs:DeleteMessage`), Lambda (`lambda:InvokeFunction` for `/notify`), Secrets Manager (`secretsmanager:GetSecretValue`).

- `infrastructure/lib/stacks/monitoring-stack.ts`  
  **Changes:** Add imports for Fargate alarm construct. Add alarm action to existing SNS topic for on-call notifications. Add dashboard widgets for Fargate metrics to existing Prometheus operational dashboard.

#### Environment Configuration
- `services/api/.env.production`  
  **Changes:** Add `FARGATE_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/{account}/prometheus-fargate-queue`. Inject via CDK stack outputs.

- `services/fargate-worker/.env`  
  **Changes:** Create environment file with `QUEUE_URL`, `WEBSOCKET_NOTIFY_FUNCTION`, `AWS_REGION`, `NODE_ENV=production`. Values injected from ECS task definition environment variables.

### Approach

The implementation follows an **extract-and-delegate** pattern: existing LLM processing logic is extracted from Lambda handlers into Fargate worker handlers with minimal changes. Lambda functions become thin adapters that validate requests, enrich with user context from JWT claims, publish SQS messages, and return immediate HTTP 202 acknowledgment.

The Fargate worker container runs a single-threaded Node.js process that polls SQS with long-polling (20-second WaitTimeSeconds). Each message retrieved spawns a handler invocation within the same process — no concurrency within a single task. Scaling is horizontal: ECS auto-scaling provisions additional tasks when SQS depth exceeds thresholds (1 message = 1 task, 10 messages = 2 tasks, 50 messages = 5 tasks, max 10 tasks).

Message processing is transactional at the application layer: Bedrock invocation → S3 write → DSQL write → WebSocket notification → SQS message deletion. If any step fails, the entire sequence is retried after visibility timeout expires. Idempotency is enforced via `intentId` as the deduplication key — duplicate processing is safe (S3 overwrites, DSQL upserts, WebSocket notifications deduplicated by frontend).

X-Ray tracing propagates `traceId` from API Gateway through Lambda → SQS (message attribute) → Fargate (extracted from message) → Bedrock/S3/DSQL/WebSocket, enabling end-to-end request tracing across service boundaries.

### Order of Operations

1. **Infrastructure Foundation (Orbit 1, Phase 1)**
   - Create SQS queue construct with DLQ and retention policies
   - Define Fargate task role with IAM policies
   - Create ECR repository for worker image
   - Deploy queue and IAM resources to AWS

2. **Fargate Worker Application (Orbit 1, Phase 2)**
   - Implement `main.ts` SQS polling loop with graceful shutdown
   - Extract artifact generation logic to `handlers/artifact-generator.ts`
   - Extract chat processing logic to `handlers/chat-processor.ts`
   - Implement Bedrock/S3/DSQL/WebSocket client wrappers
   - Write unit tests for handlers and integration test for SQS flow
   - Create Dockerfile with multi-stage build
   - Build and push image to ECR

3. **Fargate Service Deployment (Orbit 1, Phase 3)**
   - Create Fargate service construct with task definition
   - Configure auto-scaling policies based on SQS metrics
   - Deploy CloudWatch alarms and dashboard widgets
   - Deploy Fargate service with `desiredCount: 0` (inactive)
   - Verify task can start, poll SQS, and shut down cleanly

4. **Lambda Handler Migration (Orbit 2, Phase 1)**
   - Create shared SQS message schemas in `services/shared`
   - Implement SQS client wrapper for Lambda
   - Modify `artifacts/generate.ts` to publish SQS message instead of invoking Bedrock
   - Modify `chat/complete.ts` to publish SQS message
   - Update Lambda handler tests to assert on SQS publishing
   - Deploy Lambda changes behind feature flag `FARGATE_ENABLED=false`

5. **End-to-End Validation (Orbit 2, Phase 2)**
   - Enable feature flag `FARGATE_ENABLED=true` in staging environment
   - Set Fargate service `desiredCount: 1` to activate processing
   - Execute test artifact generation request → verify SQS message → verify Fargate processing → verify S3/DSQL writes → verify WebSocket notification
   - Execute test chat completion → verify same flow
   - Load test with 50 concurrent requests → verify auto-scaling behavior
   - Verify DLQ remains empty (no processing failures)

6. **Production Rollout (Orbit 3)**
   - Deploy infrastructure and application to production with `FARGATE_ENABLED=false`
   - Canary deployment: Enable `FARGATE_ENABLED=true` for 10% of traffic (feature flag with user ID hash mod 10)
   - Monitor for 24 hours: CloudWatch dashboard, cost anomaly detection, DLQ depth, WebSocket delivery rate
   - If metrics are green: ramp to 50% traffic for 24 hours
   - If metrics remain green: ramp to 100% traffic
   - Remove feature flag after 7 days of stable operation

7. **Lambda Deprecation (Orbit 4)**
   - Remove Bedrock invocation logic from Lambda handlers (no longer needed as fallback)
   - Reduce Lambda memory allocation from 10GB to 512MB (now only enqueuing messages)
   - Reduce Lambda timeout from 10 minutes to 30 seconds
   - Update cost tracking dashboard with savings from Lambda downsize

### Dependencies

#### Internal (Blocking)
- **T6-001: Container Infrastructure Setup** — ECS Fargate cluster, VPC with NAT Gateway, ECR repository must exist. Task definition references these resources.

#### Internal (Parallel)
- None — this intent can execute independently once T6-001 is complete.

#### External
- **AWS Bedrock quota:** Current quota is 100,000 tokens/minute for Claude 3.5 Sonnet. Fargate-based processing does not change quota consumption — same API calls, different compute substrate. If aggregate throughput increases due to improved reliability (fewer timeouts = more successful completions), monitor CloudWatch metric `Bedrock/ThrottledRequests` and request quota increase if approaching limit.
- **DSQL connection limits:** Current cluster supports 500 concurrent connections. Each Fargate task opens 10 connections. Max 10 tasks = 100 connections, well within limit.
- **S3 request rate:** Artifact bucket configured for high request rate (automatic partitioning). No additional configuration needed.

#### Assumptions
- **Secrets Manager:** Bedrock API keys and DSQL connection strings already exist in Secrets Manager (established in T4-002 and prior work). Fargate task role granted `secretsmanager:GetSecretValue` permission.
- **WebSocket `/notify` endpoint:** Existing Lambda function accepts async invocations with standardized payload schema. No changes required — Fargate invokes same endpoint Lambda uses internally.
- **Frontend reconnection logic:** Existing WebSocket client already implements exponential backoff and reconnection after dropped connections (established in T3-005). No frontend changes required.

---

## Risk Surface

### Edge Cases

#### SQS Message Attribute Size Limit
**Case:** Message body exceeds 256KB limit when including large conversation history (50+ messages in chat completion request).  
**Handling:** Pre-validation in Lambda before publishing: calculate estimated message size. If conversation history causes size to exceed 200KB (buffer for safety), truncate to most recent 20 messages and include `truncated: true` flag. Fargate handler logs truncation event.  
**Test:** Unit test with 100-message conversation history verifies truncation logic.

#### Concurrent SQS Message Processing for Same Intent
**Case:** User submits artifact generation request, cancels via frontend, immediately resubmits. Two SQS messages exist for same `intentId`, both processed by separate Fargate tasks simultaneously.  
**Handling:** DSQL upsert query with `ON CONFLICT (intent_id) DO UPDATE SET updated_at = NOW(), data = EXCLUDED.data` ensures second write wins (last-write-wins semantics). S3 write with same key overwrites. WebSocket sends two notifications — frontend deduplicates by `intentId` (already implemented in T3-005 notification handler).  
**Test:** Integration test publishes two messages with same `intentId`, verifies DSQL contains single record with latest data.

#### Bedrock API Rate Limit Exceeded During Batch Processing
**Case:** SQS backlog of 100 messages triggers auto-scaling to 10 Fargate tasks. All tasks invoke Bedrock simultaneously, exceeding per-second rate limit.  
**Handling:** Bedrock SDK includes automatic exponential backoff retry with jitter (AWS SDK default behavior). Fargate task logs `ThrottlingException`, retries after backoff (1s → 2s → 4s), emits CloudWatch metric `Bedrock/ThrottleRetries`. If all retries exhausted (after 8 attempts), task fails, SQS message returns to queue, DLQ alarm triggers after 3 total failures.  
**Test:** Mock Bedrock client to return `ThrottlingException` on first two invocations, verify retry succeeds on third attempt.

#### Fargate Task Restart During Processing
**Case:** ECS initiates task replacement during deployment or AZ maintenance. SIGTERM sent to running task mid-Bedrock invocation.  
**Handling:** Graceful shutdown handler in `main.ts` listens for SIGTERM. On receipt, waits for current SQS message processing to complete (up to 60 seconds), then exits. ECS waits for `stopTimeout: 60 seconds` before SIGKILL. If message processing does not complete within 60 seconds, message returns to queue after visibility timeout (task did not delete message).  
**Test:** Integration test sends SIGTERM to Fargate process during mock long-running operation, verifies SQS message not deleted, task exits within 60 seconds.

### Regressions

#### Increased End-to-End Latency for Short Operations
**Existing behavior:** Simple artifact generation (e.g., risk assessment with 5K token prompt) completes in 2 minutes via Lambda.  
**New behavior:** Same operation now includes SQS enqueue (10ms) + Fargate cold start (25 seconds) + processing (2 minutes) = 2 minutes 25 seconds.  
**Regression risk:** Users perceive slower response for operations that previously completed within Lambda timeout.  
**Mitigation:** Fargate auto-scaling maintains warm pool of 1 task when SQS depth >1 (scaling step: `lower: 1, change: +1`). Warm tasks have <1 second startup latency. Accept 25-second cold start penalty for first request after idle period as acceptable trade-off for unbounded timeout capability.  
**Monitoring:** CloudWatch metric `EndToEndLatency` with p50/p95/p99 percentiles. Alert if p95 increases >10% compared to pre-migration baseline (requires 7-day comparison window post-deployment).

#### Lost In-Progress Work on Rollback
**Existing behavior:** Lambda-based processing can be rolled back by redeploying prior Lambda function version. In-progress invocations complete normally.  
**New behavior:** Rollback requires disabling Fargate service and toggling `FARGATE_ENABLED=false` feature flag. SQS messages already enqueued remain in queue — Lambda cannot process them (incompatible message schema).  
**Regression risk:** Inflight work stalls during rollback window (1-5 minutes).  
**Mitigation:** Rollback procedure includes SQS queue drain step: temporary Lambda function consumes messages from queue and processes via old Bedrock invocation path. Message schema is backward-compatible (Lambda can deserialize Fargate messages). Drain completes in <10 minutes for typical backlog (<100 messages).  
**Test:** Staging environment rollback rehearsal includes publishing 50 SQS messages, disabling Fargate, deploying drain function, verifying all messages processed.

#### WebSocket Notification Delivery Drops During High Load
**Existing behavior:** Lambda invokes `/notify` synchronously (RequestResponse invocation type), waits for confirmation, retries on failure.  
**New behavior:** Fargate invokes `/notify` asynchronously (Event invocation type), does not wait for confirmation, relies on Lambda's built-in retry (2 attempts).  
**Regression risk:** WebSocket notification delivery success rate decreases from 99.9% to 98% under high concurrency (Lambda throttling).  
**Mitigation:** CloudWatch alarm on Lambda `/notify` error rate >2%. Frontend polling fallback already implemented (T3-005) — checks artifact status every 30 seconds if no WebSocket event received within 2 minutes. Worst-case user experience: 30-second delay before fallback polling discovers completion.  
**Monitoring:** CloudWatch metric `WebSocketDeliveryRate` calculated as `Invocations - Errors / Invocations`. Track p95 latency from Fargate invocation to frontend receipt via X-Ray trace correlation.

### Security Considerations

#### Secrets Exposure in Container Logs
**Threat:** Bedrock API responses or DSQL connection strings accidentally logged in plaintext to CloudWatch Logs.  
**Impact:** Credentials compromised if IAM policy grants overly permissive log access.  
**Mitigation:** Implement log sanitization middleware in Fargate worker. Before emitting log line, redact keys matching patterns: `/Bearer [A-Za-z0-9-._~+/]+=*/g`, `/password=S+/g`, `/secret_key=S+/g`. Secrets loaded from Secrets Manager via ECS task definition `secrets` field (injected as environment variables) — never logged. Code review checklist includes "verify no secrets in console.log() statements".  
**Test:** Unit test verifies log sanitization regex catches Bedrock authorization headers, DSQL passwords, AWS access keys.

#### SQS Message Tampering
**Threat:** Attacker with IAM permissions modifies SQS message body to inject malicious prompts or redirect artifact storage to unauthorized S3 bucket.  
**Impact:** Arbitrary LLM prompts executed, potentially extracting sensitive data from Bedrock training corpus. Artifacts written to attacker-controlled storage.  
**Mitigation:** SQS queue policy restricts `sqs:SendMessage` to Lambda execution role only (no other principals). Lambda validates all request parameters against intent schema before publishing. Fargate validates message schema with Zod — rejects malformed messages to DLQ. S3 write path is constructed from `intentId` (not user-supplied) — no path traversal risk.  
**Monitoring:** CloudWatch alarm on SQS `MessageValidationFailure` metric (custom metric emitted by Fargate when Zod validation rejects message). Threshold: >5 per hour triggers security incident review.

#### Privilege Escalation via Task Role
**Threat:** Fargate task role includes overly permissive IAM policies. Compromised task could access unrelated AWS resources (DynamoDB tables, EC2 instances, other S3 buckets).  
**Impact:** Lateral movement within AWS account, potential data exfiltration.  
**Mitigation:** Task role follows principle of least privilege: explicit resource ARNs for S3 bucket, DSQL cluster, Bedrock models, WebSocket Lambda function. No wildcard `*` resources except Bedrock foundation models (required by API). IAM policy review during CDK code review — checklist includes "verify no admin or power user policies attached". Automated IAM policy linting via `cfn-nag` during CI/CD pipeline (fails build on overly permissive policies).  
**Test:** Integration test with least-privilege IAM policy verifies task cannot access unrelated S3 buckets, cannot invoke unrelated Lambda functions.

### Performance Concerns

#### Fargate Cold Start Latency Under Burst Load
**Scenario:** SQS backlog goes from 0 to 50 messages within 10 seconds (e.g., user bulk-generates artifacts for 50 intents simultaneously).  
**Impact:** Auto-scaling provisions 5 new tasks. Cold start latency = 25 seconds per task. First 5 messages processed immediately (existing warm tasks), next 45 messages wait 25 seconds before processing begins.  
**Quantified concern:** p95 end-to-end latency increases from 2 minutes to 2.5 minutes during burst events occurring <5% of the time.  
**Mitigation:** Accept 25-second cold start penalty as acceptable for rare burst scenarios. Alternative (deferred): Maintain warm pool of 2 tasks continuously (costs $150/month baseline) — reduces cold start frequency to <1% but increases idle cost. Implement if p95 latency SLA requires <2 minute 15 second ceiling.

#### N+1 DSQL Query Pattern for Chat History
**Scenario:** Chat completion handler loads conversation history from DSQL via `SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`. For conversations with 50 messages, this is efficient. But subsequent DSQL writes (inserting new message) occur in separate query.  
**Impact:** Two round-trips to DSQL per chat completion (read history + write new message). At 45ms p50 latency per query, total DSQL time = 90ms.  
**Quantified concern:** DSQL accounts for <5% of total end-to-end latency (expected Bedrock invocation = 2-10 minutes). Not performance-critical.  
**Optimization (deferred):** Batch DSQL operations if future requirements include writing multiple records (e.g., storing intermediate LLM reasoning steps). Current implementation is acceptable.

#### S3 Multipart Upload Overhead for Small Artifacts
**Scenario:** Risk assessment artifacts are typically 50KB JSON files. Multipart upload initializes with 5MB part size, resulting in single-part upload.  
**Impact:** Multipart upload API includes overhead (CreateMultipartUpload + CompleteMultipartUpload requests = 2 additional API calls). For 50KB file, simple PutObject would be faster.  
**Quantified concern:** Multipart upload adds ~50ms overhead vs. simple PutObject. Acceptable trade-off for consistency (same code path handles 50KB and 50MB artifacts).  
**Optimization (deferred):** Implement size-based heuristic: if artifact <5MB, use PutObject; if ≥5MB, use multipart upload. Complexity not justified for 50ms optimization.

#### WebSocket Notification Lambda Throttling Under Concurrent Load
**Scenario:** 10 Fargate tasks complete processing simultaneously, all invoke `/notify` Lambda function within 1 second window.  
**Impact:** Lambda has reserved concurrency = 100 (shared across all Prometheus functions). If other functions consuming concurrency, `/notify` may throttle (TooManyRequestsException).  
**Quantified concern:** Throttling causes failed WebSocket delivery. Frontend polling fallback activates after 2 minutes, but user perceives no progress during window.  
**Mitigation:** Increase `/notify` Lambda reserved concurrency to 20 (dedicated capacity). Monitor CloudWatch metric `ConcurrentExecutions` for `/notify` function — alert if approaching 20. Cost impact: $0 (reserved concurrency has no additional charge, just allocates existing account concurrency limit).

---

## Scope Estimate

### Orbit Count
**4 Orbits Total**

| Orbit | Phase | Estimated Duration | Key Deliverables |
|-------|-------|-------------------|------------------|
| **Orbit 1** | Infrastructure + Fargate Worker | 3-5 days | CDK constructs, Fargate application code, unit tests, Dockerfile, ECR image |
| **Orbit 2** | Lambda Migration + Integration Testing | 2-3 days | Modified Lambda handlers, SQS message schemas, end-to-end staging validation |
| **Orbit 3** | Production Rollout | 3-4 days | Canary deployment, monitoring, ramp to 100% traffic, incident response readiness |
| **Orbit 4** | Lambda Deprecation | 1-2 days | Remove legacy code, downsize Lambda resources, finalize cost tracking |

**Total Estimated Duration:** 9-14 days (assumes full-time focus, no blocking dependencies beyond T6-001)

### Complexity Assessment
**High Complexity**

**Justification:**
- **New integration:** First Fargate service in Prometheus platform. Requires learning ECS task lifecycle, auto-scaling policies, container debugging workflows. No existing organizational knowledge to leverage.
- **Multi-service orchestration:** Coordination across Lambda, SQS, Fargate, S3, DSQL, WebSocket API. Failure mode spans 6 AWS services — debugging requires distributed tracing expertise.
- **Asynchronous architecture introduction:** Shifts from synchronous (HTTP request → Lambda → Bedrock → HTTP response) to asynchronous (HTTP → SQS → Fargate → WebSocket). Requires frontend changes? No, but requires validation that existing polling fallback handles new latency profile.
- **Operational risk:** Production deployment affects all LLM-powered features. Rollback complexity (drain SQS queue, toggle feature flag) higher than typical Lambda-only deployment.
- **Cost uncertainty:** Fargate runtime costs are variable (depends on task run duration, concurrency). Must establish baseline monitoring before committing to full cutover.

**Risk Mitigation for Complexity:**
- Orbit 1 completes infrastructure and application in staging environment with synthetic load testing before touching production.
- Orbit 2 validates end-to-end flow with real user workflows in staging (manual QA with 10+ test scenarios).
- Orbit 3 uses canary deployment (10% → 50% → 100%) with automated rollback trigger on error rate spike.
- Post-deployment supervised period (7 days) with daily cost/error review before reducing oversight.

### Work Breakdown

#### Orbit 1: Infrastructure + Fargate Worker
**Estimated effort:** 40-50 person-hours

- CDK constructs (SQS queue, Fargate service, IAM roles, alarms): 12 hours
- Fargate worker application (`main.ts`, handlers, client wrappers): 18 hours
- Dockerfile + multi-stage build + ECR push automation: 4 hours
- Unit tests (handlers, message validation, idempotency): 8 hours
- Integration tests (LocalStack SQS + S3 + mock Bedrock): 6 hours
- Documentation (deployment runbook, troubleshooting guide): 4 hours

#### Orbit 2: Lambda Migration + Integration Testing
**Estimated effort:** 24-30 person-hours

- Shared SQS message schemas (Zod validation): 3 hours
- Lambda handler modifications (extract Bedrock logic, add SQS publishing): 6 hours
- Lambda handler test updates (mock SQS client, assert on message publishing): 4 hours
- End-to-end staging validation (10 test scenarios): 8 hours
- Performance baseline measurement (establish p50/p95/p99 latency): 4 hours
- Rollback procedure documentation + rehearsal: 4 hours

#### Orbit 3: Production Rollout
**Estimated effort:** 20-30 person-hours (includes monitoring time)

- Canary deployment configuration (feature flag setup): 3 hours
- Deploy to production with `FARGATE_ENABLED=false`: 2 hours
- Enable 10% traffic + monitor 24 hours: 4 hours (async monitoring)
- Ramp to 50% traffic + monitor 24 hours: 4 hours (async monitoring)
- Ramp to 100% traffic + monitor 24 hours: 4 hours (async monitoring)
- Incident response (if needed — contingency): 8 hours
- Post-deployment review (cost analysis, error rate analysis): 3 hours

#### Orbit 4: Lambda Deprecation
**Estimated effort:** 12-16 person-hours

- Remove legacy Bedrock invocation code from Lambda handlers: 4 hours
- Update Lambda configurations (reduce memory/timeout): 2 hours
- Update cost tracking dashboard with Fargate metrics: 3 hours
- Final documentation (architecture diagrams, operational runbooks): 4 hours
- Retrospective (lessons learned, recommendations for future Fargate services): 2 hours

### Dependencies on External Teams
**None** — all work is within Prometheus platform engineering team's scope. No coordination required with frontend, security, or finance teams (informational notifications only).

### Testing Strategy
- **Unit tests:** 80%+ coverage for Fargate worker handlers and message processing logic
- **Integration tests:** LocalStack-based SQS + S3 + mock Bedrock for end-to-end flow validation
- **Staging validation:** 10 test scenarios covering artifact generation, chat completion, error cases, concurrent processing
- **Canary deployment:** 10% production traffic for 24 hours before full rollout
- **Load testing:** 50 concurrent requests in staging to validate auto-scaling behavior

### Estimated Test Count
**24 test cases total**

| Component | Test Count | Examples |
|-----------|-----------|----------|
| Fargate handlers (unit) | 8 | Bedrock timeout, S3 write failure, DSQL upsert, idempotency |
| SQS message validation | 4 | Valid artifact message, valid chat message, malformed JSON, missing required field |
| Lambda SQS publishing | 3 | Successful publish, SQS throttle retry, message size limit |
| Integration (SQS flow) | 5 | End-to-end artifact generation, end-to-end chat, concurrent processing, message replay, graceful shutdown |
| Staging validation | 10 | Manual QA scenarios (happy path, error cases, edge cases) |

---

## Human Modifications

**Status:** Pending human review

**Instructions for Reviewer:**
1. Verify the interpreted intent accurately reflects the desired outcome for T6-003
2. Review implementation plan for architectural fit with existing Prometheus patterns
3. Assess risk surface for completeness — identify any missing edge cases or security concerns
4. Evaluate scope estimate realism — adjust orbit count or duration based on team capacity
5. Approve, approve with modifications, or reject with specific feedback

**Modification Capture:**
When modifications are made during review, record each change in the table below:

| Field | Original | Modified | Reason |
|-------|----------|----------|--------|
| (Example) `implementation_plan.files_to_create` | `services/fargate-worker/src/main.ts` | `services/fargate-worker/src/index.ts` | "Use index.ts as entry point to match existing Lambda convention" |