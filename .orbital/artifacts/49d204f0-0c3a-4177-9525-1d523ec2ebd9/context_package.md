# Context Package: Establish Modular ORBITAL Artifact Generation Pipeline

## Codebase References

### Existing Artifact Structure
The repository contains a mature `.orbital/artifacts/` directory with 20+ completed orbit artifact sets, demonstrating the established pattern:

- `.orbital/artifacts/{orbit-uuid}/intent_document.md` — User intent and acceptance criteria
- `.orbital/artifacts/{orbit-uuid}/context_package.md` — Codebase briefing and architecture
- `.orbital/artifacts/{orbit-uuid}/proposal_record.md` — AI-generated implementation plan
- `.orbital/artifacts/{orbit-uuid}/verification_protocol.md` — Quality gates and traceability (present in 3 orbits: `8e4f5eb6`, `936de41c`, `b14a714d`)

### Reference Implementations
Examine these complete artifact sets for schema patterns:

- `b14a714d-5c4c-45e1-aca8-69a33dac3386/` — Full 4-document orbit with verification protocol
- `936de41c-48ed-4831-86b6-87b65f5533aa/` — Complete orbit demonstrating cross-document consistency
- `8e4f5eb6-3b34-45e2-9692-8ee121327058/` — Another complete reference implementation

### Application Code Structure
The repository follows a backend-focused architecture:

- `backend/api/properties/search.js` — API endpoint implementation (Node.js/Express pattern)
- `backend/database/queries/property-search.sql` — SQL query definitions (suggesting PostgreSQL or similar RDBMS)
- `README.md` — Minimal documentation (1 paragraph + bot-generated content marker)

### Missing Infrastructure Components
Notable gaps that the pipeline will need to create or integrate with:

- No visible pipeline orchestration code (Lambda, Step Functions, or equivalent)
- No database schema files (DDL for `orbits`, `artifacts`, `repository_contexts` tables)
- No Bedrock API integration modules
- No artifact validation schemas (JSON Schema, Zod, or equivalent)
- No error handling or retry logic implementations

## Architecture Context

### ORBITAL Methodology Flow
Based on artifact evidence, the system follows this sequence:

1. **Intent Capture** → Engineer or system generates Intent Document defining desired outcome
2. **Context Assembly** → Agent analyzes codebase and produces Context Package
3. **Proposal Generation** → Agent creates implementation plan as Proposal Record
4. **Verification Definition** → Agent defines quality gates as Verification Protocol
5. **Execution** → (Not visible in this repo; likely separate execution pipeline)
6. **Validation** → (Not visible; presumably uses Verification Protocol)

### Data Flow for Artifact Generation
The Intent Document establishes that the pipeline must:

1. Retrieve orbit metadata from ORBITAL database (`orbit_id`, `intent_id`, `trajectory_id`)
2. Fetch repository structure via GitHub API (file tree, key file contents)
3. Query artifact history for prior orbit context
4. Invoke Bedrock Converse API in single session with 4 sequential calls
5. Store generated artifacts as markdown files in `.orbital/artifacts/{orbit-uuid}/`
6. Update database artifact records with status and file paths

### Service Boundary Assumptions
Based on constraints and dependencies:

- **ORBITAL Database** — Postgres or compatible RDBMS with transaction support for artifact status tracking
- **GitHub Integration** — Read-only API access; no webhooks or branch protection changes
- **Bedrock Converse API** — AWS service requiring IAM role with `bedrock:InvokeModel` permissions
- **Storage** — Artifacts persisted to Git repository (not S3 or database BLOB storage)

### Session Continuity Architecture
The Intent Document specifies single Bedrock session across 4 phases:

```
Session Start
  ├─ Phase 1: Generate Intent Document (15s budget)
  ├─ Phase 2: Generate Context Package (25s budget) + Pass Intent as context
  ├─ Phase 3: Generate Proposal Record (30s budget) + Pass Intent + Context as context
  └─ Phase 4: Generate Verification Protocol (20s budget) + Pass all 3 prior artifacts as context
Session End
```

This implies:
- Session token must persist across invocations (not stateless REST calls)
- Cumulative context grows from ~5K tokens (phase 1) to ~20K tokens (phase 4)
- Failure in any phase may invalidate the entire session (requires rollback strategy)

## Pattern Library

### Artifact Naming Convention
All existing artifacts follow UUID-based directory naming:

```
.orbital/artifacts/{uuid}/
  ├─ intent_document.md
  ├─ context_package.md
  ├─ proposal_record.md
  └─ verification_protocol.md  # Optional, present in 15% of orbits
```

**Pattern Rule**: UUIDs are lowercase with hyphens (RFC 4122 format). Filenames use snake_case. No version suffixes (e.g., `_v2.md`) — Git history provides versioning.

### Markdown Document Structure
Inspection of existing artifacts reveals consistent patterns:

- **Top-level heading**: `# {Document Type}: {Intent Title}`
- **Second-level headings**: Required sections per document schema
- **Tables**: Used for acceptance criteria, risk matrices, verification checklists
- **Code blocks**: Fenced with language hints (```sql, ```javascript, ```bash)
- **Lists**: Unordered (`-`) for enumerations, ordered (`1.`) for procedures
- **Bold emphasis**: For constraint types (`**Performance Budget**`), not general emphasis

### Error Handling Pattern
The Intent Document specifies "graceful partial failure handling without corrupting state." Examining the artifact directory shows:

- No `.partial` or `.draft` suffixes on incomplete artifacts
- Some orbits have only 2-3 documents (e.g., `8b01ff68` has only `intent_document.md`)
- Implies atomic writes: either a document is complete and present, or absent entirely

**Inferred Pattern**: 
```
1. Write artifact to temporary location (.orbital/tmp/{orbit-uuid}/{doc-type}.md)
2. Validate against schema
3. Atomic move to final location
4. Update database artifact record
5. On failure: log error, leave temporary file for debugging, do not update database
```

### Cross-Document Referencing
From complete orbit sets (e.g., `b14a714d`):

- Context Package references specific files from Intent's scope
- Proposal Record references constraints from Intent by name (e.g., "per the **Performance Budget** constraint")
- Verification Protocol traces checks back to Intent's acceptance criteria table rows

**Anti-pattern**: Do not copy/paste entire sections between documents. Use referential phrases like "as defined in Intent Document §Acceptance Boundaries" or "addresses the architectural constraint regarding session continuity."

## Prior Orbit References

### Artifact Schema Evolution
The presence of Verification Protocols in only 3 orbits (`8e4f5eb6`, `936de41c`, `b14a714d`) suggests:

- **Early orbits** (most in the directory) predate the 4-document standard
- **Recent orbits** (with verification protocols) represent current methodology
- **Schema Migration**: No evidence of retroactive updates to old orbits

**Implication for this orbit**: The pipeline must generate all 4 documents for new orbits but should not attempt to backfill missing verification protocols for existing orbits (per the Intent's non-goal on version control).

### Incomplete Orbit Evidence
Orbit `8b01ff68-8c60-450f-84ed-421f536a8d98` contains only an Intent Document. Possible causes:

1. Pipeline failure during Context Package generation
2. Manual abort by engineer after reviewing intent
3. Dependency blocker discovered during context analysis

**No error logs or `.failed` markers** — suggests the current system may lack error transparency (directly addresses Intent's acceptance criteria on "Error Transparency").

### Related Domain Work
Several orbit UUIDs suggest prior work on ORBITAL infrastructure:

- Orbits in `backend/api/` and `backend/database/` indicate API and database work
- No visible orbits for "artifact generation" or "pipeline" — **this is foundational work**
- The `.orbital/artifacts/` directory itself may have been created by an earlier orbit (not tracked in this repo)

### Pattern Consistency Across Orbits
All 20+ artifact sets use identical document naming and directory structure, indicating:

- Strong organizational discipline OR
- Existing tooling that enforces the naming convention

**Risk**: If the current system auto-generates directory names, the new pipeline must match this behavior exactly to avoid duplicate or conflicting artifact paths.

## Risk Assessment

### Risk 1: Bedrock Session Token Exhaustion
**Likelihood**: Medium | **Impact**: High

**Description**: The Intent specifies cumulative context reaching 15-20K tokens by phase 4. Bedrock Converse API has model-specific context windows (e.g., Claude 3 Sonnet: 200K tokens, Claude 3 Haiku: 200K tokens). However, session management overhead, system prompts, and malformed context could push token usage higher than estimated.

**Indicators**:
- Session fails at phase 3 or 4 with token limit errors
- Generated artifacts truncate mid-sentence
- Model responses become incoherent (hallucination from context overflow)

**Mitigations**:
- Implement token counting before each phase invocation
- Fail fast if projected total exceeds 180K tokens (90% of 200K window)
- Strip non-essential context (e.g., full file contents) and retain only file paths + summaries
- Use Claude 3.5 Sonnet (200K window) rather than smaller models

### Risk 2: Cross-Document Terminology Drift
**Likelihood**: High | **Impact**: Medium

**Description**: The Intent requires "terminology and scope align across all 4 documents." Without explicit guardrails, the AI agent may introduce synonyms (e.g., "REST API" in Intent becomes "HTTP endpoints" in Proposal). This breaks traceability and confuses engineers.

**Indicators**:
- Verification Protocol references acceptance criteria that don't match Intent wording
- Proposal Record discusses files not mentioned in Context Package
- Engineers flag inconsistencies during review

**Mitigations**:
- Include explicit instruction in each phase: "Use exact terminology from prior artifacts"
- Pass a term glossary forward through phases (extract key terms from Intent, enforce in subsequent docs)
- Post-generation validation: keyword matching across documents (e.g., if Intent says "Performance Budget," all docs must use that exact phrase)

### Risk 3: GitHub API Rate Limiting
**Likelihood**: Medium | **Impact**: Medium

**Description**: Retrieving repository structure and file contents requires multiple GitHub API calls. Unauthenticated requests have 60 calls/hour limit; authenticated have 5,000/hour. High-frequency orbit generation (e.g., 10 engineers creating orbits simultaneously) could exhaust quota.

**Indicators**:
- Context Package generation fails with 403 Forbidden or 429 Too Many Requests
- Artifacts reference outdated file trees (cache staleness)

**Mitigations**:
- Use authenticated GitHub API with dedicated service account
- Implement request caching (TTL: 5 minutes) for repository structure
- Queue orbit requests if rate limit approaching (throttle to 80% of quota)
- Surface clear error messages: "GitHub API rate limit exceeded; retry in 15 minutes"

### Risk 4: Database Transaction Deadlocks
**Likelihood**: Low | **Impact**: High

**Description**: If multiple orbits generate artifacts concurrently and update the `artifacts` table, database deadlocks may occur (especially with foreign key constraints to `orbits` table). The Intent's constraint on "not corrupting database state" makes this critical.

**Indicators**:
- Artifact records missing from database despite files existing in Git
- Database logs show deadlock errors during artifact creation
- Inconsistent artifact counts between database and `.orbital/artifacts/` directory

**Mitigations**:
- Use row-level locking (`SELECT ... FOR UPDATE`) when querying orbit metadata
- Implement exponential backoff retry (3 attempts) for database writes
- Write artifacts to Git *before* updating database (Git is source of truth; database is index)
- Ensure `artifacts` table has index on `orbit_id` to prevent full table scans

### Risk 5: Artifact Schema Validation Failure
**Likelihood**: Medium | **Impact**: Medium

**Description**: The Intent requires "Schema Compliance" but the repository shows no validation schemas. If agents generate documents with missing sections or malformed tables, downstream tools may fail to parse them.

**Indicators**:
- Engineers manually fix artifacts after generation
- Parsing errors in CI/CD pipelines that consume artifacts
- Inconsistent section headings across artifact types

**Mitigations**:
- Define JSON Schema or Zod schemas for each document type (validate structure, not content quality)
- Run validation after each phase before persisting artifact
- If validation fails: log schema violation details, retry generation with explicit schema hints in prompt
- Store validation failures in database for audit trail (per Intent's "Error Transparency" criterion)

### Risk 6: Partial Failure Recovery Complexity
**Likelihood**: High | **Impact**: Medium

**Description**: The Intent requires graceful handling of partial failures (e.g., Context Package fails but Intent succeeded). Without clear recovery strategy, the system may leave orphaned Intent Documents or attempt to restart from phase 1, wasting Bedrock API calls.

**Indicators**:
- Orbits stuck in "generating" status indefinitely
- Duplicate artifact directories for same orbit UUID
- Engineers manually trigger regeneration, bypassing pipeline

**Mitigations**:
- Persist phase completion markers in database (`artifacts` table: `intent_generated_at`, `context_generated_at`, etc.)
- Implement resume capability: if orbit has Intent but no Context, restart from phase 2 (not phase 1)
- Set maximum retry limit per phase (3 attempts) before marking orbit as "failed"
- Provide manual "force regenerate" command that clears all artifacts and restarts from phase 1