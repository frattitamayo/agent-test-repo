# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

AI-powered artifact generation and interactive chat operations complete reliably without Lambda timeout failures, enabling users to generate complex artifacts (Intent Documents, Context Packages, Proposals) and engage in multi-turn AI conversations that exceed 15 minutes of processing time. The system handles long-running LLM operations asynchronously while maintaining real-time user feedback through WebSocket notifications.

**Impact:** Users experience zero timeout errors on artifact generation requests. The system scales to handle concurrent LLM operations without resource contention. Developers can introduce new AI-assisted features without architectural concerns about execution time limits.

## Constraints

### Performance
- **Initial response latency:** HTTP request acknowledgment must return within 500ms (Lambda processes request and queues message)
- **WebSocket notification latency:** Status updates must reach client within 2 seconds of state change
- **Fargate task startup:** Cold start time must not exceed 45 seconds for task initialization
- **Cost boundary:** Fargate task hours must remain under $200/month for projected volume (est. 1000 artifact generations/month)

### Security
- **Authentication:** Fargate tasks must validate user identity from SQS message payload; no unauthenticated access to LLM operations
- **Secrets management:** All Bedrock credentials and API keys must be retrieved from AWS Secrets Manager at runtime
- **Network isolation:** Fargate tasks must run in private subnets with no direct internet access; use VPC endpoints for AWS service communication
- **Data residency:** All LLM inputs and outputs must remain within us-east-1 region for compliance

### Architectural
- **Existing API contract:** Current REST endpoints (`POST /artifacts/generate`, `POST /chat/send`) must remain unchanged; migration is implementation-only
- **Database compatibility:** Results must be written to existing DSQL schema (`artifacts`, `chat_messages` tables) with no schema changes
- **WebSocket protocol:** Must use existing ApiGatewayManagementApi integration; no changes to frontend WebSocket connection logic
- **Lambda role:** Lambda functions retain current orchestration responsibilities (request validation, user authorization, response formatting)

### Non-Goals
- **Not migrating:** Simple CRUD operations, metadata queries, or sub-5-second LLM calls remain on Lambda
- **Not changing:** Frontend polling mechanisms, error handling UX, or retry logic
- **Not introducing:** Synchronous HTTP long-polling or streaming responses

## Acceptance Boundaries

### Functional Correctness
- **Message delivery:** 100% of validated HTTP requests result in SQS message enqueued with correct payload structure
- **Task execution:** ≥99.5% of SQS messages trigger successful Fargate task startup within 45 seconds
- **Result persistence:** 100% of completed LLM operations write results to DSQL and S3 with correct foreign key relationships
- **WebSocket delivery:** ≥98% of status updates reach connected clients within 2 seconds; 100% eventually consistent within 10 seconds

### Performance Thresholds
- **Artifact generation (median):** Intent Documents complete in 3–8 minutes, Context Packages in 5–12 minutes, Proposals in 8–20 minutes
- **Artifact generation (p95):** No operation exceeds 30 minutes before timeout with partial result saved
- **Concurrent capacity:** System handles minimum 10 simultaneous Fargate tasks without throttling or degraded performance
- **SQS backlog:** Queue depth remains <50 messages under normal load; alarm triggers at 100 messages

### Reliability
- **Error recovery:** Failed Fargate tasks (OOM, timeout, LLM API error) result in error state persisted to DSQL with diagnostic context
- **Dead letter queue:** Unprocessable messages move to DLQ after 3 retry attempts; manual inspection tooling available
- **Idempotency:** Duplicate SQS message delivery does not create duplicate artifacts or corrupt chat history
- **Graceful degradation:** If Fargate service unavailable, Lambda returns 503 with retry-after header; no silent failures

### Observability
- **CloudWatch metrics:** Task duration (p50, p95, p99), SQS age-of-oldest-message, Fargate CPU/memory utilization, LLM token consumption
- **Structured logs:** JSON logs with `request_id`, `user_id`, `intent_id`, `orbit_id`, `task_arn` for end-to-end trace
- **Alarms:** Lambda→SQS delivery failures, Fargate task failures >2%, DLQ message count >0, task duration >25 minutes

### Cost
- **Fargate spend:** Monthly Fargate costs remain under $200 for 1000 artifact generations + 2000 chat interactions
- **Bedrock costs:** Token consumption per operation documented in CloudWatch with per-user attribution for future billing

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:**
This intent operates in a domain with moderate blast radius and requires architectural changes to critical user-facing workflows. Specific risk factors:

1. **User experience impact:** Artifact generation and chat are primary value propositions; failures directly affect user trust and product utility
2. **Data integrity:** Introduces new async write path to DSQL; incorrect foreign key handling or race conditions could corrupt project/trajectory state
3. **Cost exposure:** Misconfigured Fargate tasks (e.g., missing timeout, infinite retry loop) could incur unexpected AWS charges
4. **Security boundary:** Fargate tasks access user data and external LLM APIs; improper secret handling or network configuration creates exposure
5. **Reversibility:** While rollback is possible, it requires coordinating Lambda, SQS, and Fargate infrastructure changes across multiple services

**Why not Tier 1 (Autonomous):**
The async execution model introduces failure modes (message loss, partial writes, orphaned tasks) that are difficult to detect in automated testing alone. Human review of task lifecycle, error handling, and monitoring configuration is warranted.

**Why not Tier 3 (Gated):**
The change is scoped to backend infrastructure with well-defined AWS primitives. The frontend contract remains unchanged, limiting cross-domain coordination risk. Rollback to Lambda-only execution is straightforward if issues arise.

## Dependencies

### External Services
- **AWS Fargate (ECS):** Container orchestration service; must provision task definitions, cluster configuration, and IAM execution roles
- **Amazon SQS:** Message queue; requires queue creation, visibility timeout tuning (30 minutes), and DLQ configuration
- **AWS Bedrock (Claude Sonnet 4):** LLM inference; existing integration must be adapted for long-running streaming responses
- **Amazon DSQL:** Existing database; connection pooling strategy must account for long-lived Fargate tasks
- **Amazon S3:** Artifact storage; existing bucket policies must allow Fargate task role access
- **AWS Secrets Manager:** Existing Bedrock credentials must be accessible to Fargate tasks via VPC endpoint

### Internal Systems
- **Lambda API handlers:** Existing `POST /artifacts/generate` and `POST /chat/send` functions must be refactored to enqueue SQS messages instead of invoking Bedrock directly
- **WebSocket notification service:** Existing `POST /@connections/{connectionId}` integration must be invoked by Fargate tasks for status updates
- **Frontend WebSocket client:** Current implementation expects messages with `{ type: 'artifact:progress' | 'artifact:complete' | 'chat:message' }` schema

### Prior Work
- **T6-001 (Container Base Infrastructure):** Assumes VPC, subnets, NAT Gateway, and VPC endpoints for AWS services exist
- **T6-002 (Container Deployment Pipeline):** Assumes CI/CD tooling (GitHub Actions, ECR) configured for building and pushing Fargate container images
- **T1-001 (DSQL Schema):** Requires `artifacts.status` enum includes `'processing'`, `'completed'`, `'failed'` states
- **T2-003 (WebSocket Notifications):** Assumes ApiGatewayManagementApi integration functional for connection lifecycle

### Data Contracts
- **SQS Message Payload:**
  ```json
  {
    "request_id": "uuid",
    "user_id": "uuid",
    "connection_id": "ApiGateway connection ID",
    "operation": "generate_artifact" | "chat_message",
    "payload": {
      "intent_id": "uuid",
      "artifact_type": "intent" | "context" | "proposal",
      "parameters": { /* operation-specific */ }
    }
  }
  ```
- **DSQL Write Schema:**
  - `artifacts` table: Must write `status`, `s3_key`, `completed_at`, `error_message` fields
  - `chat_messages` table: Must write `content`, `role`, `created_at` with correct `conversation_id` FK

### Blocking Conditions
- **Cannot proceed until:** VPC endpoints for Secrets Manager, DSQL, and SQS are provisioned (T6-001 dependency)
- **Cannot deploy until:** Fargate task IAM role has policies for DSQL write, S3 PutObject, ApiGatewayManagementApi POST
- **Cannot test end-to-end until:** WebSocket notification service supports Fargate task role credentials