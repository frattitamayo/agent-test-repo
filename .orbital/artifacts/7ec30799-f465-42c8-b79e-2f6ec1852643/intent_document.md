# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Prometheus V1 supports AI operations that exceed Lambda's 15-minute timeout without user-facing latency or failure. Artifact generation (Intent Documents, Context Packages, Proposals, Tests) and conversational AI chat complete successfully regardless of LLM inference time, model complexity, or token volume. Users receive real-time progress updates via WebSocket and retrieve completed artifacts from persistent storage without blocking HTTP connections.

The platform scales to handle concurrent long-running LLM requests without hitting Lambda concurrency limits or cold start penalties for infrequent heavy workloads.

## Constraints

- **AWS Service Boundaries:** Must use AWS Fargate (not EC2, ECS on EC2, or third-party container orchestration). SQS must be the decoupling mechanism between Lambda and Fargate.
- **Cost Profile:** Fargate tasks must terminate immediately after processing. No persistent cluster or always-on containers. Task startup latency ≤30 seconds acceptable for async workloads.
- **Data Residency:** All intermediate and final artifacts stored in S3 (for large content) or Aurora DSQL (for metadata and small payloads). No local filesystem persistence beyond task lifetime.
- **Security Posture:** Fargate tasks must run in private subnets with no direct internet access. LLM API calls (Bedrock) via VPC endpoints or NAT Gateway. Task execution role follows least-privilege IAM.
- **Client UX:** Users must NOT experience request timeouts. Lambda responds within 3 seconds with a job ID. Frontend polls or subscribes to WebSocket for status updates. No "loading spinner of death."
- **Backward Compatibility:** Existing Lambda-based artifact generation remains operational during migration. Dual-path deployment until Fargate proven stable in production.
- **Non-Goals:** This intent does NOT cover migration of trajectory planning, approval workflows, or DSQL queries. Only LLM-bound workloads (artifact generation, chat) are in scope.

## Acceptance Boundaries

### Functional Requirements
- Lambda endpoint accepts artifact generation request, writes SQS message, and returns job ID + 202 Accepted within 3 seconds.
- Fargate task retrieves SQS message, invokes Bedrock LLM with artifact prompt, writes result to S3/DSQL, and publishes completion event to WebSocket.
- Frontend receives WebSocket notification with artifact location or fetches status via polling endpoint.
- All six artifact types (Intent Document, Context Package, Proposal, Test Suite, Retrospective, Learning) successfully generate via Fargate path.
- AI chat sessions exceeding 15 minutes complete without timeout or data loss.

### Performance Thresholds
- Fargate task cold start ≤30 seconds from SQS message visibility to first LLM API call.
- SQS message processing latency ≤5 seconds (from visibility to task pickup).
- Artifact generation throughput: ≥10 concurrent Fargate tasks without throttling.
- WebSocket notification latency ≤2 seconds from artifact write to client receive.

### Reliability Guarantees
- Failed Fargate tasks retry via SQS Dead Letter Queue (DLQ) with exponential backoff.
- Maximum 3 retries before marking job as failed and notifying user.
- Task crash or timeout does not orphan SQS messages — visibility timeout matches Fargate task timeout + 10%.
- 99.5% of artifact requests complete successfully within 5 minutes of submission (excluding LLM API outages).

### Observability
- CloudWatch Logs capture task lifecycle: start, LLM invocation, artifact write, completion.
- X-Ray traces span Lambda → SQS → Fargate → Bedrock → S3 → WebSocket.
- CloudWatch metrics track: tasks started, tasks succeeded, tasks failed, average task duration, SQS queue depth.

### Security Validation
- Fargate task IAM role audited via IAM Access Analyzer — no wildcard permissions.
- S3 artifact buckets enforce encryption at rest (SSE-S3 minimum).
- Bedrock API calls logged in CloudTrail with request IDs for audit.

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:**

This intent modifies the critical path for artifact generation — the core value delivery mechanism of Prometheus V1. While the change decouples long-running work from Lambda (reducing failure risk), it introduces new failure modes:

- **SQS message loss or duplication** → user sees no artifact or duplicate charges
- **Fargate task crashes** → silent failures if DLQ not monitored
- **WebSocket notification failure** → user never knows artifact completed
- **S3 write failure** → data loss without transaction semantics

The blast radius is **contained to asynchronous workflows** (no synchronous user request fails), but **user trust is directly impacted** if artifacts are lost or never delivered. The deployment requires:

- Human review of IAM policies and VPC configuration
- Validation of SQS → Fargate → S3 → WebSocket path in staging with real LLM payloads
- Monitoring dashboards for queue depth and task failure rate before production cutover

Tier 1 (Autonomous) is insufficient because the change spans multiple AWS services with eventual consistency and introduces non-trivial failure recovery logic. Tier 3 (Gated) is excessive because the design follows AWS best practices, the risk is understood, and rollback is clean (revert to Lambda-only path).

## Dependencies

### Infrastructure
- **SQS Queue:** New queue `prometheus-artifact-generation-queue` with DLQ and 15-minute visibility timeout.
- **Fargate Cluster:** New ECS cluster `prometheus-workers` in private subnets with NAT Gateway or VPC endpoints for Bedrock.
- **S3 Bucket:** Existing `prometheus-artifacts-<env>` bucket (or new bucket if object lifecycle policies differ).
- **WebSocket API:** Existing WebSocket Gateway (from prior trajectory) must support broadcasting completion events to connected clients.

### Prior Orbits
- **T5-002 Orbit 3:** WebSocket Gateway implementation — must be operational and support server-to-client push notifications.
- **T1-001 Orbit 2:** Aurora DSQL schema — must support storing job metadata (job_id, status, artifact_uri, created_at, updated_at).

### External Systems
- **Amazon Bedrock:** LLM inference API (Claude, Titan, or other models). Requires VPC endpoint or internet egress via NAT Gateway.
- **AWS IAM:** Task execution role and Lambda execution role updates for SQS, S3, ECS permissions.

### Code Dependencies
- Lambda function must add SQS SDK call (`sendMessage`) and return job ID.
- Fargate task requires containerized runtime with: SQS SDK, Bedrock SDK, S3 SDK, WebSocket SDK, Prometheus artifact generation logic.
- Frontend must implement polling or WebSocket subscription for job status updates.

### Non-Blocking
- Migration of AI chat to Fargate can proceed independently of artifact generation migration — both use the same Fargate infrastructure but different SQS queues and task definitions.