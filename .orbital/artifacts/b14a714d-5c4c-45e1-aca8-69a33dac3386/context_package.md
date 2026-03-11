# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Generated:** 2024-02-17
**Package Type:** intent-specific
**Intent:** T6-003
**Trust Tier:** Tier 2 (Supervised)

---

## Codebase References

### Primary (will be modified or created)

**Infrastructure Layer**
- `infrastructure/cdk/lib/fargate-task-stack.ts` — Fargate ECS task definition, cluster, task role, execution role
- `infrastructure/cdk/lib/sqs-queue-stack.ts` — SQS queue for Lambda → Fargate message passing, dead-letter queue configuration
- `infrastructure/cdk/lib/vpc-stack.ts` — Private subnets, NAT gateway, VPC endpoints (S3, Secrets Manager, CloudWatch, Bedrock)
- `infrastructure/cdk/lib/monitoring-stack.ts` — CloudWatch alarms for Fargate task failures, SQS queue depth, DLQ messages

**Fargate Container Application**
- `services/fargate-worker/` — New directory for Fargate task application code
- `services/fargate-worker/src/main.ts` — Task entry point: polls SQS, processes messages, updates DSQL
- `services/fargate-worker/src/handlers/` — Job-specific handlers (artifact generation, AI chat continuation)
- `services/fargate-worker/src/integrations/bedrock.ts` — Bedrock API client with retry logic
- `services/fargate-worker/src/integrations/dsql.ts` — Aurora DSQL client for orbit status updates
- `services/fargate-worker/src/integrations/s3.ts` — S3 client for artifact storage
- `services/fargate-worker/src/integrations/websocket.ts` — WebSocket notification via Lambda invocation or shared queue
- `services/fargate-worker/Dockerfile` — Container image definition
- `services/fargate-worker/package.json` — Node.js dependencies (AWS SDK v3, SQS consumer, DSQL driver)

**Lambda HTTP Layer**
- `services/api/src/handlers/artifacts/generate.ts` — Modify to enqueue SQS message for large intents
- `services/api/src/handlers/chat/continue.ts` — Modify to enqueue SQS message for long conversations
- `services/api/src/shared/sqs-client.ts` — Shared SQS message enqueue utility
- `services/api/src/shared/job-router.ts` — Logic to decide Lambda vs Fargate routing based on complexity heuristics

**Database Schema**
- `database/migrations/V1.6_add_fargate_actor.sql` — Alter orbit table to support Fargate task ARN as actor
- `database/schema/orbit.ts` — Update TypeScript types for new actor field

### Secondary (dependencies and interfaces)

**Shared Libraries**
- `packages/core/src/entities/orbit.ts` — Orbit domain entity with status transitions
- `packages/core/src/entities/intent.ts` — Intent domain entity
- `packages/core/src/entities/artifact.ts` — Artifact domain entity
- `packages/bedrock/src/client.ts` — Existing Bedrock integration with retry logic
- `packages/bedrock/src/prompt-templates/` — Prompt templates for artifact generation
- `packages/observability/src/logger.ts` — Structured logging shared by Lambda and Fargate
- `packages/observability/src/tracer.ts` — X-Ray tracing utilities

**WebSocket Infrastructure**
- `services/websocket/src/handlers/notify.ts` — Existing notification dispatcher (may need to accept events from Fargate)
- `services/websocket/src/connection-store.ts` — WebSocket connection ID storage in DSQL or DynamoDB

### Tests

- `services/fargate-worker/tests/handlers/artifact-generation.test.ts` — Unit tests for artifact generation handler
- `services/fargate-worker/tests/integrations/dsql.test.ts` — Integration tests for DSQL orbit updates
- `services/api/tests/handlers/artifacts/generate.test.ts` — Tests for Lambda → SQS enqueue logic
- `infrastructure/cdk/tests/fargate-task-stack.test.ts` — CDK snapshot tests for Fargate infrastructure

---

## Architecture Context

### Current State

Prometheus V1 follows a **Lambda-centric request-response architecture** where all user-facing API requests are handled synchronously by Lambda functions. Artifact generation (Intent Documents, Proposals, ORBITAL Plans) and AI chat operations invoke AWS Bedrock directly from Lambda handlers. This works for small intents and short conversations but fails when LLM processing exceeds Lambda's 15-minute timeout.

**Data flow today:**
1. Frontend → API Gateway → Lambda HTTP handler
2. Lambda → Bedrock API (synchronous)
3. Lambda → Aurora DSQL (write artifact/orbit state)
4. Lambda → WebSocket API (notify frontend)
5. Lambda → S3 (store artifact content)

**Bottleneck:** Step 2 (Bedrock API calls) can take 10+ minutes for complex intents involving multi-agent decomposition, context synthesis, or iterative refinement. Lambda times out, orbit is left in incomplete state, user sees failure.

### Target State

Introduce **asynchronous job processing via Fargate** for long-running LLM operations while preserving Lambda for HTTP request handling and short tasks.

**New data flow:**
1. Frontend → API Gateway → Lambda HTTP handler
2. Lambda → **SQS queue** (enqueue job message, return 202 Accepted immediately)
3. **Fargate ECS task** → SQS (poll for messages)
4. Fargate → Bedrock API (can run for hours if needed)
5. Fargate → Aurora DSQL (update orbit status at milestones)
6. Fargate → S3 (store generated artifact)
7. Fargate → **Lambda notification function** (via direct invocation or shared SQS queue) → WebSocket API → Frontend

**Key architectural decisions:**
- **Lambda remains authoritative** — All API Gateway routes terminate at Lambda; Fargate has no inbound HTTP listeners
- **SQS as job queue** — Standard queue (300 msg/sec) or FIFO queue (3000 msg/sec with deduplication) depending on ordering requirements
- **Fargate runs in private subnets** — No public IP; egress via NAT Gateway; VPC endpoints for S3/Secrets Manager/CloudWatch reduce data transfer costs
- **DSQL as source of truth** — Orbit status transitions are atomic; Fargate updates status via prepared statements with optimistic locking
- **WebSocket connection ownership** — API Gateway manages connections; Lambda/Fargate can only send via `apigatewaymanagementapi:PostToConnection`; Fargate either invokes Lambda notification function or writes to shared notification queue

### Infrastructure Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React) — WebSocket connection to API Gateway      │
└─────────────────────────────────────────────────────────────┘
                            ↑ notifications
┌─────────────────────────────────────────────────────────────┐
│ API Gateway (HTTP + WebSocket)                               │
└─────────────────────────────────────────────────────────────┘
        ↓ HTTP requests            ↑ WebSocket sends
┌──────────────────────────────────────────────────────────────┐
│ Lambda (HTTP Handlers) ──→ SQS Queue                         │
│   - Validates request                                         │
│   - Enqueues job message                                      │
│   - Returns 202 Accepted                                      │
└──────────────────────────────────────────────────────────────┘
                            ↓ SQS message
┌──────────────────────────────────────────────────────────────┐
│ Fargate ECS Task (Job Worker)                                │
│   - Polls SQS                                                 │
│   - Calls Bedrock (long-running)                             │
│   - Updates DSQL orbit status                                │
│   - Writes artifacts to S3                                   │
│   - Invokes Lambda notification → WebSocket                  │
└──────────────────────────────────────────────────────────────┘
        ↓ reads/writes              ↓ stores
┌─────────────────┐          ┌─────────────────┐
│ Aurora DSQL     │          │ S3 Bucket       │
│ (orbit state)   │          │ (artifacts)     │
└─────────────────┘          └─────────────────┘
```

**Reference docs:**
- `docs/architecture/lambda-fargate-orchestration.md` (to be created)
- `docs/architecture/orbit-lifecycle.md` (existing — describes status transitions)
- `docs/infrastructure/aws-accounts.md` (existing — VPC, subnet, security group conventions)
- `.github/copilot-instructions.md` (existing — coding patterns)

---

## Pattern Library

### Conventions (follow these)

**Infrastructure as Code (CDK)**
- **Stack organization**: See `infrastructure/cdk/lib/` — each AWS service or logical grouping gets its own stack class (e.g., `VpcStack`, `FargateTaskStack`, `SqsQueueStack`)
- **Environment-specific configs**: See `infrastructure/cdk/config/` — dev/staging/prod configs as JSON; stacks read via `getConfig(env)`
- **IAM least privilege**: See `infrastructure/cdk/lib/iam-policies/` — task roles grant only the specific S3 prefixes, DSQL tables, and SQS queues the task needs
- **Resource naming**: All resources use `${projectName}-${env}-${resourceType}-${purpose}` format (e.g., `prometheus-prod-ecs-artifact-worker`)

**Fargate Task Patterns**
- **Container entry point**: See Node.js Lambda handlers in `services/api/src/handlers/` — similar structure but with SQS polling loop instead of Lambda runtime
- **Graceful shutdown**: Tasks must handle SIGTERM (15-second warning before ECS force-kills); flush logs, update orbit status to 'failed', delete SQS message
- **Environment variables**: Secrets (Bedrock API keys, DSQL credentials) via AWS Secrets Manager ARN references in task definition, not hardcoded
- **Logging**: Use `packages/observability/src/logger.ts` structured JSON logger; every log line includes `orbitId`, `intentId`, `taskId`, `phase`

**SQS Message Format**
- **Standard message envelope**: See `services/api/src/shared/sqs-client.ts` — all messages have `{ jobType, payload, metadata }` structure
- **Idempotency**: Include `idempotencyKey` (UUID v4) in metadata; Fargate checks DSQL for duplicate processing before starting
- **Visibility timeout**: Set to 2x expected max processing time (e.g., 60 minutes for artifact generation); prevents duplicate task execution
- **Dead-letter queue**: After 3 retries, message moves to DLQ; CloudWatch alarm triggers on DLQ depth > 0

**DSQL Orbit Status Updates**
- **Atomic transitions**: See `packages/core/src/entities/orbit.ts` — status changes use optimistic locking with `version` column
- **Actor tracking**: Every status update includes `actor` field (Lambda function ARN or Fargate task ARN) and `reason` text
- **Audit trail**: `orbit_history` table logs every transition with timestamp, old_status, new_status, actor, reason

**WebSocket Notifications**
- **Notification schema**: See `services/websocket/src/handlers/notify.ts` — all notifications have `{ type, orbitId, data }` structure
- **Connection ID lookup**: Query `websocket_connections` table in DSQL filtered by `userId` and `projectId`
- **Failure handling**: If `PostToConnection` fails with 410 (stale connection), delete connection record from database

**Bedrock Integration**
- **Retry logic**: See `packages/bedrock/src/client.ts` — exponential backoff for throttling errors (429); max 5 retries with jitter
- **Token counting**: Log input/output token counts to CloudWatch Logs for cost monitoring
- **Streaming disabled**: This intent does NOT implement streaming; wait for full response before processing

### Anti-patterns (avoid these)

- **Fargate as HTTP server**: Fargate tasks MUST NOT listen on HTTP ports; they are batch job workers, not web servers
- **SQS polling in Lambda**: Lambda should enqueue messages, not poll SQS; use Fargate for polling to avoid concurrent execution limits
- **Storing WebSocket connection IDs in Fargate memory**: Connection IDs must be persisted in DSQL or DynamoDB; tasks are ephemeral
- **Synchronous Bedrock calls from Lambda for large intents**: This is the anti-pattern being fixed; always route large jobs to Fargate
- **Hardcoded AWS service endpoints**: Use VPC endpoints or public endpoints via CDK config, not hardcoded URLs

---

## Prior Orbit References

### Completed

**T5-001: WebSocket connection management**
- Established `websocket_connections` table in DSQL with `userId`, `projectId`, `connectionId`, `connectedAt`
- Created Lambda function `services/websocket/src/handlers/notify.ts` for sending notifications
- Pattern: Lambda functions invoke notify handler with `{ userId, type, data }` payload
- **Key learning**: Connection IDs expire after 2 hours idle; cleanup job runs every 30 minutes to prune stale connections

**T4-002: Bedrock integration for artifact generation**
- Implemented `packages/bedrock/src/client.ts` with exponential backoff retry logic
- Defined prompt templates in `packages/bedrock/src/prompt-templates/intent-document.hbs`
- **Key learning**: Bedrock `anthropic.claude-3-sonnet` model has 100K context window; exceeded on large trajectories, required chunking strategy

**T3-005: Aurora DSQL orbit lifecycle**
- Created `orbit` table with `status` enum: `draft`, `in_progress`, `completed`, `failed`, `abandoned`
- Implemented optimistic locking with `version` column incremented on every update
- **Key learning**: Status transitions must be validated (can't go from `completed` to `in_progress`); see `packages/core/src/entities/orbit.ts` for state machine

**T2-001: S3 artifact storage structure**
- Artifacts stored at `s3://prometheus-artifacts-${env}/projects/${projectId}/trajectories/${trajectoryId}/intents/${intentId}/orbits/${orbitId}/artifacts/${artifactId}.md`
- Metadata stored in DSQL `artifacts` table with S3 key reference
- **Key learning**: Use presigned URLs for frontend downloads; artifacts are sensitive, bucket has no public access

### Known Issues

**Lambda timeout failures on large intents**
- Current issue: Intents with >50 acceptance criteria or >5 dependencies timeout during Intent Document generation
- Root cause: Bedrock API calls can take 8-12 minutes for complex prompts; Lambda 15-minute limit is hit when generating multiple artifacts sequentially
- **Mitigation in this intent**: Move artifact generation to Fargate with no timeout limit

**WebSocket connection staleness**
- Open issue: Connections sometimes remain in `websocket_connections` table after client disconnects without explicit `$disconnect` route call
- Workaround: Cleanup job prunes connections older than 2 hours
- **Impact on this intent**: Fargate must tolerate `PostToConnection` 410 errors (stale connection)

**SQS message size limit (256 KB)**
- Potential issue: Large intent payloads (with full trajectory context) may exceed SQS message size
- **Mitigation strategy**: If message payload > 200 KB, write full payload to S3 and include S3 key in SQS message body; Fargate fetches from S3

---

## Risk Assessment

### Infrastructure Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Fargate cold start exceeds 60 seconds** | Users wait >1 minute after enqueue before processing starts | Medium | Pre-provision 1 warm task in dev/staging; monitor cold start duration in CloudWatch; consider ECS Service with min tasks = 1 in prod |
| **NAT Gateway single point of failure** | All Fargate tasks lose Bedrock API access if NAT Gateway fails | Low | Use 2 NAT Gateways in separate AZs; ECS places tasks across AZs; test failover with chaos engineering |
| **VPC endpoint misconfiguration** | Fargate tasks can't reach S3/Secrets Manager/CloudWatch | Medium | CDK integration tests validate VPC endpoint creation; test tasks in isolated subnet without internet to confirm endpoint connectivity |
| **ECS cluster capacity exhaustion** | No available CPU/memory to launch new tasks during traffic spike | Low | Set ECS cluster with Fargate capacity providers autoscaling; CloudWatch alarm on DesiredTaskCount vs RunningTaskCount gap |

### Application Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **SQS message lost before Fargate processes** | Orbit stuck in `in_progress` without task running | Very Low | SQS durability guarantees 99.999999999%; enable SQS message retention = 14 days; DLQ captures failed messages after retries |
| **Fargate task OOM kills during large artifact generation** | Task dies mid-processing, orbit status not updated | Medium | Set task memory = 4 GB (double estimated peak usage); log memory usage every 30 seconds; CloudWatch alarm on OOMKilled event |
| **Duplicate task execution (SQS visibility timeout expires)** | Two Fargate tasks process same orbit, corrupting state | Low | Set visibility timeout = 2x max processing time (60 min); use DSQL optimistic locking on orbit updates; include idempotency key in SQS message |
| **Bedrock API throttling causes cascade failure** | Multiple tasks retry simultaneously, amplifying throttle | Medium | Preserve existing exponential backoff with jitter in `packages/bedrock/src/client.ts`; set max concurrent tasks = 10 in ECS service; rate-limit SQS polling in Fargate worker |
| **WebSocket notification fails (connection stale)** | User doesn't receive completion notification | Medium | Gracefully handle 410 errors; log failures to CloudWatch; send backup email notification if WebSocket fails |

### Data Integrity Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **DSQL transaction interrupted mid-commit** | Orbit status and artifact metadata out of sync | Very Low | Wrap DSQL updates in explicit transaction; retry on serialization failure; log transaction ID for audit |
| **S3 artifact write succeeds but DSQL update fails** | Orphaned artifact in S3, orbit thinks generation failed | Low | Write DSQL first (artifact record with status = `pending`), then S3, then update status = `completed`; background job reconciles orphans |
| **Fargate task terminated during Bedrock streaming** | Partial artifact stored in S3, orbit status unclear | Medium | Bedrock streaming NOT implemented in this intent; wait for full response before any writes; if task is terminated, SQS visibility timeout expires → retry from scratch |

### Security Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Fargate task IAM role over-privileged** | Compromised task can access unrelated S3 buckets or DSQL tables | Medium | Grant IAM task role access ONLY to specific S3 prefix (`projects/${projectId}/*`) and DSQL tables (`orbit`, `artifact`, `websocket_connections`); no wildcard permissions |
| **Secrets Manager credentials leaked in logs** | Bedrock API key or DSQL password exposed in CloudWatch Logs | Low | Use AWS Secrets Manager; never log secret values; redact credentials in `packages/observability/src/logger.ts` |
| **SQS message contains PII without encryption** | User data visible in SQS console or snapshots | Medium | Enable SQS server-side encryption (SSE-SQS); message payload contains only IDs (intentId, orbitId), not full intent content |

### Operational Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Fargate task runs indefinitely (infinite loop)** | Task never completes, blocks SQS message, costs accumulate | Low | Set ECS task `stopTimeout` = 90 minutes (hard kill); CloudWatch alarm on TaskRunningDuration > 60 min; circuit breaker terminates task after threshold |
| **CloudWatch Logs volume exceeds budget** | Verbose Fargate logging costs spike | Medium | Log structured JSON only; avoid debug-level logs in prod; set CloudWatch log retention = 7 days; sample 10% of trace logs |
| **Rollback fails (SQS queue has in-flight messages)** | Disabling Fargate leaves messages unprocessed, orbits stuck | Low | Document rollback procedure: stop Lambda from enqueuing new messages → drain SQS queue (process remaining messages) → disable Fargate service → revert Lambda code to process synchronously |

### Performance Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Lambda → SQS enqueue adds latency** | HTTP response time increases from 200ms to 500ms | Medium | Acceptable per acceptance boundary (<500ms); use AWS SDK v3 async send with Promise.all for parallel SQS writes |
| **Fargate task startup time unpredictable** | Some users wait 10 seconds, others wait 60 seconds | High | Monitor P50/P95/P99 cold start in CloudWatch; alert if P95 > 60 seconds; pre-pull container images to ECS instance cache |
| **DSQL optimistic locking causes high retry rate** | Multiple Fargate tasks updating same orbit collide | Low | Only one task should process one orbit (enforced by SQS message deduplication and idempotency key); log version conflicts for investigation |

---

**Monitoring and Observability Requirements**

Deploy these CloudWatch dashboards and alarms:

**Alarms:**
- SQS queue depth > 100 messages for >5 minutes (traffic spike or Fargate not keeping up)
- DLQ message count > 0 (failed jobs requiring manual investigation)
- Fargate task failure rate > 5% over 15-minute window
- WebSocket notification failure rate > 10% over 5-minute window
- DSQL connection pool exhaustion (all connections in use)

**Dashboards:**
- Lambda enqueue rate (messages/minute) vs Fargate task completion rate
- Fargate cold start duration (P50, P95, P99)
- Bedrock API call duration and token count per task
- Orbit status distribution (in_progress vs completed vs failed)
- Cost per orbit (Fargate vCPU-hours + Bedrock tokens + S3 PUT requests)

**X-Ray Tracing:**
- Link Lambda request ID → SQS message ID → Fargate task ID → Bedrock invocation ID
- Trace segments: `Lambda-Enqueue`, `SQS-Delivery`, `Fargate-Processing`, `Bedrock-Invocation`, `DSQL-Update`, `S3-Write`, `WebSocket-Notify`