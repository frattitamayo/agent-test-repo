# Context Package: Add Prompt Template Management

## Codebase References

### Primary Implementation Surfaces

**Prompt Template Storage**
- `prompts/templates/artifact_types/` — New directory for template files (to be created)
- `prompts/templates/artifact_types/intent_document_v1.md` — First template implementation
- `prompts/templates/artifact_types/context_package_v1.md` — Second template (should have)
- `prompts/templates/artifact_types/proposal_v1.md` — Third template (should have)

**Template Loading & Management**
- `internal/application/services/template_service.go` — Template loader, caching, version resolution (to be created)
- `internal/domain/templates/` — Domain models for templates, injection variables, validation (to be created)
- `internal/domain/templates/template.go` — Core template entity
- `internal/domain/templates/injection_context.go` — Entity context injection model
- `internal/domain/templates/validator.go` — Template validation logic

**Integration Points**
- `internal/application/services/artifact_generator.go` — Existing artifact generation service that will consume templates
- `internal/infrastructure/llm/bedrock_client.go` — AWS Bedrock integration from T2-004, receives constructed prompts
- `internal/infrastructure/llm/prompt_builder.go` — Existing prompt construction logic (to be deprecated/augmented)

**API Layer**
- `internal/infrastructure/delivery/httphandlers/artifact_generation_handler.go` — Existing artifact generation endpoints
- `internal/infrastructure/delivery/httphandlers/template_info_handler.go` — New endpoint for template metadata (optional, should have)

**Testing**
- `internal/application/services/template_service_test.go` — Template loading, caching, injection tests
- `internal/domain/templates/validator_test.go` — Template validation rules tests
- `prompts/templates/artifact_types/README.md` — Template authoring guide and injection variable reference

**Configuration**
- `config/app.yaml` — Add template directory path configuration
- `.github/copilot-instructions.md` — Update with template authoring standards

### Secondary Dependencies

**Entity Data Access**
- `internal/domain/project/repository.go` — Project context injection
- `internal/domain/trajectory/repository.go` — Trajectory context injection
- `internal/domain/intent/repository.go` — Intent context injection
- `internal/domain/orbit/repository.go` — Orbit context injection
- `internal/application/queries/get_orbit_context.go` — Consolidated entity context query (may need enhancement)

**Infrastructure**
- `internal/infrastructure/filesystem/` — File reading utilities (may already exist, verify)
- `internal/infrastructure/cache/` — Template caching layer (if implemented)

## Architecture Context

### System Positioning

Prometheus V1 follows Clean Architecture with distinct layers:
- **Domain**: Core business entities (Projects, Trajectories, Intents, Orbits, Artifacts)
- **Application**: Use cases and services (artifact generation, LLM orchestration)
- **Infrastructure**: External adapters (HTTP handlers, LLM clients, storage)

The prompt template system sits at the **Application Service** layer:
- Templates are **domain assets** (stored as files, not runtime data)
- Template loading is an **infrastructure concern** (filesystem I/O)
- Template injection and artifact generation are **application use cases**
- LLM invocation is an **infrastructure adapter** (AWS Bedrock client)

### Data Flow

```
User Request (Generate Artifact)
  ↓
HTTP Handler (artifact_generation_handler.go)
  ↓
Application Service (artifact_generator.go)
  ↓
Template Service (template_service.go) ← loads & caches template from filesystem
  ↓
Injection Context (injection_context.go) ← fetches entity data via repositories
  ↓
Template Render (produces final prompt string)
  ↓
Bedrock Client (bedrock_client.go) ← sends prompt to AWS Bedrock
  ↓
Response Parser ← extracts artifact content
  ↓
Artifact Entity ← persisted to database
  ↓
HTTP Response (generated artifact)
```

### Integration with Existing Systems

**AWS Bedrock Integration (T2-004)**
- Template system produces the final prompt string passed to `bedrock_client.InvokeModel()`
- Templates define system message, user message structure, and response format expectations
- No changes to Bedrock client itself; it remains a prompt-agnostic transport layer

**Artifact Generation Flow (Current)**
- Existing `artifact_generator.go` constructs prompts inline or via hardcoded string builders
- Template system provides a **parallel path first**, then gradual migration
- Old prompt logic remains active with deprecation logging until all artifact types migrated

**Version Control & Deployment**
- Templates deploy with application code (no runtime editing)
- Template changes follow standard Git workflow: branch → PR → review → merge → deploy
- No database migrations needed; templates are stateless files

### Design Patterns

**Template Pattern** — Defines skeleton prompt structure with variable substitution
**Strategy Pattern** — Different artifact types = different template strategies
**Repository Pattern** — Template loading abstracted behind interface for testability
**Cache-Aside** — Templates loaded once, cached in memory (invalidated on config reload)

## Pattern Library

### File Organization

**Template Directory Structure**
```
prompts/
  templates/
    artifact_types/
      intent_document_v1.md
      context_package_v1.md
      proposal_v1.md
      README.md  # Authoring guide
    base/
      system_instructions.md  # Shared system message (could have)
```

**Naming Convention**
- `{artifact_type}_v{major}.md` — Semantic versioning for templates
- Underscores for multi-word types: `context_package_v1.md`
- Version in filename enables parallel versions during migration

### Template File Structure

**Metadata Header** (YAML front matter)
```yaml
---
version: 1
artifact_type: intent_document
author: engineering@prometheus.dev
last_modified: 2026-02-17
changelog:
  - v1: Initial template implementation
---
```

**Template Body** (Markdown with injection markers)
```markdown
# System Instructions

You are generating an Intent Document for the Prometheus ORBITAL framework...

# Entity Context

**Project:** {{project.name}}
**Description:** {{project.description}}

**Trajectory:** {{trajectory.name}}
**Description:** {{trajectory.description}}

**Intent:** {{intent.name}}
**Description:** {{intent.description}}
**Trust Tier:** {{intent.trust_tier}}

# Output Format

...
```

### Injection Variable Syntax

**Standard:** `{{entity.field}}` — Simple dot notation
**Conditional:** `{{#if orbit}}{{orbit.number}}{{/if}}` — Mustache-style conditionals (could have)
**Iteration:** `{{#each constraints}}{{this}}{{/each}}` — Array iteration (could have)

**Phase 1 (Must Have):** Support only simple `{{entity.field}}` substitution
**Phase 2 (Could Have):** Add conditional/iteration logic if needed

### Error Handling

**Template Not Found**
- Return `ErrTemplateNotFound` with artifact type and version
- Log warning, fall back to legacy inline prompt (backward compatibility)
- Include migration status in error context

**Invalid Injection Variable**
- Fail template render with `ErrInvalidInjectionVariable`
- Log missing variable name and entity type
- Do NOT fail silently (prevents unnoticed context omissions)

**Malformed Template Syntax**
- Validate on application startup (fail-fast)
- Return `ErrTemplateSyntaxError` with line number and error description
- Prevent deployment of broken templates

### Testing Patterns

**Table-Driven Template Tests**
```go
func TestTemplateInjection(t *testing.T) {
    tests := []struct {
        name     string
        template string
        context  InjectionContext
        want     string
    }{
        {
            name:     "intent document with full context",
            template: "Project: {{project.name}}
Intent: {{intent.name}}",
            context:  InjectionContext{Project: &Project{Name: "Prometheus V1"}, ...},
            want:     "Project: Prometheus V1
Intent: Add prompt templates",
        },
    }
    // ...
}
```

## Prior Orbit References

### T2-004: AWS Bedrock Integration (Orbit 1)

**What Was Built**
- `internal/infrastructure/llm/bedrock_client.go` — Bedrock API client with message formatting
- `internal/infrastructure/llm/message.go` — SystemMessage and UserMessage types
- `internal/application/services/llm_orchestrator.go` — High-level LLM invocation service

**Key Learnings**
- Bedrock expects messages as `[]Message{SystemMessage{...}, UserMessage{...}}`
- System message should contain invariant instructions (role, rules, constraints)
- User message contains variable context (entity data, specific task)
- Response parsing must handle both success and error cases from Bedrock API
- Streaming not implemented yet; template system should design for future streaming support

**Relevance to Templates**
- Templates MUST produce separate system and user message content
- System instructions section → `SystemMessage`
- Entity context + task description → `UserMessage`
- Template structure mirrors Bedrock's message format requirements

### Current Artifact Generation (Pre-T2-004)

**Where Prompts Live Today**
- Inline string concatenation in `artifact_generator.go` (search for "Generate Intent Document" comment)
- Hardcoded format instructions mixed with business logic
- No version control for prompt content (changes lost in commit history)

**Pain Points**
- Changing prompt wording requires code changes and redeployment
- No A/B testing or rollback capability for prompts
- Difficult to see full prompt structure when debugging generation issues
- Entity context injection is ad-hoc (easy to miss fields)

**Migration Strategy**
- Do NOT remove old prompt code immediately
- Add template path alongside old logic
- Log deprecation warnings when old path used
- Gradual cutover: Intent Document first, then Context Package, then Proposal
- Remove old code only after 100% of artifact types migrated and validated

## Risk Assessment

### Template Syntax Errors

**Risk:** Malformed templates deployed to production cause all artifact generation to fail
**Severity:** High (breaks core workflow)
**Likelihood:** Medium (no automated validation yet)
**Mitigation:**
- Template validation on application startup (fail-fast prevents deployment)
- Unit tests for each template with known-good entity context
- Template syntax linter in CI/CD pipeline (could have)
- Staging environment validation before production deployment

### Entity Context Injection Failures

**Risk:** Missing or null entity fields cause incomplete prompts, leading to low-quality AI outputs
**Severity:** Medium (degrades artifact quality but doesn't crash)
**Likelihood:** Medium (entity relationships complex)
**Mitigation:**
- Strict validation of injection context before template render
- Required vs. optional field specification in template metadata
- Integration tests that verify all entity fields accessible
- Error logging with full context (entity ID, missing field name)
- Graceful degradation: use placeholder text for optional missing fields

### LLM Provider Lock-In

**Risk:** Template syntax becomes Claude-specific, making Bedrock provider switch difficult
**Severity:** Low (strategic risk, not immediate)
**Likelihood:** Medium (developers may optimize for current LLM)
**Mitigation:**
- Document LLM-agnostic template guidelines in `README.md`
- Avoid Claude-specific prompt engineering tricks (e.g., XML tags) in core instructions
- Abstract message formatting in `bedrock_client.go` (already done in T2-004)
- Review template changes for provider-specific assumptions during PR review

### Template Version Conflicts

**Risk:** Multiple orbit instances running different template versions produce inconsistent artifacts
**Severity:** Low (annoying but not breaking)
**Likelihood:** Low (single-instance deployment currently)
**Mitigation:**
- Template version included in artifact metadata (trace which template generated which artifact)
- Cache invalidation on application restart (ensures latest templates used)
- Deployment strategy: rolling restart ensures all instances on same template version
- Could have: Template version pinning per orbit (orbit requests specific template version)

### Performance Degradation

**Risk:** Template loading from filesystem on every request slows artifact generation
**Severity:** Low (user-facing latency increase)
**Likelihood:** Low (templates small, filesystem fast)
**Mitigation:**
- In-memory cache for loaded templates (expire on config reload)
- Lazy loading: load template on first use, not application startup
- Benchmark template loading time in tests (fail if > 50ms)
- Could have: Precompile templates into Go code at build time (eliminates runtime I/O)

### Backward Compatibility Break

**Risk:** Premature removal of old prompt code breaks existing integrations or test fixtures
**Severity:** Medium (blocks artifact generation until fixed)
**Likelihood:** Low (careful migration plan)
**Mitigation:**
- Parallel code paths: old and new prompt logic coexist
- Feature flag: enable template system per artifact type
- Deprecation warnings in logs (track usage of old path)
- Remove old code only after metrics show zero usage for 1+ week
- Rollback plan: revert to old code path with single config change

### Security: Template Injection

**Risk:** Entity data contains malicious content that breaks out of template context (e.g., `{{system_command}}` in Project name)
**Severity:** High (potential for system compromise if templates executed server-side)
**Likelihood:** Very Low (entity data sanitized at input, templates read-only)
**Mitigation:**
- Template system does NOT execute code (only string substitution)
- Entity data sanitization at API input layer (already enforced by validation middleware)
- Injection context uses strongly-typed structs, not raw string maps
- Review template rendering code for `eval()` or similar dangerous operations (must be zero)