# T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Desired Outcome

Prometheus users experience reliable, uninterrupted AI-powered operations regardless of task duration. Artifact generation (Intent Documents, Context Packages, Proposals, Implementation Plans, Test Specifications) and interactive AI chat complete successfully without timeout failures, with real-time progress visibility through WebSocket updates. The platform scales to handle concurrent long-running LLM operations without degrading API responsiveness or exhausting Lambda concurrency limits.

## Constraints

- **Backward Compatibility:** Existing API endpoints, request/response schemas, and authentication mechanisms remain unchanged; frontend clients require no modifications to initiate tasks.
- **Security Posture:** Fargate tasks execute in private subnets with no direct internet egress; AWS service access (Bedrock, S3, DSQL, SQS) routed through VPC endpoints or NAT Gateway; IAM roles follow least-privilege principle.
- **Data Governance:** All generated artifacts and chat transcripts remain within the current AWS region; S3 bucket encryption at rest (AES-256) and in-transit (TLS 1.2+) enforced; DSQL connections use SSL.
- **Cost Boundaries:** Individual Fargate tasks limited to 15-minute maximum execution; tasks capped at 2 vCPU and 4GB RAM; no spot instances (reliability over cost for user-facing operations).
- **WebSocket Protocol Stability:** Real-time notifications use existing API Gateway WebSocket API infrastructure; message format and connection lifecycle unchanged from current implementation.
- **Architectural Boundary:** Migration scope limited to LLM-dependent operations (artifact generation, AI chat); other Lambda functions (CRUD APIs, auth, webhooks) remain unchanged.
- **Non-Goal:** Retry logic, dead-letter queue processing, and exponential backoff for failed tasks are explicitly out of scope — error recovery is a separate intent.
- **Non-Goal:** Fargate auto-scaling policies and CloudWatch alarms are out of scope — initial deployment uses fixed task count with manual scaling.

## Acceptance Boundaries

### Functional Correctness
- **Minimum Viable:** All five artifact types generate via Fargate with S3 URLs stored in DSQL; AI chat responses persist in DSQL and deliver via WebSocket; zero Lambda timeout errors for migrated operations.
- **Target:** WebSocket events include `task_queued`, `task_started`, `task_progress` (with percentage), `task_completed`, `task_failed` with structured payloads (taskId, status, timestamp, artifactUrl/messageContent, errorDetails).
- **Exceptional:** Frontend receives granular progress updates (e.g., "Analyzing context", "Generating sections", "Validating output") with sub-task completion indicators.

### Performance
- **Minimum Viable:** Median end-to-end latency (API request → Lambda → SQS → Fargate → S3/DSQL → WebSocket) under 60 seconds for artifact generation, under 15 seconds for chat responses; 90th percentile under 90 seconds and 25 seconds respectively.
- **Target:** Median latency under 30 seconds for artifacts, under 8 seconds for chat; 90th percentile under 45 seconds and 12 seconds.
- **Exceptional:** Median latency under 20 seconds for artifacts, under 5 seconds for chat; 99th percentile under 60 seconds and 15 seconds.

### Reliability
- **Minimum Viable:** 90% task success rate over 24-hour observation period; task failures logged to CloudWatch with trace IDs; no cascading failures (one failed task does not block subsequent tasks).
- **Target:** 95% task success rate; failed tasks automatically logged with context (input parameters, LLM provider response codes, S3 errors); SQS message visibility timeout prevents duplicate processing.
- **Exceptional:** 99% task success rate; automatic fallback to alternative LLM provider on primary provider throttling; graceful degradation with user notification on infrastructure issues.

### Observability
- **Minimum Viable:** CloudWatch Logs capture task lifecycle events (queued, started, completed, failed) with trace IDs linking Lambda request → SQS message → Fargate task; manual CloudWatch Insights queries return task duration and error rates.
- **Target:** CloudWatch Dashboard displays real-time metrics: active Fargate task count, SQS queue depth, p50/p90/p99 latency by operation type, error rate by failure reason, WebSocket delivery success rate.
- **Exceptional:** X-Ray tracing spans entire async flow; alerts trigger on queue depth > 50, task failure rate > 5%, or p95 latency exceeding target thresholds; automated runbooks linked to alarm states.

### Operational Readiness
- **Minimum Viable:** Fargate task definition deployed with environment variables for Bedrock endpoint, S3 bucket, DSQL connection string, SQS queue URL; IAM roles granted via Terraform/CDK; one successful end-to-end test in staging environment.
- **Target:** Deployment pipeline includes smoke tests (generate one artifact, send one chat message) post-deploy; rollback procedure documented with SQS queue drain strategy; on-call runbook includes common failure modes and remediation steps.
- **Exceptional:** Blue-green deployment with traffic shifting (5% → 50% → 100%); automated rollback on error rate spike; chaos engineering tests (kill Fargate tasks, throttle SQS, simulate Bedrock 429 errors) validate resilience.

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:** This intent fundamentally alters the execution model for user-facing AI operations — shifting from synchronous request-response to asynchronous event-driven processing. The change introduces multiple new failure modes (SQS message loss, Fargate task OOM, WebSocket delivery failure) that could result in users perceiving the platform as broken ("my artifact never generated") without clear error feedback.

**Blast Radius Assessment:**
- **User Impact:** High — affects two core workflows (artifact generation, AI chat) used in every project; failures block forward progress on intents.
- **Data Integrity Risk:** Low — no destructive operations; failed tasks do not corrupt existing data, only fail to create new artifacts.
- **System Stability Risk:** Medium — misconfigured SQS visibility timeout or Fargate task memory limits could cause queue buildup or repeated task failures; does not affect non-LLM Lambda functions.
- **Reversibility:** High — revert to synchronous Lambda execution by routing API requests directly to Lambda LLM handlers (SQS and Fargate remain idle).

**Why Not Tier 1 (Autonomous)?**
The introduction of SQS as a critical path dependency and WebSocket as the sole user feedback mechanism requires human verification that the async handoff works reliably under load. A silent failure (task queued but never processed) could go undetected by automated tests but severely degrade user experience.

**Why Not Tier 3 (Gated)?**
The change is scoped to a single trajectory with well-defined acceptance boundaries and no cross-system dependencies outside AWS managed services. The architecture is reversible, and failures do not cascade to other platform features (project management, user auth, trajectory planning). Gated review is excessive for a bounded infrastructure migration with clear rollback strategy.

## Dependencies

### Infrastructure Prerequisites
- **T6-001 Completion:** Fargate cluster provisioned in target VPC with private subnets; ECS task execution role and task role created with policies for ECR pull, CloudWatch Logs, Secrets Manager; security groups allow egress to VPC endpoints.
- **T6-002 Completion:** SQS standard queue created with 15-minute visibility timeout, 14-day message retention, dead-letter queue configured with maxReceiveCount=3; Lambda execution role granted `sqs:SendMessage`, Fargate task role granted `sqs:ReceiveMessage`, `sqs:DeleteMessage`.

### Application Dependencies
- **WebSocket Infrastructure:** API Gateway WebSocket API deployed with routes (`$connect`, `$disconnect`, `$default`); DynamoDB connection table stores `connectionId ↔ userId` mappings with TTL; Lambda functions handle connection lifecycle and message routing.
- **Artifact Storage:** S3 bucket with versioning enabled, lifecycle policy (transition to IA after 90 days), bucket policy restricts access to Fargate task role; DSQL schema includes `artifacts` table (id, intent_id, orbit_id, type, s3_url, created_at, created_by).
- **LLM Provider Access:** AWS Bedrock enabled in region with model access granted (Claude 3.5 Sonnet, GPT-4 via Bedrock model access); VPC endpoint for Bedrock API or NAT Gateway with egress route configured; API rate limits understood (300 requests/min for Claude).

### External Service Dependencies
- **AWS Bedrock Availability:** LLM inference API operational with <5% throttling rate; fallback to alternative model (e.g., Claude → GPT-4) defined if primary model unavailable.
- **Aurora DSQL Connection Pool:** Database supports concurrent writes from multiple Fargate tasks; connection pooling configured (max 10 connections per task, 2-minute idle timeout); schema migrations applied for artifact metadata storage.

### Data Dependencies
- **User Context Retrieval:** Fargate tasks must access current project, trajectory, intent, and orbit context from DSQL to generate artifacts; Lambda includes context payload in SQS message or Fargate queries DSQL using IDs from message.
- **Artifact Templates:** Prompt templates for Intent Document, Context Package, Proposal, Implementation Plan, Test Specification stored in S3 or embedded in Fargate container image; version controlled with template updates triggering container rebuild.

### Observability Dependencies
- **CloudWatch Log Groups:** Pre-created log groups for Fargate task stdout/stderr (`/ecs/prometheus-llm-tasks`) with 7-day retention; log streams tagged with taskId for correlation.
- **X-Ray (Optional):** If distributed tracing required, X-Ray daemon runs as sidecar in Fargate task definition; Lambda, SQS, and Fargate instrumented with X-Ray SDK; trace IDs propagated via SQS message attributes.

### Prior Orbit Context
- **T6-001-O1 Learnings:** Fargate task startup time averages 45 seconds (image pull + ENI attachment); pre-warmed task pool not implemented in initial deployment — first request incurs cold start penalty.
- **T6-002-O1 Learnings:** SQS FIFO queue rejected due to throughput limits (300 TPS) insufficient for concurrent artifact generation; standard queue chosen with client-side deduplication (idempotency key in message attributes).