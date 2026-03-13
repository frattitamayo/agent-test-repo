# Proposal Record: Establish Modular ORBITAL Artifact Generation Pipeline

## Interpreted Intent

The ORBITAL system currently generates artifacts inconsistently, with evidence of incomplete orbits (e.g., `8b01ff68` containing only an Intent Document) and limited Verification Protocol coverage (only 3 of 20+ orbits). This orbit establishes a production-grade pipeline that generates all four ORBITAL artifacts—Intent Document, Context Package, Proposal Record, and Verification Protocol—through specialized agent invocations within a single AWS Bedrock Converse API session.

The pipeline must achieve 95% success rate (target) for complete 4-document generation, execute within 90 seconds total, maintain cross-document terminology consistency, and gracefully handle partial failures without corrupting the ORBITAL database or Git repository. The system integrates with existing database schema (`orbits`, `artifacts`, `repository_contexts` tables) and follows established artifact naming conventions (`.orbital/artifacts/{uuid}/{document_type}.md`).

This is foundational infrastructure work—not a feature for end users but critical tooling that enables autonomous orbit execution. Success means engineers receive complete, internally consistent artifact sets without manual document completion or terminology alignment fixes.

## Implementation Plan

### Phase 1: Database Schema Extension (Files: `backend/database/schema/artifact_generation.sql`)

Create database structures to track multi-phase generation state:

```sql
-- Extend artifacts table with phase tracking columns
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS generation_phase VARCHAR(50);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMP;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS phase_completed_at TIMESTAMP;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS error_context JSONB;

-- Add index for phase state queries
CREATE INDEX IF NOT EXISTS idx_artifacts_phase_status 
  ON artifacts(orbit_id, generation_phase, phase_completed_at);

-- Create generation_sessions table for Bedrock session tracking
CREATE TABLE IF NOT EXISTS generation_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orbit_id UUID NOT NULL REFERENCES orbits(id) ON DELETE CASCADE,
  bedrock_session_id VARCHAR(255),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  token_count INTEGER,
  status VARCHAR(50) NOT NULL, -- 'in_progress', 'completed', 'failed'
  CONSTRAINT fk_orbit FOREIGN KEY (orbit_id) REFERENCES orbits(id)
);
```

**Rationale**: Addresses Context Package Risk 6 (Partial Failure Recovery) by persisting phase completion state. Enables resume capability without restarting from phase 1.

### Phase 2: Artifact Schema Definitions (Files: `backend/validation/schemas/`)

Create validation schemas using Zod (TypeScript) for runtime validation:

**`backend/validation/schemas/intent-document.schema.ts`**:
```typescript
import { z } from 'zod';

export const IntentDocumentSchema = z.object({
  title: z.string().min(10),
  sections: z.object({
    desiredOutcome: z.string().min(50),
    constraints: z.array(z.object({
      type: z.string(),
      description: z.string()
    })).min(1),
    acceptanceBoundaries: z.array(z.object({
      criterion: z.string(),
      minimumAcceptable: z.string(),
      target: z.string(),
      exceptional: z.string()
    })).min(3),
    trustTierAssignment: z.object({
      tier: z.enum(['1', '2', '3']),
      rationale: z.string().min(100)
    }),
    dependencies: z.array(z.string()).optional()
  })
});
```

Create parallel schemas for Context Package, Proposal Record, and Verification Protocol with required section validation.

**Rationale**: Addresses Context Package Risk 5 (Schema Validation Failure) by enforcing structural requirements before persisting artifacts.

### Phase 3: GitHub Integration Layer (Files: `backend/services/github-context.service.ts`)

Implement caching and rate-limit-aware repository access:

```typescript
export class GitHubContextService {
  private cache: Map<string, CachedRepoData> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  async getRepositoryContext(repoUrl: string): Promise<RepoContext> {
    const cached = this.cache.get(repoUrl);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    
    // Fetch with rate limit handling
    const rateLimitRemaining = await this.checkRateLimit();
    if (rateLimitRemaining < 100) {
      throw new RateLimitError('GitHub API quota low, queuing request');
    }
    
    const [fileTree, keyFiles] = await Promise.all([
      this.fetchFileTree(repoUrl),
      this.fetchKeyFiles(repoUrl, [
        '.orbital/artifacts/**/*.md',
        'backend/**/*.js',
        'backend/**/*.sql'
      ])
    ]);
    
    const context = { fileTree, keyFiles };
    this.cache.set(repoUrl, { data: context, timestamp: Date.now() });
    return context;
  }
}
```

**Rationale**: Addresses Context Package Risk 3 (GitHub API Rate Limiting) with request caching and quota monitoring.

### Phase 4: Bedrock Session Manager (Files: `backend/services/bedrock-session.service.ts`)

Implement stateful session management with token tracking:

```typescript
export class BedrockSessionService {
  private sessionContexts: Map<string, SessionContext> = new Map();
  
  async initializeSession(orbitId: string): Promise<string> {
    const sessionId = await this.createBedrockSession();
    this.sessionContexts.set(sessionId, {
      orbitId,
      tokenCount: 0,
      phaseArtifacts: [],
      startedAt: new Date()
    });
    
    // Persist session to database
    await db.generation_sessions.insert({
      session_id: sessionId,
      orbit_id: orbitId,
      bedrock_session_id: sessionId,
      status: 'in_progress'
    });
    
    return sessionId;
  }
  
  async invokePhase(
    sessionId: string, 
    phase: ArtifactPhase,
    prompt: string
  ): Promise<string> {
    const context = this.sessionContexts.get(sessionId);
    
    // Token budget check (addresses Risk 1)
    const projectedTokens = context.tokenCount + this.estimateTokens(prompt);
    if (projectedTokens > 180000) {
      throw new TokenBudgetExceededError(
        `Projected token count ${projectedTokens} exceeds 180K limit`
      );
    }
    
    // Invoke Bedrock with session continuity
    const response = await this.bedrockClient.converse({
      sessionId,
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    // Update token tracking
    context.tokenCount = response.usage.totalTokens;
    context.phaseArtifacts.push({ phase, content: response.output.message.content });
    
    return response.output.message.content;
  }
}
```

**Rationale**: Implements **Session Continuity** constraint with token budget enforcement addressing Context Package Risk 1.

### Phase 5: Pipeline Orchestrator (Files: `backend/services/artifact-pipeline.service.ts`)

Core pipeline logic with phase sequencing and error recovery:

```typescript
export class ArtifactPipelineService {
  async generateArtifactSet(orbitId: string): Promise<ArtifactSet> {
    const orbit = await this.loadOrbitMetadata(orbitId);
    const repoContext = await this.github.getRepositoryContext(orbit.repository_url);
    
    // Check for partial completion (resume capability)
    const existingArtifacts = await this.loadExistingArtifacts(orbitId);
    const startPhase = this.determineStartPhase(existingArtifacts);
    
    const sessionId = await this.bedrock.initializeSession(orbitId);
    const results: ArtifactSet = { ...existingArtifacts };
    
    try {
      // Phase 1: Intent Document (unless already exists)
      if (!results.intentDocument && startPhase <= 1) {
        results.intentDocument = await this.generatePhase(
          sessionId,
          'intent',
          { orbit, repoContext },
          []
        );
        await this.persistArtifact(orbitId, 'intent_document', results.intentDocument);
      }
      
      // Phase 2: Context Package
      if (!results.contextPackage && startPhase <= 2) {
        results.contextPackage = await this.generatePhase(
          sessionId,
          'context',
          { orbit, repoContext },
          [results.intentDocument]
        );
        await this.persistArtifact(orbitId, 'context_package', results.contextPackage);
      }
      
      // Phase 3: Proposal Record
      if (!results.proposalRecord && startPhase <= 3) {
        results.proposalRecord = await this.generatePhase(
          sessionId,
          'proposal',
          { orbit, repoContext },
          [results.intentDocument, results.contextPackage]
        );
        await this.persistArtifact(orbitId, 'proposal_record', results.proposalRecord);
      }
      
      // Phase 4: Verification Protocol
      if (!results.verificationProtocol && startPhase <= 4) {
        results.verificationProtocol = await this.generatePhase(
          sessionId,
          'verification',
          { orbit, repoContext },
          [results.intentDocument, results.contextPackage, results.proposalRecord]
        );
        await this.persistArtifact(orbitId, 'verification_protocol', results.verificationProtocol);
      }
      
      await this.markSessionComplete(sessionId);
      return results;
      
    } catch (error) {
      await this.handlePipelineFailure(sessionId, error);
      throw error;
    }
  }
  
  private async generatePhase(
    sessionId: string,
    phase: string,
    context: PipelineContext,
    siblingArtifacts: string[]
  ): Promise<string> {
    const prompt = this.buildPhasePrompt(phase, context, siblingArtifacts);
    
    let attempt = 0;
    while (attempt < 3) {
      try {
        const content = await this.bedrock.invokePhase(sessionId, phase, prompt);
        
        // Validate against schema
        await this.validator.validate(phase, content);
        
        // Check terminology consistency (addresses Risk 2)
        if (siblingArtifacts.length > 0) {
          await this.validator.checkTerminologyAlignment(content, siblingArtifacts);
        }
        
        return content;
        
      } catch (error) {
        attempt++;
        if (attempt >= 3) throw error;
        
        // Log retry with context (Error Transparency criterion)
        await this.logRetryAttempt(sessionId, phase, attempt, error);
        await this.delay(1000 * attempt); // Exponential backoff
      }
    }
  }
}
```

**Rationale**: Implements **Error Recovery** constraint with resume capability, retry logic, and schema validation before persistence.

### Phase 6: Atomic File Operations (Files: `backend/services/artifact-storage.service.ts`)

Implement write-validate-commit pattern:

```typescript
export class ArtifactStorageService {
  async persistArtifact(
    orbitId: string,
    artifactType: string,
    content: string
  ): Promise<void> {
    const tmpPath = `.orbital/tmp/${orbitId}/${artifactType}.md`;
    const finalPath = `.orbital/artifacts/${orbitId}/${artifactType}.md`;
    
    try {
      // Write to temporary location
      await fs.mkdir(path.dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, content, 'utf-8');
      
      // Validate markdown structure
      await this.validateMarkdown(tmpPath);
      
      // Atomic move to final location
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.rename(tmpPath, finalPath);
      
      // Update database (Git is source of truth)
      await db.artifacts.upsert({
        orbit_id: orbitId,
        artifact_type: artifactType,
        file_path: finalPath,
        phase_completed_at: new Date(),
        generation_phase: 'completed'
      });
      
      // Commit to Git
      await this.git.add(finalPath);
      await this.git.commit(`Generated ${artifactType} for orbit ${orbitId}`);
      
    } catch (error) {
      // Leave temp file for debugging (Error Transparency)
      await this.logPersistenceFailure(orbitId, artifactType, error);
      throw error;
    }
  }
}
```

**Rationale**: Implements atomic write pattern from Context Package Pattern Library, ensuring no partial artifacts corrupt the repository.

### Phase 7: Terminology Consistency Validator (Files: `backend/validation/terminology-validator.ts`)

Implement cross-document term matching:

```typescript
export class TerminologyValidator {
  async checkTerminologyAlignment(
    newArtifact: string,
    existingArtifacts: string[]
  ): Promise<ValidationResult> {
    const glossary = this.extractKeyTerms(existingArtifacts);
    const violations: TermViolation[] = [];
    
    // Check for synonym usage (e.g., "REST API" vs "HTTP endpoints")
    for (const [canonical, synonyms] of glossary.entries()) {
      const synonymUsage = synonyms.filter(s => 
        newArtifact.includes(s) && !newArtifact.includes(canonical)
      );
      
      if (synonymUsage.length > 0) {
        violations.push({
          canonical,
          foundSynonym: synonymUsage[0],
          severity: 'warning'
        });
      }
    }
    
    if (violations.length > 5) {
      throw new TerminologyDriftError(
        `Excessive terminology drift detected: ${violations.length} inconsistencies`
      );
    }
    
    return { valid: violations.length === 0, violations };
  }
  
  private extractKeyTerms(artifacts: string[]): Map<string, string[]> {
    // Extract bold-emphasized terms, constraint names, section headings
    const terms = new Map<string, string[]>();
    
    for (const artifact of artifacts) {
      const boldTerms = artifact.match(/**([^*]+)**/g) || [];
      const headings = artifact.match(/^##s+(.+)$/gm) || [];
      
      // Build canonical -> synonyms mapping
      // Implementation uses NLP similarity or manual synonym list
    }
    
    return terms;
  }
}
```

**Rationale**: Addresses Context Package Risk 2 (Cross-Document Terminology Drift) with automated consistency checking.

### Phase 8: Performance Optimization (Files: Configuration adjustments)

Parallel operations where possible:

```typescript
// In artifact-pipeline.service.ts
async generateArtifactSet(orbitId: string): Promise<ArtifactSet> {
  // ... existing session setup ...
  
  // Optimize Phase 1: Parallel database and GitHub queries
  const [orbit, repoContext, existingArtifacts] = await Promise.all([
    this.loadOrbitMetadata(orbitId),
    this.github.getRepositoryContext(orbit.repository_url),
    this.loadExistingArtifacts(orbitId)
  ]);
  
  // Bedrock invocations remain sequential (session continuity requirement)
  // But validation can run in parallel with next phase prep
}
```

**Rationale**: Achieves 90-second **Performance Budget** target by parallelizing I/O operations while respecting sequential Bedrock session requirement.

### Execution Order

1. **Database schema migration** (Phase 1) — blocking, requires downtime coordination
2. **Validation schemas** (Phase 2) — parallel with schema migration (no runtime dependency)
3. **GitHub integration** (Phase 3) — depends on schema for rate limit tracking
4. **Bedrock session manager** (Phase 4) — depends on schema for session persistence
5. **Pipeline orchestrator** (Phase 5) — integrates all prior components
6. **Artifact storage** (Phase 6) — depends on orchestrator for invocation
7. **Terminology validator** (Phase 7) — plugs into orchestrator validation hook
8. **Performance tuning** (Phase 8) — iterative optimization after initial integration

## Risk Surface

### Risk 1: Bedrock Model Hallucination Under Context Overload
**Likelihood**: Medium | **Severity**: High

If cumulative context exceeds effective model capacity (not just hard token limit), Claude may generate syntactically valid but semantically incoherent artifacts. This manifests as:
- Self-contradictory statements within a single document
- Fabricated file paths not present in repository context
- Nonsensical risk assessments or acceptance criteria

**Mitigation**:
- Implement post-generation coherence checks (LLM-as-judge pattern: separate Claude invocation rates artifact quality 1-10)
- If coherence score < 7, trigger regeneration with compressed context (summarize repository file tree, truncate prior artifacts to key sections only)
- Hard limit: if 3 regeneration attempts fail, escalate to human review with "context overload" flag

### Risk 2: Database Deadlock Under High Concurrency
**Likelihood**: Low | **Severity**: Critical

Per Context Package Risk 4, concurrent orbit generation may cause `artifacts` table deadlocks. Specific scenario:
- Engineer A's orbit updates `artifact` record for orbit UUID X
- Engineer B's orbit queries `orbits` table, locking row referenced by Engineer A's foreign key
- Both transactions wait for each other's locks

**Mitigation**:
- Use explicit lock ordering: always acquire `orbits` lock before `artifacts` lock
- Implement row-level locking in read queries: `SELECT * FROM orbits WHERE id = $1 FOR UPDATE NOWAIT`
- If `NOWAIT` throws lock timeout, retry with exponential backoff (100ms, 500ms, 2s)
- Monitor deadlock frequency in production; if > 1% of transactions, introduce distributed lock (Redis) for orbit-level coordination

### Risk 3: Git Merge Conflicts in Artifact Directory
**Likelihood**: Medium | **Severity**: Medium

If two engineers generate orbits simultaneously and push to the same branch, merge conflicts in `.orbital/artifacts/` may occur. While individual artifact files won't conflict (different UUIDs), Git metadata or index corruption could block pushes.

**Mitigation**:
- Use separate branches per orbit: `orbital/{orbit-uuid}`
- Auto-merge to main via GitHub Actions after generation completes
- If merge fails (rare), preserve artifact files and create PR for manual resolution
- Engineers never directly modify `.orbital/artifacts/` (tooling-only zone)

### Risk 4: Schema Validation False Positives
**Likelihood**: Medium | **Severity**: Low

Zod schemas may reject valid artifacts due to overly strict validation (e.g., requiring exact heading text when slight variations are acceptable: "Desired Outcome" vs "Desired Outcomes").

**Mitigation**:
- Schema validation checks structure only, not exact wording:
  - Verify `## Desired Outcome` heading exists (regex: `^## Desired Outcomes?`)
  - Verify section has content (min 50 characters)
  - Do not validate exact table column names or order
- Log validation failures with artifact content for post-mortem analysis
- Provide manual override: `--skip-validation` flag for emergency artifact generation

### Risk 5: Terminology Drift in Large Artifact Sets
**Likelihood**: High | **Severity**: Low

As artifacts grow longer (e.g., Verification Protocol with 50+ checks), maintaining exact terminology across 20K+ tokens becomes difficult even for Claude. Minor drift ("Performance Budget" → "performance constraints") may slip through validation.

**Mitigation**:
- Accept "substantial" consistency (95% term match rate) rather than perfect consistency
- Highlight drift in human review UI: "Warning: 3 terminology inconsistencies detected"
- Provide auto-fix suggestions: "Replace 'performance constraints' with 'Performance Budget' (from Intent §Constraints)?"
- Terminology validator learns canonical terms from Intent Document (first artifact) and enforces in subsequent phases

### Risk 6: GitHub API Quota Exhaustion in Multi-Orbit Scenario
**Likelihood**: Medium | **Severity**: Medium

Per Context Package Risk 3, 10 concurrent orbit generations could consume 500-1000 API calls (50-100 per orbit for file tree + contents). At 5,000/hour authenticated limit, this leaves little headroom for other automation.

**Mitigation**:
- Implement orbit generation queue with concurrency limit (max 5 simultaneous pipelines)
- Use GitHub GraphQL API instead of REST (reduces calls by 3-5x via batching)
- Cache aggressively: if orbit targets same repository as recent orbit, reuse context (5-minute TTL)
- Monitor quota via `X-RateLimit-Remaining` header; pause queue if < 500 remaining

## Scope Estimate

### Complexity Assessment: **High**

This orbit integrates multiple external systems (AWS Bedrock, GitHub API, ORBITAL database) with strict consistency and performance requirements. The pipeline must handle partial failures gracefully, maintain session state across 4 phases, and validate complex document structures—all while meeting a 90-second total execution budget.

Key complexity drivers:
- Multi-phase state machine with resume capability (7 distinct states per orbit)
- Cross-document validation requiring NLP-style term extraction and matching
- Concurrency control across database, Git, and API rate limits
- Error recovery with context preservation for human debugging

### Work Breakdown

| Phase | Description | Estimated Orbit Count | Dependencies |
|-------|-------------|----------------------|--------------|
| **Foundation** | Database schema, validation schemas, GitHub service | 1 orbit | None |
| **Bedrock Integration** | Session manager, prompt engineering, token tracking | 1 orbit | Foundation |
| **Pipeline Core** | Orchestrator, phase sequencing, error handling | 2 orbits | Bedrock Integration |
| **Quality Gates** | Terminology validator, schema validation, coherence checks | 1 orbit | Pipeline Core |
| **Storage & Git** | Atomic file operations, Git integration, artifact indexing | 1 orbit | Pipeline Core |
| **Performance Tuning** | Parallelization, caching, benchmark optimization | 1 orbit | All prior phases |
| **Testing & Documentation** | Unit tests, integration tests, runbook | 1 orbit | All prior phases |

**Total Estimated Orbits**: 8

**Critical Path**: Foundation → Bedrock Integration → Pipeline Core → Storage & Git (5 orbits sequential; quality gates and performance tuning can run in parallel after pipeline core)

### Time Estimates (per phase, assume single engineer)

- **Foundation**: 2-3 days (schema design + validation logic)
- **Bedrock Integration**: 3-4 days (AWS SDK setup + session management complexity)
- **Pipeline Core**: 5-6 days (state machine + error recovery paths)
- **Quality Gates**: 2-3 days (terminology extraction + validation rules)
- **Storage & Git**: 2 days (atomic operations + Git automation)
- **Performance Tuning**: 2-3 days (profiling + optimization)
- **Testing & Documentation**: 3-4 days (integration test scenarios + runbook)

**Total Sequential**: 19-25 days | **With Parallelization**: 14-18 days

### Success Metrics Alignment

Maps to Intent Document Acceptance Boundaries:

| Intent Criterion | Implementation Verification |
|------------------|----------------------------|
| Artifact Completeness (Target: all 4 docs populated) | Pipeline generates all phases or fails atomically; no partial sets in `.orbital/artifacts/` |
| Generation Success Rate (Target: 95%) | Monitor `generation_sessions.status`; alert if failure rate > 5% over 24-hour window |
| Cross-Document Consistency (Target: terminology aligns) | Terminology validator auto-runs; logs drift incidents to database for review |
| Context Utilization (Target: reference specific patterns) | GitHub service fetches actual file contents; Context Package must cite ≥3 real paths |
| Performance (Target: < 90s) | CloudWatch metrics track end-to-end pipeline duration; alert if p95 > 90s |
| Error Transparency (Target: errors include context) | All exceptions log to `artifacts.error_context` JSONB with orbit_id, phase, input snapshot |

## Human Modifications

Pending human review.