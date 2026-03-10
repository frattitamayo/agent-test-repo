# Proposal Record: Add Prompt Template Management

**Proposal ID:** PROP-T2-005-1
**Generated:** 2026-02-17
**Intent:** T2-005
**Context Packages:** Intent Document, Context Package
**Trust Tier:** 2 — Supervised (touches core AI generation pipeline)

---

## Interpreted Intent

The system currently constructs AI prompts through inline string concatenation scattered across service code, making prompt iteration slow, quality improvements difficult to track, and changes invisible without reading code diffs. This intent replaces that ad-hoc approach with a structured template system where each artifact type (Intent Documents, Context Packages, Proposals) has a versioned file stored in the codebase that defines system instructions, entity context injection points, output format rules, and quality criteria. When the system needs to generate an artifact, it loads the appropriate template, injects runtime entity data (Project name, Intent description, etc.), and sends the constructed prompt to AWS Bedrock. The result: prompt changes become code changes — reviewable, versionable, and deployable through standard Git workflows — and template improvements propagate systematically across all artifact generation instead of requiring scattered code modifications.

---

## Implementation Plan

### Files to Create

**Template Storage**
- `prompts/templates/artifact_types/intent_document_v1.md` — First production template with full system instructions, entity injection markers, output format spec, quality criteria
- `prompts/templates/artifact_types/context_package_v1.md` — Second template (should have, may defer to orbit 2)
- `prompts/templates/artifact_types/proposal_v1.md` — Third template (should have, may defer to orbit 2)
- `prompts/templates/artifact_types/README.md` — Template authoring guide: injection variable reference, versioning strategy, LLM-agnostic guidelines

**Domain Layer**
- `internal/domain/templates/template.go` — Core template entity with fields: ID, ArtifactType, Version, Content, Metadata
- `internal/domain/templates/injection_context.go` — Strongly-typed context struct containing Project, Trajectory, Intent, Orbit entities for injection
- `internal/domain/templates/validator.go` — Template syntax validation: checks for required sections, validates injection variable syntax, ensures metadata header present
- `internal/domain/templates/errors.go` — Domain errors: `ErrTemplateNotFound`, `ErrInvalidInjectionVariable`, `ErrTemplateSyntaxError`

**Application Layer**
- `internal/application/services/template_service.go` — Template loader with caching: `LoadTemplate(artifactType, version)`, `RenderTemplate(template, context)`, cache invalidation on startup
- `internal/application/services/template_service_test.go` — Table-driven tests for loading, injection, caching, error cases

**Infrastructure Layer**
- `internal/infrastructure/filesystem/template_reader.go` — Filesystem abstraction for reading template files, returns content as string
- `internal/infrastructure/delivery/httphandlers/template_info_handler.go` — Optional metadata endpoint: `GET /api/templates/{artifact_type}` returns available versions, last modified (should have, may defer)

**Testing**
- `internal/domain/templates/validator_test.go` — Validation rule tests: malformed headers, missing sections, invalid injection syntax
- `prompts/templates/artifact_types/intent_document_v1_test.md` — Test fixture with known-good entity context for integration tests

**Configuration**
- `config/app.yaml` — Add `templates.directory_path: "prompts/templates"` and `templates.cache_enabled: true`

### Files to Modify

**Artifact Generation Integration**
- `internal/application/services/artifact_generator.go` — Add template-based path alongside existing inline prompts:
  - New method: `GenerateFromTemplate(artifactType, injectionContext)`
  - Keep existing `Generate()` methods with deprecation logging
  - Feature flag: `use_template_system: bool` to toggle between old/new
  
**LLM Orchestration**
- `internal/infrastructure/llm/prompt_builder.go` — Add `BuildFromTemplate(template, context)` that constructs SystemMessage and UserMessage from rendered template sections
  - Template section `# System Instructions` → SystemMessage
  - Template section `# Entity Context` + `# Task` → UserMessage
  
**HTTP Handlers**
- `internal/infrastructure/delivery/httphandlers/artifact_generation_handler.go` — Add query param `?use_template=true` to opt-in to template-based generation (parallel path during migration)

**Documentation**
- `.github/copilot-instructions.md` — Add section on template authoring standards: naming conventions, injection variable syntax, LLM-agnostic guidelines

### Approach

**Phase 1: Template Infrastructure (Must Have)**
1. Create template domain models and validation logic
2. Implement template service with filesystem loading and in-memory caching
3. Build injection context from existing entity repository access
4. Write and validate `intent_document_v1.md` template with all required sections
5. Integrate template rendering into `prompt_builder.go` to produce Bedrock-compatible messages
6. Add template-based path to artifact generation service (parallel with old code)
7. Expose template generation through existing artifact endpoint with opt-in flag

**Phase 2: Migration & Expansion (Should Have, Orbit 2)**
8. Create `context_package_v1.md` and `proposal_v1.md` templates
9. Migrate all artifact types to template system with deprecation warnings on old path
10. Add template metadata endpoint for visibility into available versions
11. Remove old inline prompt code after zero usage confirmed for 1+ week

**Phase 3: Advanced Features (Could Have, Future Iterations)**
12. Template composition (base + artifact-specific overrides)
13. Template performance metrics and A/B testing framework
14. Developer CLI tool for local artifact generation

**Pattern Alignment**
- Follows established Clean Architecture: domain entities, application services, infrastructure adapters
- Uses existing repository pattern for entity data access (no new database queries)
- Integrates with T2-004 Bedrock client through `prompt_builder.go` abstraction (no Bedrock client changes)
- Template caching follows cache-aside pattern used elsewhere in the system

### Order of Operations

1. **Domain foundation** — Create `template.go`, `injection_context.go`, `validator.go`, `errors.go` with full test coverage
2. **Template service** — Implement `template_service.go` with loading, caching, rendering logic + tests
3. **Filesystem reader** — Create `template_reader.go` abstraction for file I/O
4. **First template** — Write complete `intent_document_v1.md` with all sections and injection variables
5. **Template validation** — Add startup validation that loads and validates all templates (fail-fast)
6. **Prompt builder integration** — Modify `prompt_builder.go` to accept rendered templates and produce Bedrock messages
7. **Artifact generator integration** — Add `GenerateFromTemplate()` method to `artifact_generator.go`
8. **HTTP handler modification** — Add `?use_template=true` query param to artifact generation endpoint
9. **End-to-end test** — Verify full flow: HTTP request → template load → entity injection → Bedrock call → artifact creation
10. **Documentation** — Write template authoring guide in `README.md` and update `.github/copilot-instructions.md`
11. **Configuration** — Add template directory path and cache settings to `config/app.yaml`

### Dependencies

**Internal (Required)**
- **T2-004 (AWS Bedrock integration)** — Template system invokes `bedrock_client.go` with rendered prompts; cannot function without working LLM connection
- **Entity repositories** — Template injection requires read access to Project, Trajectory, Intent, Orbit data (already exists in domain layer)
- **Artifact persistence** — Generated artifacts must be saved to database (existing flow, no changes needed)

**External (Required)**
- **Git version control** — Template versioning relies on Git history and branching
- **Filesystem access** — Application must read template files from `prompts/templates/` directory at runtime

**Nice to Have (Not Blocking)**
- **Staging environment** — Validate template changes before production deployment (organizational process, not technical dependency)
- **CI/CD pipeline** — Automated deployment of template changes with application code (existing capability, no modifications needed)

---

## Risk Surface

### Edge Cases

**Template Version Mismatch During Deployment**
- **Scenario:** Rolling deployment updates half of instances with new template version while other half still uses old version; concurrent artifact generation produces inconsistent outputs
- **Severity:** Low — annoying but not breaking; artifacts still valid, just stylistically inconsistent
- **Mitigation:** Include template version in generated artifact metadata (`generated_with_template: "intent_document_v1"`); enables tracing which version produced which artifact. Deployment strategy should minimize window: fast rolling restart or blue-green deployment.

**Missing Entity Fields in Injection Context**
- **Scenario:** Template references `{{orbit.summary}}` but Orbit entity passed to injection context has nil Summary (optional field); rendered prompt has empty space or literal `{{orbit.summary}}` text
- **Mitigation:** Strict validation in `injection_context.go` constructor — fail-fast if required fields missing. Template metadata specifies required vs optional variables. For optional fields, use placeholder text: "Summary: (not yet defined)" rather than empty string.

**Malformed Template Syntax Deployed**
- **Scenario:** Template file contains invalid injection variable syntax (`{{project..name}}` double-dot) or missing required section (no `# System Instructions` header); application crashes on startup or artifact generation fails
- **Mitigation:** Template validation runs at application startup — parses all templates, checks for required sections, validates injection variable syntax. If any template invalid, fail-fast prevents deployment. Unit tests include known-bad templates to verify validation catches errors.

**Extremely Large Entity Context**
- **Scenario:** Intent has 50+ constraints or Trajectory has multi-paragraph description; injected context exceeds Bedrock's token limit (100k input tokens for Claude)
- **Mitigation:** Template design includes truncation strategy for large fields: first 500 words of description + "..." indicator. Injection context builder logs warning when field exceeds threshold. Could have: Smart truncation that preserves key sections (constraints more important than rationale).

**Concurrent Template File Modifications**
- **Scenario:** Developer modifies template file on disk while application is running; cache contains stale version, new requests get old template until restart
- **Severity:** Low — only affects local development (production templates immutable after deployment)
- **Mitigation:** Cache invalidation on config reload (existing capability). Document in `README.md`: changes require application restart to take effect. Could have: File watcher that detects template changes and invalidates cache automatically.

### Potential Regressions

**Existing Artifact Generation Flow**
- **Risk:** Adding template-based path breaks current inline prompt generation; existing tests fail, API endpoints return errors
- **Mitigation:** Parallel code paths — old inline prompts remain functional during migration. Feature flag `use_template: false` (default) preserves existing behavior. New path only executes when explicitly requested via `?use_template=true` query param. Integration tests cover both paths.

**LLM Response Parsing**
- **Risk:** Template changes how prompts are structured (e.g., adds XML tags for sections); Bedrock responses change format, existing parsing logic breaks
- **Mitigation:** Response format specification in template must match existing parser expectations. Template validation includes output format rules that parser understands. Test template with known entity context and verify generated artifact parses correctly.

**Entity Repository Query Performance**
- **Risk:** Injection context builder fetches all related entities (Project → Trajectory → Intent → Orbit) on every artifact generation; N+1 query problem or expensive joins
- **Mitigation:** Injection context populated from entities already in memory (artifact generation handler loads entity before calling service). No new database queries introduced. If performance issues arise, add read-through cache for entity lookups (could have).

### Security Considerations

**Template Injection via Entity Data**
- **Risk:** Malicious Project name like `{{system.admin_password}}` attempts to inject template variables; if not properly escaped, could expose sensitive data
- **Severity:** Medium — potential information disclosure
- **Mitigation:** Template rendering uses string replacement, NOT code execution (no `eval()` or script interpretation). Injection context uses strongly-typed structs (Project, Intent entities), not raw string maps — impossible to inject arbitrary variables. Entity data sanitization already enforced at API input layer (max lengths, character restrictions).

**Filesystem Access Control**
- **Risk:** Template directory permissions misconfigured; unauthorized user modifies templates on server filesystem
- **Severity:** High — could inject malicious prompts that leak data or manipulate AI outputs
- **Mitigation:** Template directory read-only for application runtime user. Only deployment process (CI/CD) writes to template directory. File permissions: `644` (owner read/write, group/others read-only). Document in deployment guide: never mount template directory as writable volume.

**Sensitive Data in Template Files**
- **Risk:** Developer accidentally commits API keys or secrets into template file example placeholders
- **Severity:** High if secrets exposed; low if caught early
- **Mitigation:** Template files reviewed during PR process (no secrets policy enforced). `.gitignore` includes `*.local.md` for developer-specific test templates. Pre-commit hook scans template files for common secret patterns (API keys, tokens). Templates never contain real credentials — only placeholder text like `{{config.api_key}}`.

### Performance Considerations

**Template Loading Latency**
- **Scenario:** Every artifact generation request reads template from filesystem (disk I/O), adds 10-50ms per request
- **Severity:** Low — acceptable latency increase for user-facing workflow
- **Mitigation:** In-memory cache loaded at application startup. First request for each artifact type reads file, subsequent requests hit cache. Benchmark: template loading must complete in <50ms p95. Cache invalidation only on application restart or explicit admin action (config reload).

**Large Template Files**
- **Scenario:** Template grows to 10KB+ with extensive system instructions and examples; parsing and injection takes significant time
- **Severity:** Very Low — templates text-only, small compared to entity data payload
- **Mitigation:** Template size limit documented: 50KB max per file (prevents accidental commits of test data). If template exceeds limit, break into base + overrides (could have: template composition feature).

**Memory Footprint of Template Cache**
- **Scenario:** 20+ template versions cached in memory (multiple artifact types × version history), each 10KB; total ~200KB cached
- **Severity:** Very Low — negligible compared to typical application memory (512MB+)
- **Mitigation:** Cache size monitored in application metrics. If cache grows large (>10MB), implement LRU eviction (could have, not needed for initial implementation). Version retention policy: keep only latest 3 versions per artifact type in cache.

---

## Scope Estimate

### Orbit Count Estimate

**Orbit 1 (Must Have):** 1 orbit
- Template domain models, service, validation, filesystem reader
- Single template (`intent_document_v1.md`) with full integration
- Parallel path in artifact generator with feature flag
- Startup validation, caching, end-to-end test
- Estimated: 8-12 files created/modified, medium complexity

**Orbit 2 (Should Have):** 1 orbit (if approved)
- Additional templates (`context_package_v1.md`, `proposal_v1.md`)
- Template metadata endpoint
- Migration of all artifact types to template system
- Deprecation warnings on old prompt path
- Estimated: 5-8 files created/modified, low-medium complexity

**Orbit 3+ (Could Have):** Future iterations
- Template composition, A/B testing, CLI tool
- Performance metrics, advanced caching strategies

**Total Initial Implementation:** 2 orbits

### Complexity Assessment

**Medium Complexity** — Justified by:
- **New domain model:** Template entity with validation rules, injection context builder — requires careful design to avoid future breaking changes
- **Filesystem integration:** Reading files at runtime introduces I/O concerns (error handling, caching strategy, startup validation)
- **Parallel code path:** Maintaining old inline prompts during migration increases testing surface, requires feature flag logic
- **LLM-agnostic design:** Avoiding provider lock-in requires abstract prompt structure, not just "make it work with Claude"
- **Multiple integration points:** Touches domain layer, application services, infrastructure adapters, HTTP handlers — changes ripple across architecture

**Not High Complexity Because:**
- No new database tables or migrations (templates are files, not data)
- No auth changes (template access follows existing service patterns)
- No external API integrations beyond existing Bedrock client
- No concurrency challenges (template loading is synchronous, cached reads)

### Work Phase Breakdown

**Phase 1: Foundation (Must Have) — ~60% of Orbit 1**
- Domain models: Template, InjectionContext, Validator (2-3 files, well-tested)
- Template service: loading, caching, rendering (1 service file + tests)
- Filesystem reader: abstraction for file I/O (1 infrastructure file)
- Validation logic: startup checks, syntax validation (1 domain file + tests)

**Phase 2: Integration (Must Have) — ~40% of Orbit 1**
- First template file: `intent_document_v1.md` with complete sections
- Prompt builder modification: accept template, produce Bedrock messages
- Artifact generator: add `GenerateFromTemplate()` method
- HTTP handler: expose template path via query param
- End-to-end test: full flow verification

**Phase 3: Documentation (Must Have) — overlaps with Phase 2**
- Template authoring guide: `README.md` in templates directory
- Injection variable reference: document all available entity fields
- Update `.github/copilot-instructions.md` with template standards

**Phase 4: Expansion (Should Have) — Orbit 2**
- Additional templates: Context Package, Proposal
- Template metadata endpoint (optional, may defer)
- Migration: switch all artifact types, remove old code
- Metrics: track template usage, generation success rates

### Success Criteria

**Orbit 1 Complete When:**
- [ ] Template directory structure exists with naming conventions documented
- [ ] `intent_document_v1.md` template deployed with all required sections (system instructions, entity context, output format, quality criteria)
- [ ] Template service loads and caches templates on startup, validates syntax, fails-fast if malformed
- [ ] Injection context populates from Project, Trajectory, Intent, Orbit entities
- [ ] At least one artifact successfully generated via template path (verified in integration test)
- [ ] Old inline prompt code still functional (parallel path, no breaking changes)
- [ ] Template authoring guide written (injection variables documented, versioning strategy clear)
- [ ] PR reviewed and approved by System Architect (Trust Tier 2 gate)

**Orbit 2 Complete When:**
- [ ] 3+ artifact types have production templates (Intent Document, Context Package, Proposal)
- [ ] All artifact generation endpoints use template system by default
- [ ] Old inline prompt code removed after 1+ week of zero usage
- [ ] Template metadata endpoint deployed (optional, may defer)

---

## Human Modifications

Pending human review.