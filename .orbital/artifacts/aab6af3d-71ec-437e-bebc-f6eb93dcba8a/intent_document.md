# T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Document Date:** March 13, 2026

## Desired Outcome

When this orbit completes, Prometheus V1 will handle LLM-powered artifact generation and AI chat sessions without Lambda timeout failures or degraded user experience. Users will submit generation requests through the existing HTTP API and receive real-time progress updates via WebSocket, while the actual LLM processing executes asynchronously on Fargate with sufficient runtime and memory to complete complex operations (30+ minute generations, multi-step reasoning chains, large context windows).

The system will scale horizontally to handle concurrent LLM workloads without queueing delays, maintain sub-200ms API response times for request submission, and deliver completion notifications within 2 seconds of task finish. Cost efficiency will improve by eliminating Lambda timeout waste and right-sizing compute resources per workload type.

## Constraints

**Hard Boundaries:**
- Must not break existing Lambda-based API contract — HTTP endpoints, request/response schemas, and authentication flows remain unchanged
- Must not introduce synchronous dependencies on Fargate availability — API must remain responsive even if all Fargate tasks are saturated
- Fargate task cold starts must not exceed 60 seconds for the first request in a scaled-down state
- WebSocket delivery must guarantee at-least-once notification semantics — no silent failures where a task completes but the user never learns of it
- Must not store sensitive API keys, credentials, or PII in SQS message bodies — use parameter references or secure environment injection
- Must maintain DSQL transaction boundaries — artifact records and their associated metadata must commit atomically
- S3 artifact storage must enforce server-side encryption (SSE-S3 minimum) and bucket policies must deny public read access
- Must not exceed per-account Fargate service quotas (default: 500 concurrent tasks per region) — implement backpressure or quota monitoring
- Must preserve existing audit logging for all state transitions (request received, task started, task completed, notification sent)

**Non-Goals:**
- This orbit does NOT refactor the frontend UI for artifact generation — WebSocket integration and progress display are out of scope
- This orbit does NOT implement batch processing or scheduled LLM jobs — focus is strictly on user-initiated request/response flows
- This orbit does NOT optimize LLM prompt templates, model selection, or token usage — those remain unchanged from current Lambda implementation

## Acceptance Boundaries

**Performance:**
- API request submission (Lambda → SQS enqueue) completes in <200ms at p99 under load (1000 req/min)
- Fargate task startup (container ready to process SQS message) occurs within 45 seconds of message visibility for cold starts, <5 seconds for warm tasks
- End-to-end latency from SQS message visible to WebSocket notification delivered: <processing_time + 2s> at p95
- LLM tasks that previously timed out in Lambda (>15 minutes) now complete successfully on Fargate with <5% failure rate due to infrastructure (excluding model errors)

**Reliability:**
- SQS DLQ captures messages that fail after 3 retry attempts, with CloudWatch alarm triggering on DLQ depth >0
- Fargate task crashes or OOM errors emit structured logs with correlation IDs linking to originating API request
- WebSocket connection failures trigger automatic retry with exponential backoff (max 3 attempts over 30 seconds)
- System remains degraded-but-operational if Fargate cluster is unavailable: Lambda logs error, returns 202 Accepted, and SQS retains messages for processing when capacity returns

**Observability:**
- CloudWatch Logs capture: (1) Lambda SQS enqueue events, (2) Fargate task start/stop/error, (3) S3 artifact write confirmations, (4) WebSocket delivery attempts
- X-Ray traces span the full request lifecycle with subsegments for: API Gateway, Lambda, SQS, Fargate, DSQL, S3, WebSocket API
- Custom CloudWatch metrics published for: active Fargate tasks, SQS queue depth, average task duration, WebSocket delivery success rate

**Cost:**
- Total compute cost (Lambda + Fargate) for LLM workloads decreases by >30% compared to current Lambda-only architecture measured over 30-day rolling window
- Fargate task configurations (CPU/memory) are right-sized such that average CPU utilization is 40–70% during active processing (no gross over-provisioning)

**Security:**
- IAM roles follow least-privilege: Lambda can only write to SQS, Fargate can only read from SQS + write to S3/DSQL, neither role has admin or power-user permissions
- SQS encryption at rest enabled (AWS managed keys minimum)
- All network egress from Fargate to DSQL and S3 uses VPC endpoints (no public internet routing for data plane traffic)

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:**
This intent modifies the execution path for revenue-critical LLM operations (artifact generation drives user value and retention) and introduces new failure modes (SQS delivery failures, Fargate OOM, WebSocket dropped connections) that could silently degrade service without immediate user-visible errors. The blast radius extends to all users invoking AI-powered features.

However, the changes are architecturally isolated — the HTTP API contract remains stable, rollback is achievable by draining SQS and routing traffic back to Lambda synchronous flow, and the system includes observable checkpoints (SQS DLQ, CloudWatch alarms, X-Ray tracing) that surface issues before widespread impact.

Supervised tier is appropriate because:
1. Failure scenarios are bounded and detectable (message loss triggers alarms, task crashes emit logs)
2. Rollback mechanism is straightforward (feature flag to bypass SQS enqueue)
3. No user data is permanently lost (SQS retention + DLQ preserves requests for replay)
4. Changes touch authentication, data persistence, and real-time notification layers — too sensitive for autonomous execution
5. But changes do NOT alter pricing logic, access control policies, or compliance-regulated data handling — below the threshold for Gated tier

Human review is required before deploy to validate: (1) IAM policies, (2) SQS/DLQ configuration, (3) Fargate task definitions, (4) rollback plan, and (5) CloudWatch alarm thresholds.

## Dependencies

**Internal Dependencies:**
- **Existing Lambda API Handlers:** Current implementation of artifact generation endpoints in `backend/api/` must remain functional during migration — this orbit extends rather than replaces
- **DSQL Schema:** Artifact and task status tables must support atomic writes for metadata (task_id, status, completion_time, error_message) — if schema changes are required, they are a blocking dependency
- **S3 Bucket Configuration:** Artifact storage bucket must exist with appropriate lifecycle policies, versioning, and encryption settings before Fargate tasks attempt writes
- **WebSocket API Gateway:** Existing WebSocket API must be deployed and connection management logic must support server-initiated messages (not just client → server)

**External Dependencies:**
- **AWS Fargate Availability:** This orbit assumes AWS Fargate for ECS is available in the deployment region (us-east-1, us-west-2, or eu-west-1) with no active service disruptions
- **SQS Service Limits:** AWS account must have sufficient SQS quota for message throughput (default: 3000 messages/second) and Fargate must scale within account vCPU limits
- **Bedrock/LLM API Endpoints:** LLM model endpoints (e.g., Claude via Bedrock, OpenAI API) must remain accessible from Fargate tasks with latency <5s at p99 — any provider-side rate limits or outages will cascade to this system

**Prior Orbit References:**
- None — this is the first orbit in the T6 Fargate trajectory. If prior work established VPC networking, IAM roles, or CloudWatch Logs group conventions for Prometheus V1, those patterns should be inherited.

**Unresolved External Questions:**
- Does the current DSQL connection pooling logic (if any) in Lambda work from long-lived Fargate processes, or will it require connection recycling to avoid stale handles?
- Are LLM API credentials (Bedrock/OpenAI keys) currently stored in Secrets Manager, Parameter Store, or environment variables? This orbit must use the same secure storage mechanism for Fargate environment injection.