# Implement Artifact Generation Endpoints

## Desired Outcome

When an orbit reaches a phase transition point in the ORBITAL framework, the system automatically generates the corresponding phase artifact using AI-powered analysis of the entity hierarchy context. Engineers can request artifact generation through REST endpoints, receive structured ORBITAL artifacts (Intent Documents, Context Packages, Proposal Records, Verification Protocols, Orbit Logs, Trust Tier Policies) that conform to framework specifications, and retrieve them with full versioning and provenance tracking. This establishes the foundation for the AI-native development loop where artifacts drive decision-making and verify outcomes across the entire software lifecycle.

## Constraints

- **Framework Compliance**: All generated artifacts MUST conform to ORBITAL artifact specifications exactly as defined in system prompts (no invented structure or sections)
- **Data Sovereignty**: Artifacts stored in S3 with encryption at rest (AWS KMS); metadata in Aurora DSQL for transactional consistency; no artifact content in database tables
- **LLM Context Window**: Artifact generation requests MUST NOT exceed AWS Bedrock Claude Sonnet 4 context limits (200K tokens); implement context pruning strategy if entity hierarchy exceeds budget
- **Idempotency**: Repeated generation requests for the same orbit/phase MUST create new versions, not overwrite existing artifacts
- **Backward Compatibility**: Endpoints MUST NOT break existing Prometheus V1 API contracts; new routes only
- **Error Transparency**: LLM failures, context assembly errors, and storage failures MUST surface with actionable error messages (no silent failures or generic 500s)
- **Non-Goals**: Not implementing artifact editing, human-in-the-loop review workflows, or multi-artifact comparison — generation and retrieval only

## Acceptance Boundaries

**Artifact Generation Accuracy**
- Generated artifacts match ORBITAL specifications with 100% structural compliance (all required sections present, no hallucinated sections)
- Context assembly includes full entity hierarchy (project → trajectory → intent → orbit) with all relevant metadata
- Artifact type selection correctly maps orbit phase to artifact kind (intent → Intent Document, context → Context Package, etc.)

**API Performance**
- Generation endpoint responds within 30 seconds for typical context sizes (≤50K tokens)
- Retrieval endpoint responds within 500ms for artifact metadata queries
- S3 presigned URL generation completes within 200ms

**Data Integrity**
- Artifact versions increment correctly (v1, v2, v3...) for regeneration requests
- Metadata records in Aurora DSQL include: artifact_id, orbit_id, artifact_type, version, s3_key, generated_at, token_count, generation_duration_ms
- S3 keys follow convention: `artifacts/{project_id}/{trajectory_id}/{intent_id}/{orbit_id}/{artifact_type}/v{version}.md`

**Error Handling**
- LLM timeout (>30s) returns 408 with retry guidance
- Context exceeds token budget returns 413 with pruning suggestions
- Invalid orbit phase returns 400 with valid phase list
- S3 upload failure triggers automatic retry (3 attempts) before returning 500

**Integration Points**
- POST `/api/v1/orbits/{orbit_id}/artifacts/generate` accepts `artifact_type` parameter
- GET `/api/v1/orbits/{orbit_id}/artifacts` returns list of all artifact versions for orbit
- GET `/api/v1/artifacts/{artifact_id}` returns metadata + presigned S3 URL (15min expiry)
- Bedrock integration uses existing LLM service abstraction (no direct AWS SDK calls in endpoint handlers)

## Trust Tier Assignment

**Tier 3: Gated**

This intent operates at tier 3 (gated human approval) because:

1. **Production Data Blast Radius**: Introduces new S3 storage patterns and Aurora DSQL schema changes that affect artifact provenance across all future orbits — mistakes corrupt the audit trail permanently
2. **AI Output Validity**: Generated artifacts become the source of truth for downstream decision-making; malformed artifacts (wrong structure, hallucinated content, missing context) cascade into incorrect proposals, failed verifications, and broken orbits
3. **Cost Exposure**: Unbounded LLM token consumption without proper context budget enforcement could exhaust AWS Bedrock quotas or generate unexpected costs (200K token requests at scale)
4. **Framework Foundational**: This is the first AI-integrated endpoint in Prometheus V1 — it establishes patterns (context assembly, prompt engineering, error handling) that all future AI features will inherit; errors here propagate architecturally

A tier 2 (supervised) assignment would be appropriate only after: artifact schema validation is battle-tested in staging, context pruning algorithm is proven, and cost monitoring/alerts are operational.

## Dependencies

**Internal Systems**
- Existing entity hierarchy services (Projects, Trajectories, Intents, Orbits APIs) for context assembly
- LLM service abstraction layer (`LLMService` interface) already implemented in T2-001
- S3 bucket provisioned with encryption and lifecycle policies configured
- Aurora DSQL `artifacts` table schema deployed (includes: id, orbit_id, artifact_type, version, s3_key, metadata JSONB, created_at, token_count)

**External Services**
- AWS Bedrock access with Claude Sonnet 4 model enabled in us-east-1 region
- IAM role permissions: `bedrock:InvokeModel`, `s3:PutObject`, `s3:GetObject`, `kms:Decrypt`, `kms:GenerateDataKey`

**Artifact Specifications**
- ORBITAL system prompts defining Intent Document, Context Package, Proposal Record, Verification Protocol, Orbit Log, and Trust Tier Policy structure (already documented in knowledge base)

**Prior Orbits**
- T2-001 Orbit 1 (completed): AWS Bedrock integration via Converse API — provides `LLMService.generateText()` method and error handling patterns
- T1-002 Orbit 1 (completed): Aurora DSQL integration — establishes database connection pooling and transaction patterns