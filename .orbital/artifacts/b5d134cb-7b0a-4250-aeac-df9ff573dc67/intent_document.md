# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Artifact generation and AI chat operations complete successfully without timing out, enabling users to generate complex artifacts (context packages, proposals, test suites) and engage in extended AI conversations without interruption. The system architecture supports LLM operations that exceed Lambda's 15-minute execution limit while maintaining responsiveness through asynchronous processing and real-time status updates via WebSocket notifications.

## Constraints

- **Lambda execution model remains unchanged** — HTTP request handling, authentication, and authorization continue in Lambda; only long-running LLM processing moves to Fargate
- **No synchronous HTTP response for long-running operations** — clients must use WebSocket connections for status updates; cannot return artifact content directly in HTTP response body
- **S3 and DSQL remain system of record** — Fargate tasks write results to existing storage; no new databases or caching layers introduced
- **SQS message visibility timeout must accommodate worst-case LLM latency** — set to prevent duplicate processing while allowing for variable generation times
- **Fargate task IAM roles follow least-privilege** — tasks receive only permissions required for S3 write, DSQL insert, SQS receive/delete, and Bedrock invocation
- **No cross-region dependencies** — Fargate cluster, SQS queue, and Lambda functions colocated in single AWS region
- **Existing WebSocket infrastructure reused** — no new connection management layer; leverage current API Gateway WebSocket implementation
- **Backward compatibility maintained** — existing clients using current artifact/chat endpoints continue to function during migration
- **Non-goal: real-time streaming of LLM responses** — system delivers complete artifacts, not token-by-token streaming

## Acceptance Boundaries

### Functional Requirements

- **Artifact generation completes for all types** — context packages, proposals, test suites, and deployment plans generate without timeout errors (success rate ≥ 99% for requests under 100K tokens)
- **AI chat supports extended conversations** — multi-turn conversations with context spanning 50+ messages complete without Lambda timeout
- **SQS message processing reliability** — messages processed exactly once; no duplicate generations; failed tasks retry up to 3 times before dead-letter queue
- **WebSocket notifications deliver within 2 seconds** — frontend receives status update (queued, processing, completed, failed) within 2s of state change
- **Result retrieval succeeds** — generated artifacts available via S3 presigned URL or DSQL query within 5 seconds of completion notification

### Performance Thresholds

- **Cold start impact < 10 seconds** — Fargate task startup from cold does not exceed 10s from SQS message receipt to first Bedrock API call
- **Concurrency scaling** — system handles 10 concurrent long-running LLM tasks without queueing delay exceeding 30 seconds
- **SQS queue depth monitored** — CloudWatch alarm triggers if queue depth exceeds 50 messages for more than 5 minutes

### Operational Requirements

- **CloudWatch logs capture task lifecycle** — each Fargate task logs: message receipt, Bedrock request/response, S3 write, DSQL insert, WebSocket publish
- **Error classification** — failed tasks tagged with failure reason (timeout, Bedrock error, storage failure, invalid input)
- **Cost visibility** — CloudWatch metrics track Fargate vCPU-hours, SQS message count, and Bedrock token usage per intent/trajectory
- **Graceful degradation** — if Fargate cluster capacity exhausted, Lambda returns 503 with retry-after header rather than queueing indefinitely

### Security Requirements

- **Message payload encryption** — SQS messages encrypted at rest and in transit (AWS KMS with project-specific key)
- **Fargate task secrets managed via Secrets Manager** — no plaintext credentials in environment variables or task definitions
- **S3 presigned URLs expire within 15 minutes** — artifact retrieval links time-bound to reduce exposure window
- **Audit trail maintained** — every artifact generation logged with requesting user ID, intent ID, and timestamp

## Trust Tier Assignment

**Tier 2 — Supervised**

This intent warrants supervised execution because:

1. **Touches critical user-facing workflows** — artifact generation is a primary value proposition; failures directly impact user productivity and trust
2. **Introduces asynchronous processing model** — shifts from synchronous Lambda execution to async Fargate, increasing failure modes (message loss, task crashes, notification delivery failures)
3. **Modifies billing surface** — Fargate introduces new cost structure (per-second billing, minimum task duration) that could impact project economics if misconfigured
4. **Expands IAM attack surface** — Fargate tasks require cross-service permissions (S3, DSQL, SQS, Bedrock) that must be validated to prevent privilege escalation
5. **Reversibility limited** — once clients adopt async pattern, rolling back to synchronous Lambda requires client-side changes and coordination

Human review required at:
- **Task definition approval** — IAM policy, resource allocations, and environment configuration reviewed before deployment
- **SQS queue configuration** — visibility timeout, redrive policy, and DLQ settings validated against worst-case execution time
- **WebSocket event schema** — notification payload structure approved to ensure frontend compatibility
- **Deployment plan** — blue/green strategy and rollback triggers documented and approved
- **Post-deployment validation** — first 100 production tasks manually verified for correct behavior before removing supervision

## Dependencies

### Infrastructure Dependencies

- **AWS Fargate cluster** — ECS cluster with Fargate launch type configured in project region (prerequisite: T6-001 or equivalent container infrastructure setup)
- **SQS queue** — standard queue with DLQ for failed messages; visibility timeout ≥ 30 minutes
- **VPC configuration** — Fargate tasks require VPC subnet with NAT gateway for Bedrock API access
- **CloudWatch log group** — dedicated log group for Fargate task output with 30-day retention

### Service Dependencies

- **Amazon Bedrock** — Claude 3.5 Sonnet model access via `bedrock-runtime:InvokeModel` API
- **Aurora DSQL** — existing database connection for writing artifact metadata (location, token count, generation time)
- **S3 bucket** — existing artifact storage bucket with versioning enabled
- **API Gateway WebSocket API** — existing WebSocket connections table and $default route for pushing notifications
- **Lambda functions** — existing HTTP request handlers (create_artifact, chat_message endpoints) modified to enqueue SQS messages instead of invoking Bedrock directly

### Data Dependencies

- **Intent/Trajectory context** — Fargate tasks require access to intent definitions, trajectory specifications, and orbit history (passed via SQS message payload or fetched from DSQL)
- **User session state** — authentication token or user ID included in message to associate generated artifacts with requesting user
- **Artifact templates** — system prompt templates and schema definitions for each artifact type (context package, proposal, etc.)

### Prior Orbit References

- **Assumption: T6-001 completed** — if container infrastructure setup is incomplete, this intent blocks on Fargate cluster provisioning, VPC configuration, and IAM role creation
- **WebSocket infrastructure assumed operational** — if WebSocket notification system has known issues (connection drops, message loss), those must be resolved before long-running tasks depend on it for status updates