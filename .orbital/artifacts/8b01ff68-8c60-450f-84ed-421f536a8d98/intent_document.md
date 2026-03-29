# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Users can initiate artifact generation and AI chat operations that reliably complete within 5 minutes without timing out, experiencing improved responsiveness and real-time progress updates. The system scales to handle concurrent LLM operations without degrading performance for other API endpoints.

When a user requests an artifact or engages in AI chat:
- The HTTP request returns immediately with a tracking ID and status endpoint
- Long-running LLM processing executes asynchronously on dedicated compute resources
- Progress and completion are communicated via WebSocket events
- Results are durably stored and retrievable via API

This migration eliminates Lambda timeout failures for LLM operations, enables processing workloads that currently fail or require artificial splitting, and establishes infrastructure patterns for future long-running workloads (background processing, ML inference, data pipelines).

## Constraints

### Performance
- API Gateway requests must respond within 3 seconds with task accepted confirmation
- WebSocket latency for progress events: ≤ 500ms from event emission to client receipt
- Task state transitions (queued → processing → completed) must be queryable via API with ≤ 200ms p95 latency
- Maximum task execution time: 5 minutes before automatic timeout and cleanup

### Architecture
- Must preserve existing REST API contract for artifact generation and chat endpoints
- Cannot introduce breaking changes to current frontend integration patterns
- SQS standard queue (not FIFO) — must handle at-least-once delivery semantics
- Fargate tasks must be stateless and horizontally scalable
- All task state must persist to DSQL or S3 for durability across task failures

### Security
- Fargate tasks must authenticate to AWS services using IAM roles (no long-lived credentials)
- LLM API keys and sensitive parameters must be retrieved from AWS Secrets Manager
- Task logs must not contain PII, API keys, or full prompt/response bodies
- WebSocket connections must validate authentication tokens before delivering task events

### Cost
- Fargate tasks must terminate within 60 seconds of completion or failure (no idle containers)
- SQS message retention: 4 hours maximum (failed tasks are dead-lettered, not retried indefinitely)
- S3 artifact storage follows existing lifecycle policies (transition to IA after 30 days)

### Observability
- All task state transitions must emit CloudWatch metrics (queued_count, processing_duration, failure_rate)
- Failed tasks must write structured error context to CloudWatch Logs
- Distributed traces must span Lambda → SQS → Fargate → WebSocket with correlation IDs

### Non-Goals
- **Not** migrating all Lambda functions to Fargate — only LLM workloads exceeding Lambda constraints
- **Not** implementing a generic async job framework — solving the specific LLM timeout problem
- **Not** adding a queueing UI or admin dashboard — task status is API-queryable only

## Acceptance Boundaries

### Core Functionality
- **Task Submission:** POST to `/artifacts/generate` or `/chat/stream` returns `202 Accepted` with `task_id` in ≤ 3 seconds, 99% of requests
- **Task Execution:** 95% of artifact generation tasks complete successfully within 5 minutes when given valid input
- **Result Retrieval:** GET `/tasks/{task_id}` returns current state (queued | processing | completed | failed) with error context if failed
- **WebSocket Delivery:** Clients subscribed to `task:{task_id}` receive `task.completed` or `task.failed` events within 500ms of state change

### Reliability
- **Idempotency:** Resubmitting identical artifact/chat request within 5 minutes returns existing `task_id` (no duplicate processing)
- **Failure Handling:** Failed tasks transition to `failed` state with structured error (error_code, message, retry_after_seconds) — no silent failures
- **Dead Letter Queue:** Messages failing 3 processing attempts move to DLQ with original request context for manual inspection

### Observability
- **Metrics:** CloudWatch dashboard shows p50/p95/p99 processing duration, success rate, queue depth — 1-minute granularity
- **Tracing:** Every task has X-Ray trace linking API request → SQS publish → Fargate execution → WebSocket emit → result storage
- **Alerting:** CloudWatch alarm triggers if task failure rate exceeds 5% over 5-minute window OR queue depth exceeds 100 messages for 10 minutes

### Performance Under Load
- **Concurrency:** System handles 20 concurrent artifact generation requests without p95 latency exceeding 4 minutes per task
- **Graceful Degradation:** When Fargate task count reaches configured maximum (e.g., 10 concurrent tasks), new requests queue rather than fail — estimated wait time included in API response

### Data Integrity
- **Artifact Storage:** Generated artifacts written to S3 with bucket versioning enabled — retrievable via GET `/artifacts/{artifact_id}`
- **Task History:** Task records persist in DSQL for 30 days minimum with full audit trail (submitted_at, started_at, completed_at, executor_task_arn)

### Migration Validation
- **Backward Compatibility:** Existing frontend artifact/chat integrations continue working without code changes — only response structure enhanced with `task_id` and polling endpoint
- **Rollback Safety:** Feature flag `ENABLE_FARGATE_LLM=true|false` allows instant rollback to Lambda-based execution without data loss

## Trust Tier Assignment

**Tier 2 — Supervised**

### Rationale
This intent introduces asynchronous processing for user-initiated operations with moderate blast radius:

- **User-Facing Impact:** Changes how artifact generation and AI chat are invoked — adds polling/WebSocket patterns that could degrade UX if implemented incorrectly
- **Data Flow Complexity:** Adds SQS, Fargate, and WebSocket notification layer to critical user journeys — failure modes span multiple AWS services
- **No Financial Risk:** Does not touch billing, payment processing, or subscription management
- **Reversibility:** Feature flag enables instant rollback to Lambda execution; failed Fargate tasks do not corrupt existing data
- **Partial Automation Safe:** Infrastructure provisioning (Fargate cluster, SQS queues, IAM roles) can proceed autonomously; integration with existing API endpoints requires human review before deploy

Tier 1 (Autonomous) is too permissive — this touches user-facing request/response contracts and introduces new failure modes requiring validation. Tier 3 (Gated) is unnecessarily restrictive — changes are scoped, reversible, and don't affect account security or financial operations.

## Dependencies

### Internal Dependencies
- **T6-001 · Fargate Cluster Foundation:** Requires VPC, ECS cluster, task execution role, and CloudWatch log groups to exist before deploying Fargate tasks
- **T5-002 · WebSocket Infrastructure:** Depends on API Gateway WebSocket API, connection management Lambda, and DynamoDB connection tracking for real-time event delivery
- **T1-003 · DSQL Schema for Tasks:** Requires `tasks` table with columns: `task_id`, `intent_id`, `status`, `created_at`, `started_at`, `completed_at`, `result_location`, `error_context`

### External Dependencies
- **AWS Bedrock API:** LLM operations invoke Bedrock models (Claude, Titan) — requires stable API access and quota headroom
- **AWS Secrets Manager:** Fargate tasks retrieve LLM provider credentials and encryption keys at runtime
- **S3 Bucket Lifecycle Policies:** Artifact storage depends on existing S3 buckets configured for Prometheus project with versioning and lifecycle transitions

### Data Dependencies
- **Artifact Templates:** Existing artifact generation logic (currently in Lambda) must be refactored into standalone modules callable from Fargate tasks
- **Prompt Libraries:** AI chat operations depend on current prompt templates and conversation history storage patterns

### Assumptions
- API Gateway has capacity to handle 202 Accepted responses with no payload streaming
- WebSocket connection table supports query by `user_id` for targeted event delivery
- Existing frontend polling or SSE implementations can migrate to WebSocket subscription model without backend changes