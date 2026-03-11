# T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Desired Outcome

AI-powered operations in Prometheus — artifact generation (Intent Documents, Context Packages, Proposals, Implementation Plans) and interactive AI chat — execute reliably without Lambda timeout failures. Users experience seamless, real-time progress updates via WebSocket as LLM operations complete in the background. System capacity scales independently from HTTP request handling, enabling concurrent long-running tasks without blocking API throughput.

## Constraints

- **Backward Compatibility:** Existing Lambda-based API contracts remain unchanged; clients continue sending requests to the same endpoints with the same payloads.
- **Security Boundary:** Fargate tasks operate within private subnets with no direct internet access; all AWS service communication uses VPC endpoints or NAT Gateway.
- **Data Residency:** Generated artifacts and chat messages remain in S3 and Aurora DSQL within the same AWS region; no cross-region data transfer.
- **Cost Control:** Fargate tasks terminate within 15 minutes maximum execution time; tasks must not consume more than 2 vCPU / 4GB RAM per concurrent operation.
- **WebSocket Protocol:** Real-time updates use existing WebSocket infrastructure (API Gateway WebSocket API); no new client-side protocol changes.
- **Non-Goal:** This intent does NOT migrate all Lambda functions to Fargate — only LLM-dependent operations that exceed 15-minute Lambda limit or require persistent connections.
- **Non-Goal:** This intent does NOT implement retry logic or dead-letter queue handling — focus is on happy-path execution; error recovery is a separate intent.

## Acceptance Boundaries

### Functional Completeness
- **Artifact Generation:** All five artifact types (Intent, Context Package, Proposal, Implementation Plan, Test Specification) generate successfully via Fargate with results stored in S3 and metadata in DSQL.
- **AI Chat:** Multi-turn conversational chat completes on Fargate with message history persisted and retrieved correctly.
- **WebSocket Notifications:** Frontend receives at minimum three event types: `task_started`, `task_progress`, `task_completed` with relevant payload (task ID, status, artifact URL or message content).

### Performance
- **Acceptable:** 90th percentile end-to-end latency (Lambda enqueue → Fargate complete → WebSocket notify) under 45 seconds for artifact generation, under 10 seconds for chat responses.
- **Ideal:** 90th percentile under 30 seconds for artifacts, under 5 seconds for chat.
- **Unacceptable:** Median latency exceeds 60 seconds for artifacts or 15 seconds for chat.

### Reliability
- **Acceptable:** 95% of tasks complete successfully without manual intervention during a 24-hour period.
- **Ideal:** 99% task success rate.
- **Unacceptable:** Success rate below 90% or any single task blocking subsequent tasks in the queue.

### Observability
- **Minimum:** CloudWatch Logs capture task start, completion, and error events with trace IDs linking Lambda → SQS → Fargate → WebSocket.
- **Ideal:** CloudWatch dashboard displays real-time task queue depth, Fargate task count, and p50/p90/p99 latency metrics.

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:** This intent modifies the execution path of core user-facing features (AI artifact generation and chat) and introduces a new asynchronous processing pattern. While the change is architecturally sound and reversible (revert to synchronous Lambda execution), the blast radius includes:

- **User Experience Impact:** Failures result in users not receiving expected artifacts or chat responses, with no immediate fallback to synchronous behavior.
- **Data Flow Changes:** Introduces SQS as a critical path dependency; misconfiguration could silently drop tasks or delay processing indefinitely.
- **WebSocket Dependency:** Real-time notification failures leave users in an ambiguous state ("is my task still running?").

The change does NOT touch:
- Authentication or authorization logic
- Payment or billing systems
- User data deletion or modification outside artifact/chat scope

Supervised review ensures the async handoff works correctly and monitoring catches queue backlog or task failures before users are impacted. Autonomous execution (Tier 1) is inappropriate due to the lack of automated rollback for user-facing feature regressions. Gated execution (Tier 3) is excessive because the change is scoped to a single trajectory with clear acceptance boundaries and no cross-team dependencies.

## Dependencies

### Internal Dependencies
- **Trajectory T6-001:** Fargate cluster, task definition, IAM roles, and VPC networking must be provisioned and verified operational.
- **Trajectory T6-002:** SQS queue for task triggering must exist with appropriate visibility timeout (15 minutes minimum) and dead-letter queue configured.
- **WebSocket Infrastructure:** API Gateway WebSocket API and connection management (DynamoDB connection table) must be deployed and tested for message delivery.

### External Dependencies
- **AWS Bedrock:** LLM inference API (Claude, GPT-4, or equivalent) must be accessible from Fargate tasks via VPC endpoint or NAT Gateway.
- **S3 Artifact Bucket:** Bucket with versioning enabled and lifecycle policies configured; Fargate tasks require PutObject and GetObject permissions.
- **Aurora DSQL:** Database connection pool and schema for artifact metadata (artifact_id, s3_url, created_at, user_id) must support concurrent writes from Fargate.

### Prior Orbit Context
- **No Direct Dependency:** This is the first orbit in T6-003. However, learnings from **T6-001-O1** (Fargate cluster provisioning) and **T6-002-O1** (SQS queue setup) inform implementation choices — specifically, Fargate task definition memory allocation and SQS FIFO queue decision (standard queue preferred for parallel execution).