# T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 3/12/2026  
**Project:** Prometheus V1  
**Trajectory:** Container Infrastructure (Fargate)  
**Trust Tier:** 2 — Supervised

---

## Desired Outcome

AI-powered artifact generation and chat operations complete successfully without Lambda timeout failures. Users experience uninterrupted AI interactions regardless of processing duration, with real-time progress updates delivered through WebSocket connections. The system handles LLM operations that require >15 minutes of processing time while maintaining the existing API contract and user experience.

---

## Constraints

- **API Contract Preservation:** All existing HTTP endpoints remain unchanged. Response formats, status codes, and error structures must match current implementation.
- **Latency Budget:** Initial HTTP response acknowledging task submission must return within 500ms. WebSocket connection establishment must complete within 1 second.
- **Security Boundaries:** Fargate tasks must not access resources outside their designated IAM role scope. SQS message encryption at rest is mandatory. No LLM API keys or secrets may be logged or exposed in CloudWatch.
- **Cost Control:** Fargate task CPU and memory allocations must not exceed 4 vCPU / 8 GB per task. Tasks must terminate within 30 minutes or be force-stopped.
- **Backward Compatibility:** Existing Lambda-based endpoints must continue to function during migration. No client-side changes permitted for this orbit.
- **Non-Goals:** This orbit does NOT include batch processing, scheduled jobs, or migration of artifact retrieval operations. It does NOT introduce new user-facing features beyond reliability improvements.

---

## Acceptance Boundaries

### Reliability
- **Success Rate:** ≥99.5% of queued tasks complete without unhandled exceptions
- **Timeout Elimination:** Zero Lambda timeout errors for artifact generation and chat operations
- **Task Durability:** Fargate tasks survive and complete even when processing takes 20+ minutes

### Performance
- **Queue Latency:** SQS message pickup by Fargate occurs within 10 seconds of enqueue
- **WebSocket Delivery:** Progress updates and completion events arrive at client within 2 seconds of state change
- **Cold Start Impact:** First Fargate task launch for a deployment completes within 60 seconds

### Observability
- **Trace Coverage:** 100% of tasks emit structured logs with correlation IDs linking HTTP request → SQS message → Fargate execution → WebSocket event
- **Metric Visibility:** CloudWatch dashboards display queue depth, task duration (p50, p95, p99), failure rate, and cost per task
- **Error Attribution:** Failed tasks surface actionable error messages distinguishing LLM API failures, timeout exhaustion, and processing errors

### Operational
- **Rollback Safety:** Feature flag or deployment parameter enables instant revert to Lambda-only processing
- **Manual Intervention:** Tasks stuck in RUNNING state for >30 minutes auto-terminate with clear failure reason in logs
- **SQS Dead Letter Queue:** Messages failing 3 retries route to DLQ with alerting configured

---

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:**  
This intent introduces a new execution model (asynchronous task processing) into the critical path of AI operations that directly impact user-facing features. While the changes are architecturally isolated (SQS queue, Fargate tasks, IAM roles), they affect:

1. **Revenue-Adjacent Flows:** AI artifact generation is a core product capability users pay for
2. **State Management Complexity:** Introduces distributed state across Lambda, SQS, Fargate, S3, and WebSocket APIs
3. **Failure Mode Expansion:** New failure domains (task scheduling delays, container launch failures, SQS visibility timeouts) that did not exist in synchronous Lambda execution

The blast radius is contained to AI operations (does not affect authentication, billing, or data integrity), but the novelty of the async pattern and potential for subtle race conditions or message loss justifies human review of the implementation plan before deployment.

**Tier 1 (Autonomous)** would be inappropriate because this is not a reversible change — once messages enter SQS, they must be processed reliably. **Tier 3 (Gated)** is unnecessary because the domain is well-understood infrastructure work with clear acceptance criteria, not ambiguous product design.

---

## Dependencies

### Internal Dependencies
- **WebSocket Infrastructure:** Requires functional API Gateway WebSocket API with connection management and message routing (assumed to exist based on acceptance criteria referencing WebSocket events)
- **IAM Roles:** Fargate task execution role with permissions for SQS read, S3 write, DSQL write, CloudWatch Logs, and Bedrock API access
- **SQS Queue Configuration:** Standard queue (not FIFO) with visibility timeout ≥30 minutes, message retention 4 days, and DLQ configured

### External Dependencies
- **AWS Fargate Availability:** Deployment region must support Fargate capacity for 4 vCPU tasks
- **LLM API Access:** Existing Bedrock or external LLM provider endpoints remain available with unchanged rate limits
- **S3 Bucket:** Artifact storage bucket exists with lifecycle policies and CORS configured for frontend access

### Prior Context
- This orbit assumes Lambda timeout issues have been observed in production (implied by desired outcome). Acceptance criteria for "timeout elimination" depend on baseline metrics from current Lambda-based implementation.
- The constraint "existing Lambda-based endpoints must continue to function" implies this is a phased migration, not a cut-over. Coordination with frontend team on progressive rollout is required.