# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Prometheus V1 can reliably execute artifact generation and AI chat operations that exceed Lambda's 15-minute execution limit without user-facing timeouts or degraded experience. Users receive real-time progress updates via WebSocket notifications while long-running LLM tasks process asynchronously in Fargate containers, eliminating the constraint that currently blocks complex multi-artifact generation and extended AI conversations.

## Constraints

- **Lambda remains the HTTP entry point**: All user requests hit API Gateway → Lambda. Lambda must not invoke Fargate directly; it must enqueue work to SQS.
- **No synchronous Fargate calls**: Frontend cannot wait for Fargate task completion via HTTP. All results delivered asynchronously via WebSocket.
- **Backward compatibility**: Existing short-running operations (< 5 minutes) continue to execute in Lambda without routing through Fargate.
- **Security boundary**: Fargate tasks must use IAM roles with least-privilege access to S3, DSQL, Bedrock, and SQS. No credentials in environment variables.
- **Cost containment**: Fargate tasks must scale to zero when idle. No persistent running containers.
- **Data durability**: Results persisted to S3 and DSQL before WebSocket notification sent. No in-memory-only state.
- **WebSocket connection management**: System must handle client disconnects gracefully. Clients reconnecting must retrieve task status from persistent storage.

## Acceptance Boundaries

### Functional Requirements
- Artifact generation requests exceeding 5 minutes complete successfully without Lambda timeout errors
- AI chat sessions sustaining > 15 minutes of continuous interaction remain responsive
- WebSocket clients receive progress updates at minimum 10-second intervals during long-running tasks
- Clients disconnected during processing can reconnect and retrieve final results from S3/DSQL
- Failed Fargate tasks are retried up to 3 times with exponential backoff before marking as failed
- SQS dead-letter queue captures messages that fail all retry attempts for manual inspection

### Performance Requirements
- Lambda → SQS enqueue latency: < 200ms (p95)
- Fargate task startup (cold start): < 30 seconds (p95)
- WebSocket notification delivery: < 500ms from task completion (p95)
- S3 artifact retrieval for reconnected clients: < 1 second (p95)

### Operational Requirements
- CloudWatch dashboards display: SQS queue depth, Fargate task count, task success/failure rates, WebSocket connection count
- CloudWatch alarms trigger on: SQS age-of-oldest-message > 5 minutes, Fargate task failure rate > 5%, DLQ message count > 0
- Fargate task logs stream to CloudWatch Logs with request IDs for tracing
- Cost per successful artifact generation tracked in CloudWatch metrics

### Quality Thresholds
- Zero Lambda timeout errors for requests routed to Fargate
- Fargate task success rate ≥ 95% (excluding user-caused failures like invalid inputs)
- WebSocket message delivery success rate ≥ 99%
- End-to-end artifact generation latency reduced by ≥ 30% for operations currently timing out in Lambda

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale**: This intent introduces a new async processing pattern that touches core user-facing workflows (artifact generation, AI chat) and adds infrastructure components (Fargate, SQS) that affect system reliability and cost. While the architecture is well-understood and the blast radius is contained to specific operation types, the integration points between Lambda → SQS → Fargate → WebSocket → Frontend create multiple failure modes that require human validation before production deployment.

The supervised tier is justified because:
- **Revenue impact**: Artifact generation is a primary user workflow. Failures directly affect user experience and retention.
- **New failure modes**: SQS message loss, Fargate OOM errors, WebSocket disconnect edge cases are novel to this system.
- **Cost implications**: Misconfigured Fargate scaling or retry logic could drive runaway costs.
- **Rollback complexity**: Reverting requires coordination across Lambda, SQS, Fargate, and WebSocket handler deployments.

Human review will validate: SQS visibility timeout configuration, Fargate task resource limits, retry/backoff strategy, WebSocket reconnection logic, and cost estimation under load.

## Dependencies

### Infrastructure Dependencies
- **SQS Queue**: Standard queue with visibility timeout ≥ Fargate max execution time (suggest 1 hour). DLQ with retention ≥ 7 days.
- **Fargate Cluster**: ECS cluster with Fargate launch type. Task definition with Bedrock, S3, DSQL IAM permissions.
- **S3 Bucket**: Existing artifact storage bucket with lifecycle policies for result objects.
- **DSQL Tables**: Existing `artifacts`, `orbits`, `tasks` tables with columns for task status and result references.
- **WebSocket API**: Existing API Gateway WebSocket API with connection table in DSQL.

### Service Dependencies
- **Bedrock**: Claude 3.5 Sonnet model access for LLM operations. No changes required.
- **API Gateway**: Existing REST API for Lambda entry points. No changes required.
- **CloudWatch**: Log groups, metric namespaces, alarms. New resources for Fargate.

### Code Dependencies
- **Lambda Handler**: Modify artifact generation and AI chat endpoints to route long-running requests to SQS instead of inline execution.
- **Fargate Worker**: New service that polls SQS, invokes LLM operations, writes results to S3/DSQL, sends WebSocket notifications.
- **WebSocket Handler**: Existing connection management. Add reconnection/status-retrieval endpoint.
- **Frontend**: Update artifact generation and AI chat UI to handle async mode (loading states, progress polling, reconnection).

### Prior Orbit Context
This is Orbit 1 for Intent T6-003. No prior orbit learnings to incorporate.

### External Constraints
- Bedrock throttling limits: 200 TPS per model (cross-region quota). Fargate concurrency must respect this.
- SQS standard queue throughput: 3,000 messages/second per API action. No architectural limit expected at current scale.