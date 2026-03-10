# Context Package: T2-005 · Add Prompt Template Management

## Codebase References

### Primary Implementation Areas

**Template Storage & Management**
- `internal/llm/templates/` — NEW directory for prompt template files (to be created)
- `internal/llm/template_engine.go` — NEW template hydration engine (to be created)
- `internal/llm/template_loader.go` — NEW template loading and versioning logic (to be created)

**Integration Points**
- `internal/services/artifact_service.go` — Existing artifact generation service that will consume templates
- `internal/services/llm_service.go` — Existing LLM client service (from T2-004) that receives hydrated prompts
- `internal/models/artifact.go` — Artifact type definitions and enums

**Entity Context Sources**
- `internal/models/project.go` — Project entity providing context data
- `internal/models/trajectory.go` — Trajectory entity providing context data
- `internal/models/intent.go` — Intent entity providing context data
- `internal/models/orbit.go` — Orbit entity providing context data

**Testing & Validation**
- `internal/llm/templates/` — Template test fixtures
- `internal/llm/template_engine_test.go` — Template hydration unit tests (to be created)
- `internal/services/artifact_service_test.go` — Integration tests for template-based generation

### Configuration & Documentation
- `docs/templates/README.md` — NEW template developer documentation (to be created)
- `docs/templates/VERSIONING.md` — NEW template versioning conventions (to be created)
- `.github/copilot-instructions.md` — Update with template structure patterns

## Architecture Context

### System Position
The prompt template system sits at the **interface layer between domain logic and external LLM services**. It acts as a translator, converting structured Prometheus entity data into well-formed LLM prompts according to artifact-specific specifications.

**Data Flow:**
1. Controller receives artifact generation request with entity context
2. Artifact Service identifies required artifact type (Intent, Context, Proposal, etc.)
3. **Template Engine** (NEW) loads appropriate versioned template from filesystem
4. **Template Engine** (NEW) hydrates template with entity context data
5. Hydrated prompt passed to LLM Service (existing, from T2-004)
6. LLM Service submits to AWS Bedrock and returns generated content
7. Artifact Service processes response and returns to controller

### Architectural Patterns

**Clean Architecture Layers:**
- **Domain Layer:** Entity models (Project, Trajectory, Intent, Orbit) remain unchanged
- **Application Layer:** Artifact Service orchestrates template loading and LLM invocation
- **Infrastructure Layer:** Template Engine handles filesystem I/O and text processing
- **External Interface:** LLM Service maintains boundary with AWS Bedrock

**Design Principles Applied:**
- **Separation of Concerns:** Template content (what to say) separate from hydration logic (how to inject context)
- **Dependency Inversion:** Artifact Service depends on template abstraction, not concrete template files
- **Open/Closed Principle:** Adding new templates does not require code changes to engine
- **Single Responsibility:** Template Engine only handles hydration; validation and LLM invocation remain separate

### Technology Constraints

**Go Template Engine:**
The implementation should leverage Go's built-in `text/template` package for variable interpolation. This provides:
- Safe, sandboxed template execution (no arbitrary code execution)
- Structured data binding via dot notation (e.g., `{{.Project.Name}}`)
- Conditionals and iteration for optional context sections
- Built-in HTML/text escaping to prevent injection attacks

**File System Storage:**
Templates stored as `.tmpl` or `.prompt.md` files in version-controlled directories. Version selection implemented via:
- Directory structure: `templates/intent_document/v1.tmpl`, `templates/intent_document/v2.tmpl`
- OR filename convention: `intent_document_v1.tmpl`, `intent_document_v2.tmpl`
- OR embedded metadata in template header comments

**Performance Profile:**
- Template loading: Cached in memory after first read (lazy initialization)
- Hydration: Pure text transformation, ~1-5ms for typical templates
- No database queries in hot path
- Total budget <50ms p95 includes filesystem reads on cold start

## Pattern Library

### Repository Patterns (from existing codebase)

**Service Layer Pattern:**
```go
// Existing pattern in internal/services/
type ArtifactService struct {
    llmService  LLMService
    repository  ArtifactRepository
    // NEW: template engine dependency
}

func (s *ArtifactService) GenerateArtifact(ctx context.Context, req ArtifactRequest) (*Artifact, error) {
    // Orchestration logic here
}
```

**Error Handling Convention:**
```go
// Consistent error wrapping with context
if err != nil {
    return nil, fmt.Errorf("failed to load template: %w", err)
}
```

**Dependency Injection:**
```go
// Constructor injection pattern used throughout
func NewArtifactService(llm LLMService, repo ArtifactRepository) *ArtifactService {
    return &ArtifactService{
        llmService: llm,
        repository: repo,
    }
}
```

### Template Structure Pattern (NEW - to be established)

**Template File Convention:**
```markdown
<!-- Template Metadata -->
<!-- Version: 1.0.0 -->
<!-- Artifact Type: intent_document -->
<!-- Last Updated: 2024-01-15 -->
<!-- Token Budget: 4000 -->

# System Instructions
You are the Intent Agent...

# Entity Context
Project: {{.Project.Name}}
Trajectory: {{.Trajectory.Name}}
...

# Output Format
Produce a markdown document with...

# Quality Criteria
- Must include all required sections
- Outcome must be specific and measurable
```

**Template Data Structure:**
```go
type TemplateContext struct {
    Project    *Project
    Trajectory *Trajectory
    Intent     *Intent
    Orbit      *Orbit
    Metadata   map[string]interfacenull // extensible context
}
```

**Template Loader Interface:**
```go
type TemplateLoader interface {
    LoadTemplate(artifactType ArtifactType, version string) (*Template, error)
    ListVersions(artifactType ArtifactType) ([]string, error)
}

type Template struct {
    Content   string
    Version   string
    Metadata  TemplateMetadata
}
```

### Naming Conventions

**File Naming:**
- Template files: `{artifact_type}_v{major}.tmpl` (e.g., `intent_document_v1.tmpl`)
- Test fixtures: `{artifact_type}_v{major}_test.tmpl`
- Documentation: `{artifact_type}_README.md`

**Go Package Structure:**
- `internal/llm/templates/` — template content files (data)
- `internal/llm/` — template engine logic (code)
- No circular dependencies between packages

**Variable Naming in Templates:**
- Entity references: PascalCase matching Go struct fields (`.Project.Name`, `.Trajectory.Description`)
- Metadata: lowercase with underscores (`.metadata.request_id`)
- Conditional sections: descriptive names (`{{if .ShowConstraints}}`)

## Prior Orbit References

### T2-004 · Establish AWS Bedrock Integration (Completed)

**What was implemented:**
- LLM Service with Bedrock client configuration
- Request/response handling for Claude 3 Sonnet
- Error handling and retry logic
- Message structure (system/user message separation)

**Relevant patterns:**
- Bedrock requests use structured message arrays: `[]Message{{Role: "system", Content: "..."}, {Role: "user", Content: "..."}}`
- Token limits enforced at LLM Service boundary (32k input for Claude 3 Sonnet)
- Streaming not yet implemented — full response only
- No prompt caching — each request is independent

**Integration considerations:**
- Template hydration output must produce valid Bedrock message structure
- System instructions go in system message, entity context in user message
- Template Engine should return `SystemPrompt` and `UserPrompt` separately for LLM Service consumption

### T2-001 through T2-003 · Platform Foundation (Completed)

**Entity Model Stability:**
- Project, Trajectory, Intent, Orbit models are stable
- All entities have `ID`, `Name`, `Description`, `Status` fields
- Intent includes `TrustTier`, `Outcome`, `Constraints`, `Acceptance` fields
- Orbit includes `Phase`, `Summary`, `Metrics` fields
- Entity relationships: Project → Trajectories → Intents → Orbits

**Service Layer Conventions:**
- All services use context.Context as first parameter
- Repository pattern for data access
- No business logic in controllers
- Services return domain errors, controllers map to HTTP status codes

## Risk Assessment

### High Impact Risks

**Risk: Template Injection or Code Execution**
- **Threat:** Malicious template content or entity data could execute arbitrary code if template engine is not properly sandboxed
- **Likelihood:** Low (Go text/template is safe by default, entity data comes from trusted database)
- **Impact:** Critical (code execution, data exfiltration)
- **Mitigation:** 
  - Use `text/template`, NOT `html/template` with `Execute` method (no JS execution)
  - Validate template syntax at load time, fail fast on parse errors
  - Sanitize entity data before hydration (strip control characters, validate UTF-8)
  - Add integration test that attempts injection patterns and verifies they're escaped

**Risk: Template Versioning Conflicts**
- **Threat:** Two developers create templates with same version number, causing non-deterministic behavior in production
- **Likelihood:** Medium (common in distributed teams without coordination)
- **Impact:** High (inconsistent artifact generation, user confusion, debugging difficulty)
- **Mitigation:**
  - Enforce version uniqueness via filesystem structure (one file per version)
  - Add CI check that fails on duplicate template versions
  - Document version increment policy in `VERSIONING.md`
  - Consider semantic versioning (major.minor.patch) for breaking vs. non-breaking changes

**Risk: Template Hydration Performance Degradation**
- **Threat:** Complex templates with nested loops or large entity data cause >50ms hydration time
- **Likelihood:** Medium (as templates grow more sophisticated)
- **Impact:** Medium (violates performance constraint, degrades user experience)
- **Mitigation:**
  - Add performance benchmarks in `template_engine_test.go` (fail if >50ms p95)
  - Implement template caching (parse once, reuse compiled template)
  - Profile hydration with realistic entity data during development
  - Set token budget per template (documented in metadata), fail if exceeded

### Medium Impact Risks

**Risk: Missing or Null Entity Context Data**
- **Threat:** Template hydration fails or produces malformed prompts when required entity fields are null/empty
- **Likelihood:** High (new intents may have incomplete metadata during draft phase)
- **Impact:** Medium (artifact generation fails, requires retry with complete data)
- **Mitigation:**
  - Validate entity completeness before template hydration (return validation error)
  - Use template conditionals to handle optional fields gracefully (`{{if .Intent.Constraints}}`)
  - Define "required fields" schema per template, enforce in Template Loader
  - Provide meaningful error messages indicating which fields are missing

**Risk: Template Rot (Divergence from Entity Schema)**
- **Threat:** Entity models evolve (new fields, renamed fields) but templates are not updated, causing hydration errors or stale prompts
- **Likelihood:** High (entity schema changes are common in active development)
- **Impact:** Medium (template hydration fails, requires maintenance)
- **Mitigation:**
  - Add integration tests that hydrate templates with actual entity instances (catches field mismatches)
  - Document entity field dependencies in template metadata (e.g., `RequiredFields: [Project.Name, Intent.Outcome]`)
  - Add CI check that compiles templates against current entity schema (static analysis)
  - Include template review in PR checklist when entity models change

**Risk: Template Content Quality Degradation**
- **Threat:** New template versions produce lower-quality artifacts (less clear, missing key instructions) compared to previous versions
- **Likelihood:** Medium (hard to objectively measure prompt quality)
- **Impact:** Medium (degrades AI-generated output quality, hurts user trust)
- **Mitigation:**
  - Require human review of all new template versions (Tier 2 gate requirement)
  - A/B test new templates against current versions before full rollout (version selection via config)
  - Capture qualitative metrics: user feedback on artifact quality per template version
  - Maintain template changelog documenting what changed and why in each version

### Low Impact Risks

**Risk: File System I/O Errors**
- **Threat:** Template files missing, corrupted, or unreadable due to deployment issues or filesystem permissions
- **Likelihood:** Low (immutable deployments, files deployed with application code)
- **Impact:** High (artifact generation fails completely)
- **Mitigation:**
  - Embed templates in binary using Go `embed` directive (optional, for zero filesystem dependencies)
  - Fail-fast on startup: validate all required templates are loadable, exit if missing
  - Add health check endpoint that verifies template availability
  - Log template load events for observability

**Risk: Concurrent Template Modification**
- **Threat:** Template file modified on disk while engine is using it (via hot-reload or manual edit)
- **Likelihood:** Very Low (templates deployed with application, no runtime modification expected)
- **Impact:** Low (single request may use inconsistent template state)
- **Mitigation:**
  - Cache parsed templates in memory, never re-read from disk after initial load
  - If hot-reload is required later, implement proper synchronization (read-write locks)
  - Document in README that templates are immutable once deployed

---

**Overall Risk Posture:** Moderate. The primary risks are operational (versioning conflicts, schema divergence) rather than security or data integrity risks. Appropriate mitigations focus on validation, testing, and developer documentation to establish good template authoring practices early.