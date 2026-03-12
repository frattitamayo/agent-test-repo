# T6-003 · Migrate long-running LLM tasks to Fargate

**Document Date:** 2026-03-12  
**Orbit:** 1  
**Phase:** Intent  
**Trust Tier:** 2 — Supervised

## Desired Outcome

Artifact generation and AI chat operations complete reliably without Lambda timeout failures, enabling users to generate complex documents and hold extended AI conversations within the Prometheus platform. The system processes LLM requests that exceed 15 minutes of compute time while maintaining responsive UI feedback through WebSocket notifications.

When this orbit completes:
- Users initiate artifact generation or AI chat through the same UI flows they use today
- Requests requiring extended LLM processing (>29 seconds) are handled by Fargate tasks without user-facing errors
- Users receive real-time progress updates via WebSocket as their requests process
- Generated artifacts appear in S3 and database records update atomically upon completion
- The frontend experience remains identical for requests under Lambda's execution window
- Platform reliability for LLM operations increases from current timeout-limited success rate to >99.5%

## Constraints

**Infrastructure Boundaries:**
- Must use AWS Fargate (not EC2 or EKS) — project infrastructure standard for container workloads
- Fargate tasks triggered exclusively via SQS — no direct invocation from API Gateway or frontend
- Must retain Lambda as the HTTP request handler — no bypassing API Gateway → Lambda flow
- WebSocket infrastructure must use existing API Gateway WebSocket API if present, or AWS IoT Core if WebSocket API not yet implemented

**Execution Limits:**
- Fargate task execution time capped at 4 hours (Fargate max for ECS tasks)
- SQS message retention: 14 days maximum (SQS limit)
- Individual artifact generation requests must complete within task timeout or fail gracefully with stored partial results

**Data & State:**
- All LLM processing results stored in S3 with metadata in Aurora DSQL — no ephemeral-only results
- S3 writes must be atomic per artifact — no partial/incomplete artifacts visible to users
- Database records must not show "completed" status until S3 artifact exists and is validated
- Must preserve existing artifact schema and database structure — no breaking changes to current artifact retrieval logic

**Security & Access:**
- Fargate tasks run in private subnets with no direct internet access — NAT Gateway or VPC endpoints required for AWS service calls
- IAM roles follow least-privilege: separate roles for Lambda (SQS write), Fargate (S3/DSQL write, Bedrock invoke), WebSocket (connection management)
- No hardcoded credentials or API keys in container images
- SQS messages must not contain sensitive user data in plaintext — use references/IDs only

**Operational:**
- Must support rollback to Lambda-only execution if Fargate path fails — maintain existing Lambda handlers as fallback
- CloudWatch logs required for all Fargate task executions with correlation IDs linking request → SQS message → task → result
- Must not increase infrastructure costs by >30% compared to current Lambda-only spend for equivalent workload volume

**Non-Goals:**
- Auto-scaling Fargate task count based on queue depth (use fixed task count or manual scaling initially)
- Streaming LLM responses back to frontend during generation (batch completion only)
- Migrating short-duration LLM calls (<20s) from Lambda to Fargate — Lambda remains optimal for fast responses

## Acceptance Boundaries

**Functional Acceptance:**
- Artifact generation requests >29s of LLM processing time complete successfully via Fargate path with <2% failure rate (excluding LLM service errors)
- Lambda-to-SQS message publish latency <500ms p99
- Fargate task cold start + initiation <45s from SQS message visibility to first Bedrock API call
- WebSocket notification delivery within 3 seconds of Fargate task completion
- S3 artifact availability within 10 seconds of database record showing "completed" status
- Existing Lambda-only path continues to handle requests <20s execution time with no regression in latency or error rate

**Data Integrity:**
- Zero instances of database showing "completed" when S3 artifact missing or corrupted
- Zero instances of S3 artifact existing without corresponding database record
- All artifacts generated via Fargate path include same metadata fields as Lambda-generated artifacts
- Retry logic prevents duplicate artifact generation for same request ID with >99.9% accuracy

**Observability:**
- Every Fargate task execution logs: request ID, correlation ID, start time, end time, LLM token count, S3 key written, database record ID, WebSocket connection notified
- CloudWatch dashboard shows: SQS queue depth, Fargate task count (running/pending/stopped), task execution duration p50/p95/p99, task failure rate, WebSocket notification success rate
- Errors surface sufficient detail to distinguish: SQS delivery failures, Fargate task crashes, LLM service errors, S3 write failures, database write failures, WebSocket delivery failures

**Performance:**
- Fargate path adds <60s overhead vs. hypothetical equivalent Lambda with no timeout (cold start + SQS + coordination)
- SQS→Fargate→Result cycle completes for 95% of requests within 5 minutes for artifacts requiring <3min of LLM processing
- WebSocket notification delivery success rate >98% (accounting for client disconnections)

**Operational:**
- Deployment runbook includes: manual Fargate task count adjustment, SQS DLQ inspection, rollback procedure to Lambda-only mode
- Cost tracking separates: Lambda invocations, SQS requests, Fargate vCPU-hours, S3 PUT requests, Bedrock token costs
- Infrastructure-as-code (CDK/Terraform) provisions all new resources with zero manual console configuration

## Trust Tier Assignment

**Assigned Tier:** 2 — Supervised

**Rationale:**

This intent introduces asynchronous, long-running processes with multiple failure modes and cross-service state coordination (Lambda → SQS → Fargate → S3 → DSQL → WebSocket). The blast radius is moderate:

- **Revenue Impact:** Medium — artifact generation is a core user-facing feature; failures frustrate users but do not prevent all platform usage
- **Data Integrity Risk:** Medium — requires atomic S3/DSQL writes to prevent orphaned artifacts or phantom completion states
- **Operational Complexity:** High — adds new failure domains (SQS DLQ, Fargate task crashes, VPC networking, container image builds) not present in Lambda-only architecture
- **Reversibility:** High — can roll back to Lambda-only execution, but only if existing Lambda handlers remain untouched

The change is not fully autonomous (Tier 1) because:
- It modifies critical request-handling paths for a core feature
- Database schema or artifact structure changes could break existing retrieval logic
- Incorrect IAM roles could expose sensitive data or block legitimate access
- WebSocket coordination logic errors could leave users without completion feedback

The change does not require full gating (Tier 3) because:
- No payment flows, authentication, or PII handling involved
- Feature flag can isolate Fargate path during initial rollout
- Rollback procedure is straightforward (route all requests back to Lambda)
- Infrastructure is additive — no removal of existing Lambda handlers

**Supervision Checkpoints:**
1. **Pre-deploy:** Human reviews CloudFormation/CDK diff for IAM role policies, VPC configuration, and S3 bucket policies
2. **Post-deploy (canary):** Human observes CloudWatch metrics for first 50 Fargate task executions — validates success rate, duration, and WebSocket delivery before scaling to 100% traffic
3. **Post-deploy (full):** Human confirms no increase in artifact retrieval errors or orphaned S3 objects after 48 hours of production traffic

## Dependencies

**Internal Dependencies:**
- **T6-001 or T6-002 (prerequisite):** Fargate cluster, task definition template, and ECS service infrastructure must exist before this intent can execute
  - Requires: VPC with private subnets, NAT Gateway or VPC endpoints for AWS service access
  - Requires: ECR repository for Fargate container images
  - Requires: Base Fargate task IAM role with CloudWatch Logs write permissions

- **Existing Lambda handlers:** Current artifact generation and AI chat Lambda functions must remain operational as fallback path
  - Location: `backend/api/` (assumed based on repo structure)
  - Must not be removed or refactored until Fargate path proven stable in production

- **Database schema (Aurora DSQL):** Artifact and chat message tables must support status tracking for async processing
  - Required fields: `status` (enum: pending/processing/completed/failed), `s3_key` (nullable until completion), `fargate_task_arn` (nullable, for debugging)
  - If schema lacks these fields, schema migration is a **blocking dependency**

- **WebSocket API:** Must have existing API Gateway WebSocket API or AWS IoT Core connection manager to notify frontend of completion
  - If WebSocket infrastructure does not exist, **T6-003 cannot deliver user-facing value** — either scope WebSocket implementation into this intent or split into separate intent

**External Dependencies:**
- **Amazon Bedrock availability:** LLM operations require Bedrock service accessible from Fargate task VPC
  - Dependency: VPC endpoint for Bedrock if using private subnets (recommended)
  - Risk: Bedrock throttling or model unavailability affects Fargate success rate — not addressable within this intent

- **S3 bucket:** Must exist with lifecycle policies for artifact retention
  - Assumed existing based on project description — if bucket does not exist, creation is **blocking dependency**

- **SQS queue:** New FIFO or Standard queue required for Lambda→Fargate message passing
  - Must provision: main queue + DLQ (dead-letter queue) for failed processing
  - Decision needed: FIFO (ordered, exactly-once) vs. Standard (higher throughput, at-least-once) — recommend Standard unless ordering required

**Prior Orbit References:**
- No prior orbit data provided — this is Orbit 1 for intent T6-003
- If T6-001/T6-002 orbits exist, review their artifacts for: Fargate task definition structure, networking decisions (VPC endpoints vs. NAT), IAM role patterns

**Assumptions Requiring Validation:**
1. Aurora DSQL supports concurrent writes from Lambda and Fargate without locking issues — validate with load test if unknown
2. Existing Lambda handlers expose request IDs or correlation IDs suitable for SQS message deduplication
3. Frontend can handle async artifact generation UX (loading states, polling, or WebSocket subscription) — if not, frontend changes are **blocking dependency**