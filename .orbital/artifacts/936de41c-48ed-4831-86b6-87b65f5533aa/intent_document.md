# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Long-running LLM operations — artifact generation via Bedrock and multi-turn AI chat sessions — execute without timeout constraints, with real-time progress visibility to end users. Users initiate operations via HTTP API and receive immediate acknowledgment, then observe completion via WebSocket notifications. The system handles concurrent LLM requests without Lambda timeout failures, enabling artifact generation workflows that exceed 15 minutes and chat sessions that maintain context across multiple exchanges.

## Constraints

- **Backward compatibility:** Existing HTTP API contracts (request/response shapes, status codes, error formats) remain unchanged; frontend requires no modifications beyond WebSocket integration.
- **Security posture:** Fargate tasks operate within private subnets with no direct internet access; authentication and authorization occur at API Gateway before SQS enqueue; task execution inherits tenant isolation from SQS message payload.
- **Cost guardrails:** Fargate task count auto-scales based on SQS queue depth with maximum concurrency limit to prevent runaway costs; tasks terminate within 60 minutes regardless of completion state.
- **Data residency:** All LLM inputs, intermediate artifacts, and results remain in us-west-2; no cross-region data movement during processing.
- **Observability:** All task executions emit structured CloudWatch logs with correlation IDs linking HTTP request → SQS message → Fargate execution → WebSocket event.

## Acceptance Boundaries

**Functional Requirements:**
- Artifact generation requests complete successfully for operations requiring 15–45 minutes of Bedrock interaction (current 100% timeout rate drops to <1%).
- WebSocket connection delivers task completion events within 5 seconds of Fargate task termination.
- SQS dead-letter queue captures failed tasks after 3 retry attempts; dead-letter messages include error context sufficient for operator diagnosis.

**Performance Thresholds:**
- Lambda → SQS enqueue latency: p95 <200ms (synchronous acknowledgment to client).
- Fargate task cold start: p95 <60 seconds from SQS message visibility to first Bedrock API call.
- End-to-end artifact generation: p95 <30 minutes for standard ORBITAL artifacts (Context Package, Proposal, Implementation Plan).

**Scalability Targets:**
- System handles 50 concurrent LLM operations without queue backlog exceeding 2 minutes.
- Fargate ECS service scales from 0 to 20 tasks based on SQS `ApproximateNumberOfMessagesVisible` metric.

**Error Handling:**
- Transient Bedrock throttling errors trigger exponential backoff within task; permanent failures (invalid model ID, malformed prompt) immediately dead-letter without retry.
- Frontend receives explicit error states via WebSocket: `task_failed`, `task_timeout`, `task_dead_lettered` with human-readable messages.

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:** This migration introduces asynchronous execution boundaries where Lambda, SQS, Fargate, and WebSocket systems must coordinate without deterministic end-to-end testing in development environments. The blast radius spans:

1. **Revenue-impacting workflows:** Artifact generation is a core product capability; failure blocks user progress on paid plans.
2. **Data integrity risks:** Task failures mid-execution could leave orphaned S3 objects or inconsistent DSQL records if rollback logic is incomplete.
3. **Security surface expansion:** Fargate tasks require new IAM roles with Bedrock, S3, DSQL, and SQS permissions; misconfiguration could expose cross-tenant data.
4. **Observability gaps:** Distributed tracing across Lambda → SQS → Fargate → WebSocket requires new instrumentation; blind spots could hide cascading failures.

Human review gates:
- **Pre-deploy:** Validate SQS retry policy, dead-letter configuration, and Fargate task IAM least-privilege scoping.
- **Deploy strategy:** Blue-green deployment with 10% traffic shift; monitor error rates, queue depth, and task failure rates for 24 hours before full cutover.
- **Rollback criteria:** >5% dead-letter rate, p95 end-to-end latency >45 minutes, or any WebSocket delivery failure rate >1% triggers automatic rollback.

## Dependencies

**Internal Systems:**
- **API Gateway + Lambda (HTTP):** Existing `/artifacts/generate` and `/chat/send` endpoints modified to enqueue SQS messages instead of direct Bedrock calls.
- **WebSocket Gateway:** Real-time connection infrastructure (assumed operational per prior T6 trajectories) delivers task lifecycle events (`task_started`, `task_progress`, `task_completed`, `task_failed`).
- **DSQL:** Artifact and chat message tables store task correlation IDs; Fargate tasks query/update records atomically.
- **S3:** Artifact content stored under `/artifacts/{tenant_id}/{artifact_id}/` with server-side encryption; Fargate tasks write directly via SDK.

**External Services:**
- **Amazon Bedrock:** Claude 3.5 Sonnet model availability and quota in us-west-2 (current throughput: 200 requests/min sustained).
- **Amazon SQS:** Standard queue for task distribution; requires FIFO queue evaluation if order-of-execution matters for multi-step artifact workflows.
- **Amazon ECS (Fargate):** Task definition with 4 vCPU / 8 GB memory profile; container image hosted in ECR with Prometheus backend runtime and dependencies.

**Prior Orbits:**
- **T6-001 (WebSocket Gateway):** WebSocket connection management and event broadcasting assumed operational; if incomplete, blocks end-to-end testing.
- **T5-002 (DSQL Schema):** Artifact and chat tables must include `task_id` and `task_status` columns; schema migration required if missing.

**Open Questions:**
- Does the existing WebSocket implementation support server-initiated broadcasts to specific connection IDs, or only connection-initiated subscriptions?
- Are Bedrock throttling limits shared across Lambda and Fargate, or isolated per execution environment?