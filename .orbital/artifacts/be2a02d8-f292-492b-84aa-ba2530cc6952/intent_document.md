# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Artifact generation and AI chat operations complete successfully regardless of execution duration, eliminating Lambda timeout failures. Users receive real-time progress updates via WebSocket during long-running LLM operations. The system maintains sub-second HTTP response times while offloading compute-intensive work to background tasks.

When this orbit completes:
- Artifact generation requests that previously timed out in Lambda now complete successfully in Fargate
- AI chat sessions with complex multi-turn reasoning execute without interruption
- Frontend receives WebSocket events tracking LLM operation progress (queued, processing, completed, failed)
- API endpoints return immediately with job identifiers rather than blocking for LLM completion
- System scales horizontally for concurrent LLM workloads without Lambda concurrency limits

## Constraints

**Performance:**
- HTTP request → SQS enqueue latency must remain under 500ms
- WebSocket notification delivery within 2 seconds of state change
- S3 artifact write operations complete within 5 seconds of LLM output
- DSQL transaction commits for status updates under 200ms

**Security:**
- Fargate tasks execute in private subnets with no direct internet access
- All LLM API calls route through NAT Gateway or VPC endpoints
- SQS queue encrypted at rest with KMS
- IAM roles follow least-privilege: Lambda cannot invoke Fargate directly, only enqueue messages
- Artifact S3 bucket blocks public access, requires signed URLs for frontend retrieval

**Architectural:**
- No synchronous Lambda → Fargate invocation; all communication via SQS
- Lambda functions remain stateless; no polling or long-polling for job completion
- WebSocket connection managed by existing Lambda WebSocket API
- Fargate task definition reuses existing application container image
- No changes to DSQL schema for core entities (Project, Trajectory, Intent, Orbit, Artifact)

**Operational:**
- Fargate tasks must log to CloudWatch with structured JSON
- Failed tasks retry maximum 3 times with exponential backoff (handled by SQS)
- Dead-letter queue captures permanently failed messages after retry exhaustion
- CloudWatch alarms trigger on DLQ depth > 5 or task failure rate > 10%

**Non-goals:**
- Real-time streaming of LLM tokens to frontend (future enhancement)
- Migration of short-duration Lambda functions (< 30s execution time)
- Replacement of Lambda for synchronous API endpoints
- Support for user-cancellable in-flight LLM operations (future enhancement)

## Acceptance Boundaries

**Functional Completeness:**
- ✓ Artifact generation endpoint returns 202 Accepted with job ID within 500ms
- ✓ AI chat endpoint returns 202 Accepted with conversation ID within 500ms
- ✓ SQS queue receives messages with complete context (intent ID, user ID, request payload)
- ✓ Fargate task polls SQS, processes message, invokes LLM, writes output to S3
- ✓ Fargate task updates DSQL with job status (queued → processing → completed/failed)
- ✓ WebSocket emits events: `job.queued`, `job.processing`, `job.completed`, `job.failed`
- ✓ Frontend displays real-time status updates without polling
- ✓ Completed artifacts accessible via signed S3 URL returned in WebSocket payload

**Performance Thresholds:**
- HTTP → SQS enqueue: p95 < 400ms, p99 < 800ms
- Fargate cold start (task launch to message processing): < 15 seconds
- Fargate warm task (message received to LLM invocation): < 2 seconds
- End-to-end (HTTP request to WebSocket `job.completed`): p50 < 45s, p95 < 90s for typical artifact generation

**Reliability:**
- Zero message loss: SQS visibility timeout exceeds maximum Fargate task duration
- Failed tasks retry automatically; DLQ captures permanent failures
- WebSocket disconnections during processing do not lose job status (query endpoint returns current state)
- Fargate task crashes or ECS service interruptions do not corrupt DSQL state (idempotent writes)

**Observability:**
- CloudWatch Logs contain structured JSON with `traceId`, `jobId`, `intentId`, `phase`
- Metrics published: `fargate.task.duration`, `llm.invocation.latency`, `sqs.message.age`
- X-Ray traces span Lambda → SQS → Fargate → LLM → S3 → WebSocket

**Degraded Acceptable:**
- Fargate cold starts up to 30 seconds acceptable during low-traffic periods
- WebSocket notification delay up to 5 seconds acceptable if CloudWatch Events experiences latency
- SQS message visibility timeout extended to 15 minutes (allows for extremely long LLM operations)

**Unacceptable:**
- Message processing failure rate > 5% (excluding user-caused errors like invalid input)
- DLQ depth growth indicating systematic processing failures
- Fargate tasks running > 15 minutes without emitting progress logs
- S3 write failures causing completed LLM outputs to be discarded

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:**

This tier assignment reflects moderate blast radius with established mitigation patterns:

**Blast Radius (Medium):**
- Affects all long-running LLM operations — artifact generation and AI chat — representing core platform value
- Failure modes impact user-facing features but do not corrupt data or compromise security
- Rollback possible by reverting Lambda handlers to synchronous execution (temporary degradation to 15-minute timeout ceiling)
- Existing DSQL and S3 state remain intact; SQS messages can be drained or purged without data loss

**Risk Factors Requiring Supervision:**
- First introduction of asynchronous job processing pattern in platform architecture
- WebSocket event delivery relies on new Fargate → API Gateway integration
- Failure to handle SQS message visibility timeout correctly could cause duplicate processing
- Fargate IAM role permissions must be scoped precisely to prevent lateral movement

**Mitigations in Place:**
- Canary deployment: enable for single test intent first, observe for 24 hours before broader rollout
- Feature flag allows instant reversion to synchronous Lambda execution
- SQS DLQ captures failures for post-mortem analysis without user impact
- CloudWatch alarms provide early warning of degradation

**Why Not Tier 1 (Autonomous):**
- Architectural novelty (async + Fargate) introduces unknown unknowns
- WebSocket integration has potential for silent failures (client doesn't realize job completed)
- Cost implications of long-running Fargate tasks not yet validated in production load

**Why Not Tier 3 (Gated):**
- No PII, payment, or authentication logic affected
- Read-only impact on existing data (writes are new artifacts, not mutations)
- Failure modes are observable and recoverable within minutes
- Prior ORBITAL orbits established container deployment patterns

## Dependencies

**Infrastructure (Must Exist):**
- ECS Fargate cluster with capacity for minimum 2 concurrent tasks
- Private subnets with NAT Gateway or VPC endpoints for Bedrock/external LLM APIs
- SQS queue: `prometheus-llm-jobs` with 15-minute visibility timeout, DLQ attached
- IAM role: `PrometheusECSTaskRole` with policies for S3 write, DSQL query/update, SQS receive/delete
- CloudWatch Logs group: `/ecs/prometheus-fargate`

**Application Dependencies:**
- Existing application container image deployable to Fargate (Dockerfile, ECR repo)
- WebSocket API Lambda function updated to publish events via API Gateway Management API
- S3 bucket: `prometheus-artifacts-{env}` with lifecycle policy and encryption
- DSQL schema includes `job_status` ENUM and `job_id` indexed column (or extend Artifact table)

**External Services:**
- AWS Bedrock or OpenAI API reachable from Fargate via VPC networking
- API Gateway WebSocket API with `$connect`, `$disconnect`, and `sendMessage` routes

**Prior Orbit References:**
- T6-001 (if exists): Initial Fargate cluster provisioning
- T6-002 (if exists): Container image CI/CD pipeline
- Any orbit establishing DSQL transaction patterns for async state updates

**Concurrent Intent Conflicts:**
- Must coordinate with any intent modifying Artifact entity schema (column additions may conflict)
- Must align with any WebSocket API changes (event payload structure)

**Data Assumptions:**
- Intent, Orbit, and Artifact records already exist in DSQL with stable IDs
- User authentication tokens valid for duration of async job (or refresh mechanism exists)
- S3 signed URLs generated by Lambda remain valid for frontend download (expiry > expected job duration)