# Context Package: T6-003 · Migrate long-running LLM tasks to Fargate

**Intent:** T6-003  
**Orbit:** 1  
**Package Type:** intent-specific  
**Generated:** 2025-02-17

---

## Codebase References

### Primary (will be modified or created)

**Lambda Functions:**
- `src/lambda/handlers/artifacts/generate.ts` — HTTP handler for artifact generation requests; will be modified to enqueue to SQS and return 202 with task_id
- `src/lambda/handlers/chat/message.ts` — HTTP handler for chat message submissions; will enqueue long operations to SQS
- `src/lambda/handlers/tasks/status.ts` — NEW: polling fallback endpoint for task status retrieval

**Fargate Task Definitions:**
- `infrastructure/fargate/tasks/artifact-generator/` — NEW: Fargate task definition, Dockerfile, and entrypoint for artifact generation
- `infrastructure/fargate/tasks/chat-processor/` — NEW: Fargate task definition, Dockerfile, and entrypoint for LLM chat operations
- `src/fargate/workers/artifact-worker.ts` — NEW: worker logic that polls SQS, processes messages, calls Bedrock, writes results to S3
- `src/fargate/workers/chat-worker.ts` — NEW: worker logic for extended chat sessions

**Shared Libraries:**
- `src/shared/queue/sqs-client.ts` — NEW: wrapper for SQS operations with retry logic and error handling
- `src/shared/storage/s3-results.ts` — NEW: S3 client for storing task results with pre-signed URL generation
- `src/shared/database/dsql/task-executions.ts` — NEW: DSQL repository for task status tracking
- `src/shared/websocket/notifications.ts` — wrapper for sending WebSocket events; will add task completion event types

**Infrastructure as Code:**
- `infrastructure/terraform/sqs.tf` — NEW: SQS queue definitions with DLQ, visibility timeout, retention
- `infrastructure/terraform/fargate-cluster.tf` — references T6-001 cluster, adds task definitions
- `infrastructure/terraform/iam-fargate-tasks.tf` — NEW: IAM roles/policies for Fargate to access SQS, S3, DSQL, Bedrock, WebSocket API
- `infrastructure/terraform/s3-task-results.tf` — NEW: S3 bucket for task results with encryption, lifecycle policies

### Secondary (dependencies and interfaces)

**Existing WebSocket Infrastructure:**
- `src/lambda/handlers/websocket/connect.ts` — connection management
- `src/lambda/handlers/websocket/disconnect.ts` — cleanup
- `src/shared/database/dynamodb/connections.ts` — connection table operations
- `src/shared/websocket/broadcast.ts` — message delivery to connected clients

**Existing Artifact Storage:**
- `src/shared/storage/s3-artifacts.ts` — artifact bucket conventions from T4-001
- `src/shared/models/artifact.ts` — artifact data model

**Existing LLM Integration:**
- `src/shared/llm/bedrock-client.ts` — Bedrock API wrapper
- `src/shared/llm/prompt-templates.ts` — reusable prompts for artifact generation

**Database Schemas:**
- `infrastructure/dsql/migrations/` — existing migration scripts
- `src/shared/database/dsql/schema.ts` — schema definitions

### Tests

- `tests/integration/lambda/artifacts/generate.test.ts` — existing tests for artifact generation endpoint
- `tests/integration/lambda/chat/message.test.ts` — existing tests for chat endpoint
- `tests/unit/shared/queue/sqs-client.test.ts` — NEW: test suite for SQS wrapper
- `tests/unit/fargate/workers/artifact-worker.test.ts` — NEW: test suite for Fargate worker logic
- `tests/e2e/task-lifecycle.test.ts` — NEW: end-to-end test for Lambda → SQS → Fargate → S3 → WebSocket flow

---

## Architecture Context

### System Overview

Prometheus V1 follows a serverless-first architecture with API Gateway → Lambda for synchronous HTTP operations and EventBridge/SQS for async workflows. The system stores structured data in Aurora DSQL (PostgreSQL-compatible) and artifacts in S3. WebSocket connections are managed via API Gateway WebSocket API with connection state in DynamoDB.

This intent introduces a **hybrid execution model**: Lambda handles HTTP ingress and orchestration; Fargate handles compute-intensive, long-running tasks. The pattern is:

```
Client → API Gateway → Lambda (auth, enqueue) → SQS → Fargate (process) → S3 (store) → WebSocket (notify)
                                     ↓
                                   DSQL (status tracking)
```

### Current State

- **Artifact generation** currently runs entirely in Lambda (`src/lambda/handlers/artifacts/generate.ts`), calling Bedrock synchronously and returning the generated artifact in the HTTP response body
- **Chat operations** stream responses via WebSocket but the LLM call happens in Lambda, limited to 15-minute max execution
- **No SQS integration** for user-facing operations; SQS is used only for internal event processing
- **No Fargate workloads** in production; T6-001 established the cluster but no tasks are deployed

### Integration Boundaries

**Authentication flow:** Lambda validates JWT (Cognito) → extracts user_id, org_id → includes in SQS message attributes → Fargate inherits context from message, does NOT re-authenticate

**State management:** DSQL is source of truth for task status; S3 stores results; WebSocket provides real-time updates; HTTP polling is fallback for disconnected clients

**Error handling:** SQS visibility timeout (30 min) exceeds Fargate task max runtime (25 min); tasks must either succeed, fail explicitly (with error in DSQL), or crash (SQS redelivers up to 3 times)

**Reference Docs:**
- `docs/architecture/serverless-patterns.md`
- `docs/architecture/websocket-notifications.md` (from T1-002)
- `docs/infrastructure/fargate-cluster.md` (from T6-001)

---

## Pattern Library

### Conventions (follow these)

**Lambda HTTP Handlers:**
- **Pattern:** Request validation → Business logic → Response
- **Example:** `src/lambda/handlers/intents/create.ts`
- **Convention:** Use Zod schemas for request validation; throw `HttpError` with status codes; return typed responses
- **Apply here:** Artifact and chat handlers validate request → enqueue to SQS → return `202 Accepted` with `{ task_id, status: "queued", poll_url }`

**SQS Message Envelope:**
- **Pattern:** Consistent message structure across all queues
- **Example:** See `src/shared/queue/event-publisher.ts` (EventBridge events)
- **Convention:** `{ id, type, timestamp, payload, metadata: { user_id, org_id, trace_id } }`
- **Apply here:** SQS messages carry same envelope; payload contains original request body; metadata includes auth context

**Fargate Worker Structure:**
- **Pattern:** Poll → Validate → Execute → Persist → Acknowledge
- **Example:** N/A (first Fargate worker in the system)
- **Convention:** Workers run in infinite loop; graceful shutdown on SIGTERM (drain current message, reject new); structured logging to CloudWatch
- **Apply here:** Worker polls SQS with long-polling (20s); processes message; updates DSQL with state transitions; writes result to S3; sends WebSocket notification; deletes message from SQS

**S3 Result Storage:**
- **Pattern:** Key structure: `{org_id}/{intent_id}/{orbit_id}/{task_id}/{artifact_type}.json`
- **Example:** `src/shared/storage/s3-artifacts.ts` (from T4-001)
- **Convention:** Metadata tags: `intent_id`, `orbit_id`, `created_at`; lifecycle policy deletes after 30 days
- **Apply here:** Results stored with 7-day pre-signed URL expiration; metadata includes task execution details

**DSQL Repository Pattern:**
- **Pattern:** One repository class per table; methods for CRUD + domain queries
- **Example:** `src/shared/database/dsql/intents-repository.ts`
- **Convention:** Use parameterized queries; return domain models (not raw rows); handle unique constraint violations gracefully
- **Apply here:** `TaskExecutionsRepository` with methods: `create()`, `updateStatus()`, `findById()`, `findByIntentId()`

**WebSocket Notification Events:**
- **Pattern:** Event types namespaced by domain; payload includes entity ID and action
- **Example:** `src/shared/websocket/notifications.ts` — `orbit.status.changed`, `artifact.generated`
- **Convention:** Event shape: `{ type, data: { id, ...payload }, timestamp }`
- **Apply here:** New event types: `task.queued`, `task.processing`, `task.completed`, `task.failed`

**Error Handling in Workers:**
- **Pattern:** Distinguish transient vs. permanent failures; only delete SQS message on permanent failure or success
- **Convention:** Wrap processing in try/catch; log error with context; update DSQL status to `failed` with error message; send failure notification
- **Apply here:** Bedrock throttling = transient (let SQS retry); invalid request payload = permanent (delete message, mark failed)

### Anti-Patterns (avoid these)

**Do not block Lambda on task completion** — Lambda must return immediately after enqueuing; waiting for Fargate to finish defeats the purpose and risks timeout

**Do not store task results in DSQL** — results can be large (multi-MB artifacts); DSQL is for metadata only; S3 is the result store

**Do not send entire result via WebSocket** — send notification with S3 key; client fetches via pre-signed URL; WebSocket is for signaling, not bulk data transfer

**Do not scale Fargate tasks manually** — use SQS-based autoscaling with target tracking (queue depth metric); manual scaling leads to over-provisioning or starvation

**Do not retry indefinitely** — 3 retries max (SQS DLQ after that); human intervention required for tasks in DLQ (via CloudWatch alarm → ops runbook)

**Do not assume WebSocket delivery** — client may disconnect during task execution; must support polling fallback via HTTP status endpoint

---

## Prior Orbit References

### T6-001 Orbit 2: Fargate Cluster Setup
- **Completed:** 2025-02-10
- **Relevance:** Established VPC configuration, ECS cluster, IAM roles for Fargate tasks
- **Key artifacts:** `infrastructure/terraform/fargate-cluster.tf`, `infrastructure/terraform/vpc.tf`
- **Lessons:** Use private subnets with NAT gateway for Fargate tasks; enable CloudWatch Container Insights for monitoring
- **Apply here:** Reference existing cluster ARN; add task definitions to same cluster

### T6-002 Orbit 1: SQS Queue Provisioning
- **Completed:** 2025-02-12
- **Relevance:** Created SQS queues with DLQ, visibility timeout, encryption at rest
- **Key artifacts:** `infrastructure/terraform/sqs.tf`, `docs/runbooks/sqs-dlq-handling.md`
- **Lessons:** Visibility timeout must exceed max task runtime + network buffer (set to 30 min for 25 min max task)
- **Apply here:** Reuse queue naming convention; ensure message retention = 14 days (intent constraint)

### T1-002 Orbit 3: WebSocket Async Notifications
- **Completed:** 2024-11-20
- **Relevance:** Established pattern for notifying clients of long-running operations via WebSocket
- **Key artifacts:** `src/shared/websocket/notifications.ts`, `src/shared/database/dynamodb/connections.ts`
- **Lessons:** Always implement polling fallback; WebSocket delivery is best-effort (clients disconnect, connections expire after 2 hours)
- **Apply here:** Extend notification types; reuse connection management; add HTTP status endpoint for polling

### T4-001 Orbit 2: Artifact Storage Conventions
- **Completed:** 2024-12-15
- **Relevance:** Defined S3 bucket structure, key naming, metadata tagging for artifacts
- **Key artifacts:** `src/shared/storage/s3-artifacts.ts`, `infrastructure/terraform/s3-artifacts.tf`
- **Lessons:** Use consistent key structure for discoverability; add lifecycle policies to prevent unbounded storage growth
- **Apply here:** Follow same key structure for task results; 7-day expiration for pre-signed URLs (shorter than artifact URLs to limit exposure)

---

## Risk Assessment

### Risk: SQS message loss on Fargate task crash
**Impact:** User loses task progress; no retry happens; appears as stuck "processing" forever  
**Likelihood:** Medium (unhandled exceptions, OOM kills, network partition during write)  
**Mitigation:**
- Set SQS visibility timeout > max task runtime (30 min for 25 min tasks)
- Implement graceful shutdown handler (catch SIGTERM, finish current message, reject new)
- Update DSQL status atomically before deleting SQS message (ordering: persist → notify → delete)
- DLQ alarm triggers after 5 messages → ops runbook for manual recovery

### Risk: Fargate cold start delays
**Impact:** Users perceive tasks as "stuck" when Fargate scales from 0 → 1; breach 30-second cold start constraint  
**Likelihood:** High on initial deploy; medium ongoing (depends on traffic patterns)  
**Mitigation:**
- Pre-warm 1 Fargate task during deployment (min capacity = 1 for first 24 hours)
- Set SQS autoscaling to scale up aggressively (target: queue depth > 5 → +1 task immediately)
- Add CloudWatch alarm: if task start latency p95 > 30s for 5 minutes → page on-call
- Optimize Docker image: multi-stage build, cache dependencies, minimize layers

### Risk: Unbounded Fargate autoscaling cost
**Impact:** Bug causes queue to fill infinitely; Fargate scales to max (10 tasks); unexpected AWS bill  
**Likelihood:** Low (requires sustained high error rate or circular enqueue bug)  
**Mitigation:**
- Set hard max capacity = 10 tasks (intent constraint: $50/month baseline)
- Add AWS Budget alert: if projected monthly cost > $100 → alert engineering
- Implement circuit breaker in Lambda: if enqueue fails 3 times in 1 minute → reject requests with 503
- Monitor queue depth: if > 100 messages for 10 minutes → alarm (investigate backlog cause)

### Risk: S3 pre-signed URL expiration before user retrieves result
**Impact:** User completes long task, receives notification, but URL expired; appears as "result lost"  
**Likelihood:** Low (7-day expiration; intent states user must retrieve within window)  
**Mitigation:**
- Document URL expiration in API response: `{ result_url, expires_at }`
- Log retrieval attempts (S3 access logs) to detect expiration issues in production
- Store task result S3 key in DSQL; allow regenerating pre-signed URL via `/tasks/{id}/result-url` endpoint
- Frontend shows warning 24 hours before expiration: "Download result soon"

### Risk: WebSocket connection drops during task execution
**Impact:** User misses completion notification; perceives task as stalled; no UI update  
**Likelihood:** High (mobile networks, laptop sleep, 2-hour connection timeout)  
**Mitigation:**
- Implement polling fallback: frontend polls `/tasks/{task_id}/status` every 5 seconds if WebSocket disconnected
- DSQL `task_executions` table is source of truth; always queryable via HTTP
- Frontend reconnects WebSocket on page focus / network restore
- Send notification to ALL active connections for user (not just originating connection)

### Risk: Fargate task exceeds 25-minute runtime without completion
**Impact:** Task killed by ECS; SQS message becomes visible again; retry loop without progress  
**Likelihood:** Medium (Bedrock API slowness, large artifact generation, prompt engineering bugs)  
**Mitigation:**
- Implement timeout guard in worker: if processing exceeds 24 minutes → save partial progress to S3, mark as failed with "timeout" reason
- Add Bedrock call timeout (5 min per API call); fail fast on unresponsive LLM
- Log task duration to CloudWatch; alert if p95 > 20 minutes (investigate before hitting limit)
- Chunk large operations: split multi-artifact generation into separate tasks

### Risk: DSQL transaction lock on high-concurrency status updates
**Impact:** Fargate workers block on `updateStatus()` calls; task throughput degrades  
**Likelihood:** Low at current scale; medium if >50 concurrent tasks  
**Mitigation:**
- Use optimistic locking: `UPDATE task_executions SET status = $1 WHERE id = $2 AND status = $3` (prevents stale writes)
- Index on `task_id` + `status` for fast lookup
- Avoid long transactions: update status in separate txn from result write
- Monitor query latency: if DSQL `UPDATE` p95 > 100ms → investigate lock contention

### Risk: Auth context lost between Lambda and Fargate
**Impact:** Fargate task cannot enforce row-level security; wrong user's data accessible  
**Likelihood:** Medium (requires correct SQS message attribute passthrough and Fargate validation)  
**Mitigation:**
- Lambda MUST include `user_id`, `org_id`, `trace_id` in SQS message attributes (not body)
- Fargate MUST validate presence of auth attributes before processing; reject message if missing
- Add integration test: enqueue task as User A → verify Fargate cannot access User B's data
- Log auth context in every worker log line (correlation for security audits)

### Risk: Bedrock API throttling or quota exhaustion
**Impact:** Fargate tasks fail with rate limit errors; user sees failures; SQS retry storm  
**Likelihood:** Medium (depends on org-level Bedrock quota and concurrent task count)  
**Mitigation:**
- Implement exponential backoff in Bedrock client: 3 retries with jitter (1s, 4s, 16s)
- Request Bedrock quota increase before production launch (document current limits in runbook)
- Add CloudWatch alarm: if Bedrock 429 responses > 10 in 5 minutes → page on-call
- Consider per-user rate limiting in Lambda: reject enqueue if user has >5 active tasks