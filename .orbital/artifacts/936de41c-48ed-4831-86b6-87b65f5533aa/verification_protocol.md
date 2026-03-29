# Verification Protocol — T6-003: Migrate long-running LLM tasks to Fargate

**Protocol ID:** VP-T6-003-1
**Generated:** 2024-01-17
**Intent:** T6-003
**Proposal:** PROP-T6-003-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Artifact generation requests complete successfully for operations requiring 15–45 minutes | End-to-end artifact generation flow with mocked 20-minute Bedrock response completes without timeout | Integration test: `src/handlers/artifacts/generate.integration.test.ts` — `TestLongRunningArtifactGeneration` with Bedrock mock delay | Test passes, task status transitions to `completed`, result written to S3 | Yes |
| AG-02 | Artifact generation requests complete successfully for operations requiring 15–45 minutes | SQS message enqueue from Lambda handler succeeds and includes required fields | Unit test: `src/handlers/artifacts/generate.test.ts` — `TestSQSEnqueueSuccess` | SQS mock receives message with `taskId`, `taskType`, `tenantId`, `userId`, `correlationId`, `parameters` | Yes |
| AG-03 | Lambda → SQS enqueue latency: p95 <200ms | Lambda handler enqueue operation completes within latency budget | Performance test: `src/handlers/artifacts/generate.perf.test.ts` — 100 iterations measuring enqueue duration | p95 latency < 200ms | Yes |
| AG-04 | WebSocket connection delivers task completion events within 5 seconds of Fargate task termination | WebSocket publish called within 5 seconds of task status update to `completed` | Integration test: `src/workers/llm-task-processor.integration.test.ts` — `TestWebSocketTimeliness` with timestamp assertions | WebSocket publish timestamp - task completion timestamp < 5 seconds | Yes |
| AG-05 | SQS dead-letter queue captures failed tasks after 3 retry attempts | Task that fails permanently routes to DLQ after 3 receives | Integration test: `src/workers/llm-task-processor.integration.test.ts` — `TestDLQRouting` with simulated permanent failure | Message appears in DLQ, not in main queue, after 3 visibility timeout expirations | Yes |
| AG-06 | SQS dead-letter queue captures failed tasks with error context | DLQ message includes `error_code`, `error_message`, `retry_count` | Integration test: `src/workers/llm-task-processor.integration.test.ts` — `TestDLQMessageAttributes` | DLQ message has `MessageAttributes` with error details | Yes |
| AG-07 | Transient Bedrock throttling errors trigger exponential backoff | Bedrock `ThrottlingException` triggers retry with increasing delays | Unit test: `src/workers/tasks/artifact-generation.test.ts` — `TestBedrockThrottlingRetry` | Retry delays follow 2^n pattern: 2s, 4s, 8s; eventual success after throttling clears | Yes |
| AG-08 | Permanent failures (invalid model ID, malformed prompt) immediately dead-letter without retry | Bedrock `ValidationException` marks task as failed without retry | Unit test: `src/workers/tasks/artifact-generation.test.ts` — `TestBedrockValidationFailure` | Task status set to `failed`, error classified as non-retryable, SQS message deleted | Yes |
| AG-09 | Frontend receives explicit error states via WebSocket | Task failures publish `task_failed` event with error details | Unit test: `src/services/websocket/task-events.test.ts` — `TestFailureEventPayload` | WebSocket event includes `error.code`, `error.message`, `error.retryable` | Yes |
| AG-10 | System handles 50 concurrent LLM operations without queue backlog exceeding 2 minutes | Load test with 50 simultaneous artifact generation requests | Load test: `tests/load/concurrent-tasks.test.ts` — 50 parallel HTTP requests | SQS `ApproximateAgeOfOldestMessage` stays below 120 seconds throughout test | Yes |
| AG-11 | Fargate ECS service scales from 0 to 20 tasks based on SQS metric | ECS service responds to queue depth scaling trigger | Integration test with ECS API mocking: `tests/integration/ecs-autoscaling.test.ts` | Desired task count increases when `ApproximateNumberOfMessagesVisible` > 3 | Yes |
| AG-12 | Fargate task cold start: p95 <60 seconds | Container startup to first SQS poll completes within budget | Performance test: `tests/performance/fargate-coldstart.test.ts` — 10 cold start cycles | p95 time from task launch to first `ReceiveMessage` call < 60 seconds | Yes |
| AG-13 | End-to-end artifact generation: p95 <30 minutes | Complete flow from HTTP request to result available in S3 | Performance test: `tests/performance/e2e-artifact.test.ts` — 20 artifact generation flows with real Bedrock calls (staging) | p95 duration < 30 minutes | Yes |
| AG-14 | Existing HTTP API contracts remain unchanged | Lambda handler response schema matches original | Contract test: `src/handlers/artifacts/generate.contract.test.ts` — schema validation | Response includes `taskId`, `status`, `estimatedCompletionTime`, `pollUrl`, `websocketChannel`; status code 202 | Yes |
| AG-15 | Task execution inherits tenant isolation from SQS message payload | Fargate task cannot access S3 objects outside tenant prefix | Integration test: `tests/security/tenant-isolation.test.ts` — attempt cross-tenant S3 write | S3 PutObject with wrong tenant prefix returns `AccessDeniedException` | Yes |
| AG-16 | Fargate tasks terminate within 60 minutes regardless of completion state | ECS task timeout enforced | Unit test: `infrastructure/fargate/task-definition.test.ts` — validate task definition YAML | `taskRoleArn` includes `ecs:StopTask` permission; task definition specifies 60-minute timeout | Yes |
| AG-17 | All task executions emit structured CloudWatch logs with correlation IDs | Logs include correlation ID at all lifecycle phases | Integration test: `tests/observability/correlation-tracking.test.ts` — trace single request through system | CloudWatch Logs Insights query finds log entries with same `correlationId` across Lambda, SQS, Fargate phases | Yes |
| AG-18 | Idempotency check prevents duplicate task execution | Duplicate SQS messages skip processing for completed tasks | Unit test: `src/workers/tasks/base-task.test.ts` — `TestIdempotencyCheck` | Second execution queries DSQL, detects `status = 'completed'`, skips work, ACKs message | Yes |
| AG-19 | IAM task role has least-privilege permissions | Fargate task role denies actions outside defined scope | Security test: `tests/security/iam-policy-validation.test.ts` — simulate principal policy | `s3:PutObject` succeeds for tenant-scoped prefix, fails for root prefix; Bedrock call succeeds for Claude 3.5 Sonnet ARN, fails for other models | Yes |
| AG-20 | Code passes lint and format checks | No lint violations or format inconsistencies | CI pipeline: `make lint && make fmt` | Zero errors, zero warnings | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | WebSocket connection delivers task completion events within 5 seconds | Verify WebSocket events are useful and timely in real user sessions | Manual test in staging: initiate artifact generation via UI, observe WebSocket console logs for event arrival time relative to task completion | System Architect |
| HV-02 | Frontend receives explicit error states via WebSocket | Review error messages for clarity and actionability | Code review of `src/services/websocket/task-events.ts` error message templates; verify messages don't leak internals (e.g., AWS ARNs, stack traces) but provide enough context for user debugging | System Architect |
| HV-03 | Fargate task cold start: p95 <60 seconds | Assess whether cold start latency is acceptable for end-user experience | Manual test during off-peak hours (when service scales to 0): trigger artifact generation, observe time to first progress event; evaluate whether UI loading state adequately communicates delay | Intent Architect |
| HV-04 | System handles 50 concurrent LLM operations without queue backlog exceeding 2 minutes | Validate auto-scaling behavior under realistic load patterns | Staging load test review: examine CloudWatch dashboard showing queue depth, active task count, and scaling events over 15-minute test window; verify no anomalous spikes or scale-in thrashing | System Architect |
| HV-05 | All task executions emit structured CloudWatch logs with correlation IDs | Verify logs are sufficient for incident response and debugging | Code review of `src/lib/logger.ts` and task handler logging; simulate failure scenario (e.g., Bedrock timeout) and trace through logs using correlation ID; ensure each phase (enqueue, execution_start, bedrock_call, persist_result, publish_event, execution_complete/failed) is logged | System Architect |
| HV-06 | Fargate tasks operate within private subnets with no direct internet access | Validate network isolation configuration | Infrastructure review: verify `infrastructure/fargate/service.yaml` references private subnets; check security group rules allow only NAT Gateway egress for Bedrock API; confirm no IGW route in subnet route table | System Architect |
| HV-07 | SQS dead-letter queue captures failed tasks with error context sufficient for operator diagnosis | Review DLQ messages for diagnosability | Manual test: trigger failure scenarios (Bedrock validation error, DSQL deadlock, S3 write failure) and examine resulting DLQ messages; verify error context allows root cause identification without additional log correlation | System Architect |
| HV-08 | Data residency: all LLM inputs, intermediate artifacts, and results remain in us-west-2 | Confirm no cross-region data movement | Architecture review: trace data flow from API Gateway (us-west-2) → SQS (us-west-2) → Fargate (us-west-2) → Bedrock (us-west-2) → S3 (us-west-2); verify no replication policies or Lambda@Edge that could move data | System Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Artifact generation requests complete successfully for operations requiring 15–45 minutes (current 100% timeout rate drops to <1%) | AG-01, AG-02 |
| WebSocket connection delivers task completion events within 5 seconds of Fargate task termination | AG-04, HV-01 |
| SQS dead-letter queue captures failed tasks after 3 retry attempts; dead-letter messages include error context sufficient for operator diagnosis | AG-05, AG-06, HV-07 |
| Lambda → SQS enqueue latency: p95 <200ms | AG-03 |
| Fargate task cold start: p95 <60 seconds from SQS message visibility to first Bedrock API call | AG-12, HV-03 |
| End-to-end artifact generation: p95 <30 minutes for standard ORBITAL artifacts | AG-13 |
| System handles 50 concurrent LLM operations without queue backlog exceeding 2 minutes | AG-10, HV-04 |
| Fargate ECS service scales from 0 to 20 tasks based on SQS `ApproximateNumberOfMessagesVisible` metric | AG-11 |
| Transient Bedrock throttling errors trigger exponential backoff within task | AG-07 |
| Permanent failures (invalid model ID, malformed prompt) immediately dead-letter without retry | AG-08 |
| Frontend receives explicit error states via WebSocket: `task_failed`, `task_timeout`, `task_dead_lettered` with human-readable messages | AG-09, HV-02 |
| Existing HTTP API contracts (request/response shapes, status codes, error formats) remain unchanged | AG-14 |
| Fargate tasks operate within private subnets with no direct internet access | HV-06 |
| Task execution inherits tenant isolation from SQS message payload | AG-15, AG-19 |
| Fargate task count auto-scales with maximum concurrency limit; tasks terminate within 60 minutes regardless of completion state | AG-11, AG-16 |
| Data residency: all LLM inputs, intermediate artifacts, and results remain in us-west-2 | HV-08 |
| All task executions emit structured CloudWatch logs with correlation IDs | AG-17, HV-05 |

**Orphan checks:** None
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-02, AG-07, AG-08, AG-09, AG-14, AG-16, AG-18, AG-20) | re-orbit — fix implementation and re-run tests | AI Agent |
| Integration test failure (AG-01, AG-04, AG-05, AG-06, AG-11, AG-15, AG-17) | re-orbit — if test environment issue, fix environment; if implementation bug, fix code and re-test | AI Agent → System Architect (if infrastructure misconfiguration) |
| Performance test failure (AG-03, AG-12, AG-13) | re-orbit — profile and optimize; if architectural (e.g., cold start exceeds budget due to image size), escalate | AI Agent → System Architect |
| Load test failure (AG-10) | re-orbit — if auto-scaling policy misconfigured, adjust thresholds; if Fargate capacity limit hit, request quota increase | System Architect |
| Security test failure (AG-15, AG-19) | re-orbit — security-critical; IAM policy or tenant isolation bug must not ship; fix and re-verify | System Architect |
| WebSocket event delivery assessment failure (HV-01, HV-02) | re-orbit — if event payload unclear or misleading, revise message templates; if timing unacceptable but within SLA, document as known limitation | System Architect |
| Cold start latency assessment failure (HV-03) | modify-intent — if p95 cold start meets technical SLA but UX unacceptable, re-negotiate intent to add scheduled scaling (minimum task count during business hours) | Intent Architect |
| Auto-scaling behavior issues (HV-04) | re-orbit — if scale-in/scale-out thrashing observed, adjust scaling policy cooldown or threshold; if underlying metrics unreliable, escalate to AWS Support | System Architect |
| Logging insufficiency (HV-05) | re-orbit — add missing log statements or structured fields; re-test incident response scenario | AI Agent |
| Network isolation failure (HV-06) | re-orbit — critical security control; fix subnet/security group configuration before production deployment | System Architect |
| DLQ diagnosability failure (HV-07) | re-orbit — enhance error context in SQS message attributes or task execution table | AI Agent |
| Data residency violation (HV-08) | escalate — potential compliance breach; halt deployment, audit all data flows, remediate before proceeding | System Architect → Intent Architect |
| Production deployment monitoring gate failure (error rate >5%, DLQ rate >5%, p95 latency >45 minutes, WebSocket failure rate >1%) | rollback — automatic revert to previous Lambda-only implementation; incident review before re-attempting deployment | System Architect → Intent Architect |