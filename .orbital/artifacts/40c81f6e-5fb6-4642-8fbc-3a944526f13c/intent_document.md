# T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Desired Outcome

AI-powered artifact generation and chat interactions complete reliably within their natural processing time without Lambda timeout failures or client disconnection. Users receive real-time progress notifications during long-running operations and can navigate away from the browser while tasks complete in the background. The system's capacity to handle concurrent LLM workloads scales independently of API request volume.

## Constraints

- **Cost ceiling:** Fargate task execution cost must not exceed $0.50 per artifact generation or $0.10 per chat completion at current Claude Sonnet 3.5 pricing
- **API contract stability:** Existing REST endpoints (`POST /artifacts`, `POST /chat`) must maintain identical request/response schemas; clients must not require code changes
- **WebSocket compatibility:** Must integrate with existing API Gateway WebSocket connections established during user sessions
- **Data residency:** All LLM inputs, outputs, and intermediate artifacts must remain within Aurora DSQL and S3 in us-east-1
- **Security posture:** Fargate tasks must not have direct internet egress; Bedrock access via VPC endpoints only
- **Non-goal:** This intent does NOT migrate real-time streaming chat responses to Fargate — those remain in Lambda with chunked SSE

## Acceptance Boundaries

### Functional Requirements
- Artifact generation requests (Context Documents, Proposals, Execution Plans) process successfully for inputs up to 500KB and LLM responses up to 200K tokens
- SQS message placement occurs within 200ms of Lambda receiving the HTTP request
- Fargate task startup (cold start) completes within 15 seconds of SQS message arrival
- WebSocket progress events emit at minimum every 10 seconds during active LLM processing
- Failed tasks retry automatically up to 3 times with exponential backoff (30s, 2m, 5m)
- Dead-letter queue captures permanently failed tasks for manual investigation

### Performance Targets
- **P50 latency:** End-to-end artifact generation completes in <45 seconds (simple) and <120 seconds (complex)
- **P99 latency:** No artifact generation exceeds 5 minutes wall-clock time
- **Concurrency:** System handles 20 concurrent Fargate tasks without throttling
- **Message processing:** SQS message visibility timeout set to 6 minutes; messages deleted only after successful completion

### Observability
- CloudWatch Logs capture task startup, LLM request/response metadata, and completion events with structured JSON
- Custom CloudWatch metrics track: task duration, LLM token usage, retry count, DLQ depth
- X-Ray traces link Lambda invocation → SQS message → Fargate execution → WebSocket notification

### Data Integrity
- Artifact content stored in S3 with server-side encryption (SSE-S3)
- DSQL artifact records include: task ARN, S3 object key, generation timestamp, token count, cost estimate
- WebSocket notification payload includes artifact ID, download URL (presigned S3), and generation metadata

## Trust Tier Assignment

**Tier 2: Supervised**

This intent warrants supervised autonomy due to:

1. **Moderate blast radius:** Affects all users generating artifacts and conducting AI chat — core product workflows — but failures degrade gracefully (users can retry, existing artifacts remain accessible)
2. **Cost exposure:** Introduces new Fargate billing with unbounded task duration; poorly configured retry logic or memory allocation could cause budget overruns
3. **Architecture novelty:** First asynchronous processing pattern in Prometheus; introduces SQS, ECS task definitions, and inter-service choreography not previously exercised
4. **Partial reversibility:** Can rollback Lambda functions independently, but reverting Fargate infrastructure requires coordinated CloudFormation updates

Human review gates:
- Terraform plan approval before applying ECS task definitions, SQS queues, and IAM roles
- Cost analysis review of first 100 production tasks (expected ~$15 total spend) before removing rate limits
- Manual verification of WebSocket notification delivery in staging with 10+ concurrent tasks

## Dependencies

### Internal Systems
- **Aurora DSQL:** Artifact metadata tables (`artifacts`, `orbits`, `orbit_logs`) must support concurrent writes from Fargate tasks
- **S3 Bucket:** `prometheus-artifacts-{env}` bucket must exist with lifecycle policies for 90-day retention
- **API Gateway WebSocket API:** Connection IDs must be stored in DSQL and accessible to Fargate tasks for `@connections` POST
- **Bedrock Runtime:** VPC endpoint `com.amazonaws.us-east-1.bedrock-runtime` must allow traffic from Fargate task security group

### Prior Work
- **T6-001** (assumed completed): VPC with private subnets, NAT gateway, and VPC endpoints for AWS services
- **T5-002** (assumed completed): WebSocket API implementation with connection management in Lambda

### External Dependencies
- **Amazon ECS:** Fargate platform version 1.4.0+ for ephemeral storage allocation
- **Amazon SQS:** Standard queue with message retention ≥ 6 hours
- **AWS Secrets Manager:** Bedrock model IDs and generation configs stored as versioned secrets

### Configuration Requirements
- Task definition CPU: 1 vCPU (1024 units)
- Task definition Memory: 2 GB
- SQS batch size: 1 message per task invocation
- Reserved concurrency: 20 tasks maximum (safety limit)