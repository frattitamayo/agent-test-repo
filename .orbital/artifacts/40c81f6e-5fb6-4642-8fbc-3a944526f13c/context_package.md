# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Codebase References

### Lambda Functions (Current Implementation)
- `infrastructure/lambda/api/handlers/artifacts.ts` — POST /artifacts endpoint that currently synchronously calls Bedrock and times out on complex generations
- `infrastructure/lambda/api/handlers/chat.ts` — POST /chat endpoint for AI conversations (non-streaming variant subject to 29s API Gateway timeout)
- `infrastructure/lambda/api/lib/bedrock-client.ts` — Wrapper around AWS Bedrock Runtime SDK; contains retry logic and token counting
- `infrastructure/lambda/api/lib/websocket.ts` — WebSocket notification helpers using API Gateway Management API
- `infrastructure/lambda/api/lib/s3-storage.ts` — S3 upload/download helpers with presigned URL generation

### Database Schema
- `infrastructure/database/migrations/001_artifacts.sql` — Artifacts table schema with columns: `id`, `type`, `content_s3_key`, `metadata_json`, `created_at`, `orbit_id`
- `infrastructure/database/migrations/003_websocket_connections.sql` — WebSocket connection tracking: `connection_id`, `user_id`, `connected_at`, `last_seen_at`

### Infrastructure as Code
- `infrastructure/terraform/modules/vpc/main.tf` — VPC configuration with private subnets and VPC endpoints (from T6-001)
- `infrastructure/terraform/modules/api-gateway/websocket.tf` — WebSocket API routes and integrations (from T5-002)
- `infrastructure/terraform/modules/s3/artifacts-bucket.tf` — Artifacts bucket with encryption and lifecycle policies

### New Components (To Be Created)
- `infrastructure/terraform/modules/ecs/fargate-task.tf` — ECS task definition for LLM processor
- `infrastructure/terraform/modules/sqs/llm-processing-queue.tf` — Standard SQS queue with DLQ
- `infrastructure/lambda/workers/fargate-llm-processor/` — Node.js container image entrypoint for Fargate task
- `infrastructure/lambda/workers/fargate-llm-processor/src/handlers/artifact-generator.ts` — Artifact generation logic extracted from Lambda
- `infrastructure/lambda/workers/fargate-llm-processor/src/handlers/chat-processor.ts` — Long-running chat completion logic
- `infrastructure/lambda/workers/fargate-llm-processor/Dockerfile` — Container definition with Node 20 runtime

## Architecture Context

### Current State (Pre-Intent)
Prometheus API follows a synchronous request-response model where Lambda functions directly invoke Bedrock Runtime APIs and block until LLM responses complete. For artifact generation (Context Documents, Proposals, Execution Plans), the Lambda function:

1. Receives POST request at API Gateway
2. Loads trajectory/intent context from Aurora DSQL
3. Constructs LLM prompt with retrieved context
4. Calls Bedrock Runtime synchronously (Claude Sonnet 3.5)
5. Parses LLM response and stores artifact in DSQL
6. Returns artifact ID in HTTP 201 response

This design fails when:
- LLM response generation exceeds 29 seconds (API Gateway timeout)
- Input context exceeds Lambda memory allocation (1.5GB)
- User closes browser tab before response completes (orphaned work)

### Target State (Post-Intent)
The architecture shifts to an asynchronous choreography pattern:

```
┌─────────┐    ┌────────┐    ┌─────┐    ┌─────────┐    ┌──────────┐
│ Client  │───▶│ Lambda │───▶│ SQS │───▶│ Fargate │───▶│ S3 + DSQL│
│ (HTTP)  │◀───│ (API)  │    │Queue│    │  Task   │    │          │
└─────────┘    └────────┘    └─────┘    └─────────┘    └──────────┘
     ▲              │                          │               │
     │              └──────────────────────────┼───────────────┘
     │                    WebSocket Push       │
     └────────────────────────────────────────▶│
                                         Notify on Complete
```

**Lambda (API Handler) Responsibilities:**
- Validate request payload and authenticate user
- Store initial artifact record in DSQL with `status='pending'`
- Construct SQS message with: `artifact_id`, `orbit_id`, `user_id`, `connection_id`, `task_type`, `input_context`
- Send message to `llm-processing-queue.fifo` or standard queue (TBD: FIFO vs standard tradeoff)
- Return HTTP 202 Accepted with artifact ID and estimated completion time

**SQS Queue Configuration:**
- Message retention: 12 hours (allows replay on Fargate outages)
- Visibility timeout: 6 minutes (2x expected P99 latency)
- Redrive policy: Max 3 receives, then move to DLQ
- DLQ: `llm-processing-dlq` with 14-day retention for forensics

**Fargate Task Responsibilities:**
- Poll SQS using long-polling (20-second wait)
- Retrieve input context from DSQL using `artifact_id`
- Invoke Bedrock Runtime via VPC endpoint `com.amazonaws.us-east-1.bedrock-runtime`
- Stream progress via WebSocket every 10 seconds (message format: `{"type":"artifact_progress","artifact_id":"...", "status":"processing", "elapsed_seconds":...}`)
- On completion: Upload artifact content to S3, update DSQL record with `status='completed'`, delete SQS message
- On failure: Log error to CloudWatch, allow SQS retry via message visibility timeout expiration

**Data Flow:**
- Artifact content >1MB stored exclusively in S3 as `{orbit_id}/{artifact_id}.json`
- DSQL stores metadata: S3 key, token count, generation timestamp, cost estimate
- WebSocket final notification includes presigned S3 URL valid for 1 hour

### Network Topology
Fargate tasks run in **private subnets** (no internet gateway route) within VPC from T6-001. Outbound connectivity:
- Bedrock Runtime: VPC endpoint `vpce-bedrock-runtime` (PrivateLink)
- S3: VPC endpoint `vpce-s3` (Gateway endpoint)
- Aurora DSQL: VPC endpoint `vpce-dsql` (PrivateLink)
- API Gateway WebSocket: Via NAT Gateway for `execute-api` POST to `@connections`

Security groups:
- Fargate task SG allows egress to VPC endpoints only
- VPC endpoint SGs allow ingress from Fargate task SG on port 443

### Cost Model
Per-task cost breakdown (1 vCPU, 2GB, 3-minute runtime):
- Fargate: $0.04048/vCPU-hour + $0.004445/GB-hour = ~$0.006 for 3 minutes
- Bedrock (Claude Sonnet 3.5): Input $3/MTok, Output $15/MTok
  - Artifact generation: ~30K input + ~5K output = $0.165 per artifact
  - Total per artifact: $0.171 (well under $0.50 constraint)

## Pattern Library

### SQS Message Schema (Established Pattern)
Prometheus uses a standardized envelope format for all async job messages:

```typescript
interface LLMProcessingMessage {
  version: "1.0";
  task_type: "artifact_generation" | "chat_completion";
  correlation_id: string; // UUID for distributed tracing
  artifact_id: string; // DSQL primary key
  orbit_id: string;
  user_id: string;
  websocket_connection_id: string | null; // null if user disconnected
  input: {
    prompt_template: string;
    context_variables: Record<string, unknown>;
    model_config: {
      model_id: string; // e.g., "anthropic.claude-3-5-sonnet-20241022-v2:0"
      max_tokens: number;
      temperature: number;
    };
  };
  metadata: {
    enqueued_at: string; // ISO 8601 timestamp
    attempt_count: number; // 1-indexed retry counter
  };
}
```

### Artifact Storage Convention
All artifacts follow this S3 key structure:
```
s3://prometheus-artifacts-{env}/{orbit_id}/{artifact_id}.json
```

Artifact JSON structure:
```json
{
  "artifact_id": "art_...",
  "type": "context_document" | "proposal" | "execution_plan",
  "content": { /* type-specific schema */ },
  "generation_metadata": {
    "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "input_tokens": 28450,
    "output_tokens": 4829,
    "latency_ms": 142380,
    "cost_usd": 0.165
  }
}
```

### WebSocket Notification Pattern (from T5-002)
All WebSocket messages use this envelope:

```typescript
interface WebSocketMessage {
  type: string; // event discriminator
  timestamp: string; // ISO 8601
  payload: unknown; // type-specific data
}
```

For artifact completion:
```typescript
{
  type: "artifact_completed",
  timestamp: "2024-01-15T10:30:45Z",
  payload: {
    artifact_id: "art_abc123",
    orbit_id: "orb_xyz789",
    download_url: "https://prometheus-artifacts-prod.s3.amazonaws.com/...",
    expires_at: "2024-01-15T11:30:45Z" // presigned URL expiry
  }
}
```

### Error Handling Standard
Lambda and Fargate tasks follow consistent error taxonomy:

| Error Class | HTTP Status | Retry? | Action |
|------------|-------------|--------|--------|
| `ValidationError` | 400 | No | Return to client immediately |
| `ThrottlingError` | 429 | Yes (3x) | Exponential backoff: 30s, 2m, 5m |
| `ServiceError` | 503 | Yes (3x) | Bedrock/DSQL transient failures |
| `TimeoutError` | 504 | Yes (1x) | LLM response exceeds 5 minutes |
| `InternalError` | 500 | No | Move to DLQ, alert on-call |

Fargate tasks log errors in structured JSON:
```json
{
  "level": "error",
  "error_class": "ServiceError",
  "error_message": "Bedrock throttling: Rate exceeded",
  "artifact_id": "art_...",
  "attempt_count": 2,
  "will_retry": true,
  "next_attempt_in_seconds": 120
}
```

### Terraform Module Structure
Prometheus infrastructure uses layered modules:
```
infrastructure/terraform/
├── environments/
│   ├── dev/
│   │   └── main.tf          # Composes modules for dev env
│   └── prod/
│       └── main.tf          # Composes modules for prod env
└── modules/
    ├── ecs/                  # NEW: ECS cluster + task definitions
    ├── sqs/                  # NEW: Queues + DLQs
    ├── vpc/                  # From T6-001
    ├── api-gateway/          # From T5-002
    └── lambda/               # Existing API handlers
```

Each module exposes outputs used by dependent modules:
```hcl
# modules/sqs/outputs.tf
output "llm_queue_arn" { ... }
output "llm_queue_url" { ... }
output "dlq_arn" { ... }

# modules/ecs/main.tf references:
data "terraform_remote_state" "sqs" { ... }
resource "aws_ecs_task_definition" "llm_processor" {
  # ... uses data.terraform_remote_state.sqs.outputs.llm_queue_url
}
```

### Container Image Build (New Pattern)
Fargate container images built via GitHub Actions on merge to `main`:

```yaml
# .github/workflows/build-fargate-images.yml
- name: Build LLM Processor Image
  run: |
    docker build -t prometheus-llm-processor:${{ github.sha }} 
      -f infrastructure/lambda/workers/fargate-llm-processor/Dockerfile 
      infrastructure/lambda/workers/fargate-llm-processor/
    
- name: Push to ECR
  run: |
    aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY
    docker tag prometheus-llm-processor:${{ github.sha }} $ECR_REGISTRY/prometheus-llm-processor:${{ github.sha }}
    docker tag prometheus-llm-processor:${{ github.sha }} $ECR_REGISTRY/prometheus-llm-processor:latest
    docker push $ECR_REGISTRY/prometheus-llm-processor:${{ github.sha }}
    docker push $ECR_REGISTRY/prometheus-llm-processor:latest
```

Task definition references the image:
```hcl
resource "aws_ecs_task_definition" "llm_processor" {
  container_definitions = jsonencode([{
    name  = "llm-processor"
    image = "${data.aws_ecr_repository.llm_processor.repository_url}:latest"
    # ...
  }])
}
```

## Prior Orbit References

### T6-001: VPC Infrastructure Setup (Assumed Completed)
Established the network foundation this intent depends on:
- VPC with CIDR `10.0.0.0/16` in `us-east-1`
- Private subnets in 3 AZs: `10.0.1.0/24`, `10.0.2.0/24`, `10.0.3.0/24`
- NAT Gateway in public subnet for internet egress (used sparingly)
- VPC endpoints:
  - Gateway endpoint for S3 (`vpce-s3`)
  - Interface endpoint for Bedrock Runtime (`vpce-bedrock-runtime`)
  - Interface endpoint for Aurora DSQL (`vpce-dsql`)
  - Interface endpoint for ECR (for Fargate image pulls: `vpce-ecr-api`, `vpce-ecr-dkr`)
  
**Lessons Applied:**
- VPC endpoint security groups must explicitly allow ingress from Fargate task SG
- S3 gateway endpoint uses route table associations, not security groups
- NAT Gateway required for API Gateway WebSocket `@connections` POST (no VPC endpoint available)

### T5-002: WebSocket API Implementation (Assumed Completed)
Built the real-time notification channel this intent leverages:
- API Gateway WebSocket API with `$connect`, `$disconnect`, `$default` routes
- Lambda authorizer validates JWT tokens on `$connect`
- Connection IDs stored in DSQL `websocket_connections` table with TTL (2 hours idle timeout)
- Lambda helper library `lib/websocket.ts` with methods:
  - `sendMessage(connectionId, payload)` — POST to `@connections/{connectionId}`
  - `isConnectionActive(connectionId)` — Check DSQL for connection existence
  - `broadcastToUser(userId, payload)` — Send to all active connections for a user

**Lessons Applied:**
- WebSocket connection can be stale (user closed tab) — Fargate tasks must handle 410 Gone responses gracefully
- Don't fail the entire task if WebSocket notification fails; log and continue
- Include `connection_id` in SQS message; if null, skip WebSocket notifications (user not connected)

### T3-004: Artifact Generation V1 (Synchronous Lambda)
Original implementation this intent is superseding:
- Single Lambda function `POST /artifacts` with 30-second timeout
- Embedded prompt templates in function code (hard to version)
- No retry logic — timeouts resulted in HTTP 504 and orphaned work
- Users had to stay on page for entire generation time

**Why It Failed:**
- Complex Context Documents (500KB input) took 45-90 seconds to generate
- API Gateway's hard 29-second timeout caused frequent failures
- Lambda memory pressure at 1.5GB when constructing large prompts
- No visibility into progress — users didn't know if system was working

**What We're Keeping:**
- Bedrock model configuration (Claude Sonnet 3.5, temperature=0.7)
- Artifact JSON schema and validation logic
- Token counting and cost estimation formulas

## Risk Assessment

### Risk 1: SQS Message Loss
**Description:** Message deleted from queue before Fargate task completes processing, causing orphaned artifacts with `status='pending'` forever.

**Likelihood:** Low (requires task crash between Bedrock response and SQS delete)

**Impact:** Medium (user never receives artifact, no notification sent)

**Mitigations:**
- Set SQS visibility timeout to 6 minutes (2x P99 latency)
- Implement idempotent task processing: check artifact status in DSQL before starting work
- Background job sweeps `artifacts` table hourly for records >10 minutes in `pending` state, marks them as `failed`
- CloudWatch alarm on DLQ depth >5 messages

### Risk 2: Fargate Task Infinite Loop
**Description:** Bug in task code causes endless retries on same message, burning through SQS redrive policy and filling DLQ.

**Likelihood:** Medium (new codebase, complex error handling)

**Impact:** High (queue blocked, no artifacts generated, customer impact)

**Mitigations:**
- Hard timeout in task definition: `stopTimeout=300` (5 minutes max)
- SQS message attribute `attempt_count` incremented on each retry; task exits early if >3
- DLQ alarm triggers PagerDuty after 10 messages in 5 minutes
- Canary deployment: test with 5% traffic for 1 hour before full rollout

### Risk 3: Cost Overrun from Runaway Concurrency
**Description:** Misconfigured auto-scaling or SQS batch settings cause 100+ concurrent Fargate tasks, exceeding $500/day budget.

**Likelihood:** Low (requires multiple config mistakes)

**Impact:** Critical (budget breach, potential account suspension)

**Mitigations:**
- ECS Service `desired_count=0` with event-driven scaling (SQS triggers)
- `maximum_tasks=20` hard limit in service auto-scaling policy
- SQS queue `batch_size=1` (one message per task invocation)
- CloudWatch billing alarm at $50/day for Fargate spend (10% of monthly budget)
- First 100 production tasks manually approved via feature flag before removing rate limit

### Risk 4: WebSocket Connection Leakage
**Description:** `websocket_connections` table grows unbounded if `$disconnect` route fails to delete records, causing DSQL storage growth and slower queries.

**Likelihood:** Medium (WebSocket disconnects aren't guaranteed)

**Impact:** Medium (degraded performance over weeks, increased DSQL cost)

**Mitigations:**
- TTL column `expires_at = connected_at + 2 hours` with DSQL auto-expiry
- Background Lambda runs hourly to purge `expires_at < NOW()` records (defense in depth)
- Fargate task checks connection validity before sending notification; if 410 Gone, remove from table
- CloudWatch metric tracks table row count; alarm on >10,000 rows (indicates leak)

### Risk 5: Fargate Task Fails to Access VPC Endpoints
**Description:** Security group misconfiguration blocks Fargate task egress to Bedrock or DSQL endpoints, causing all tasks to timeout and redrive to DLQ.

**Likelihood:** Medium (common mistake in VPC setups)

**Impact:** High (complete outage, no artifacts generated)

**Mitigations:**
- Pre-deployment integration test: standalone Fargate task invokes Bedrock via VPC endpoint in staging
- Task definition health check: container start-up script runs `curl` to VPC endpoint before processing messages
- If health check fails, task exits with status code 1, ECS doesn't mark it as healthy
- Terraform `aws_security_group_rule` resources explicitly document ingress/egress rules with comments

### Risk 6: S3 Presigned URL Expiry Before User Downloads
**Description:** WebSocket notification includes presigned URL valid for 1 hour, but user is in different timezone and views notification hours later — link expired.

**Likelihood:** Medium (realistic user behavior)

**Impact:** Low (user can request re-generation or admin provides direct link)

**Mitigations:**
- Presigned URL validity: 24 hours (not 1 hour)
- DSQL artifact record stores S3 key permanently; UI can request new presigned URL via `GET /artifacts/{id}/download`
- Artifact content in S3 retained for 90 days (lifecycle policy in `artifacts-bucket.tf`)
- UI shows "Download expires in X hours" countdown on notification

### Risk 7: DSQL Write Contention on High Concurrency
**Description:** 20 concurrent Fargate tasks updating `artifacts` table cause transaction conflicts and retries, degrading latency.

**Likelihood:** Low (Aurora DSQL designed for high write concurrency)

**Impact:** Low (increased task duration, but within P99 latency bounds)

**Mitigations:**
- Use optimistic locking: `UPDATE artifacts SET status='completed' WHERE id=? AND status='pending'`
- If zero rows updated, log warning and exit (another task already completed it)
- DSQL connection pooling in Fargate task: max 2 connections per task
- CloudWatch metric tracks DSQL transaction retry count; alarm on >100 retries/minute

### Risk 8: Bedrock Throttling Under Load
**Description:** Bedrock enforces per-account rate limits (e.g., 10 concurrent requests for Claude Sonnet); Fargate tasks exceed this during burst traffic.

**Likelihood:** Medium (likely during initial launch or marketing campaigns)

**Impact:** Medium (tasks retry, increased latency, but eventually succeed)

**Mitigations:**
- Request Bedrock quota increase to 50 concurrent invocations before production launch
- Implement token bucket rate limiter in Fargate task: max 10 Bedrock calls per 10 seconds
- SQS standard queue inherently smooths burst traffic into steady processing rate
- Fargate task retries Bedrock calls with exponential backoff on `ThrottlingException`
- CloudWatch metric tracks Bedrock throttle errors; alarm on >10% error rate