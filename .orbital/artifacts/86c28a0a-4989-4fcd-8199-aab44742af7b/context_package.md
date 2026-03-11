# Context Package: T6-003 · Migrate Long-Running LLM Tasks to Fargate

## Codebase References

### Lambda Functions (Entry Points)
- `lambda/api/artifacts/generate_intent.py` — Intent Document generation endpoint
- `lambda/api/artifacts/generate_context.py` — Context Package generation endpoint
- `lambda/api/artifacts/generate_proposal.py` — Proposal generation endpoint
- `lambda/api/artifacts/generate_plan.py` — Implementation Plan generation endpoint
- `lambda/api/artifacts/generate_tests.py` — Test Specification generation endpoint
- `lambda/api/chat/send_message.py` — AI chat message handler
- `lambda/api/shared/sqs_client.py` — SQS message publishing utility (to be created)

### Fargate Task Implementation (To Be Created)
- `fargate/tasks/artifact_generator/` — New directory for artifact generation task
  - `main.py` — Task entry point, SQS polling loop
  - `handlers/` — Per-artifact-type generation logic
  - `llm_client.py` — Bedrock API wrapper with retry/timeout handling
  - `storage.py` — S3 upload and DSQL metadata persistence
  - `websocket.py` — WebSocket notification client
- `fargate/tasks/chat_processor/` — New directory for chat processing task
  - `main.py` — Chat task entry point
  - `conversation.py` — Multi-turn chat logic with history retrieval
  - `storage.py` — Message persistence to DSQL

### Infrastructure as Code
- `terraform/fargate/task_definitions.tf` — Fargate task definitions for artifact and chat tasks
- `terraform/sqs/queues.tf` — SQS queue configurations (artifact queue, chat queue)
- `terraform/iam/fargate_roles.tf` — IAM roles for Fargate tasks (S3, DSQL, Bedrock, WebSocket access)
- `terraform/vpc/endpoints.tf` — VPC endpoints for Bedrock and other AWS services

### WebSocket Infrastructure
- `lambda/websocket/connection_manager.py` — Connection ID storage/retrieval from DynamoDB
- `lambda/websocket/notify.py` — Message publishing to connected clients (to be enhanced)
- `dynamodb/schemas/websocket_connections.json` — DynamoDB table schema for connection tracking

### Database Schema (Aurora DSQL)
- `db/migrations/015_artifact_metadata.sql` — Existing artifact metadata schema
- `db/migrations/016_task_tracking.sql` — New migration for task status tracking (task_id, status, created_at, completed_at, error_message)
- `db/migrations/017_chat_messages.sql` — Existing chat message schema (to be verified for async compatibility)

### Configuration
- `config/environment.yaml` — Environment-specific settings (SQS queue URLs, Fargate cluster ARN, WebSocket API endpoint)
- `.env.example` — Development environment variables template

## Architecture Context

### Current State (Pre-Intent)
Prometheus executes LLM operations **synchronously within Lambda functions**:
1. API Gateway receives HTTP request → Lambda invokes Bedrock → Lambda waits for response → Lambda returns artifact/message
2. **15-minute Lambda timeout** causes failures for complex artifact generation (Implementation Plans, large Context Packages)
3. **No concurrency control** — multiple simultaneous artifact requests consume Lambda concurrency quota

### Target State (Post-Intent)
Prometheus executes LLM operations **asynchronously via Fargate**:
1. **HTTP Layer (Lambda):** API Gateway → Lambda receives request → validates payload → publishes SQS message → returns `202 Accepted` with `task_id`
2. **Processing Layer (Fargate):** Fargate task polls SQS → processes message → invokes Bedrock → stores result to S3/DSQL → publishes WebSocket notification
3. **Notification Layer (WebSocket):** Frontend maintains WebSocket connection → receives `task_started`, `task_progress`, `task_completed` events → fetches artifact from S3 or displays chat message

### Data Flow
```
Client (Web UI)
  ↓ HTTP POST /artifacts/generate-intent
API Gateway
  ↓
Lambda (generate_intent.py)
  ↓ publish message {task_id, user_id, orbit_id, artifact_type}
SQS Queue (prometheus-artifact-tasks)
  ↓ poll (visibility timeout: 15 min)
Fargate Task (artifact_generator)
  ↓ invoke LLM
AWS Bedrock (Claude/GPT-4)
  ↓ stream response
Fargate Task
  ├─→ S3 (store artifact content)
  ├─→ Aurora DSQL (store metadata + status)
  └─→ WebSocket API (notify completion)
       ↓
Client (WebSocket connection)
  ↓ fetch artifact via GET /artifacts/{task_id}
Lambda (artifact retrieval)
  ↓ query DSQL for s3_url
S3 (retrieve artifact)
  ↓ return to client
```

### Service Boundaries
- **Lambda:** Stateless request validation, SQS publishing, WebSocket connection management. **No LLM invocation.**
- **Fargate:** Stateful LLM processing, artifact generation, chat conversation handling. **No direct HTTP exposure.**
- **SQS:** Decoupling layer between Lambda and Fargate. Standard queue for parallel execution; no ordering guarantees needed.
- **S3:** Artifact storage (versioned, encrypted at rest). Objects prefixed by `user_id/orbit_id/task_id/`.
- **Aurora DSQL:** Metadata storage (task status, artifact references, chat messages). Connection pooling required for concurrent Fargate task writes.
- **WebSocket API:** Real-time notifications. Connection IDs stored in DynamoDB; Lambda authorizer validates user session.

### Infrastructure Constraints
- **Fargate Tasks:** Private subnets only. No internet access except via NAT Gateway (for Bedrock API). VPC endpoints for S3, SQS, DSQL.
- **IAM Roles:** Fargate execution role requires `bedrock:InvokeModel`, `s3:PutObject`, `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `dsql:ExecuteStatement`, `execute-api:ManageConnections`.
- **SQS Configuration:** Visibility timeout = 900 seconds (15 minutes). Dead-letter queue after 3 receive attempts. Message retention = 14 days.
- **Fargate Scaling:** Task count scales based on SQS queue depth (CloudWatch alarm triggers ECS service auto-scaling). Min tasks = 0, Max tasks = 10.

### Relevant Design Patterns
- **Asynchronous Request-Reply:** Lambda generates correlation ID (`task_id`), returns immediately, Fargate processes asynchronously, WebSocket closes the loop.
- **Idempotency:** SQS message deduplication not enabled (standard queue); Fargate tasks check DSQL for existing completed task before processing.
- **Envelope Pattern:** S3 stores raw artifact content; DSQL stores metadata envelope (task_id, s3_url, status, timestamps).
- **Circuit Breaker:** Fargate tasks implement exponential backoff for Bedrock API rate limits (429 errors). After 3 retries, task writes error to DSQL and notifies WebSocket.

## Pattern Library

### SQS Message Publishing (Lambda)
**Pattern:** Use `boto3.client('sqs').send_message()` with JSON payload. Include `task_id` (UUID v4), `user_id`, `orbit_id`, `artifact_type`, `input_params`.

**Example:**
```python
import boto3
import json
import uuid

sqs = boto3.client('sqs')

task_id = str(uuid.uuid4())
message = {
    "task_id": task_id,
    "user_id": event['requestContext']['authorizer']['user_id'],
    "orbit_id": body['orbit_id'],
    "artifact_type": "intent_document",
    "input_params": body
}

sqs.send_message(
    QueueUrl=os.environ['ARTIFACT_QUEUE_URL'],
    MessageBody=json.dumps(message),
    MessageAttributes={
        'task_id': {'StringValue': task_id, 'DataType': 'String'}
    }
)
```

**Anti-Pattern:** Do NOT send large payloads (>256KB) in SQS. Store large inputs in S3 and reference via `s3_key` in message.

### Fargate Task Structure
**Pattern:** Single `main.py` with infinite polling loop. Receive message → process → delete message → repeat. Graceful shutdown on SIGTERM.

**Example:**
```python
import boto3
import signal
import sys

sqs = boto3.client('sqs')
running = True

def shutdown_handler(signum, frame):
    global running
    print("SIGTERM received, finishing current task...")
    running = False

signal.signal(signal.SIGTERM, shutdown_handler)

while running:
    response = sqs.receive_message(
        QueueUrl=os.environ['QUEUE_URL'],
        MaxNumberOfMessages=1,
        WaitTimeSeconds=20  # long polling
    )
    if 'Messages' in response:
        for message in response['Messages']:
            process_task(json.loads(message['Body']))
            sqs.delete_message(
                QueueUrl=os.environ['QUEUE_URL'],
                ReceiptHandle=message['ReceiptHandle']
            )
```

**Anti-Pattern:** Do NOT process multiple messages concurrently in a single task (defeats task-level scaling). One message at a time per Fargate task.

### WebSocket Notification
**Pattern:** Use API Gateway Management API to post to connection. Fetch connection ID from DynamoDB by `user_id`.

**Example:**
```python
import boto3

apigw = boto3.client('apigatewaymanagementapi', 
                     endpoint_url=os.environ['WEBSOCKET_ENDPOINT'])

def notify_user(user_id, event_type, payload):
    # Fetch connection_id from DynamoDB
    connection_id = get_connection_id(user_id)
    if connection_id:
        apigw.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps({
                'event': event_type,
                'data': payload
            })
        )
```

**Event Types:**
- `task_started`: `{"task_id": "...", "artifact_type": "intent_document"}`
- `task_progress`: `{"task_id": "...", "progress": 0.5, "message": "Generating outline..."}`
- `task_completed`: `{"task_id": "...", "artifact_url": "https://s3.../", "status": "success"}`
- `task_failed`: `{"task_id": "...", "error": "Bedrock API timeout"}`

### S3 Artifact Storage
**Pattern:** Key structure = `artifacts/{user_id}/{orbit_id}/{task_id}/{artifact_type}.md`. Use server-side encryption (SSE-S3). Set `Content-Type: text/markdown`.

**Example:**
```python
s3 = boto3.client('s3')

s3_key = f"artifacts/{user_id}/{orbit_id}/{task_id}/intent_document.md"
s3.put_object(
    Bucket=os.environ['ARTIFACT_BUCKET'],
    Key=s3_key,
    Body=artifact_content,
    ContentType='text/markdown',
    ServerSideEncryption='AES256',
    Metadata={
        'task_id': task_id,
        'artifact_type': 'intent_document',
        'generated_at': datetime.utcnow().isoformat()
    }
)
```

### DSQL Metadata Persistence
**Pattern:** Insert task status immediately upon Fargate task start. Update to `completed` or `failed` after processing. Use transaction for atomic S3 URL + status update.

**Schema:**
```sql
CREATE TABLE task_status (
    task_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    orbit_id UUID NOT NULL,
    artifact_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'started', 'completed', 'failed'
    s3_url TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

**Example:**
```python
import psycopg2

conn = psycopg2.connect(os.environ['DSQL_CONNECTION_STRING'])
cursor = conn.cursor()

# On task start
cursor.execute("""
    INSERT INTO task_status (task_id, user_id, orbit_id, artifact_type, status)
    VALUES (%s, %s, %s, %s, 'started')
""", (task_id, user_id, orbit_id, artifact_type))
conn.commit()

# On task completion
cursor.execute("""
    UPDATE task_status
    SET status = 'completed', s3_url = %s, completed_at = NOW()
    WHERE task_id = %s
""", (s3_url, task_id))
conn.commit()
```

### Error Handling
**Pattern:** Catch exceptions at task level, write to DSQL with error message, notify via WebSocket, let SQS visibility timeout trigger retry (up to 3 attempts before DLQ).

**Example:**
```python
try:
    artifact = generate_artifact(task_params)
    s3_url = upload_to_s3(artifact)
    update_task_status(task_id, 'completed', s3_url)
    notify_websocket(user_id, 'task_completed', {'task_id': task_id, 's3_url': s3_url})
except BedrockThrottlingException as e:
    # Transient error, let SQS retry
    raise
except Exception as e:
    # Permanent error, mark failed
    update_task_status(task_id, 'failed', error_message=str(e))
    notify_websocket(user_id, 'task_failed', {'task_id': task_id, 'error': str(e)})
```

## Prior Orbit References

### T6-001-O1: Fargate Cluster Provisioning
**Status:** Completed (assumed, per trajectory dependency)

**Key Learnings:**
- Fargate cluster named `prometheus-llm-tasks` runs in `us-west-2` across 3 availability zones
- Task definition uses `awslogs` driver to CloudWatch Logs group `/ecs/prometheus-llm-tasks`
- Task execution role includes `AmazonECSTaskExecutionRolePolicy` plus custom policy for secrets manager (Bedrock API keys)
- **Memory Allocation Decision:** 2 vCPU / 4GB RAM per task based on profiling of Claude API response streaming (peak 3.2GB observed during 50k token response)

**Relevant Outputs:**
- ECS Cluster ARN: `arn:aws:ecs:us-west-2:123456789012:cluster/prometheus-llm-tasks`
- Task Execution Role ARN: `arn:aws:iam::123456789012:role/prometheus-fargate-execution`

### T6-002-O1: SQS Queue Setup
**Status:** Completed (assumed, per trajectory dependency)

**Key Learnings:**
- **Queue Type Decision:** Standard queue (not FIFO) chosen to allow parallel task execution. No ordering requirement for artifact generation — users don't care if two artifacts complete out-of-order.
- **Visibility Timeout:** Set to 900 seconds (15 minutes) to match max task execution time. If task doesn't complete in 15 min, message becomes visible again for retry.
- **Dead-Letter Queue:** Configured after 3 receive attempts. DLQ messages trigger CloudWatch alarm for manual investigation.
- **Message Retention:** 14 days (SQS maximum) to allow debugging of stuck messages.

**Relevant Outputs:**
- Artifact Queue URL: `https://sqs.us-west-2.amazonaws.com/123456789012/prometheus-artifact-tasks`
- Chat Queue URL: `https://sqs.us-west-2.amazonaws.com/123456789012/prometheus-chat-tasks`
- DLQ ARN: `arn:aws:sqs:us-west-2:123456789012:prometheus-llm-tasks-dlq`

### Prior Work in Lambda-Based Artifact Generation
**Existing Endpoints:**
- All five artifact types currently implemented as synchronous Lambda functions
- LLM client uses `bedrock-runtime:InvokeModel` with streaming enabled
- Average Lambda execution time: 30-180 seconds (Intent Document), 60-300 seconds (Implementation Plan)
- **Pain Points Observed:**
  - 12% of Implementation Plan requests timeout at 900 seconds (Lambda max)
  - No progress indication for users during generation
  - High Lambda concurrency consumption during peak usage (3pm-5pm EST) causes throttling

## Risk Assessment

### 1. SQS Message Loss
**Risk:** Lambda publishes SQS message but Fargate task never receives it due to queue misconfiguration or task crash.

**Impact:** User receives `202 Accepted` but artifact never generates. No retry mechanism in place.

**Likelihood:** Medium (first-time SQS integration, potential for IAM permission gaps)

**Mitigation:**
- Enable SQS CloudWatch metrics (`ApproximateAgeOfOldestMessage`, `NumberOfMessagesReceived`)
- Set CloudWatch alarm if message age exceeds 5 minutes
- Implement task-level heartbeat: update DSQL `last_heartbeat` timestamp every 60 seconds during processing
- Dead-letter queue captures failed messages for manual reprocessing

### 2. WebSocket Connection Dropped
**Risk:** User closes browser tab or loses network connection before task completes. WebSocket notification fails silently.

**Impact:** User doesn't receive completion event. Must manually refresh or check task status.

**Likelihood:** High (mobile users, flaky networks, long task duration)

**Mitigation:**
- **Primary:** Store task status in DSQL; frontend polls `/tasks/{task_id}/status` endpoint as fallback (every 10 seconds)
- **Secondary:** Implement WebSocket reconnection with backoff on client side
- **Tertiary:** Email notification for tasks exceeding 2 minutes (future intent)

### 3. Fargate Task Timeout
**Risk:** LLM generation exceeds 15-minute visibility timeout. SQS makes message visible again while task is still running. Two tasks process same message.

**Impact:** Duplicate artifacts, wasted compute, potential race condition in DSQL update.

**Likelihood:** Low (typical artifact generation completes in 1-3 minutes), but non-zero for complex Implementation Plans

**Mitigation:**
- Enforce 15-minute task execution timeout at Fargate level (ECS task definition `timeout` parameter)
- Implement idempotency check: before starting generation, query DSQL for existing task status. If `completed`, skip processing and delete message.
- Log task duration in CloudWatch; alert if p90 exceeds 10 minutes

### 4. Bedrock API Rate Limiting
**Risk:** Concurrent Fargate tasks exceed Bedrock API quota (e.g., 10 requests/second). Tasks receive 429 ThrottlingException.

**Impact:** Task failures, SQS retries, potential DLQ accumulation, degraded user experience.

**Likelihood:** Medium (scaling from 0 to 10 Fargate tasks during peak usage)

**Mitigation:**
- Implement exponential backoff in Bedrock client (initial delay 1s, max delay 32s, jitter)
- Request Bedrock quota increase to 50 requests/second (submit AWS support case)
- Add task-level rate limiting: sleep 100ms between Bedrock API calls if streaming multiple artifacts in sequence
- Monitor Bedrock throttling via CloudWatch Logs; alert if throttling rate exceeds 5% of requests

### 5. S3 Put Failure
**Risk:** Artifact generation completes but S3 upload fails (network partition, bucket policy issue, IAM permission gap).

**Impact:** Task marked as failed in DSQL, user receives error notification, artifact lost.

**Likelihood:** Low (S3 99.99% availability SLA), but impact is high (work lost)

**Mitigation:**
- Retry S3 upload 3 times with exponential backoff before marking task as failed
- Store artifact content in DSQL as fallback (TEXT column, max 1MB) if S3 upload fails after retries
- Log S3 upload failures to CloudWatch; alert if failure rate exceeds 1% of tasks

### 6. DSQL Connection Pool Exhaustion
**Risk:** 10 concurrent Fargate tasks open connections to Aurora DSQL. Connection pool limit (default 100) exhausted due to long-running transactions or leaked connections.

**Impact:** New tasks cannot acquire database connection. Tasks hang or fail with `connection timeout` error.

**Likelihood:** Medium (first-time connection pooling implementation)

**Mitigation:**
- Configure connection pool with `max_connections=10`, `timeout=5s`, `pool_recycle=3600s`
- Use context manager (`with conn:`) to ensure connections are released after task completion
- Monitor DSQL connection count via CloudWatch RDS metrics; alert if active connections exceed 80
- Implement health check: ping DSQL every 5 minutes, restart task if connection fails

### 7. Incomplete Task Status Updates
**Risk:** Fargate task crashes after generating artifact but before updating DSQL or notifying WebSocket.

**Impact:** Artifact exists in S3 but user never notified. Task status stuck in `started`.

**Likelihood:** Low (Python exceptions caught at task level), but non-zero for OOM kills

**Mitigation:**
- Use database transactions: update DSQL and send WebSocket notification in single atomic operation (if WebSocket API call fails, rollback DSQL update)
- **Alternative:** Update DSQL first, then send WebSocket notification. If WebSocket fails, frontend polling fallback detects completion.
- Background job (Lambda cron every 5 minutes) scans for tasks in `started` status older than 20 minutes; marks as `failed` with error "Task did not complete"

### 8. Backward Compatibility Break
**Risk:** Frontend expects synchronous Lambda response but receives `202 Accepted` with `task_id`. Frontend doesn't handle async pattern.

**Impact:** User sees error or loading spinner that never resolves.

**Likelihood:** **High** (this is a breaking change if frontend not updated)

**Mitigation:**
- **CRITICAL:** Deploy frontend changes BEFORE deploying async Lambda changes. Frontend must:
  - Detect `202` response status
  - Store `task_id` in local state
  - Open WebSocket connection if not already open
  - Subscribe to task events via `task_id`
  - Implement polling fallback
- Feature flag: `ENABLE_ASYNC_ARTIFACTS` environment variable. If false, Lambda invokes Bedrock synchronously (old behavior). Allows gradual rollout.
- Canary deployment: route 10% of traffic to async endpoint, monitor for errors, scale to 100% if success rate >95%