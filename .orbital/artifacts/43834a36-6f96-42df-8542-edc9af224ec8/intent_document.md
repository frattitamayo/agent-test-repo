# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

API endpoints for artifact generation and AI chat operations respond within acceptable HTTP timeout windows while supporting LLM operations that may take minutes to complete. Users receive immediate confirmation that their request is processing, with real-time progress updates via WebSocket, and final results delivered asynchronously without blocking the API layer.

The system scales elastically to handle variable LLM workload without Lambda timeout failures or cold-start penalties on long-running operations.

## Constraints

- **Backward compatibility:** All existing API contracts remain unchanged; frontend receives WebSocket events in the same schema currently expected
- **Cost boundary:** Fargate task definitions must not exceed $0.50/hour compute cost per task at p99 utilization patterns
- **Security:** Fargate tasks authenticate to DSQL/S3/SQS using IAM roles; no credentials in environment variables or task definitions
- **Observability:** All Fargate task execution traces flow into existing CloudWatch Logs and X-Ray; no separate monitoring stack
- **Regional availability:** Solution must work in `us-east-1` and `us-west-2` without cross-region dependencies
- **No vendor lock-in to queue implementation:** SQS is the initial implementation, but the pattern must allow swapping to EventBridge or SNS without rewriting business logic
- **Non-goal:** This orbit does NOT migrate PDF generation, email dispatch, or scheduled jobs — only interactive LLM operations (artifact generation, chat)

## Acceptance Boundaries

### Functional Requirements

- **Queue-based invocation:** Lambda API handlers successfully place messages on SQS queue with <100ms p95 latency
- **Task startup:** Fargate tasks begin processing within 30 seconds of message arrival in SQS
- **LLM operation completion:** Artifact generation and chat operations complete successfully for prompts up to 200k tokens input with no timeout failures
- **Result persistence:** Generated artifacts stored in S3 with correct MIME types and DSQL records updated atomically
- **WebSocket notification:** Frontend receives `artifact.completed` or `chat.response` events within 2 seconds of Fargate task completion
- **Error handling:** Failed Fargate tasks retry up to 3 times with exponential backoff; after final failure, WebSocket receives `artifact.failed` event with error details

### Performance Thresholds

- **Lambda API response:** HTTP 202 Accepted returned in <500ms p95
- **Queue visibility:** SQS message visible to Fargate consumer within 1 second of Lambda enqueue
- **Task resource utilization:** Fargate tasks use <2 vCPU and <4GB memory at p95; right-sized to actual LLM client requirements
- **Concurrent execution:** System supports ≥10 concurrent Fargate tasks without throttling or increased error rates

### Operational Requirements

- **Deployment:** Fargate task definition, SQS queue, and IAM roles deployed via CDK with zero downtime
- **Rollback safety:** New queue-based pattern deployed alongside existing Lambda implementation; feature flag controls routing for ≥7 days
- **Monitoring:** CloudWatch dashboard shows SQS queue depth, Fargate task count, task duration p50/p95/p99, and error rate
- **Cost visibility:** CloudWatch Insights query available to calculate per-request cost breakdown (Lambda + SQS + Fargate + S3)

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:**

- **Moderate blast radius:** Changes affect artifact generation and AI chat — core user-facing features with revenue impact, but failures are observable and recoverable
- **New infrastructure pattern:** Introducing Fargate and SQS to the stack for the first time; architectural mistakes could cascade into cost overruns or regional outages
- **Backward compatibility risk:** Replacing synchronous Lambda execution with async queue pattern requires careful coordination between API layer, queue handlers, and WebSocket event schema
- **Production data flow:** Fargate tasks read/write production DSQL and S3; misconfigured IAM policies or task definitions could leak tenant data across boundaries
- **Not tier 3 (gated):** Changes are isolated to backend execution layer; frontend contract remains unchanged; rollback via feature flag is clean; no compliance or legal review required

Human review gates:

1. **Pre-deploy:** CDK diff review for IAM policies, SQS queue configuration, and Fargate task definition
2. **Post-deploy:** Monitor SQS queue depth and Fargate error rates for 48 hours before enabling for >10% of traffic
3. **Before full rollout:** Verify cost-per-request metrics align with $0.50/hour constraint

## Dependencies

### Internal System Dependencies

- **DSQL (Aurora):** Fargate tasks query and update `artifacts`, `orbits`, and `chat_messages` tables; requires connection pooling configuration for concurrent tasks
- **S3 bucket:** `prometheus-artifacts-prod` must grant Fargate task role `s3:PutObject` and `s3:GetObject` permissions with bucket versioning enabled
- **WebSocket API:** Existing WebSocket connection manager must expose `postToConnection` API for Fargate tasks to send events; requires VPC endpoint if Fargate runs in private subnet
- **IAM roles:** New `FargateTaskExecutionRole` (for ECR/CloudWatch) and `FargateTaskRole` (for DSQL/S3/SQS/WebSocket) must be created
- **VPC:** Fargate tasks run in existing VPC private subnets with NAT Gateway for Bedrock API egress

### External Service Dependencies

- **AWS Bedrock:** Fargate tasks invoke `bedrock-runtime:InvokeModel` with `anthropic.claude-3-5-sonnet-20241022`; existing Lambda IAM policies apply
- **SQS Standard Queue:** New queue `prometheus-llm-tasks-prod.fifo` with message retention 4 hours, visibility timeout 15 minutes
- **ECR:** Docker image for Fargate task must be built from existing Lambda layer codebase + lightweight Node.js runtime

### Prior Orbit References

- **T6-001 (Orbit 3):** Established Lambda + Bedrock integration pattern for artifact generation; this orbit extracts the Bedrock invocation logic into a reusable task handler
- **T2-004 (Orbit 2):** Defined WebSocket event schema for `artifact.completed` and `chat.response`; Fargate tasks must emit the same schema

### Ordering Constraints

- **Before T6-004 (Background Processing):** This orbit establishes the SQS + Fargate pattern; T6-004 will extend it to scheduled jobs
- **After T6-002 (Lambda Refactor):** Assumes Lambda API handlers are already refactored to async patterns with feature flags