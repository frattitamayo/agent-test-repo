# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Users can reliably generate artifacts and engage in AI chat sessions without encountering timeout errors or degraded performance, regardless of task duration. The system seamlessly handles LLM operations that exceed Lambda's 15-minute execution limit by offloading them to containerized workers, while maintaining responsive feedback through real-time WebSocket notifications. Operations that previously failed or required workarounds now complete successfully, with progress visibility throughout execution.

## Constraints

- **Lambda timeout boundary:** Must remain under Lambda's 15-minute limit for all synchronous HTTP handling
- **Backward compatibility:** Existing API contracts and WebSocket event schemas cannot break; clients should not require updates
- **Cost control:** Fargate task runtime must be minimized; no perpetually running containers
- **Security posture:** Fargate tasks must operate within the same VPC security boundaries as Lambda; no direct internet egress without NAT gateway
- **Data residency:** All LLM inputs, outputs, and intermediate results must remain in AWS us-east-1; no cross-region data movement
- **Observability continuity:** Existing CloudWatch log groups and X-Ray traces must continue to capture the full request lifecycle across Lambda → SQS → Fargate
- **Authentication propagation:** User identity and authorization context must flow from initial HTTP request through to Fargate execution
- **Non-goal:** This orbit does NOT implement retry logic, dead-letter queues, or poison message handling — those are deferred to T6-004

## Acceptance Boundaries

### Functional Requirements

- **LLM task migration:** Artifact generation (Intent, Context, Proposal, Plan, Evaluation) and AI chat operations execute in Fargate tasks triggered by SQS messages
- **Lambda handoff:** Lambda HTTP handlers accept requests, validate inputs, enqueue SQS messages with correlation IDs, and return HTTP 202 with a tracking reference within <500ms
- **Fargate execution:** Tasks pull messages from SQS, invoke Bedrock APIs, store results in S3 (artifacts) and Aurora DSQL (metadata), and complete within observed durations (artifact generation: <5 minutes; chat turns: <30 seconds at p95)
- **WebSocket notification:** Frontend receives structured events (`task.started`, `task.progress`, `task.completed`, `task.failed`) with correlation ID, task type, and result references
- **Result retrieval:** Clients can fetch completed artifacts from S3 via presigned URLs or query chat history from DSQL using the correlation ID

### Performance Thresholds

- **SQS message latency:** Messages appear in queue within <1 second of Lambda enqueue
- **Fargate cold start:** Tasks begin processing within <45 seconds of message visibility (container pull + task startup)
- **Warm task pickup:** If a task is already running, new messages are processed within <5 seconds
- **WebSocket delivery:** Notification events reach connected clients within <2 seconds of task state change
- **Failure visibility:** Failed tasks produce error events within <10 seconds of failure detection

### Operational Limits

- **Concurrency:** Fargate service scales to minimum 0 tasks (idle state) and maximum 10 tasks (burst protection)
- **SQS visibility timeout:** Set to 10 minutes (allows for artifact generation + buffer); tasks must complete or extend timeout before expiration
- **Message retention:** SQS retains unprocessed messages for 4 days (96 hours)
- **Task resource allocation:** Each Fargate task allocated 2 vCPU, 4 GB memory (sized for Bedrock SDK + payload buffering)

### Quality Gates

- **Zero HTTP 504 Gateway Timeout errors:** No Lambda timeouts for artifact generation or chat requests after migration
- **Result consistency:** 100% of completed tasks produce either a valid S3 artifact + DSQL record OR a structured error event
- **Audit trail completeness:** Every SQS message has corresponding CloudWatch logs spanning Lambda enqueue → Fargate processing → result storage → WebSocket notification

## Trust Tier Assignment

**Tier 2 — Supervised**

This orbit operates at Trust Tier 2 due to:

1. **Cross-service coordination risk:** Introduces asynchronous handoff between Lambda, SQS, Fargate, and WebSocket API — failure modes are non-obvious and require multi-service observability
2. **Data flow complexity:** Sensitive user inputs (intents, chat messages) and AI outputs traverse multiple storage layers (SQS message bodies, S3 objects, DSQL records); data leakage or loss has compliance impact
3. **Cost blast radius:** Misconfigured Fargate scaling or SQS visibility timeouts could spin up unbounded tasks or orphan containers, incurring runaway AWS charges
4. **User experience dependency:** WebSocket notification failures or SQS delivery delays create "black hole" scenarios where users receive no feedback on task status

Human review is required before deployment to verify:
- SQS dead-letter queue configuration and alarm thresholds
- Fargate task IAM policies scoped to least privilege (S3 write to artifact bucket only, DSQL write to specific tables)
- CloudWatch dashboards capturing end-to-end latency and error rates across all services
- Load testing results demonstrating behavior under concurrent task submission (10+ simultaneous artifact generations)

This does NOT require Tier 3 (Gated) because the functionality is additive — existing synchronous Lambda paths remain operational during rollout, and Fargate tasks can be disabled via feature flag without data loss.

## Dependencies

### Internal Dependencies

- **T6-001 (Fargate Service Definition):** ECS cluster, task definition, IAM roles, and VPC networking must exist and be validated
- **T6-002 (SQS Queue Provisioning):** Standard queue for task messages, DLQ for failures, CloudWatch alarms for queue depth
- **Existing Lambda handlers:** `/api/intents`, `/api/artifacts/generate`, `/api/chat` routes must be refactored to enqueue mode
- **WebSocket API infrastructure:** Connection table in DSQL, API Gateway WebSocket routes, Lambda authorizer for connection management
- **S3 artifact bucket:** `prometheus-artifacts-{env}` with lifecycle policies and versioning enabled
- **Aurora DSQL schema:** Tables for `artifacts`, `chat_messages`, `tasks` with indexes on correlation_id and user_id

### External Dependencies

- **AWS Bedrock availability:** Claude 3.5 Sonnet in us-east-1 must remain accessible; no alternative LLM provider is configured
- **VPC NAT Gateway capacity:** Fargate tasks require outbound internet for Bedrock API calls; NAT gateway must handle burst traffic without throttling
- **CloudWatch Logs retention:** Log groups for Fargate tasks (`/ecs/prometheus-llm-worker`) must exist with 30-day retention configured

### Prior Orbit Context

This orbit assumes the foundational Fargate infrastructure from T6-001 has been deployed and smoke-tested. It does NOT depend on retry logic (T6-004) or multi-region failover (T6-005) — those are follow-on enhancements. If T6-001 is incomplete or unstable, this orbit is blocked.