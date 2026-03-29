# T6-003 · Migrate Long-Running LLM Tasks to Fargate

**Generated:** March 12, 2026  
**Project:** Prometheus V1  
**Trajectory:** Container Infrastructure (Fargate)  
**Trust Tier:** 2 — Supervised

---

## Desired Outcome

Users can generate artifacts and engage in AI chat sessions without experiencing timeouts or degraded performance, regardless of LLM processing duration. The system handles LLM operations that exceed Lambda's 15-minute execution limit through an asynchronous architecture that provides real-time progress updates via WebSocket and reliably completes operations that may take 30+ minutes.

Business impact: Eliminates the primary constraint preventing users from working with large codebases, complex intent decomposition, and multi-turn AI conversations. Removes the need for users to split large requests or work around timeout limitations.

## Constraints

**Performance Boundaries:**
- WebSocket notification latency: ≤ 500ms from task completion to frontend update
- SQS message processing: task pickup within 2 seconds of message arrival
- Cold start tolerance: ≤ 10 seconds for Fargate task initialization

**Architectural Limits:**
- Must preserve existing Lambda-based API Gateway endpoints and authentication flow
- Must maintain current DSQL schema for artifact storage
- Must not introduce direct client-to-Fargate communication (all client interaction via API Gateway + WebSocket)
- Must use existing S3 bucket structure for artifact storage

**Security Requirements:**
- Fargate tasks must execute in private subnets with no direct internet access (NAT gateway only)
- SQS messages must not contain sensitive data in plain text (use references to DSQL records)
- WebSocket connections must validate session tokens on every broadcast
- Task execution logs must not leak API keys or model parameters

**UX Constraints:**
- Users must receive acknowledgment within 3 seconds that their request is queued
- Progress updates must be granular enough to distinguish between "starting", "processing", and "completing" phases
- Failed tasks must surface actionable error messages (not stack traces or internal state)

**Non-Goals:**
- Real-time streaming of LLM token generation (WebSocket notifies on phase transitions only)
- Fargate-based execution of sub-1-minute operations (Lambda remains the default)
- Migration of existing Lambda-based endpoints that operate within timeout limits

## Acceptance Boundaries

**Functional Correctness:**
- ✓ API Gateway endpoint accepts artifact generation request, returns task ID within 2 seconds, and places message on SQS
- ✓ Fargate task consumes SQS message, invokes LLM, stores result in S3 and DSQL, deletes message on success
- ✓ WebSocket connection receives notification within 500ms of task completion with artifact ID and download URL
- ✓ Failed tasks are retried up to 3 times with exponential backoff before moving to DLQ
- ✓ Task execution logs are queryable in CloudWatch with tracing from request ID through completion

**Performance Thresholds:**
- Task pickup latency (SQS message visible → Fargate begins processing): ≤ 2 seconds at p50, ≤ 5 seconds at p99
- WebSocket notification latency (task write to DSQL → client receives event): ≤ 500ms at p95
- Fargate task cold start: ≤ 10 seconds when no warm tasks available
- End-to-end for 5-minute LLM call: request → acknowledgment → processing → notification ≤ 6 minutes total

**Reliability:**
- Message loss rate: 0% (SQS visibility timeout > max task duration, DLQ captures failures)
- WebSocket delivery rate: ≥ 99% (task completes but notification fails → client can poll DSQL as fallback)
- Task success rate for non-LLM failures (infra, config, permissions): ≥ 99.5%

**Operational Observability:**
- CloudWatch dashboard shows: active tasks, queue depth, task duration histogram, failure reasons
- Alarms trigger when: queue depth > 50, task failure rate > 1%, p99 latency > 10 seconds
- X-Ray traces connect API Gateway request → SQS message → Fargate execution → WebSocket notification

**Cost Boundaries:**
- Fargate task scaling: min 1 task, max 10 concurrent tasks (protects against runaway costs)
- Task resource allocation: 2 vCPU, 4GB RAM per task (sufficient for current LLM call patterns)
- SQS message retention: 7 days (balance cost vs. recovery window for failed tasks)

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:**  
This intent introduces a new execution path for user-initiated operations that bypasses Lambda's predictable timeout and cold-start characteristics. Blast radius includes:

1. **Data Integrity Risk:** Fargate tasks write directly to DSQL and S3. Bugs in transaction handling or error recovery could corrupt artifact state or leave orphaned records.
2. **Cost Risk:** Misconfigured scaling policies or retry logic could spawn dozens of long-running Fargate tasks, incurring significant charges before detection.
3. **Availability Risk:** WebSocket notification failures create a degraded UX where users see "processing" indefinitely unless polling fallback is correctly implemented.

The supervised tier is appropriate because:
- The implementation is novel to this system (no prior Fargate workloads)
- The failure modes are not immediately reversible (bad artifacts may be stored, consumed, or presented to users)
- The operational monitoring and cost controls require human review before production exposure

Autonomous (Tier 1) would be inappropriate because this is not a low-risk, isolated change. Gated (Tier 3) is not required because the domain is well-understood (asynchronous task processing), and the proposed architecture is standard AWS practice.

**Deployment Strategy:**  
Deploy behind a feature flag (`fargate_artifact_generation`) that gates both the API endpoint and Fargate task registration. Verify in staging with controlled load before enabling for production traffic.

## Dependencies

**Infrastructure:**
- AWS Fargate cluster with ECS task definition, IAM role, and private subnet configuration
- SQS queue with DLQ, visibility timeout ≥ max expected task duration (suggested: 45 minutes)
- Existing WebSocket infrastructure (API Gateway WebSocket API + connection management in DSQL)
- S3 bucket for artifact storage (already exists, requires no schema changes)

**Data Layer:**
- DSQL tables: `artifacts`, `orbits`, `tasks` (require new `task_id` and `status` columns on `artifacts` table to track async processing state)
- WebSocket connection registry (stored in DSQL `websocket_connections` table) for broadcast targeting

**Services:**
- Lambda function: existing API Gateway handler must be modified to enqueue SQS message instead of invoking LLM synchronously
- Bedrock API access from Fargate tasks (requires VPC endpoint or NAT gateway for external LLM calls)

**Prior Work:**
- No direct predecessor orbits
- Assumes T6-001 (Fargate cluster setup) and T6-002 (SQS queue configuration) are complete or will be addressed in the `context` phase of this orbit

**External Systems:**
- Bedrock (LLM provider): Fargate tasks must handle rate limits, retries, and model availability errors
- CloudWatch Logs and X-Ray: required for observability, no changes needed to existing setup