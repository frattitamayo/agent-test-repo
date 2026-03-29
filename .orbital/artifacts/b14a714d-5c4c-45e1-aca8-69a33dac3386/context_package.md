# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Generated:** 2026-03-12  
**Intent:** T6-003  
**Package Type:** intent-specific  
**Orbit:** 1

---

## Codebase References

### Primary (will be modified or created)

**API Gateway / Lambda:**
- `infrastructure/lambda/api-gateway/handlers/artifacts/generate.ts` — Existing handler for POST `/artifacts` that currently invokes LLM synchronously; must be modified to enqueue SQS message and return task acknowledgment
- `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — Test suite for artifact generation handler
- `infrastructure/lambda/api-gateway/middleware/auth.ts` — Authentication middleware used by API Gateway handlers
- `infrastructure/lambda/shared/sqs-client.ts` — (create) SQS client wrapper for message publishing

**Fargate Task:**
- `infrastructure/fargate/tasks/artifact-generation/` — (create) New directory for Fargate task implementation
- `infrastructure/fargate/tasks/artifact-generation/index.ts` — (create) Main entry point for Fargate task (SQS polling, LLM invocation, result storage)
- `infrastructure/fargate/tasks/artifact-generation/Dockerfile` — (create) Container image definition
- `infrastructure/fargate/tasks/artifact-generation/task-definition.json` — (create) ECS task definition with resource limits, IAM role, environment variables
- `infrastructure/fargate/shared/bedrock-client.ts` — (create) Bedrock API client with retry logic and error handling
- `infrastructure/fargate/shared/websocket-notifier.ts` — (create) Utility for broadcasting task completion events via WebSocket

**Infrastructure as Code:**
- `infrastructure/terraform/fargate-cluster.tf` — (create) ECS cluster, service, task definition resources
- `infrastructure/terraform/sqs-queues.tf` — (create) Main queue, DLQ, visibility timeout, retention configuration
- `infrastructure/terraform/iam-fargate.tf` — (create) IAM role and policy for Fargate tasks (S3, DSQL, SQS, Bedrock, CloudWatch)
- `infrastructure/terraform/vpc-endpoints.tf` — (modify) Add VPC endpoint for Bedrock if not already present

**Database Schema:**
- `infrastructure/dsql/migrations/008_add_task_tracking.sql` — (create) Add `task_id`, `task_status`, `task_error` columns to `artifacts` table
- `infrastructure/dsql/schema/artifacts.sql` — Update to reflect new columns

### Secondary (dependencies and interfaces)

**WebSocket Infrastructure:**
- `infrastructure/lambda/websocket/connection-manager.ts` — Existing connection manager for WebSocket API
- `infrastructure/lambda/websocket/broadcast.ts` — Utility for sending messages to connected clients
- `infrastructure/dsql/schema/websocket_connections.sql` — Connection registry (user_id, connection_id, workspace_id)

**Storage and Data Layer:**
- `infrastructure/dsql/schema/artifacts.sql` — Artifact record schema
- `infrastructure/s3/bucket-config.tf` — S3 bucket for artifact content storage
- `infrastructure/dsql/queries/artifacts.ts` — Query helpers for artifact CRUD operations

**Observability:**
- `infrastructure/cloudwatch/dashboards/fargate-tasks.json` — (create) Dashboard for task metrics
- `infrastructure/cloudwatch/alarms/task-failures.json` — (create) Alarm definitions for failure rate, queue depth, latency
- `infrastructure/xray/config.ts` — Existing X-Ray configuration for distributed tracing

### Tests

- `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — Unit tests for modified Lambda handler
- `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — (create) Integration tests for Fargate task logic
- `tests/integration/fargate-to-websocket.test.ts` — (create) End-to-end test: API call → SQS → Fargate → WebSocket notification

---

## Architecture Context

**System Overview:**

Prometheus V1 follows a serverless-first architecture with Lambda handling synchronous API requests via API Gateway. The current artifact generation flow is synchronous: API Gateway → Lambda → Bedrock (LLM) → DSQL/S3 → HTTP response. This intent introduces an **asynchronous execution path** for long-running LLM operations by splitting the request flow into three stages:

1. **Request Acknowledgment (Lambda):** API Gateway handler validates the request, writes a pending `artifact` record to DSQL with `task_status = 'queued'`, publishes an SQS message with the task parameters, and returns the task ID to the client.
2. **Background Processing (Fargate):** A Fargate task polls the SQS queue, picks up the message, invokes Bedrock for LLM processing (may take 5-30+ minutes), stores the result in S3, updates the `artifact` record in DSQL with `task_status = 'completed'`, and deletes the SQS message.
3. **Completion Notification (WebSocket):** Upon writing the completed artifact to DSQL, the Fargate task broadcasts a WebSocket event to the user's active connection (via `connection-manager.ts`), providing the artifact ID and S3 download URL.

**Data Flow:**

```
Client → API Gateway → Lambda (auth, validate, enqueue) → SQS
                                  ↓ (task_id, 202 Accepted)
                                Client

SQS → Fargate Task (poll, invoke LLM, store result) → DSQL + S3
                                  ↓ (broadcast event)
                            WebSocket API → Client
```

**Integration Boundaries:**

- **Lambda ↔ SQS:** Lambda publishes messages using `sqs-client.ts` wrapper; messages contain task ID, user ID, workspace ID, and artifact parameters (intent, trajectory, orbit references).
- **Fargate ↔ SQS:** Fargate task uses AWS SDK to poll messages with long polling (20-second `WaitTimeSeconds`), processes one message at a time, and deletes on success or allows visibility timeout to expire on failure (triggers retry).
- **Fargate ↔ Bedrock:** Fargate invokes Bedrock via VPC endpoint or NAT gateway (private subnet), handles rate limits with exponential backoff, retries transient errors up to 3 times.
- **Fargate ↔ DSQL:** Fargate updates artifact status using transactional writes (ensure `task_status` transitions are atomic).
- **Fargate ↔ WebSocket:** Fargate calls `broadcast.ts` utility to send event to user's connection ID (looked up from `websocket_connections` table by `user_id`).

**Infrastructure Layers:**

- **Networking:** Fargate tasks run in private subnets with no public IP. Internet access (for Bedrock calls) is via NAT gateway. VPC endpoints for S3, DSQL, SQS reduce data transfer costs.
- **Scaling:** ECS service autoscales based on SQS `ApproximateNumberOfMessagesVisible` metric (target: 1 task per 5 messages in queue, max 10 tasks).
- **Security:** Fargate task IAM role grants least-privilege access: `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `s3:PutObject`, `dsql:ExecuteStatement`, `bedrock:InvokeModel`, `logs:CreateLogStream`.

**Reference Docs:**

- `docs/architecture/async-task-pattern.md` — (create) General pattern for SQS-triggered async operations
- `docs/architecture/websocket-integration.md` — Existing doc on WebSocket connection lifecycle
- `infrastructure/terraform/README.md` — Terraform module structure and deployment process

---

## Pattern Library

### Conventions (follow these)

**Lambda Handler Structure:**

- **Pattern:** Request validation → business logic → response formatting
- **Exemplar:** `infrastructure/lambda/api-gateway/handlers/orbits/create.ts`
- **Details:** Use Zod for input validation, `ApiResponse` type for HTTP responses, `withAuth` middleware for authentication. Errors are caught by global error handler and mapped to HTTP status codes. Use `logger` utility for structured logging with request ID.

**SQS Message Publishing:**

- **Pattern:** Wrap AWS SDK SQS calls in a typed client with retry logic
- **Exemplar:** (No existing SQS usage in project; propose pattern based on S3 client at `infrastructure/lambda/shared/s3-client.ts`)
- **Details:** Create `sqs-client.ts` with methods like `publishMessage({ queueUrl, body, attributes })`. Use AWS SDK v3, handle `QueueDoesNotExist` and throttling errors, return message ID on success.

**Fargate Task Entry Point:**

- **Pattern:** Long-running process with graceful shutdown
- **Exemplar:** (No existing Fargate tasks; propose pattern based on Lambda async handlers)
- **Details:** Main function runs infinite loop: poll SQS → process message → delete message → repeat. Trap `SIGTERM` to finish in-flight message before shutdown (ECS sends `SIGTERM` 30 seconds before `SIGKILL`). Use structured logging with task ID for correlation.

**WebSocket Broadcasting:**

- **Pattern:** Lookup connection ID, send message, handle disconnection gracefully
- **Exemplar:** `infrastructure/lambda/websocket/broadcast.ts`
- **Details:** Query `websocket_connections` by `user_id`, call API Gateway Management API `postToConnection`, catch `GoneException` (stale connection), remove from registry on 410 response.

**DSQL Transactions:**

- **Pattern:** Single transaction block for multi-step state changes
- **Exemplar:** `infrastructure/dsql/queries/artifacts.ts` → `updateArtifactStatus`
- **Details:** Use `BEGIN...COMMIT` for updates that change multiple columns (`task_status`, `updated_at`, `content_url`). Rollback on error. Never leave orphaned records with inconsistent state.

**Infrastructure as Code (Terraform):**

- **Pattern:** Module per service, outputs for cross-module references
- **Exemplar:** `infrastructure/terraform/modules/lambda/main.tf`
- **Details:** Each resource (Fargate cluster, SQS queue) is a separate module. Outputs expose ARNs, IDs, and endpoint URLs for consumption by dependent modules. Variables use descriptive names with type constraints.

**Testing Async Flows:**

- **Pattern:** Mock external dependencies, test state transitions
- **Exemplar:** `infrastructure/lambda/api-gateway/handlers/orbits/create.test.ts`
- **Details:** Use `vitest` with `mockResolvedValue` for AWS SDK calls. For Fargate task tests, mock SQS polling to return a test message, mock Bedrock response, assert DSQL/S3 writes and WebSocket broadcast. For integration tests, use LocalStack or live AWS resources in isolated test account.

### Anti-patterns (avoid these)

**Synchronous LLM Calls in Lambda:**

- **Why:** Lambda has 15-minute timeout; LLM calls may exceed this. Previous architecture suffered from timeout errors.
- **Mitigation:** Use the async pattern for all LLM operations >1 minute expected duration. For short operations (<30 seconds), synchronous Lambda is acceptable.

**Storing Sensitive Data in SQS Messages:**

- **Why:** SQS messages are visible in CloudWatch logs and accessible to anyone with queue permissions.
- **Mitigation:** Messages contain only task ID and references (user ID, workspace ID). Actual artifact parameters are stored in DSQL; Fargate task retrieves them by task ID.

**Unbounded Fargate Task Scaling:**

- **Why:** LLM calls are expensive; runaway scaling could incur thousands of dollars in Bedrock charges before detection.
- **Mitigation:** ECS service `maximumCount = 10`. CloudWatch alarm triggers at 8 concurrent tasks. Cost anomaly detection enabled in AWS Budgets.

**Blocking WebSocket Calls in Task Logic:**

- **Why:** WebSocket broadcast failures should not block task completion or cause message reprocessing.
- **Mitigation:** WebSocket notification is best-effort. If broadcast fails (connection gone, API error), log the failure and complete the task anyway. Client can poll DSQL for task status as fallback.

**Implicit Task Timeout:**

- **Why:** If a Fargate task hangs (LLM call never returns, infinite loop), it may run indefinitely.
- **Mitigation:** Set SQS visibility timeout to 45 minutes (longer than max expected task duration). If task exceeds this, message becomes visible again and is retried. After 3 retries, message moves to DLQ for manual inspection.

---

## Prior Orbit References

### Completed

**No direct predecessors** — This is the first Fargate-based workload in Prometheus V1. Related work:

- **T1-005 (Orbit 3):** Implemented WebSocket connection management for real-time notifications. Established `websocket_connections` schema and `broadcast.ts` utility. Relevant because this intent reuses that infrastructure for task completion events.
- **T3-012 (Orbit 2):** Added CloudWatch dashboards for Lambda observability. Established monitoring conventions (alarms, metrics, log queries) that should be replicated for Fargate tasks.
- **T4-008 (Orbit 1):** Implemented S3 artifact storage with signed URLs. Established bucket structure and naming conventions (`artifacts/{workspace_id}/{orbit_id}/{artifact_id}.json`). Fargate task must follow the same pattern.

### Known Issues

**Lambda Timeout on Large Codebases:**

- **Context:** Users with >10k LOC codebases experience timeouts when generating Context Packages or decomposing complex intents. This intent directly addresses that limitation.
- **Implication:** Fargate task must be stress-tested with large inputs (codebase size, conversation history) to ensure it handles scenarios that previously timed out.

**WebSocket Connection Staleness:**

- **Context:** Existing WebSocket implementation does not proactively detect stale connections. `GoneException` is handled reactively.
- **Implication:** Fargate task must gracefully handle broadcast failures. Do not retry indefinitely or fail the task if WebSocket notification fails.

**DSQL Transaction Contention:**

- **Context:** High-frequency updates to the same `orbit` record caused occasional deadlocks in previous implementations.
- **Implication:** If multiple Fargate tasks update the same orbit concurrently (unlikely but possible), use optimistic locking or retry transient `SerializationFailure` errors.

---

## Risk Assessment

### Data Integrity Risks

**Risk:** Fargate task writes partial result to S3 but fails before updating DSQL, leaving artifact in `queued` state forever.

**Likelihood:** Medium (transient DSQL failures, task termination during write)

**Impact:** High — User sees "processing" indefinitely, artifact is lost

**Mitigation:**
- Use DSQL transactions: write S3 URL and status update in single transaction
- If S3 write succeeds but DSQL write fails, SQS message visibility timeout expires → task retries → idempotent S3 write (overwrite same key)
- Add CloudWatch alarm for `task_status = 'queued'` older than 1 hour → manual investigation

**Risk:** SQS message deleted before DSQL write commits, leading to lost task result.

**Likelihood:** Low (requires race condition between delete and commit)

**Impact:** Critical — Result is computed but never recorded

**Mitigation:**
- Delete SQS message AFTER DSQL transaction commits, not before
- Use `sqs:ChangeMessageVisibility` to extend timeout while processing, ensuring message stays invisible until task completes
- DLQ captures messages that exceed max retries; manual recovery process can replay from DLQ

### Cost Risks

**Risk:** Runaway Fargate scaling due to message backlog or slow task execution.

**Likelihood:** Low (protected by `maximumCount = 10`)

**Impact:** High — $500+ daily cost for sustained max-capacity operation

**Mitigation:**
- ECS service autoscaling policy capped at 10 tasks
- CloudWatch alarm at 8 concurrent tasks (80% capacity) → alerts on-call engineer
- AWS Budget configured with $100/day threshold → email alert
- SQS queue depth alarm at 50 messages → indicates abnormal load or task failures

**Risk:** Long-running LLM calls (30+ minutes) cost more than expected per task.

**Likelihood:** Medium (user requests with large context windows)

**Impact:** Medium — $2-5 per task for sustained Claude 3 Opus usage

**Mitigation:**
- Monitor `TaskDuration` CloudWatch metric, alert if p95 > 20 minutes
- Set Bedrock request timeout at 30 minutes (fail task if LLM call exceeds)
- Consider usage-based rate limiting (e.g., max 10 Fargate tasks per user per hour)

### Security Risks

**Risk:** Fargate task IAM role is over-permissioned, allowing access to unrelated S3 buckets or DSQL tables.

**Likelihood:** Low (IAM policy is scoped to specific resources)

**Impact:** High — Task compromise could leak data from other workspaces

**Mitigation:**
- IAM policy uses resource constraints: `s3:PutObject` only on `arn:aws:s3:::artifacts-bucket/artifacts/*`
- DSQL policy uses row-level security: task can only update artifacts where `workspace_id = <task's workspace>`
- Regular IAM policy audits (quarterly) to prune unused permissions

**Risk:** SQS message contains sensitive data (API keys, user PII) in plain text.

**Likelihood:** Low (messages contain only IDs)

**Impact:** Medium — CloudWatch Logs or SQS console exposes sensitive data

**Mitigation:**
- Message body is JSON with fields: `{ taskId, userId, workspaceId }`
- Sensitive parameters (intent description, codebase content) are never in SQS message; retrieved from DSQL by task ID
- SQS queue encryption at rest using AWS-managed KMS key

**Risk:** WebSocket broadcast leaks task result to wrong user's connection.

**Likelihood:** Low (connection lookup is by `user_id`)

**Impact:** Critical — Cross-user data exposure

**Mitigation:**
- WebSocket connection registry enforces `user_id` → `connection_id` mapping with workspace isolation
- Broadcast payload contains only task ID and status, not full artifact content (client fetches via authenticated API call)
- Integration test validates: User A's task completion does not notify User B's WebSocket connection

### Performance Risks

**Risk:** Fargate task cold start (10+ seconds) delays message processing, accumulating queue backlog.

**Likelihood:** High (ECS scales from 1 → 10 tasks on demand)

**Impact:** Medium — Users experience 10-20 second lag before task begins

**Mitigation:**
- Set ECS service `desiredCount = 1` (one task always warm)
- Monitor `TimeInQueue` metric (time between message publish and task pickup), alert if p95 > 5 seconds
- Consider pre-warming: periodically send no-op messages to keep tasks alive

**Risk:** WebSocket notification latency exceeds 500ms due to connection lookup overhead.

**Likelihood:** Medium (DSQL query for `websocket_connections` adds 100-200ms)

**Impact:** Low — Degrades UX but does not block task completion

**Mitigation:**
- Index `websocket_connections` table on `user_id`
- Cache connection IDs in Fargate task memory (invalidate on `GoneException`)
- If broadcast latency exceeds threshold, consider asynchronous notification (write to SNS topic, separate Lambda handles broadcast)

### Operational Risks

**Risk:** CloudWatch Logs retention fills storage with verbose Fargate task logs.

**Likelihood:** Medium (tasks log every SQS poll, LLM request, DSQL query)

**Impact:** Low — Increased AWS bill, log search performance degrades

**Mitigation:**
- Set log retention to 7 days for Fargate task logs (vs. 30 days for Lambda)
- Use structured logging with `level: 'info'` for normal operations, `level: 'debug'` only when troubleshooting
- Sample logs: log 1 in 10 successful task completions at `info` level, all failures at `error` level

**Risk:** X-Ray trace sampling misses critical failure paths in Fargate → WebSocket flow.

**Likelihood:** Low (X-Ray samples 5% of requests by default)

**Impact:** Medium — Difficult to debug production issues

**Mitigation:**
- Enable X-Ray active tracing for all Fargate tasks (env var `AWS_XRAY_TRACING_NAME`)
- Propagate trace ID from Lambda → SQS message attributes → Fargate task → WebSocket broadcast
- For failed tasks, force 100% sampling (send `X-Amzn-Trace-Id` header with `Sampled=1`)

---

## Dependencies

**Prerequisite Intents/Orbits:**

- **T6-001:** Fargate cluster setup (ECS cluster, VPC configuration, IAM roles) — MUST be completed before this orbit begins execution
- **T6-002:** SQS queue provisioning (main queue, DLQ, visibility timeout configuration) — MUST be completed before this orbit begins execution

If T6-001 and T6-002 are not complete, the `context` phase of this orbit should include their scope or they should be delivered as prerequisites.

**External Service Dependencies:**

- **AWS Bedrock:** Fargate task invokes Claude 3 models via `bedrock-runtime:InvokeModel` API. Requires:
  - Model access enabled in AWS account (request via AWS Console if not already granted)
  - VPC endpoint for `bedrock-runtime` or NAT gateway for internet access
  - Rate limit handling (Bedrock enforces per-model throttling; implement exponential backoff)

- **AWS API Gateway (WebSocket):** Existing WebSocket API for broadcasting events. Requires:
  - `$default` route for incoming messages (already implemented)
  - Connection management Lambda functions (already implemented)
  - Fargate task IAM role must have `execute-api:ManageConnections` permission

- **DSQL:** Existing Aurora DSQL database for artifact and connection storage. Requires:
  - Schema migration to add `task_id`, `task_status`, `task_error` columns to `artifacts` table
  - Row-level security policy to enforce workspace isolation for Fargate task queries

**Infrastructure Dependencies:**

- **VPC Endpoints:** Required to reduce data transfer costs and improve security:
  - `com.amazonaws.us-east-1.s3` (S3 Gateway endpoint, already exists)
  - `com.amazonaws.us-east-1.sqs` (SQS Interface endpoint, create if not exists)
  - `com.amazonaws.us-east-1.bedrock-runtime` (Bedrock Interface endpoint, create if not exists)

- **NAT Gateway:** Required if VPC endpoints are not used for Bedrock (cost: $0.045/hour + data transfer). Fargate tasks in private subnet cannot reach internet without NAT or VPC endpoint.

**Observability Dependencies:**

- **CloudWatch Logs:** Log group for Fargate task logs (`/ecs/artifact-generation-task`)
- **CloudWatch Metrics:** Custom metrics for task duration, queue depth, failure rate
- **X-Ray:** Tracing enabled for API Gateway, Lambda, and Fargate tasks (requires X-Ray daemon sidecar or AWS SDK instrumentation)