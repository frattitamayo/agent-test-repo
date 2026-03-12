# Verification Protocol — T6-003: Migrate Long-Running LLM Tasks to Fargate

**Protocol ID:** VP-T6-003-1
**Generated:** 2026-03-12
**Intent:** T6-003
**Proposal:** PROP-T6-003-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | API Gateway accepts request, returns task ID within 2 seconds, places SQS message | Lambda handler receives valid POST `/artifacts` request, creates artifact record with `task_status = 'queued'`, publishes SQS message, returns 202 with task ID in <2 seconds | `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — `TestGenerateHandler/valid_request_enqueues_task` | Test passes, response time assertion ≤2000ms | Yes |
| AG-02 | API Gateway accepts request, returns task ID within 2 seconds, places SQS message | SQS message structure contains `taskId`, `userId`, `workspaceId`, `orbitId` and no sensitive parameters | `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — `TestGenerateHandler/sqs_message_schema` | Message matches Zod schema, no `codebaseContent` or `conversationHistory` fields present | Yes |
| AG-03 | Fargate task consumes message, invokes LLM, stores in S3/DSQL, deletes message | Fargate task polls SQS, receives message, retrieves artifact parameters from DSQL by `taskId` | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/message_consumption` | Mock SQS returns test message, DSQL query executes with correct `taskId`, returns artifact record | Yes |
| AG-04 | Fargate task consumes message, invokes LLM, stores in S3/DSQL, deletes message | Task invokes Bedrock with artifact parameters, receives LLM response, writes to S3 with key `artifacts/{workspaceId}/{orbitId}/{taskId}.json` | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/bedrock_invocation_and_s3_write` | Mock Bedrock returns 200 with content, S3 `PutObject` called with correct key, content matches LLM response | Yes |
| AG-05 | Fargate task consumes message, invokes LLM, stores in S3/DSQL, deletes message | Task updates DSQL artifact record with `task_status = 'completed'`, `content_url = s3SignedUrl` in single transaction | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/dsql_transaction_commit` | Mock DSQL transaction begins, UPDATE statement with correct `taskId`, transaction commits, `task_status = 'completed'` | Yes |
| AG-06 | Fargate task consumes message, invokes LLM, stores in S3/DSQL, deletes message | Task deletes SQS message after successful DSQL commit | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/sqs_delete_after_commit` | SQS `DeleteMessage` called with correct receipt handle AFTER DSQL commit completes | Yes |
| AG-07 | WebSocket notification within 500ms with artifact ID and download URL | Task broadcasts WebSocket event to user's connection with `{ type: 'task_completed', taskId, artifactId, downloadUrl }` | `infrastructure/fargate/shared/websocket-notifier.test.ts` — `TestNotifier/broadcast_payload` | WebSocket `postToConnection` called with correct connection ID, payload contains required fields | Yes |
| AG-08 | Failed tasks retry 3 times then DLQ | Task processing fails due to Bedrock timeout, SQS message visibility timeout expires, message becomes visible for retry | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/retry_on_bedrock_timeout` | Mock Bedrock times out, task logs error, does not delete message, SQS visibility timeout expires (mock timer) | Yes |
| AG-09 | Failed tasks retry 3 times then DLQ | After 3 failed receive attempts, message moves to DLQ | SQS queue configuration test — `infrastructure/terraform/sqs-queues.tf` validation | Terraform apply succeeds, SQS DLQ policy `maxReceiveCount = 3` verified via AWS CLI `get-queue-attributes` | Yes |
| AG-10 | CloudWatch logs queryable with request tracing | Fargate task logs include `taskId`, `userId`, `workspaceId` in structured JSON format | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/structured_logging` | Log output parsed as JSON, contains required fields, log level matches operation (info/error) | Yes |
| AG-11 | Task pickup latency ≤ 2s p50, ≤ 5s p99 | SQS message published timestamp vs. Fargate task receive timestamp measured | Integration test — `tests/integration/fargate-to-websocket.test.ts` — `TestE2E/task_pickup_latency` | Publish 50 messages, measure `receiveTimestamp - sentTimestamp`, assert p50 ≤2s, p99 ≤5s | Yes |
| AG-12 | WebSocket notification latency ≤ 500ms p95 | Task DSQL commit timestamp vs. WebSocket client receive timestamp measured | Integration test — `tests/integration/fargate-to-websocket.test.ts` — `TestE2E/notification_latency` | Complete 20 tasks, measure WebSocket event arrival time, assert p95 ≤500ms | Yes |
| AG-13 | Fargate cold start ≤ 10s | ECS task start time (task pending → running) measured when scaling from 0 to 1 tasks | Integration test — `tests/integration/fargate-scaling.test.ts` — `TestScaling/cold_start_duration` | Scale service to 0, publish message, measure task start time via ECS API, assert ≤10s | Yes |
| AG-14 | End-to-end for 5-min LLM call ≤ 6 minutes | Full request flow from API call to WebSocket notification measured with mock 5-minute Bedrock response | Integration test — `tests/integration/fargate-to-websocket.test.ts` — `TestE2E/end_to_end_with_long_llm_call` | Mock Bedrock with 5-minute delay, measure total time, assert ≤6 minutes (360s) | Yes |
| AG-15 | Message loss rate: 0% | SQS message persistence verified through task failure and retry | Integration test — `tests/integration/sqs-reliability.test.ts` — `TestReliability/message_persistence_on_failure` | Publish message, simulate task crash before delete, verify message reappears after visibility timeout | Yes |
| AG-16 | Task success rate for non-LLM failures ≥ 99.5% | Infrastructure failures (DSQL timeout, S3 throttle) are retried and succeed | Unit test — `infrastructure/fargate/shared/bedrock-client.test.ts` — `TestRetryLogic/transient_errors` | Mock transient error on first attempt, success on retry, assert task completes | Yes |
| AG-17 | Max 10 concurrent Fargate tasks (cost boundary) | ECS service configuration enforces `maximumCount = 10` | Terraform validation — `infrastructure/terraform/fargate-cluster.tf` | Terraform plan output shows `max_capacity = 10`, applied configuration verified via AWS CLI | Yes |
| AG-18 | 2 vCPU, 4GB RAM per task (cost boundary) | ECS task definition specifies resource limits | Terraform validation — `infrastructure/terraform/fargate-cluster.tf` | Task definition JSON contains `"cpu": "2048"`, `"memory": "4096"` | Yes |
| AG-19 | SQS retention 7 days (cost boundary) | Queue configuration sets message retention period | Terraform validation — `infrastructure/terraform/sqs-queues.tf` | Queue attribute `MessageRetentionPeriod = 604800` (7 days in seconds) | Yes |
| AG-20 | Lambda handler idempotency prevents duplicate tasks | Submitting identical request twice within 1 second returns existing task ID | `infrastructure/lambda/api-gateway/handlers/artifacts/generate.test.ts` — `TestGenerateHandler/idempotency_key` | Two requests with same parameters (userId + workspaceId + orbitId + hash), second returns existing taskId, only one SQS message published | Yes |
| AG-21 | Fargate task IAM role scoped to specific S3 prefix | Task can write to `artifacts/*` but cannot access other S3 paths | IAM policy test — `tests/security/iam-permissions.test.ts` — `TestPermissions/s3_scope` | Mock S3 write to `artifacts/{workspaceId}/{orbitId}/{taskId}.json` succeeds, write to `terraform-state/*` fails with AccessDenied | Yes |
| AG-22 | SQS message encryption at rest | Queue uses AWS-managed KMS key for encryption | Terraform validation — `infrastructure/terraform/sqs-queues.tf` | Queue attribute `SqsManagedSseEnabled = true` or custom KMS key ARN present | Yes |
| AG-23 | DSQL transaction rollback on S3 failure | If S3 write succeeds but DSQL update fails, task retries and S3 key is overwritten (idempotent) | `infrastructure/fargate/tasks/artifact-generation/index.test.ts` — `TestTaskLoop/s3_idempotent_on_dsql_failure` | S3 write succeeds, DSQL update throws error, task does not delete message, retry overwrites same S3 key | Yes |
| AG-24 | WebSocket broadcast failure does not block task completion | If WebSocket `postToConnection` fails with GoneException, task still marks artifact complete | `infrastructure/fargate/shared/websocket-notifier.test.ts` — `TestNotifier/gone_exception_handling` | Mock WebSocket returns 410 GoneException, notifier logs error, returns without throwing, task completes | Yes |
| AG-25 | Terraform resources pass security scan | No overly permissive IAM policies, no hardcoded secrets, no public subnets for Fargate tasks | `make security-scan` (Checkov or tfsec) | Zero critical or high-severity findings in Terraform code | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | WebSocket notification within 500ms with artifact ID and download URL | Verify WebSocket notification payload contains artifact ID and S3 signed URL, and signed URL is actually downloadable by the client | Manual test: Submit artifact generation request, observe WebSocket notification in browser DevTools Network tab, copy `downloadUrl` and fetch in browser, confirm artifact content is returned | System Architect |
| HV-02 | CloudWatch logs queryable with request tracing | Review CloudWatch Logs Insights query that traces a request from API Gateway through SQS message to Fargate task completion, confirm all log entries are correlated by request ID | CloudWatch Logs Insights: `fields @timestamp, taskId, message | filter taskId = '<test-task-id>' | sort @timestamp asc` | System Architect |
| HV-03 | Dashboard shows active tasks, queue depth, duration, failures | Review CloudWatch dashboard to ensure all required metrics are present and accurate (active task count, queue depth, task duration histogram, failure reasons) | Open `infrastructure/cloudwatch/dashboards/fargate-tasks.json` in CloudWatch console, verify widgets display data, compare to known state (e.g., 2 active tasks should show 2 on dashboard) | System Architect |
| HV-04 | Alarms trigger for queue depth > 50, failure rate > 1%, p99 latency > 10s | Test alarm thresholds by injecting synthetic load or failures, confirm alarm state transitions and notifications are sent | Publish 60 messages to SQS, verify alarm transitions to ALARM state within 5 minutes, check Slack/email for notification | System Architect |
| HV-05 | X-Ray traces connect API Gateway → SQS → Fargate → WebSocket | Inspect X-Ray service map and trace timeline for a completed request, verify all segments are present and latency is correctly attributed | X-Ray console: filter by `taskId` annotation, open trace detail, confirm segments for Lambda, SQS, Fargate, WebSocket API present with no gaps | System Architect |
| HV-06 | Task execution scales correctly under load (autoscaling policy) | Observe ECS service scaling behavior during burst load (0 → 50 messages in queue), confirm tasks scale up and back down appropriately | Submit 50 artifact requests via API, monitor ECS service metrics, verify task count increases to ~10 (max limit), then decreases as queue drains | System Architect |
| HV-07 | Request size heuristic correctly routes small requests to Lambda and large to Fargate | Test boundary conditions (999 LOC vs 1001 LOC codebase) to ensure heuristic behaves as expected | Submit artifact request with small codebase (mock 800 LOC), verify synchronous response (<5s). Submit with large codebase (mock 1200 LOC), verify async response (202 with taskId) | System Architect |
| HV-08 | Error messages surfaced to users are actionable and do not leak internals | Review error response for failed task (e.g., Bedrock timeout, invalid workspace), confirm message is user-friendly ("Your request took too long to process. Please try again.") and does not expose stack trace or internal IDs | Trigger task failure by invalidating workspace ID, inspect error field in artifact record, verify client displays appropriate message | Verification Engineer |
| HV-09 | Fargate task graceful shutdown completes in-flight message within 30 seconds | Send `SIGTERM` to running Fargate task during LLM call, observe logs to confirm task finishes processing before exit | ECS console: stop task manually while it's processing a message, check logs for "Received SIGTERM, finishing current message" and "Graceful shutdown complete" within 30 seconds | System Architect |
| HV-10 | IAM policy scoping prevents cross-workspace data access | Attempt to process artifact for workspace A using credentials from workspace B's task role (simulated), verify request is denied | Create two artifacts in different workspaces, manually invoke Fargate task with workspace A credentials and workspace B's taskId, assert DSQL query returns 0 rows or permission denied | Security Reviewer |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| API Gateway accepts request, returns task ID within 2 seconds, places SQS message | AG-01, AG-02 |
| Fargate task consumes message, invokes LLM, stores in S3/DSQL, deletes message | AG-03, AG-04, AG-05, AG-06, AG-23 |
| WebSocket notification within 500ms with artifact ID and download URL | AG-07, AG-12, HV-01 |
| Failed tasks retry 3 times then DLQ | AG-08, AG-09 |
| CloudWatch logs queryable with request tracing | AG-10, HV-02 |
| Task pickup latency ≤ 2s p50, ≤ 5s p99 | AG-11 |
| WebSocket notification latency ≤ 500ms p95 | AG-12 |
| Fargate cold start ≤ 10s | AG-13 |
| End-to-end for 5-min LLM call ≤ 6 minutes | AG-14 |
| Message loss rate: 0% | AG-15 |
| WebSocket delivery rate: ≥ 99% | AG-24, HV-01 |
| Task success rate for non-LLM failures: ≥ 99.5% | AG-16 |
| Dashboard shows active tasks, queue depth, duration, failures | HV-03 |
| Alarms trigger for queue depth > 50, failure rate > 1%, p99 latency > 10s | HV-04 |
| X-Ray traces connect API Gateway → SQS → Fargate → WebSocket | HV-05 |
| Max 10 concurrent Fargate tasks (cost boundary) | AG-17, HV-06 |
| 2 vCPU, 4GB RAM per task (cost boundary) | AG-18 |
| SQS retention 7 days (cost boundary) | AG-19 |
| Must preserve existing Lambda API Gateway endpoints | AG-01 (handler modified, not replaced) |
| Must maintain current DSQL schema for artifacts | AG-05 (adds columns, no breaking changes) |
| Fargate tasks in private subnets, no direct internet | HV-06 (verify subnet configuration during scaling test) |
| SQS messages must not contain sensitive data | AG-02, AG-21 |
| WebSocket connections validate session tokens | HV-01 (manual verification of auth headers) |
| Task logs must not leak API keys or model parameters | HV-08 (log review for sensitive data) |
| Users receive acknowledgment within 3 seconds | AG-01 (2-second assertion covers 3-second requirement) |
| Failed tasks surface actionable error messages | HV-08 |
| Request size heuristic routes small requests to Lambda | HV-07 |

**Orphan checks:** None  
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01 through AG-10, AG-16, AG-20, AG-23, AG-24) | re-orbit — fix implementation and re-run test suite | AI Agent |
| Integration test latency regression (AG-11, AG-12, AG-13, AG-14) | re-orbit — profile slow path (X-Ray traces, CloudWatch metrics), optimize if < 20% over threshold; escalate if architectural (e.g., DSQL connection pool exhaustion) | AI Agent → System Architect |
| Terraform validation failure (AG-09, AG-17, AG-18, AG-19, AG-22, AG-25) | re-orbit — correct resource configuration, re-apply and verify via AWS CLI | AI Agent |
| SQS message persistence test failure (AG-15) | escalate — message loss is unacceptable, requires deep dive into SQS configuration and visibility timeout logic | System Architect |
| IAM permission test failure (AG-21, HV-10) | re-orbit — security-critical, must not ship with overly permissive policies; tighten resource constraints and re-test | System Architect |
| WebSocket notification payload missing fields (HV-01) | re-orbit — correct payload structure in `websocket-notifier.ts`, re-run integration test | AI Agent |
| CloudWatch Logs correlation broken (HV-02) | re-orbit — fix structured logging to include request ID in all log entries, verify query returns complete trace | AI Agent |
| Dashboard or alarm misconfiguration (HV-03, HV-04) | re-orbit — update CloudWatch configuration, re-deploy and verify widgets/alarms work as expected | AI Agent |
| X-Ray trace gaps (HV-05) | re-orbit — enable X-Ray active tracing in missing service (likely Fargate task missing `AWS_XRAY_DAEMON_ADDRESS` env var), redeploy | AI Agent |
| Autoscaling policy does not scale tasks under load (HV-06) | re-orbit — adjust ECS autoscaling target (e.g., 1 task per 3 messages instead of 5), test again | System Architect |
| Request size heuristic misclassifies requests (HV-07) | re-orbit — tune threshold (e.g., 1000 LOC → 1500 LOC), add logging to capture boundary cases | AI Agent |
| User-facing error messages leak internals (HV-08) | re-orbit — security risk, sanitize error messages, re-test all failure paths | System Architect |
| Graceful shutdown does not complete within 30 seconds (HV-09) | re-orbit — increase visibility timeout or optimize shutdown logic, re-test | AI Agent |
| Multiple automated gates fail (>3 failures across AG-01 to AG-25) | escalate — systemic issue, proposal may have architectural flaw; convene technical review before re-orbiting | System Architect |
| Human verification reveals UX degradation (HV-01, HV-08) | modify-intent — if user experience is fundamentally worse than synchronous flow (e.g., notification latency perceived as slow), re-negotiate acceptable latency in intent | Intent Architect |