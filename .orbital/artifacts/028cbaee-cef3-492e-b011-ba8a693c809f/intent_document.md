# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

**Prometheus V1 eliminates Lambda timeout failures for artifact generation and AI chat operations by routing long-running LLM workloads through Fargate.**

When this orbit completes:
- Users can generate artifacts of any complexity without timeout errors, regardless of LLM response latency
- AI chat sessions handle multi-turn conversations and long-form responses without interruption
- The system maintains sub-second HTTP response times by decoupling API latency from LLM execution time
- WebSocket connections deliver real-time progress updates during long-running operations
- Infrastructure costs scale with actual processing time rather than provisioned Lambda duration limits

## Constraints

### Performance
- Initial HTTP response (Lambda → SQS) must complete in <500ms
- WebSocket event delivery latency must remain <2s from task completion
- SQS message processing must begin within 30s of enqueue
- Fargate task cold start overhead must not exceed 10s for p95

### Security
- SQS messages must not contain PII or sensitive prompt content — only task IDs and S3 references
- Fargate tasks must run in private subnets with no direct internet access
- IAM roles must follow least-privilege: Lambda cannot invoke Fargate directly, Fargate cannot write to DSQL tables outside `artifacts` and `chat_messages`
- All LLM API credentials must be retrieved from AWS Secrets Manager, never environment variables

### Architecture
- Must reuse existing Lambda functions for HTTP ingress — no API Gateway or ALB changes
- Must preserve existing DSQL schema for `artifacts` and `chat_messages` tables
- Must not introduce new synchronous dependencies — Fargate tasks cannot block Lambda execution
- Must support graceful shutdown: in-flight LLM requests complete before task termination

### UX Patterns
- Frontend must receive immediate acknowledgment (<1s) that the request is queued
- Users must see "processing" state with progress indicators during Fargate execution
- WebSocket must deliver partial results (streaming) for chat operations when possible
- Must preserve existing artifact versioning behavior (stored in S3 with DSQL metadata)

### Non-Goals
- This orbit does NOT migrate batch processing, scheduled jobs, or data pipeline workloads
- This orbit does NOT implement retries or dead-letter handling (deferred to T6-004)
- This orbit does NOT optimize Fargate instance sizing or autoscaling policies (current defaults acceptable)

## Acceptance Boundaries

### Functional Completeness
- **Minimum:** Artifact generation requests return HTTP 202, write to SQS, and Fargate tasks complete with results in S3/DSQL within 5 minutes for standard prompts
- **Target:** Chat sessions support 10-turn conversations with streaming responses via WebSocket; artifact generation handles prompts up to 100k tokens
- **Exceptional:** System gracefully handles LLM API timeouts (>120s) with user-visible error states and automatic cleanup

### Reliability
- **Minimum:** 95% of SQS messages processed within 60s; Fargate task failure rate <5%
- **Target:** 99% of tasks complete successfully; failed tasks write error details to DSQL with correlation IDs
- **Exceptional:** Circuit breaker triggers at 10% failure rate, queuing pauses, and ops team receives alert

### Performance
- **Minimum:** Lambda→SQS latency p95 <500ms; WebSocket event delivery p95 <3s; Fargate cold start p95 <15s
- **Target:** Lambda→SQS latency p95 <300ms; WebSocket event delivery p95 <2s; Fargate cold start p95 <10s
- **Exceptional:** Warm Fargate pool maintains 2 standby tasks during business hours, reducing cold starts to <5s p95

### Observability
- **Minimum:** CloudWatch logs capture SQS message IDs, Fargate task IDs, and LLM request durations; errors include stack traces
- **Target:** X-Ray traces span Lambda→SQS→Fargate→WebSocket; custom metrics track queue depth, task duration, and failure types
- **Exceptional:** Real-time dashboard shows active Fargate tasks, queue backlog, and p95 latencies; alerts fire on anomaly detection

### Cost
- **Minimum:** Fargate costs remain below $200/month for current load (estimated 500 artifact generations + 2000 chat turns/month)
- **Target:** Per-operation cost decreases vs. Lambda due to precise resource allocation (no 15-minute timeout padding)
- **Exceptional:** Autoscaling policies keep idle Fargate capacity <10% during off-peak hours

## Trust Tier Assignment

**Tier 2 — Supervised**

### Rationale
This intent modifies critical user-facing workflows (artifact generation, AI chat) with **moderate blast radius** and **irreversible data flow changes**:

1. **Revenue Impact:** Artifact generation is a core paid feature; downtime or failures directly affect user satisfaction and retention
2. **Data Integrity:** Migration introduces new async boundaries where message loss or processing failures could leave DSQL in inconsistent state (e.g., artifact record exists but S3 file missing)
3. **Infrastructure Complexity:** Adding Fargate + SQS increases failure modes (SQS visibility timeout, task OOM, network partitions) that require validation before production deployment
4. **Partial Reversibility:** Rolling back requires coordinated Lambda + Fargate deployments and SQS queue draining — not a simple function revert

**Why not Tier 1 (Autonomous)?**
- Changes affect revenue-critical paths
- Introduces distributed system failure modes not present in current Lambda-only architecture
- No ability to A/B test (all users affected simultaneously)

**Why not Tier 3 (Gated)?**
- Does not touch authentication, billing, or compliance-critical systems
- Failure blast radius contained to artifact/chat features (does not cascade to other services)
- Architecture pattern (Lambda→SQS→Fargate) is established in industry, not novel research

**Supervision Requirements:**
- Human review of Fargate task definitions, IAM policies, and SQS configuration before deploy
- Canary deployment: 10% of artifact requests routed to Fargate for 24 hours, monitoring error rates and latencies
- Rollback plan validated in staging with synthetic load matching production p95

## Dependencies

### Internal Systems
- **DSQL Schema:** Requires `artifacts.status` and `chat_messages.status` columns to support `queued`, `processing`, `completed`, `failed` states (currently only `completed` exists)
- **WebSocket Service:** Depends on existing WebSocket connection manager (assumed operational per Prometheus V1 architecture) to broadcast task completion events
- **S3 Buckets:** Artifact storage bucket must grant Fargate task role `s3:PutObject` permissions (currently Lambda-only)

### External Services
- **AWS SQS:** New FIFO queue `prometheus-llm-tasks.fifo` required; must support message deduplication and 12-hour visibility timeout
- **AWS Fargate:** ECS cluster `prometheus-workers` must exist with VPC endpoints for Secrets Manager, S3, and DSQL
- **LLM Provider API:** Bedrock or external LLM service must support requests from Fargate's subnet (egress via NAT Gateway or VPC endpoint)

### Prior Orbits
- **T6-001 (Container Foundation):** Assumes ECS cluster, task execution role, and CloudWatch log groups are provisioned
- **T6-002 (SQS Integration):** Assumes Lambda has SQS send permissions and dead-letter queue exists for failed messages

### Blockers
- **Critical:** DSQL connection pooling from Fargate tasks (if Lambda currently uses single connection per invocation, Fargate needs connection reuse strategy)
- **Critical:** WebSocket connection mapping (how does Fargate task resolve user connection ID to send progress updates?)
- **Non-Blocking:** Fargate spot instance support (cost optimization, can default to on-demand initially)