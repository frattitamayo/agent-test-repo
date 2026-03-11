# Verification Protocol: T6-003 · Migrate long-running LLM tasks to Fargate

**Protocol ID:** VP-T6-003-1  
**Generated:** 2024-01-15  
**Intent:** T6-003  
**Proposal:** PROP-T6-003-1  
**Trust Tier:** 2 — Supervised

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | SQS queue accepts messages from Lambda with artifact generation or chat payloads | Lambda enqueues valid message to SQS with all required fields | Unit test: `src/lambda/artifact-generation/__tests__/handler.test.ts` → `TestEnqueueMessage/valid_artifact_request` | Test passes, message contains taskId, command, userId, requestPayload, dedupeId | Yes |
| AG-02 | SQS queue accepts messages from Lambda with artifact generation or chat payloads | Lambda enqueues AI chat message with conversation context | Unit test: `src/lambda/ai-chat/__tests__/handler.test.ts` → `TestEnqueueMessage/valid_chat_request` | Test passes, message includes full conversation history in requestPayload | Yes |
| AG-03 | Fargate tasks poll SQS, process LLM requests, and write results to S3 | Fargate task polls SQS, receives message, invokes Bedrock, writes artifact to S3 | Integration test: `src/fargate/task-processor/__tests__/integration/sqs-to-s3.test.ts` → `TestEndToEndFlow/artifact_generation` | Test passes, artifact written to S3 with correct key structure, ETag captured | Yes |
| AG-04 | Fargate tasks poll SQS, process LLM requests, and write results to DSQL | Fargate task writes artifact metadata to DSQL after S3 upload | Integration test: `src/fargate/task-processor/__tests__/integration/sqs-to-s3.test.ts` → `TestEndToEndFlow/dsql_metadata_write` | Test passes, DSQL record includes s3_etag, status=completed, matches S3 object | Yes |
| AG-05 | Fargate tasks poll SQS, process LLM requests, and write results to DSQL | Fargate task writes chat messages to DSQL chat_messages table | Integration test: `src/fargate/task-processor/__tests__/integration/sqs-to-s3.test.ts` → `TestEndToEndFlow/chat_history_write` | Test passes, chat message inserted with correct user_id, conversation_id, timestamp | Yes |
| AG-06 | WebSocket events fire when Fargate task completes or fails | Fargate task invokes WebSocket notification Lambda on completion | Unit test: `src/fargate/task-processor/__tests__/handlers/artifact-generation.test.ts` → `TestWebSocketNotification/completion` | Test passes, WebSocket Lambda invoked with taskId, artifactUrl, event=task_completed | Yes |
| AG-07 | WebSocket events fire when Fargate task completes or fails | Fargate task invokes WebSocket notification Lambda on failure | Unit test: `src/fargate/task-processor/__tests__/handlers/artifact-generation.test.ts` → `TestWebSocketNotification/failure` | Test passes, WebSocket Lambda invoked with taskId, error message, event=task_failed | Yes |
| AG-08 | Lambda enqueue latency: <500ms p95 | Lambda enqueue operation completes within latency budget | Load test: `tests/performance/lambda-enqueue.test.ts` → measure latency across 1000 requests | p95 latency < 500ms | Yes |
| AG-09 | SQS message visibility timeout: 35 minutes | SQS queue configured with correct visibility timeout | Infrastructure validation: `terraform plan` output inspection | Visibility timeout = 2100 seconds (35 minutes) | Yes |
| AG-10 | Fargate cold start to first LLM token: <45 seconds p95 | End-to-end cold start latency measured | Integration test with fresh ECS service deployment: `tests/performance/fargate-cold-start.test.ts` | p95 cold start < 45 seconds (container start + SQS poll + Bedrock first token) | Yes |
| AG-11 | Fargate task completion for median artifact generation: <8 minutes | Task duration for median workload within target | Load test: `tests/performance/artifact-generation-duration.test.ts` → 100 median-complexity artifacts | p50 task duration < 8 minutes | Yes |
| AG-12 | Fargate task completion for p95 artifact generation: <25 minutes | Task duration for p95 workload within target | Load test: `tests/performance/artifact-generation-duration.test.ts` → 100 complex artifacts | p95 task duration < 25 minutes | Yes |
| AG-13 | WebSocket notification delivery: <2 seconds after task completion | WebSocket event delivered within latency budget | Integration test: `tests/integration/websocket-notification.test.ts` → measure time from task completion to WebSocket message receipt | Latency < 2 seconds | Yes |
| AG-14 | SQS dead-letter queue captures tasks that fail after 2 retries | Failed message moves to DLQ after max receive count | Integration test: `src/fargate/task-processor/__tests__/integration/dlq-routing.test.ts` → force failure, verify DLQ | Message appears in DLQ after 2 receive attempts | Yes |
| AG-15 | Fargate task failure rate: <2% under normal load | Task failure rate meets reliability target | Load test: `tests/performance/reliability.test.ts` → 1000 tasks, track failures | Failure rate < 2% | Yes |
| AG-16 | No message loss between Lambda → SQS → Fargate → S3/DSQL | All enqueued messages result in S3/DSQL writes | Integration test: `tests/integration/message-delivery.test.ts` → enqueue 100 messages, verify 100 S3 objects + DSQL records | 100% delivery, no orphaned messages | Yes |
| AG-17 | Graceful degradation: if Fargate cluster capacity exhausted, Lambda returns 503 | Lambda checks queue depth before enqueue, rejects if over threshold | Unit test: `src/lambda/artifact-generation/__tests__/handler.test.ts` → `TestQueueDepthCheck/capacity_exceeded` | Test passes, Lambda returns HTTP 503 with Retry-After header | Yes |
| AG-18 | CloudWatch logs capture task start, LLM stream progress, completion, and errors | Structured logs written to CloudWatch at each lifecycle event | Integration test: `tests/integration/cloudwatch-logs.test.ts` → run task, query logs | Logs contain: task_started, bedrock_stream_started, task_completed events with structured JSON | Yes |
| AG-19 | CloudWatch metrics track: queue depth, task duration, failure rate, cost per task | Custom CloudWatch metrics emitted by Fargate task | Integration test: `tests/integration/cloudwatch-metrics.test.ts` → run task, query metrics API | Metrics exist: TaskDurationSeconds, BedrockInputTokens, BedrockOutputTokens, TaskFailureCount | Yes |
| AG-20 | X-Ray traces link Lambda request ID → SQS message ID → Fargate task ID → WebSocket event | X-Ray trace includes all request context propagation | Integration test: `tests/integration/xray-tracing.test.ts` → run end-to-end flow, query X-Ray API | Single trace ID spans Lambda → SQS → Fargate → WebSocket Lambda | Yes |
| AG-21 | Fargate task handles duplicate messages via dedupe ID | Task skips processing if artifact with matching dedupe ID exists | Unit test: `src/fargate/task-processor/__tests__/handlers/artifact-generation.test.ts` → `TestIdempotency/duplicate_message` | Test passes, task queries DSQL, finds existing record, deletes message without reprocessing | Yes |
| AG-22 | Fargate task retries Bedrock API throttling with exponential backoff | Task handles HTTP 429 from Bedrock and retries with backoff | Unit test: `src/fargate/task-processor/__tests__/lib/bedrock-streaming.test.ts` → `TestRetry/throttling` | Test passes, retries 5 times with delays: 2s, 4s, 8s, 16s, 32s | Yes |
| AG-23 | Fargate task gracefully handles SIGTERM timeout signal | Task cleanup completes within 30 seconds of SIGTERM | Integration test: `src/fargate/task-processor/__tests__/integration/timeout-handling.test.ts` → send SIGTERM during processing | Test passes, task cancels Bedrock call, writes timeout status to DSQL, exits within 10 seconds | Yes |
| AG-24 | IAM policies scoped to least privilege | Terraform plan shows no wildcard permissions in Fargate task role | Infrastructure validation: `make terraform-plan` → inspect IAM policy resources | All actions and resources explicitly scoped, no wildcards | Yes |
| AG-25 | S3 artifact key structure follows pattern | S3 objects written with correct key format | Unit test: `src/fargate/task-processor/__tests__/lib/s3-writer.test.ts` → `TestS3KeyFormat` | Key matches pattern: `{userId}/{intentId}/{artifactId}.md` | Yes |
| AG-26 | DSQL connection pooling limits respected | Task uses pg-pool with max 5 connections | Unit test: `src/fargate/task-processor/__tests__/lib/dsql-writer.test.ts` → `TestConnectionPooling` | Pool configuration max=5, connection acquisition <100ms under normal load | Yes |
| AG-27 | Code passes lint and format checks | No lint or format violations | CI pipeline: `make lint && make fmt` | Zero errors | Yes |
| AG-28 | TypeScript type safety enforced | No type errors in compilation | CI pipeline: `make typecheck` | Zero type errors | Yes |
| AG-29 | Container image builds successfully | Dockerfile builds without errors, image size within target | CI pipeline: Docker build in `.github/workflows/deploy-task-processor.yml` | Build succeeds, image size < 500 MB | Yes |
| AG-30 | Unit test coverage meets threshold | Code coverage for Fargate application ≥90% | CI pipeline: `make test-coverage` | Coverage ≥90% for src/fargate/task-processor/**/*.ts | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Frontend receives artifact URLs or chat responses via WebSocket without polling | Verify user experience: artifact generation completes, WebSocket notification arrives, frontend displays artifact without requiring manual refresh | Manual test in staging: Submit artifact request, observe WebSocket notification in browser DevTools, confirm artifact retrieved via presigned URL | Product Engineer |
| HV-02 | Graceful degradation: if Fargate cluster capacity exhausted, Lambda returns 503 with retry-after header | Review error handling UX: When capacity exceeded, does frontend display helpful error message with retry guidance? | Manual test in staging: Artificially set queue depth threshold low, trigger 503 response, observe frontend error handling | Product Engineer |
| HV-03 | CloudWatch logs capture task start, LLM stream progress, completion, and errors | Review log structure and readability: Can an on-call engineer diagnose task failures from CloudWatch Logs Insights queries? | Manual review of CloudWatch Logs Insights: Run queries for failed tasks, verify structured JSON fields enable filtering and correlation | System Architect |
| HV-04 | Fargate task execution cost measured and baselined within 7 days of deploy | Validate cost tracking: Are CloudWatch custom metrics accurately measuring Bedrock token costs? Cross-reference with AWS Cost Explorer. | Manual analysis 7 days post-deploy: Export CloudWatch metrics, compare calculated cost per task against AWS Cost Explorer actuals, verify accuracy within 10% | System Architect |
| HV-05 | P95 task cost documented and compared against $0.50 constraint threshold | Review cost baseline report: Does p95 task cost meet constraint? If not, what optimization plan is proposed? | Manual review of cost baseline document generated post-deploy: Verify p95 cost calculation methodology, assess whether constraint met | Intent Architect |
| HV-06 | IAM role permissions scoped correctly | Review Terraform IAM policies: Verify no over-permissioned actions, resource conditions applied, principle of least privilege followed | Code review of `infrastructure/terraform/iam-fargate-*` files: Check every action and resource ARN, validate conditions restrict access appropriately | System Architect |
| HV-07 | SQS retry and DLQ configuration | Review SQS queue configuration: Visibility timeout matches task timeout + buffer, DLQ captures failures correctly, message retention appropriate | Code review of `infrastructure/terraform/sqs-*.tf`: Verify visibility timeout = 2100s, max receive count = 2, DLQ retention = 14 days | System Architect |
| HV-08 | Fargate task definition (CPU/memory/timeout) | Review ECS task definition: Resource allocation appropriate for workload, timeout matches intent constraint (30 minutes), healthcheck endpoint functional | Code review of `infrastructure/terraform/ecs-task-definition.tf`: Verify 2 vCPU, 4 GB memory, stop timeout = 1800s, healthcheck path = /health | System Architect |
| HV-09 | Fargate task graceful shutdown logic | Review signal handler implementation: Does SIGTERM cleanup complete within timeout? Are in-flight operations cancelled correctly? | Code review of `src/fargate/task-processor/lib/signal-handler.ts`: Trace cleanup flow, verify AbortController usage, DSQL writes, WebSocket notification, exit timing | System Architect |
| HV-10 | Architectural fit: async processing pattern | Evaluate design coherence: Does SQS-based async pattern align with Prometheus V1 architecture? Are failure modes handled consistently with existing patterns? | Architecture review session: Present data flow diagram, discuss failure scenarios, compare with WebSocket notification pattern from T5-004 | Intent Architect |
| HV-11 | Load test results interpretation | Analyze performance test outcomes: Do p95 latencies meet acceptance criteria under realistic load? Are auto-scaling triggers tuned correctly? | Manual review of load test report: Examine latency distributions, queue depth graphs, task scaling behavior, identify tuning recommendations | System Architect |
| HV-12 | Staged deployment plan | Review traffic cutover strategy: Is 10% → 50% → 100% rollout plan safe? Are rollback procedures clear? Are monitoring checkpoints defined? | Code review of deployment runbook: Validate feature flag implementation, confirm metrics to monitor between stages, verify rollback procedure documented | Intent Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| SQS queue accepts messages from Lambda with artifact generation or chat payloads | AG-01, AG-02, AG-09 |
| Fargate tasks poll SQS, process LLM requests, and write results to S3 (artifacts) and DSQL (chat history) | AG-03, AG-04, AG-05, AG-21 |
| WebSocket events fire when Fargate task completes or fails | AG-06, AG-07, AG-13, HV-01 |
| Frontend receives artifact URLs or chat responses via WebSocket without polling | HV-01 |
| Lambda enqueue latency: <500ms p95 | AG-08 |
| SQS message visibility timeout: 35 minutes (5-minute buffer beyond task timeout) | AG-09, HV-07 |
| Fargate cold start to first LLM token: <45 seconds p95 | AG-10 |
| Fargate task completion for median artifact generation: <8 minutes | AG-11 |
| Fargate task completion for p95 artifact generation: <25 minutes | AG-12 |
| WebSocket notification delivery: <2 seconds after task completion | AG-13 |
| SQS dead-letter queue captures tasks that fail after 2 retries | AG-14, HV-07 |
| Fargate task failure rate: <2% under normal load | AG-15 |
| No message loss between Lambda → SQS → Fargate → S3/DSQL | AG-16 |
| Graceful degradation: if Fargate cluster capacity exhausted, Lambda returns 503 with retry-after header | AG-17, HV-02 |
| CloudWatch logs capture task start, LLM stream progress, completion, and errors | AG-18, HV-03 |
| CloudWatch metrics track: queue depth, task duration, failure rate, cost per task | AG-19 |
| X-Ray traces link Lambda request ID → SQS message ID → Fargate task ID → WebSocket event | AG-20 |
| Fargate task execution cost measured and baselined within 7 days of deploy | HV-04 |
| P95 task cost documented and compared against $0.50 constraint threshold | HV-05 |
| Timeout boundaries: Fargate tasks MUST timeout after 30 minutes | AG-23, HV-08 |
| Security posture: Fargate tasks MUST operate within existing VPC security groups, IAM roles follow least-privilege | AG-24, HV-06 |
| Aurora DSQL limits: Database write operations from Fargate MUST NOT exceed current connection pool limits | AG-26 |

**Orphan checks:** None

**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01 through AG-07, AG-21 through AG-26) | re-orbit — fix implementation and re-run tests | AI Agent |
| Performance test failure: latency targets missed (AG-08, AG-10, AG-11, AG-12, AG-13) | re-orbit — profile bottleneck (SQS polling delay, Bedrock API latency, S3 upload time), optimize; if architectural limitation identified, escalate | AI Agent → System Architect if escalation needed |
| Reliability test failure: failure rate exceeds 2% or message loss detected (AG-15, AG-16) | re-orbit — critical reliability violation, root cause failure scenario, add retry logic or error handling | AI Agent |
| Infrastructure validation failure: IAM over-permissioned or resource limits incorrect (AG-09, AG-24) | re-orbit — security-critical, revise Terraform IAM policies and resource configurations, re-run validation | System Architect (Tier 2 requirement) |
| Integration test failure: end-to-end flow broken (AG-03, AG-04, AG-05, AG-16, AG-18, AG-19, AG-20) | re-orbit — trace failure through data flow (Lambda → SQS → Fargate → S3/DSQL → WebSocket), fix broken integration point | AI Agent |
| Timeout handling test failure (AG-23) | re-orbit — graceful shutdown is foundational for reliability, fix signal handler logic, verify cleanup completes within timeout | AI Agent |
| Load test failure: queue depth causes capacity exhaustion or DLQ overflows (AG-14, AG-17, HV-11) | re-orbit — tune auto-scaling policy (adjust target messages per task), increase max task count, or revise queue depth threshold in Lambda | System Architect |
| CloudWatch observability gaps (AG-18, AG-19, AG-20, HV-03) | re-orbit — observability is Tier 2 requirement, cannot deploy without comprehensive monitoring; add missing log statements or metrics | AI Agent |
| Human verification failure: UX issues or cost overrun (HV-01, HV-02, HV-04, HV-05) | re-orbit if fixable (e.g., improve error messages, optimize Bedrock prompt to reduce tokens); escalate if fundamental constraint violated (e.g., cost >$0.50 requires intent renegotiation or architectural change) | System Architect → Intent Architect if escalation needed |
| Architectural review identifies design flaw (HV-10) | escalate — architectural concerns require Intent Architect review; may result in modify-intent if async pattern deemed incompatible with Prometheus V1 patterns | Intent Architect |
| IAM policy review identifies security risk (HV-06) | re-orbit — security is non-negotiable, revise IAM policies to least privilege, re-review before Terraform apply | System Architect |
| Staged deployment failure: metrics degrade during traffic ramp (HV-12) | rollback — immediately revert to synchronous Lambda flow (disable feature flag), investigate metric degradation in postmortem | System Architect |
| Lint/format/typecheck failure (AG-27, AG-28) | re-orbit — run `make fmt` to fix formatting, resolve lint warnings, fix type errors | AI Agent |
| Container build failure (AG-29) | re-orbit — debug Dockerfile, resolve dependency issues, re-run build | AI Agent |
| Test coverage below threshold (AG-30) | re-orbit — write additional unit tests to cover untested code paths, target ≥90% coverage | AI Agent |