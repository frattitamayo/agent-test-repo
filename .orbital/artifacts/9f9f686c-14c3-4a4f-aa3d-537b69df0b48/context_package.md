# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** T6-003  
**Trust Tier:** tier_2

---

## Codebase References

### Primary (will be modified or created)

- `infrastructure/terraform/fargate.tf` — New Fargate cluster, task definitions, ECS service configuration
- `infrastructure/terraform/sqs.tf` — New SQS queue and DLQ for async task routing
- `services/lambda/handlers/artifacts/generate.ts` — Modify to enqueue long-running requests to SQS
- `services/lambda/handlers/chat/stream.ts` — Modify to enqueue extended conversations to SQS
- `services/fargate/worker/` — New directory for Fargate worker service
- `services/fargate/worker/src/main.ts` — Entry point for Fargate task that polls SQS
- `services/fargate/worker/src/handlers/artifact_generation.ts` — LLM artifact generation logic
- `services/fargate/worker/src/handlers/ai_chat.ts` — LLM chat processing logic
- `services/fargate/worker/Dockerfile` — Container definition for Fargate worker
- `services/lambda/handlers/websocket/status.ts` — New endpoint for reconnection status retrieval

### Secondary (dependencies and interfaces)

- `services/shared/bedrock_client.ts` — Bedrock API client wrapper used by both Lambda and Fargate
- `services/shared/s3_client.ts` — S3 operations for artifact storage
- `services/shared/dsql_client.ts` — DSQL operations for task status persistence
- `services/shared/websocket_client.ts` — WebSocket notification sender
- `services/shared/types/` — Shared TypeScript types for tasks, artifacts, messages
- `infrastructure/terraform/iam.tf` — IAM roles and policies
- `infrastructure/terraform/cloudwatch.tf` — Log groups, metric filters, alarms
- `services/lambda/handlers/websocket/connect.ts` — Existing connection handler
- `services/lambda/handlers/websocket/disconnect.ts` — Existing disconnection handler
- `frontend/src/hooks/useWebSocket.ts` — WebSocket connection management on frontend
- `frontend/src/components/ArtifactGeneration/` — Artifact generation UI components
- `frontend/src/components/AIChat/` — AI chat UI components

### Tests

- `services/lambda/handlers/artifacts/__tests__/generate.test.ts`
- `services/lambda/handlers/chat/__tests__/stream.test.ts`
- `services/fargate/worker/__tests__/integration/` — New integration test directory
- `services/shared/__tests__/bedrock_client.test.ts`

---

## Architecture Context

Prometheus V1 follows a serverless-first architecture with API Gateway → Lambda as the synchronous HTTP boundary. All user requests originate from the React frontend, pass through API Gateway REST API, and invoke Lambda handlers. Lambda currently performs LLM operations inline using Bedrock, which works for operations completing within 15 minutes but fails for complex artifact generation and extended AI chat sessions.

This intent introduces an **async processing pattern** where:

1. **Lambda as request router**: Lambda receives the HTTP request, validates inputs, writes initial task record to DSQL, enqueues a message to SQS with task metadata, and immediately returns a 202 Accepted response with a task ID.

2. **SQS as work queue**: SQS Standard Queue decouples Lambda from Fargate. Messages contain task type (artifact generation or AI chat), task ID, input parameters, and requester identity. Visibility timeout set to 1 hour to accommodate long-running LLM operations.

3. **Fargate as worker**: ECS Fargate tasks poll SQS using long-polling, receive messages, execute LLM operations via Bedrock, write results to S3 (artifacts) and DSQL (task status), send WebSocket notifications to connected clients, and delete messages from SQS on success.

4. **WebSocket for notifications**: Existing WebSocket API (API Gateway WebSocket) maintains persistent connections to frontend clients. Fargate worker sends progress updates and completion notifications. Disconnected clients can reconnect and retrieve task status via new `/status` endpoint that queries DSQL.

**Data Flow:**
```
Frontend → API Gateway REST → Lambda (enqueue) → SQS → Fargate (process) → S3 + DSQL → WebSocket API → Frontend
```

**Failure Handling:**
- SQS message not deleted → redelivery after visibility timeout expires → Fargate retries (up to 3 attempts via SQS redrive policy)
- After max retries → message moved to DLQ → CloudWatch alarm triggers → manual investigation
- WebSocket disconnection → client reconnects → `/status` endpoint returns task result from DSQL

**Backward Compatibility:**
Lambda handlers detect operation duration heuristics (e.g., artifact count, conversation depth) and decide whether to execute inline (< 5 min) or enqueue to SQS (≥ 5 min). Existing short-running operations continue unchanged.

**Infrastructure Boundaries:**
- **Fargate IAM Role**: `arn:aws:iam::ACCOUNT:role/FargateWorkerRole` with policies for `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `bedrock:InvokeModel`, `s3:PutObject`, `dynamodb:PutItem`, `execute-api:ManageConnections`
- **Lambda IAM Role**: Add `sqs:SendMessage` permission to existing role
- **Fargate Scaling**: ECS Service with target tracking on SQS `ApproximateNumberOfMessagesVisible` metric. Scale out when queue depth > 10, scale in to 0 when queue empty for 5 minutes.

**Reference docs:**
- `docs/architecture/serverless-design.md` — Serverless patterns and Lambda constraints
- `docs/architecture/websocket-protocol.md` — WebSocket message format and connection lifecycle
- `docs/infrastructure/terraform-conventions.md` — Terraform module structure and naming

---

## Pattern Library

### Conventions (follow these)

- **Lambda Handler Structure**: See `services/lambda/handlers/artifacts/list.ts` — All Lambda handlers export a single `handler` function with `APIGatewayProxyEvent` input and `APIGatewayProxyResult` output. Error handling via try-catch with standardized error responses (`error_response.ts`). Input validation using Zod schemas.

- **SQS Message Envelope**: See `services/shared/types/sqs_message.ts` — SQS message bodies are JSON with `{ task_id, task_type, payload, metadata: { user_id, request_id, timestamp } }`. All messages include request tracing ID for CloudWatch Logs correlation.

- **Bedrock Client Usage**: See `services/shared/bedrock_client.ts` — Bedrock invocations wrapped in exponential backoff retry logic (3 attempts, 1s/2s/4s delays). Throttling errors (429) trigger backoff. Non-retryable errors (400) throw immediately. Streaming responses buffered in 1KB chunks for progress tracking.

- **DSQL Task Schema**: See `schema/dsql/tasks.sql` — Task records in `tasks` table with columns: `task_id` (PK), `task_type`, `status` (enum: pending/running/completed/failed), `created_at`, `started_at`, `completed_at`, `result_s3_key`, `error_message`, `retry_count`, `user_id`. Status transitions: pending → running → (completed|failed).

- **S3 Artifact Storage**: See `services/shared/s3_client.ts` — Artifacts stored in `prometheus-artifacts-{environment}` bucket with key pattern: `artifacts/{project_id}/{trajectory_id}/{intent_id}/{orbit_id}/{artifact_type}_{timestamp}.json`. Metadata tags: `project_id`, `intent_id`, `orbit_id`. Lifecycle policy archives to Glacier after 90 days.

- **WebSocket Notification Format**: See `services/lambda/handlers/websocket/send.ts` — WebSocket messages are JSON with `{ event_type, task_id, data, timestamp }`. Event types: `task.progress` (with `percentage` field), `task.completed` (with `result_url` field), `task.failed` (with `error` field). Connection IDs retrieved from DSQL `websocket_connections` table.

- **Fargate Task Definition**: See `infrastructure/terraform/modules/ecs_task/` — Task definitions define resource limits (CPU: 1 vCPU, Memory: 2GB for LLM operations), execution role (for ECR image pull), task role (for runtime AWS API calls), log configuration (CloudWatch Logs with awslogs driver), environment variables (only non-sensitive config like `AWS_REGION`, `ENVIRONMENT`).

- **Terraform Module Structure**: See `infrastructure/terraform/modules/` — Infrastructure components organized as reusable modules. SQS module accepts `queue_name`, `visibility_timeout`, `dlq_retention_days`. ECS module accepts `cluster_name`, `service_name`, `task_definition_arn`, `desired_count`, `autoscaling_config`.

- **TypeScript Project Structure**: See `services/fargate/worker/tsconfig.json` — All TypeScript services use strict mode, ES2022 target, path aliases (`@shared/*` → `services/shared/*`), Jest for testing. Build output to `dist/`, source in `src/`.

### Anti-patterns (avoid these)

- **Lambda invoking Fargate directly**: Never use `ecs:RunTask` from Lambda. This couples Lambda to Fargate task lifecycle and breaks async processing. Always enqueue to SQS.

- **SQS message retention as primary storage**: SQS message retention (14 days max) is insufficient for audit trails. Always persist task state to DSQL before deleting SQS message.

- **Inline credentials**: Never pass AWS credentials in SQS message body or environment variables. Use IAM roles for all AWS SDK calls.

- **Synchronous WebSocket responses**: Frontend must not poll WebSocket connections synchronously waiting for task completion. Use event-driven handlers that update UI on `task.completed` event arrival.

- **Unbounded Fargate concurrency**: Do not set ECS service desired count > 10 without load testing. Bedrock throttling limits (200 TPS) are cross-region and shared. Runaway Fargate scaling can exhaust quota and impact other operations.

- **Missing request IDs**: All log statements must include `request_id` from message metadata for distributed tracing. Logs without request IDs are un-debuggable across Lambda → SQS → Fargate boundary.

---

## Prior Orbit References

### Completed

This is Orbit 1 for Intent T6-003. No prior orbits for this intent.

**Related intents:**
- **T4-002** (Trajectory: Real-time Collaboration) — Implemented WebSocket API for real-time notifications. Established `websocket_connections` table in DSQL, connection/disconnection handlers, and message format conventions. This intent reuses that WebSocket infrastructure for task notifications.

- **T5-001** (Trajectory: Artifact Generation V2) — Refactored artifact generation to use modular prompt templates and Bedrock streaming responses. Established `services/shared/bedrock_client.ts` wrapper with retry logic. That client is reused by Fargate worker with no modifications required.

**Architectural decisions:**
- **ADR-008: WebSocket over Server-Sent Events** — Chose WebSocket API over SSE for bidirectional communication. Relevant because task status retrieval on reconnection uses bidirectional protocol (client sends `get_status` request, server responds with status).

- **ADR-012: DSQL over DynamoDB for transactional data** — Chose Aurora DSQL for relational queries and transactions. Task state tracking benefits from SQL queries (`SELECT * FROM tasks WHERE user_id = ? AND status = 'running'`) for reconnection status retrieval.

### Known Issues

- **Bedrock throttling under high concurrency**: Current Lambda-based artifact generation has encountered `ThrottlingException` from Bedrock when > 50 concurrent requests hit the same model. Fargate must implement global concurrency limits (via ECS service max task count) to prevent exceeding Bedrock quota. Mitigation: Set ECS max capacity to 10 tasks until load testing validates higher limits.

- **WebSocket connection table cleanup**: Stale connection IDs accumulate in `websocket_connections` table when clients close browser tabs without graceful disconnect. Disconnect handler does not always fire. Fargate must handle `GoneException` when sending WebSocket messages to stale connections. Mitigation: Already implemented in `services/shared/websocket_client.ts` — catch `GoneException`, delete connection ID from DSQL, continue processing.

- **S3 eventual consistency for artifact reads**: After Fargate writes artifact to S3, there's a 0-1 second window where S3 `GetObject` may return `NoSuchKey` despite successful `PutObject`. Frontend artifact retrieval must retry with exponential backoff. Mitigation: Already implemented in `services/shared/s3_client.ts` — retry up to 3 times with 500ms delay.

---

## Risk Assessment

### Operational Risks

**Risk: SQS message loss due to visibility timeout misconfiguration**
- **Scenario**: Fargate task runs for 90 minutes, but SQS visibility timeout set to 60 minutes. Message becomes visible again while task still running. Another Fargate task receives duplicate message and processes same work concurrently.
- **Impact**: Duplicate artifact generation, wasted Bedrock API costs, confusing "completed" notifications sent twice.
- **Mitigation**: Set SQS visibility timeout to 1 hour (60 minutes) AND implement idempotency in Fargate worker (check task status in DSQL before processing; skip if status = 'running' or 'completed').
- **Detection**: CloudWatch metric for duplicate `task.completed` events sent to same task_id. Alarm if count > 1.

**Risk: Fargate OOM errors during large artifact generation**
- **Scenario**: Artifact generation for workspace with 50+ intents loads all context into memory, exceeds 2GB task memory limit, Fargate task killed by ECS.
- **Impact**: Task fails without retry (ECS does not auto-retry OOM errors), user receives "failed" notification without actionable error message.
- **Mitigation**: Implement memory-efficient streaming: process artifacts one at a time, write to S3 incrementally, clear from memory. Add CloudWatch Container Insights memory metrics. Alarm if memory utilization > 80%.
- **Detection**: CloudWatch Logs entry with `137` exit code (OOM kill signal). ECS task stopped reason = "OutOfMemory".

**Risk: Fargate cold start delays user experience**
- **Scenario**: ECS service scaled to zero after 5 minutes idle. User submits artifact generation request. Lambda enqueues to SQS immediately, but Fargate takes 30 seconds to pull image and start task. User sees "pending" status for 30+ seconds with no progress.
- **Impact**: Perceived slowness, user abandons operation thinking it failed.
- **Mitigation**: Keep 1 Fargate task warm (desired count = 1) during business hours (8am-8pm UTC) using CloudWatch Event scheduled scaling. Scale to 0 only during off-hours.
- **Detection**: CloudWatch metric `TimeToFirstMessage` = time between SQS message send and first Fargate log entry. Alarm if p95 > 30 seconds.

**Risk: WebSocket disconnection during long-running task**
- **Scenario**: User submits 20-minute artifact generation, walks away from computer, laptop goes to sleep, WebSocket disconnects. Task completes while user disconnected. Notification lost.
- **Impact**: User returns to UI still showing "in progress" spinner, does not know task completed.
- **Mitigation**: Frontend polls `/status` endpoint every 30 seconds while task in "running" state. On reconnection, immediately query `/status` and update UI. DSQL persistence ensures status survives disconnection.
- **Detection**: CloudWatch metric for WebSocket `GoneException` rate when sending task notifications. Normal if < 10% of messages.

### Security Risks

**Risk: Fargate task accesses data from other tenants**
- **Scenario**: Fargate worker processes task for user A, but user_id not included in SQS message metadata or not validated. Worker reads/writes artifacts belonging to user B.
- **Impact**: Data leak, compliance violation (SOC 2, GDPR).
- **Mitigation**: Include `user_id` in SQS message metadata. Fargate worker validates task ownership by querying DSQL task record and comparing `user_id` from message to task record `user_id` before processing. All S3 and DSQL operations include `user_id` in request context for audit logging.
- **Detection**: CloudWatch Logs Insights query for mismatched user IDs: `fields @timestamp, task_id, message.user_id, dsql_user_id | filter message.user_id != dsql_user_id`. Alarm if count > 0.

**Risk: Privilege escalation via IAM role overpermissions**
- **Scenario**: Fargate task role granted `s3:*` instead of `s3:PutObject` on specific bucket. Compromised container (e.g., via supply chain attack in npm dependency) deletes all artifacts.
- **Impact**: Data loss, service outage.
- **Mitigation**: Apply least-privilege IAM policies. Fargate task role grants only: `s3:PutObject` on `arn:aws:s3:::prometheus-artifacts-*/*`, `dynamodb:PutItem` on `tasks` table ARN, `bedrock:InvokeModel` on specific model ARN, `sqs:ReceiveMessage|DeleteMessage` on task queue ARN, `execute-api:ManageConnections` on WebSocket API ARN. Use resource-level restrictions (`Resource` field in IAM policy).
- **Detection**: AWS CloudTrail logs for unauthorized API calls from Fargate role. GuardDuty findings for anomalous behavior.

**Risk: Secrets exposure in Fargate logs**
- **Scenario**: Developer logs SQS message body containing user input. User input includes sensitive data (API keys, passwords) from artifact generation context. Logs written to CloudWatch Logs with 90-day retention.
- **Impact**: Secrets leak, compliance violation.
- **Mitigation**: Never log full SQS message body or user input payloads. Redact sensitive fields. Log only task_id, task_type, request_id for tracing. Use structured logging (JSON) and define explicit allow-list of fields to log.
- **Detection**: Manual audit of log statements before deployment. Automated regex scan in CI/CD for patterns like `log(message.body)`.

### Performance Risks

**Risk: SQS queue depth grows faster than Fargate can process**
- **Scenario**: 100 users submit artifact generation requests simultaneously. Lambda enqueues 100 messages to SQS in 10 seconds. Fargate service maxes out at 10 tasks. Each task processes 1 message per 5 minutes. Queue depth grows to 50+ messages.
- **Impact**: Users wait 20+ minutes for results, perceive service as broken, contact support.
- **Mitigation**: Implement autoscaling on `ApproximateNumberOfMessagesVisible` metric. Scale out threshold: 10 messages → add 1 task (max 10 tasks). Monitor queue age metric. If age > 5 minutes AND task count < max, trigger manual investigation (potential Fargate launch failures).
- **Detection**: CloudWatch alarm on `ApproximateAgeOfOldestMessage` > 300 seconds. CloudWatch dashboard showing queue depth, task count, and processing rate (messages/minute).

**Risk: Bedrock API throttling cascades to all operations**
- **Scenario**: Fargate workers invoke Bedrock at max rate (200 TPS cross-region). Throttling errors returned. Workers retry with exponential backoff. Retry storms amplify load. Bedrock quota exhausted for 15+ minutes.
- **Impact**: All LLM operations (including Lambda-based short-running tasks) fail with throttling errors. Service-wide outage.
- **Mitigation**: Implement distributed rate limiting using SQS + ECS service autoscaling. Limit max Fargate concurrency to 5 tasks initially (each task averages 2 Bedrock calls/second = 10 TPS total). Monitor Bedrock throttling CloudWatch metric. Gradually increase max tasks after validating throttling rate < 1%.
- **Detection**: CloudWatch metric `ThrottlingException` count from Bedrock client. Alarm if rate > 10/minute.

### Cost Risks

**Risk: Fargate tasks fail to terminate after completion**
- **Scenario**: Bug in Fargate worker code causes infinite loop after successful artifact generation. Task continues running, consuming CPU/memory, accruing Fargate charges at $0.04/hour/task.
- **Impact**: 10 stuck tasks over 7 days = $67.20 unnecessary spend. Multiplied across production/staging/dev environments.
- **Mitigation**: Implement task timeout at ECS task definition level: `StopTimeout = 3600` (1 hour). If task runs longer, ECS forcibly stops it. Fargate worker implements graceful shutdown: process 1 message, send completion notification, exit process (ECS restarts task for next message).
- **Detection**: CloudWatch alarm on ECS task running duration > 1 hour. CloudWatch Logs entry with `StopTimeout exceeded` message.

**Risk: Retry storms from DLQ messages trigger runaway costs**
- **Scenario**: Persistent Bedrock API error (e.g., model temporarily unavailable) causes 100 messages to land in DLQ. Manual reprocessing script redrives all messages to main queue simultaneously. Fargate scales out to 10 tasks. All tasks retry same failing operation. Cycle repeats.
- **Impact**: Bedrock API charges ($2/1M input tokens × 100 retries × 100 messages = $20,000 wasted).
- **Mitigation**: DLQ redrive requires manual approval. Implement circuit breaker in Fargate worker: if > 5 consecutive messages fail with same error type, stop processing and send alert. Do not auto-retry DLQ messages.
- **Detection**: CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible` > 0. PagerDuty alert for manual investigation before redrive.

---

## Implementation Checklist

Before beginning orbit execution, validate:

- [ ] Existing WebSocket API connection table schema reviewed (`websocket_connections`)
- [ ] Existing S3 bucket permissions allow Fargate role to write artifacts
- [ ] Existing DSQL `tasks` table schema supports required columns (or schema migration planned)
- [ ] Bedrock model quotas checked in target region (verify 200 TPS available)
- [ ] Terraform state backend configured for infrastructure changes
- [ ] ECR repository exists for Fargate container images
- [ ] CloudWatch Log Groups retention policies reviewed (90 days standard)
- [ ] Cost estimation approved: 10 Fargate tasks × 1 vCPU × 2GB × 24 hours × 30 days × $0.04/hour = ~$288/month baseline