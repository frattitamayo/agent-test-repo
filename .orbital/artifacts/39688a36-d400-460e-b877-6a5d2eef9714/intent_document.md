# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

AI-powered artifact generation and conversational chat operations complete reliably without Lambda timeout failures or resource constraints. Users experience no degradation in response quality while the platform gains operational headroom for concurrent LLM workloads. The system architecture evolves to support operations exceeding 15 minutes (Lambda's hard limit) and memory-intensive processing beyond 10GB.

## Constraints

- **No user-facing latency increase:** HTTP request acknowledgment must remain under 200ms. Users receive immediate confirmation that their request is processing.
- **Backward compatibility:** All existing API contracts remain unchanged. Frontend clients require no modifications to consume LLM-generated content.
- **Cost ceiling:** Fargate runtime costs must not exceed 3x the equivalent Lambda invocation cost for workloads under 15 minutes. Monitor and alert if unit economics degrade.
- **Security posture:** Fargate tasks inherit all existing IAM policies for S3, DSQL, Bedrock, and WebSocket API access. No privilege escalation. Secrets remain in AWS Secrets Manager, never in container images.
- **Observability parity:** CloudWatch logs, traces, and metrics must provide equivalent debugging capability to current Lambda implementation. X-Ray integration required.
- **No SQS message loss:** Standard queue durability applies. Dead-letter queue configured with 3 retry attempts before manual intervention.
- **WebSocket connection lifecycle:** Frontend must handle connection drops during long operations. Reconnection logic with exponential backoff already exists — do not break it.

## Acceptance Boundaries

### Functional Correctness
- Lambda → SQS → Fargate → S3/DSQL → WebSocket notification pathway executes end-to-end for both artifact generation and chat completions
- SQS messages contain sufficient context (intent ID, user ID, request parameters) for Fargate to execute without additional API calls
- Fargate tasks retrieve Bedrock responses, persist results to correct S3 paths and DSQL records, and emit WebSocket events matching existing schema
- Dead-letter queue captures failed tasks after 3 retry attempts; CloudWatch alarm triggers on DLQ depth > 0

### Performance
- **HTTP acknowledgment:** 95th percentile < 150ms for POST requests that enqueue SQS messages
- **Task startup latency:** Fargate task begins processing within 30 seconds of SQS message arrival (cold start acceptable; warm pool optimization deferred)
- **End-to-end completion:** Artifact generation completes in ≤ 90th percentile of current Lambda times for operations under 10 minutes. Operations exceeding 10 minutes establish new baseline.
- **WebSocket notification delivery:** 99th percentile < 2 seconds from S3/DSQL write to frontend receipt

### Reliability
- **SQS processing success rate:** ≥ 99.5% of messages processed without reaching DLQ
- **Fargate task failure rate:** < 0.1% due to infrastructure issues (excludes Bedrock throttling or user input errors)
- **No zombie tasks:** All Fargate tasks terminate within 60 minutes or are force-stopped. CloudWatch alarm on tasks running > 45 minutes.

### Cost
- **Per-operation cost:** Fargate invocation cost ≤ 3x equivalent Lambda cost for < 15-minute workloads. CloudWatch dashboard tracks cost per intent processed.
- **Idle resource cost:** Fargate service scales to zero when SQS queue is empty. No continuous baseline charges beyond SQS itself.

### Operational
- **Deployment:** Fargate task definition updates via CDK. Zero-downtime rollout — old tasks drain before termination.
- **Rollback:** Revert to Lambda-only processing by disabling SQS consumers and re-enabling direct Lambda invocation. Tested in staging environment.
- **Monitoring dashboard:** CloudWatch dashboard displays SQS depth, Fargate task count, success/failure rates, p95 latency, and cost per 1000 operations.

## Trust Tier Assignment

**Tier 2: Supervised**

This intent touches critical user-facing workflows (artifact generation, chat) and introduces new failure modes (SQS delays, Fargate OOM, task termination). While operations are asynchronous and non-destructive (no data deletion, no auth changes), prolonged failures would degrade core product value.

Rationale:
- **Blast radius:** Affects all users invoking LLM-powered features. Failure mode is degraded experience (no results) rather than data corruption.
- **Reversibility:** Architectural change is reversible via feature flag or rollback to Lambda-only path. Data integrity unaffected.
- **Risk domains:** Infrastructure (new ECS/Fargate dependency), concurrency (SQS backpressure handling), cost (unbounded Fargate scaling if misconfigured).
- **Novel territory:** First Fargate service in Prometheus. Requires validation of scaling behavior, error propagation, and cost under production load.

Human approval required before:
1. Merging infrastructure code (CDK changes for Fargate cluster, task definitions, SQS queues)
2. Deploying to production environment
3. Enabling SQS consumers to route production traffic through Fargate

Post-deployment supervised period: 7 days with daily cost and error rate review before considering autonomous operation.

## Dependencies

### Internal Dependencies
- **T6-001 (Container Infrastructure Setup):** Fargate cluster, VPC configuration, IAM roles, ECR repository must exist. Task definition inherits base configuration.
- **Existing WebSocket API:** `/notify` endpoint and connection management already operational. Fargate tasks call existing Lambda function to broadcast events.
- **S3 artifact storage:** Bucket structure and IAM policies established. Fargate writes to same paths as current Lambda.
- **DSQL schema:** `artifacts` and `chat_messages` tables support async writes. No schema changes required.

### External Dependencies
- **AWS Bedrock:** Fargate tasks invoke `bedrock-runtime:InvokeModel` with same quotas as Lambda. No additional quota requests unless aggregate throughput increases significantly.
- **SQS limits:** Standard queue supports 120,000 inflight messages. Fargate concurrency must not exceed this threshold (enforced via ECS task count limits).
- **CloudWatch Logs:** Fargate log groups created with 7-day retention. Integrate with existing centralized logging if present.

### Cross-Cutting Concerns
- **Secrets rotation:** Bedrock API keys and DSQL credentials in Secrets Manager. Fargate tasks must handle rotation without restart (use AWS SDK caching with TTL).
- **Cost monitoring:** Finance team notified of new Fargate line item in AWS bill. Projected monthly cost: $200–$500 based on current LLM operation volume.
- **Incident response:** On-call runbook updated with Fargate-specific debugging steps (task logs, ECS exec access, SQS replay procedures).