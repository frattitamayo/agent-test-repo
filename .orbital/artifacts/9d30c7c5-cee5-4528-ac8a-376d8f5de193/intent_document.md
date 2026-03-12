# T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Generated:** 2026-03-12  
**Project:** Prometheus V1  
**Trajectory:** Container Infrastructure (Fargate)  
**Trust Tier:** 2 — Supervised

---

## Desired Outcome

Artifact generation and AI chat operations complete successfully without Lambda timeout failures, enabling users to generate complex artifacts and maintain extended conversational context. The system delivers results reliably for operations requiring >15 minutes of LLM processing time, with progress visibility and graceful handling of long-running tasks.

Users experience no degradation in response time for initial requests — Lambda continues to serve the HTTP endpoint with sub-second acknowledgment — while background Fargate tasks process the actual LLM workload asynchronously. Frontend receives completion notifications via WebSocket, maintaining the perception of responsive interaction despite extended backend processing.

---

## Constraints

### Performance Boundaries
- **Initial HTTP response:** <500ms (Lambda acknowledgment + SQS enqueue)
- **WebSocket notification latency:** <2s after Fargate task completion
- **Maximum Fargate task duration:** 4 hours (hard limit for billing and resource management)
- **SQS visibility timeout:** Aligned with expected task duration to prevent duplicate processing

### Architectural Limits
- **Must not break existing Lambda-based endpoints:** All current API routes remain functional during migration
- **Must not introduce new external dependencies:** Use only AWS-native services (Fargate, SQS, S3, DSQL, API Gateway WebSocket)
- **Must maintain current authentication model:** JWT validation occurs in Lambda before enqueuing; Fargate tasks receive validated user context via message payload
- **Must preserve data isolation:** Fargate tasks access only the workspace data authorized in the original request

### Security Requirements
- **Fargate tasks run in private subnets** with no direct internet ingress
- **Secrets management:** All LLM API keys, database credentials, and service tokens retrieved from AWS Secrets Manager — never baked into task definitions
- **Message encryption:** SQS messages encrypted at rest (AWS-managed keys minimum)
- **Audit trail:** All task invocations logged to CloudWatch with user context, intent ID, and outcome status

### Non-Goals
- **Migration of short-duration operations (<15s):** Lambda remains the preferred runtime for fast responses
- **Real-time streaming of LLM output:** Initial implementation delivers complete results asynchronously; streaming is a future enhancement
- **Multi-region failover:** Single-region deployment acceptable for V1

---

## Acceptance Boundaries

### Functional Success
- **SQS message routing:** 100% of artifact generation requests placed on queue within 500ms of Lambda receiving HTTP request
- **Fargate task invocation:** Queue message triggers Fargate task within 30 seconds of enqueue
- **LLM processing completion:** Tasks successfully generate artifacts for intents requiring up to 240 minutes of LLM processing (95th percentile target: 45 minutes)
- **Result persistence:** Generated artifacts stored in S3 with DSQL metadata entries containing storage location, generation timestamp, and user/intent references
- **WebSocket notification delivery:** Frontend receives completion event within 2 seconds of Fargate task writing results, with <1% notification loss rate

### Operational Resilience
- **Retry logic:** Failed tasks requeue automatically with exponential backoff (max 3 attempts) before moving to dead-letter queue
- **Graceful degradation:** If Fargate capacity unavailable, requests remain queued up to 12 hours before timing out with user notification
- **Observability:** CloudWatch dashboard displays queue depth, task duration percentiles, failure rates, and LLM token consumption per task

### Cost Efficiency
- **Fargate task right-sizing:** Tasks allocated minimum viable CPU/memory to complete within budget constraints (baseline: 2 vCPU, 4GB RAM)
- **Idle task prevention:** No Fargate tasks run when queue is empty; scaling from 0 to 1 task completes within 30 seconds
- **Monthly cost target:** Fargate compute costs <$200/month at projected load of 500 long-running artifact generations [inferred based on early-stage project scale]

### Backward Compatibility
- **Existing Lambda endpoints unaffected:** All non-migrated API routes maintain current latency and success rate
- **Data schema unchanged:** Artifact storage format and DSQL schema remain identical to Lambda-generated artifacts
- **Frontend API contract preserved:** HTTP response structure and WebSocket message format match current implementation

---

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:**  
This intent introduces asynchronous processing with multiple failure modes (SQS message loss, Fargate task crash, WebSocket disconnect) that could result in silent failures where users submit requests but never receive results. The blast radius includes:

- **User experience degradation:** Failed migrations could block artifact generation entirely, preventing core workflow completion
- **Cost exposure:** Misconfigured Fargate tasks could spin up excessive capacity or run indefinitely
- **Data integrity risk:** Race conditions between Lambda, Fargate, and WebSocket updates could corrupt artifact state in DSQL

Human review is required before deployment to validate:
- SQS dead-letter queue configuration and alerting
- Fargate task definition IAM policies (least-privilege verification)
- Cost guardrails (task timeout enforcement, max concurrent tasks)
- End-to-end failure testing (simulated WebSocket disconnect, Fargate OOM, SQS backlog)

Tier 1 (Autonomous) is insufficient due to the novelty of Fargate in this codebase and the potential for silent failures. Tier 3 (Gated) is excessive because the functionality is isolated to artifact generation — a non-critical path for the platform's operational stability.

---

## Dependencies

### Infrastructure Prerequisites
- **SQS Queue Provisioned:** Standard queue with dead-letter queue configured for failed messages (max receive count: 3)
- **Fargate Cluster Exists:** ECS cluster configured in the same VPC as Lambda and DSQL
- **Task Definition Available:** Base Fargate task definition with Node.js runtime, AWS SDK, and Bedrock client library pre-installed
- **WebSocket API Gateway:** Existing WebSocket connection manager capable of sending messages to connected clients by user ID

### External Services
- **AWS Bedrock Access:** IAM role for Fargate tasks must include `bedrock:InvokeModel` permission for Claude 3.5 Sonnet and Claude 3 Opus
- **S3 Bucket for Artifacts:** Existing bucket with versioning enabled and lifecycle policy for archival after 90 days
- **DSQL Database:** Schema includes `artifacts` table with columns for S3 location, generation status, and WebSocket notification timestamp

### Prior Orbit Learnings
- **Orbit Log Reference:** If prior orbits addressed Lambda timeout issues or artifact generation patterns, link those logs here to inform implementation approach
- **Known Lambda Limitations:** Documented max execution time failures for specific artifact types (e.g., large intent documents, multi-agent collaboration logs)

### Codebase Context
- **Existing Lambda Handler:** `backend/api/artifacts/generate.js` currently handles synchronous artifact generation — this is the code path being migrated
- **WebSocket Message Format:** Current implementation sends `{ type: 'artifact_complete', artifact_id: string, url: string }` — maintain this contract