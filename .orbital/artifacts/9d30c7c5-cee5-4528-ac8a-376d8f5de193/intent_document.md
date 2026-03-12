# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Artifact generation and AI chat operations complete successfully without hitting Lambda's 15-minute execution limit. Users experience uninterrupted AI interactions regardless of task duration. The system handles multi-minute LLM operations (complex artifact generation, extended chat sessions) with real-time progress feedback via WebSocket, while maintaining sub-second response times for the initial HTTP request.

Backend engineers gain a clear pattern for offloading compute-intensive work: Lambda receives requests and enqueues them to SQS; Fargate tasks process work asynchronously; results persist to S3/DSQL; WebSocket events notify connected clients of completion.

## Constraints

- **No breaking changes to existing API contracts** — HTTP endpoints must maintain current request/response shape; existing clients continue to function without modification
- **Fargate task cold start must complete within 30 seconds** — users perceive tasks as "starting" not "stuck"
- **SQS message retention set to 14 days maximum** — failed tasks are retryable within this window
- **WebSocket connections must handle reconnection gracefully** — clients that disconnect during long operations can retrieve results via polling fallback
- **Fargate tasks must not exceed $50/month in baseline cost** — burst capacity allowed, but idle infrastructure stays within budget
- **S3 bucket for results must enforce encryption at rest** — compliance requirement for storing generated artifacts
- **DSQL transaction log must capture task status transitions** — audit trail for every queued → processing → completed/failed state change
- **No new authentication mechanism** — Fargate tasks inherit auth context from the originating Lambda request via SQS message attributes
- **Existing Lambda-based artifact generation remains functional** — migration is opt-in per artifact type, not a hard cutover

## Acceptance Boundaries

### Functional

- Artifact generation tasks exceeding 10 minutes complete successfully in Fargate
- AI chat sessions exceeding 5 minutes complete without timeout errors
- Lambda-to-SQS enqueue latency < 500ms (p95)
- Fargate task picks up SQS message within 10 seconds of availability (p95)
- WebSocket notification delivered within 2 seconds of task completion (p95)
- Failed tasks retry with exponential backoff (3 attempts: immediate, +30s, +5m)
- Results stored in S3 with pre-signed URLs expiring in 7 days
- DSQL records contain: task_id, intent_id, orbit_id, status, enqueued_at, started_at, completed_at, error_message (if failed)

### Operational

- CloudWatch logs capture structured JSON events for every task lifecycle transition
- Fargate task failure rate < 2% (excluding user cancellations)
- SQS dead-letter queue configured with alarm triggering after 5 messages
- Fargate tasks auto-scale from 0 to 10 tasks based on SQS queue depth
- Health check endpoint on Fargate tasks responds < 1s

### Observable

- Grafana dashboard shows: queue depth, active tasks, task duration (p50/p95/p99), success/failure rate, cost per task
- X-Ray traces connect Lambda → SQS → Fargate → S3 → WebSocket for end-to-end visibility
- User-facing UI displays task status: queued / processing / completed / failed with progress indicator

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:**

- **High blast radius** — touches critical user-facing workflows (artifact generation, chat) that directly impact perceived system reliability
- **Data flow risk** — introduces new persistence layer (S3) and asynchronous state management (SQS) that could lead to orphaned tasks or lost results if misconfigured
- **Cost sensitivity** — Fargate autoscaling misconfiguration could generate unexpected AWS bills
- **Moderate reversibility** — Lambda fallback exists but requires toggling feature flags and draining SQS queues; not a one-click rollback

Human approval required before deploy. Post-deploy, monitor error rates and cost metrics for 48 hours before promoting to production traffic beyond canary (10%).

## Dependencies

### Internal

- **T6-001** — Fargate cluster must exist with VPC configuration, IAM roles, and CloudWatch logging
- **T6-002** — SQS queues must be provisioned with DLQ, visibility timeout (30 minutes), and message retention policy
- **Existing WebSocket infrastructure** — API Gateway WebSocket routes, connection management Lambda, DynamoDB connection table
- **S3 bucket for artifacts** — must support pre-signed URL generation with configurable expiration
- **DSQL schema** — requires `task_executions` table with columns: id, intent_id, orbit_id, task_type, status, payload_s3_key, created_at, started_at, completed_at, error

### External

- **AWS Bedrock API** — Fargate tasks call Bedrock for LLM operations; requires IAM permissions and retry logic for throttling
- **OpenAPI spec for existing endpoints** — artifact generation and chat endpoints must document new `202 Accepted` response with `task_id`
- **Frontend client library** — must handle WebSocket events and polling fallback for task status

### Prior Orbits

- **T1-002 Orbit 3** — established WebSocket notification pattern for async operations; reuse connection management logic
- **T4-001 Orbit 2** — defined artifact storage conventions in S3 (bucket structure, naming, metadata tags)