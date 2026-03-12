# T6-003 · Migrate long-running LLM tasks to Fargate

## Desired Outcome

Long-running AI operations — artifact generation, extended chat sessions, and multi-turn LLM workflows — complete reliably without Lambda timeout failures. Users experience uninterrupted AI interactions through WebSocket notifications, while the backend scales elastically to handle variable workload durations without degrading API responsiveness or consuming Lambda concurrency limits.

The system transitions from a synchronous, Lambda-bound execution model to an asynchronous, queue-driven architecture where HTTP endpoints remain fast and responsive while Fargate handles computationally intensive work in the background.

## Constraints

- **Lambda migration boundary:** Only operations exceeding 15 minutes or requiring persistent connections move to Fargate. Sub-minute operations remain on Lambda to minimize cold start overhead.
- **Backward compatibility:** Existing API contracts (request/response shapes, status codes, error formats) must not break. Clients must not require changes to accommodate the async pattern.
- **Security posture:** Fargate tasks inherit least-privilege IAM roles. No credentials in environment variables. Secrets retrieved from AWS Secrets Manager at runtime.
- **Cost envelope:** Fargate task definitions must target t4g.small equivalent compute. No provisioned capacity — scale from zero.
- **Observability floor:** All Fargate tasks emit structured logs to CloudWatch with correlation IDs. Execution traces link SQS message → task → S3 result → WebSocket event.
- **Non-goals:** This intent does NOT migrate database queries, file uploads, or authentication flows to Fargate. Those remain Lambda-native.

## Acceptance Boundaries

### Functional Boundaries

- **Artifact generation completes:** A user requests an Intent Document artifact via API. Within 30 seconds, they receive a `202 Accepted` response with a job ID. Within 5 minutes [inferred], a WebSocket event delivers the artifact URL (S3 presigned link). The artifact content matches the schema defined in the Intent Agent system prompt.
- **Chat continuity preserved:** A user initiates a multi-turn AI chat. Messages exceeding 2 minutes of LLM processing time are offloaded to Fargate. The user sees typing indicators and receives responses via WebSocket without frontend polling or timeout errors.
- **Queue depth observable:** SQS queue depth and Fargate task count are exposed via CloudWatch metrics. A dashboard visualizes pending jobs, active tasks, and task duration histogram.

### Performance Boundaries

- **API latency unchanged:** `POST /intents/{id}/artifacts` responds in <500ms (p99), matching current Lambda-only performance.
- **Task startup latency:** Fargate tasks begin processing within 60 seconds of SQS message arrival [inferred].
- **WebSocket delivery latency:** Result notification reaches connected clients within 2 seconds of S3 write completion.

### Reliability Boundaries

- **Retry and dead-letter handling:** Failed Fargate tasks (non-zero exit code or timeout) trigger SQS message redelivery. After 3 retries, messages move to a dead-letter queue with alerting.
- **Graceful degradation:** If Fargate task capacity is exhausted, new requests queue in SQS without API failures. Queue age alerts fire at 10 minutes.
- **Idempotency guarantee:** Duplicate SQS deliveries (due to retries or at-least-once semantics) do not create duplicate artifacts or charge duplicate LLM API calls. Job IDs are deduplication keys.

### Security Boundaries

- **IAM role isolation:** Fargate task role has read/write to specific S3 prefixes and DSQL tables only. No cross-intent data access.
- **Secrets rotation compatible:** Bedrock API keys (if not using IAM-based auth) are fetched from Secrets Manager on task start, not baked into images.
- **Network segmentation:** Fargate tasks run in private subnets with egress-only internet access via NAT Gateway for Bedrock API calls. No inbound internet exposure.

### Operational Boundaries

- **Zero manual scaling:** Fargate auto-scales based on SQS queue depth. No capacity planning or reserved instances required.
- **Cost visibility:** CloudWatch metrics break down Fargate compute cost per intent type. Monthly spend stays under $50 at current trajectory volume [inferred].
- **Rollback safety:** If Fargate tasks fail >50% of jobs over 10 minutes, automatic rollback to Lambda-based artifact generation (with timeout warnings) activates.

## Trust Tier Assignment

**Tier 2 — Supervised**

### Rationale

This intent modifies the execution path of revenue-adjacent workflows (AI artifact generation) and introduces new failure modes (queue delays, Fargate task crashes) that could degrade user experience across multiple sessions. While the blast radius is contained to async operations (synchronous API paths remain unchanged), the introduction of SQS as a message bus and Fargate as a runtime requires human review of:

1. **IAM role definitions** — Overly permissive task roles could leak data across intents or projects.
2. **Retry and DLQ configuration** — Misconfigured retries could amplify LLM API costs or create infinite loops.
3. **WebSocket notification payload** — Incorrectly formatted events could break frontend rendering or expose internal job metadata.

The tier is NOT 3 (Gated) because:

- The change does not touch authentication, billing, or PII storage.
- Rollback is automated via feature flags and metric-based cutover.
- The existing Lambda-based flow remains operational as a fallback.

Supervised approval ensures the AI-proposed infrastructure code (Terraform for Fargate, SQS, CloudWatch alarms) is reviewed for security and cost implications before deployment, while allowing autonomous iteration on task container logic and queue processing behavior within those boundaries.

## Dependencies

### Upstream Dependencies

- **WebSocket infrastructure (T6-002):** Fargate tasks must emit events to API Gateway WebSocket connections. If T6-002 is incomplete, fallback to polling or email notifications is required.
- **DSQL schema for job tracking:** A `jobs` table must exist with columns: `job_id`, `intent_id`, `status`, `created_at`, `completed_at`, `result_s3_key`. If the schema is missing, Fargate tasks cannot persist status updates.
- **S3 bucket for artifacts:** The `prometheus-artifacts-{env}` bucket must exist with lifecycle policies (30-day expiration for draft artifacts). Fargate tasks write generated artifacts here.

### Downstream Dependencies

- **Frontend polling removal (future):** Once Fargate + WebSocket are stable, the frontend can remove HTTP polling for artifact status. This is a follow-on optimization, not blocking.
- **Cost monitoring dashboard:** A CloudWatch dashboard showing Fargate task duration, SQS queue depth, and per-intent cost breakdown should be created post-deployment to inform future capacity planning.

### External Dependencies

- **Amazon Bedrock API availability:** Fargate tasks call Bedrock for LLM completions. If Bedrock throttles or returns 5xx errors, tasks must retry with exponential backoff and respect service quotas.
- **AWS Secrets Manager:** Task startup depends on Secrets Manager API availability to fetch Bedrock credentials (if not using IAM roles). Secrets Manager outages delay task execution but do not crash the API.

### Prior Orbit Context

- **Orbit Reference:** This is Orbit 1 for Intent T6-003. No prior orbit learnings exist. Baseline Lambda-based artifact generation lives in `backend/api/artifacts/generate.js` (not present in the provided repo structure but implied by the intent description).