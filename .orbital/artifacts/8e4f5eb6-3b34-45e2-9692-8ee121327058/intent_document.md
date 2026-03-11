# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Artifact generation and AI chat operations execute reliably beyond Lambda's 15-minute timeout, completing within 30 minutes for 95th percentile requests. Users receive real-time progress updates via WebSocket and can retrieve completed artifacts from S3/DSQL without blocking the HTTP request-response cycle. The system scales to handle concurrent LLM workloads without throttling or resource exhaustion.

## Constraints

- **Timeout Boundaries**: Fargate tasks MUST timeout after 30 minutes to prevent runaway costs. Any operation requiring longer execution is out of scope.
- **Cost Ceiling**: Fargate task execution cost per intent MUST NOT exceed $0.50 for 95th percentile workloads.
- **Existing API Contracts**: HTTP endpoints for artifact generation and chat MUST maintain current request/response schemas. Breaking changes to frontend integration are forbidden.
- **Security Posture**: Fargate tasks MUST operate within the existing VPC security groups. No new public internet access. IAM roles MUST follow least-privilege for S3/DSQL/SQS access.
- **WebSocket Infrastructure**: MUST reuse existing WebSocket connection management. No changes to connection lifecycle or authentication.
- **Aurora DSQL Limits**: Database write operations from Fargate MUST NOT exceed current connection pool limits (50 concurrent connections).
- **Non-Goals**: This intent does NOT include migrating existing Lambda functions that complete within timeout. This intent does NOT implement batch processing of multiple intents. This intent does NOT add new LLM providers or models.

## Acceptance Boundaries

### Functional Completeness
- SQS queue accepts messages from Lambda with artifact generation or chat payloads
- Fargate tasks poll SQS, process LLM requests, and write results to S3 (artifacts) and DSQL (chat history)
- WebSocket events fire when Fargate task completes or fails
- Frontend receives artifact URLs or chat responses via WebSocket without polling

### Performance
- Lambda enqueue latency: <500ms p95
- SQS message visibility timeout: 35 minutes (5-minute buffer beyond task timeout)
- Fargate cold start to first LLM token: <45 seconds p95
- Fargate task completion for median artifact generation: <8 minutes
- Fargate task completion for p95 artifact generation: <25 minutes
- WebSocket notification delivery: <2 seconds after task completion

### Reliability
- SQS dead-letter queue captures tasks that fail after 2 retries
- Fargate task failure rate: <2% under normal load
- No message loss between Lambda → SQS → Fargate → S3/DSQL
- Graceful degradation: if Fargate cluster capacity exhausted, Lambda returns 503 with retry-after header

### Observability
- CloudWatch logs capture task start, LLM stream progress, completion, and errors
- CloudWatch metrics track: queue depth, task duration, failure rate, cost per task
- X-Ray traces link Lambda request ID → SQS message ID → Fargate task ID → WebSocket event

### Cost
- Fargate task execution cost measured and baselined within 7 days of deploy
- P95 task cost documented and compared against $0.50 constraint threshold

## Trust Tier Assignment

**Tier 2 — Supervised**

This intent operates in supervised mode because:

1. **Blast Radius**: Touches critical user-facing paths (artifact generation, AI chat). Failures directly impact user experience and block core workflows.
2. **Financial Risk**: Introduces new compute cost model (Fargate vs Lambda). Misconfigured timeouts or retry logic could multiply costs 10x.
3. **Data Integrity**: Fargate writes to DSQL and S3 outside the Lambda request context. Race conditions or partial writes could corrupt artifact state.
4. **Infrastructure Novelty**: First Fargate workload in Prometheus V1. Cluster configuration, IAM policies, and VPC networking patterns are unproven in this codebase.

Human review is required before deploy to validate:
- SQS retry and DLQ configuration
- Fargate task definition (CPU/memory/timeout)
- IAM role permissions scoped correctly
- Cost projections based on load testing

## Dependencies

### Infrastructure
- **SQS Queue**: New FIFO queue for task ordering (per-user FIFO group to prevent head-of-line blocking)
- **Fargate Cluster**: ECS cluster with auto-scaling group (1–10 tasks, scale on queue depth)
- **S3 Bucket**: Existing artifact storage with Fargate IAM write access
- **Aurora DSQL**: Existing database with Fargate connection pool allocation
- **VPC Configuration**: Private subnets with NAT gateway for Bedrock API access

### Services
- **Lambda Functions**: Existing artifact generation and chat endpoints (modified to enqueue SQS messages)
- **WebSocket API**: Existing API Gateway WebSocket connections (Fargate must publish to connection management Lambda)
- **Bedrock LLM APIs**: Claude models for artifact generation and chat (existing IAM role extended to Fargate execution role)

### Prior Work
- **Orbit T6-001**: Established container build pipeline and ECR repository pattern (reused for Fargate task image)
- **Orbit T5-004**: Implemented WebSocket connection lifecycle management (Fargate reuses connection table and notification Lambda)

### External Constraints
- **AWS Service Limits**: Fargate task quota in region (current: 100 concurrent tasks)
- **Bedrock Quotas**: Anthropic Claude 3.5 Sonnet token throughput (current: 100k TPM per region)