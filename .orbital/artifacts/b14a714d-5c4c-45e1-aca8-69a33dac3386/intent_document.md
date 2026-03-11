# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Prometheus V1 reliably processes artifact generation and AI chat operations that exceed Lambda's 15-minute timeout limit without user-facing failures, enabling complex multi-step LLM workflows (trajectory decomposition, context synthesis, multi-agent orchestration) to complete successfully. Users experience responsive feedback during long-running operations via real-time WebSocket notifications, eliminating the current failure mode where large intents or deep conversations time out and require manual retry.

## Constraints

- **AWS Lambda remains the entry point** — All HTTP requests continue to be handled by existing Lambda functions; no direct HTTP traffic to Fargate
- **No breaking changes to existing APIs** — Current Lambda-only endpoints must continue to function unchanged; Fargate is additive
- **Aurora DSQL transactional guarantees** — All state transitions (intent → orbit → artifact) must maintain ACID properties; no eventual consistency for core entities
- **WebSocket connection management** — API Gateway WebSocket connections remain owned by Lambda; Fargate cannot directly send to connection IDs
- **Security boundaries** — Fargate tasks run in private subnets with no inbound internet access; secrets managed via AWS Secrets Manager; IAM roles follow principle of least privilege
- **Cost containment** — Fargate tasks must terminate after job completion; no idle task charges; SQS visibility timeout prevents duplicate processing
- **Bedrock rate limits** — Existing per-request throttling and retry logic must be preserved; Fargate does not bypass AWS service quotas
- **Non-goal: Real-time streaming** — This intent does NOT implement token-by-token streaming of LLM responses; notifications occur at job completion or major phase transitions only

## Acceptance Boundaries

### Functional Completeness
- Lambda → SQS → Fargate → S3/DSQL → WebSocket notification flow demonstrated for at least one artifact type (Intent Document or Proposal)
- AI chat conversations exceeding 10 minutes of LLM processing time complete successfully without timeout
- Fargate task updates orbit status in DSQL at: job start, major phase transitions, completion, and error states
- WebSocket clients receive notifications within 5 seconds of Fargate job state changes
- Failed Fargate tasks result in orbit status = 'failed' with error details stored in DSQL

### Performance Thresholds
- Lambda HTTP response time: <500ms for endpoints that enqueue SQS messages
- SQS message delivery to Fargate: <10 seconds from enqueue to task start
- Fargate cold start overhead: <60 seconds from task launch to first LLM API call
- WebSocket notification latency: <5 seconds from DSQL write to frontend receipt

### Reliability
- Fargate task failure rate <5% for transient infrastructure issues (retry logic handles Bedrock throttling separately)
- SQS visibility timeout prevents duplicate task execution >99.9% of the time
- Orbit recovery: if Fargate task dies mid-execution, orbit status reflects 'failed' within 2 minutes (via dead-letter queue or timeout monitoring)

### Observability
- CloudWatch Logs capture: SQS message metadata, Fargate task lifecycle events, LLM token counts, execution duration, error stack traces
- X-Ray traces link: Lambda request ID → SQS message ID → Fargate task ID → Bedrock invocation ID
- DSQL audit trail: every orbit status transition includes timestamp, actor (Lambda vs Fargate task ARN), and reason

### Operational
- Infrastructure-as-code (CDK/Terraform) deploys: SQS queue, Fargate task definition, IAM roles, CloudWatch log groups, and VPC networking
- Rollback plan documented: how to disable Fargate routing and revert to Lambda-only processing without data loss
- Cost monitoring dashboard: Fargate vCPU-hours, SQS message volume, S3 PUT requests per orbit

## Trust Tier Assignment

**Tier 2: Supervised** — This intent introduces new infrastructure primitives (Fargate, SQS queues, cross-service orchestration) into the critical path of artifact generation and AI interactions. The blast radius is contained to long-running operations (short tasks remain Lambda-only), but failures affect user-facing workflows and could corrupt orbit state if transaction boundaries are mishandled.

**Rationale:**
- **Not Tier 1 (Autonomous):** Changes core orchestration patterns; introduces new failure modes (task OOM, SQS poisoned messages, cross-service state desync); requires human validation of infrastructure templates and error-handling logic before production deployment
- **Not Tier 3 (Gated):** Does not touch authentication, billing, or cross-tenant data; failures are scoped to individual orbits and logged for debugging; rollback path is clear (disable SQS routing); no regulatory or contractual risk

**Human approval required for:**
- CDK/Terraform infrastructure diff before apply
- Fargate IAM role policies (S3, DSQL, Secrets Manager, Bedrock permissions)
- SQS dead-letter queue configuration and alarm thresholds
- First production deploy of Fargate-backed artifact generation

## Dependencies

### Internal Systems
- **Lambda HTTP handlers** — Must be updated to enqueue SQS messages for eligible long-running operations; existing logic remains for short tasks
- **Aurora DSQL schema** — Orbit table must support status updates from Fargate task ARNs (new actor type beyond Lambda function names)
- **WebSocket notification service** — Existing Lambda-based notification system must accept events from Fargate tasks (requires shared SQS-to-WebSocket adapter or direct Lambda invocation from Fargate)
- **S3 artifact storage** — Fargate tasks write generated artifacts (markdown, JSON) to the same bucket/prefix structure Lambda uses today
- **Bedrock integration layer** — Existing prompt management, token counting, and retry logic must be callable from Fargate container runtime

### External Dependencies
- **AWS Fargate availability** — Tasks run in us-east-1; requires VPC with private subnets, NAT Gateway for Bedrock API egress, and AWS service VPC endpoints (S3, Secrets Manager, CloudWatch)
- **SQS FIFO queues** (optional) — If processing order matters for multi-step artifact generation, FIFO queue ensures strict sequencing; standard queue acceptable if operations are idempotent
- **Container image registry** — Fargate task definition pulls from ECR; requires CI/CD pipeline to build and push images on code changes

### Prior Orbits
- **Orbit T6-002** (if exists) — Any prior Fargate infrastructure work (VPC setup, base container image, monitoring) should be referenced to avoid duplication
- **Orbit T5-xxx** (WebSocket implementation) — Existing WebSocket connection management must support notifications from non-Lambda sources

### Assumptions
- Bedrock API calls from Fargate tasks use the same AWS SDK credentials/retry logic as Lambda
- SQS message size limit (256 KB) is sufficient for intent metadata; if not, message body references S3 object with full payload
- Fargate task termination after job completion is handled by ECS task definition (no manual cleanup required)