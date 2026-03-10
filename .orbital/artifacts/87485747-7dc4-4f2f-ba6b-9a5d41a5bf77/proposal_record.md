# Proposal Record: T2-005 · Add Prompt Template Management

**Proposal ID:** PROP-T2-005-O1
**Intent Reference:** T2-005
**Trust Tier:** 2 — Supervised
**Generated:** 2024-01-20

---

## Interpreted Intent

The Prometheus platform currently generates artifacts (Intent Documents, Context Packages, Proposals, etc.) by constructing prompts programmatically within service code. This couples prompt engineering to application logic, making it difficult to iterate on prompt quality, track what instructions were used for a given artifact, or test different prompt strategies without code changes.

This intent establishes a **prompt-as-configuration** system where each artifact type has versioned template files stored in the codebase. When artifact generation is requested, the system loads the appropriate template, hydrates it with entity context (Project, Trajectory, Intent, Orbit metadata), and produces a well-formed prompt ready for submission to AWS Bedrock. The template acts as a specification: it defines what instructions the LLM receives, where entity data is injected, what output format is expected, and what quality criteria apply.

The outcome is deterministic, version-controlled prompt behavior that can be reviewed in pull requests, rolled back if needed, and evolved independently from service code. A developer adding a new artifact type creates a template file following established conventions rather than modifying service logic.

---

## Implementation Plan

### Files to Create

**Template Infrastructure (Core):**
- `internal/llm/template_engine.go` — Template hydration engine using Go's `text/template` package. Exposes `HydrateTemplate(templateContent string, context TemplateContext) (SystemPrompt, UserPrompt string, error)`. Handles parsing, execution, and separation into system/user message structure for Bedrock.
- `internal/llm/template_loader.go` — Template file loading and versioning logic. Provides `LoadTemplate(artifactType ArtifactType, version string) (*Template, error)` and `ListVersions(artifactType ArtifactType) ([]string, error)`. Implements filesystem-based template discovery with in-memory caching.
- `internal/llm/types.go` — Type definitions for template system: `Template`, `TemplateContext`, `TemplateMetadata` structs.

**Template Content (Data):**
- `internal/llm/templates/intent_document_v1.tmpl` — First concrete template for Intent Document generation. Includes system instructions from the Intent Agent skill, entity context injection points for Project/Trajectory/Intent data, ORBITAL Intent Document format specification, and quality criteria (outcome specificity, constraint clarity, acceptance boundaries).
- `internal/llm/templates/README.md` — Developer documentation explaining template structure, versioning convention (filename-based: `{type}_v{major}.tmpl`), how to add new templates, and hydration variable reference (`.Project.Name`, `.Intent.Outcome`, etc.).
- `internal/llm/templates/VERSIONING.md` — Template versioning policy: when to increment versions, how to test new versions before rollout, and version selection configuration.

**Testing:**
- `internal/llm/template_engine_test.go` — Unit tests for template parsing, hydration with mock entity data, error handling for malformed templates, and validation of system/user prompt separation.
- `internal/llm/template_loader_test.go` — Unit tests for template discovery, version selection, caching behavior, and error handling for missing templates.
- `internal/llm/templates/fixtures/` — Test fixture templates for validation (valid template, malformed syntax, missing required fields).

**Integration Points (Modified):**
- `internal/services/artifact_service.go` — Add `templateLoader TemplateLoader` dependency. Update `GenerateArtifact` method to load template based on `artifactType`, hydrate with entity context, then pass hydrated prompts to existing `llmService.Generate()`. No controller interface changes required.
- `internal/services/llm_service.go` — Update `Generate` method signature to accept `systemPrompt` and `userPrompt` as separate parameters (currently takes single prompt string). Map to Bedrock message structure: `[{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}]`.

**Documentation:**
- `docs/architecture/prompt-template-system.md` — Architecture decision record explaining template system design, why templates are filesystem-based, how versioning works, and integration with artifact generation flow.
- `.github/copilot-instructions.md` — Add section on prompt template conventions: structure, variable naming, and testing requirements.

### Approach

**Phase 1: Template Engine Core (Foundation)**
Build the hydration engine and loader as independent components with no external dependencies. Use Go's `text/template` for safe variable interpolation. Implement template caching to meet <50ms performance budget: parse templates once at startup or on first use, cache compiled `*template.Template` instances in memory keyed by `{artifactType}:{version}`.

**Phase 2: Intent Document Template (First Concrete Example)**
Create `intent_document_v1.tmpl` based on the existing Intent Agent skill document. Structure template with clear delimiters:
```
{{/* System Instructions */}}
You are the Intent Agent...

{{/* Entity Context */}}
Project: {{.Project.Name}}
Trajectory: {{.Trajectory.Name}}
Intent Status: {{.Intent.Status}}

{{/* Output Format */}}
Produce markdown with these sections...
```

Test hydration with actual entity instances from test database.

**Phase 3: Service Integration**
Wire template system into `ArtifactService`. When `GenerateArtifact(ctx, ArtifactRequest{Type: IntentDocument, Intent: intentID})` is called:
1. Fetch entity data (Intent + related Project/Trajectory)
2. Load template: `template := templateLoader.LoadTemplate(IntentDocument, "v1")`
3. Build context: `ctx := TemplateContext{Project: proj, Trajectory: traj, Intent: intent}`
4. Hydrate: `systemPrompt, userPrompt, err := templateEngine.HydrateTemplate(template.Content, ctx)`
5. Generate: `response := llmService.Generate(ctx, systemPrompt, userPrompt)`

**Phase 4: Validation & Documentation**
Add validation rules: required template metadata (version, artifact type, token budget), required entity fields per template (fail hydration if missing), and syntax validation at load time. Write README and VERSIONING docs with examples.

### Dependencies

**Must Complete First:**
- Entity context data must be available: `Project`, `Trajectory`, `Intent`, `Orbit` models must be fetched and passed to template engine
- LLM Service from T2-004 must support separate system/user prompt parameters (requires minor refactor of `Generate` method signature)

**Assumes Stable:**
- Entity model schemas (Project.Name, Intent.Outcome, etc.) — any schema changes require template updates
- Bedrock message structure (system/user role separation, content field naming)
- File system access during template loading (not a concern in containerized deployment)

**Blocks Future Work:**
- All subsequent artifact generation orbits depend on this template system being operational
- Template composition/reusability (deferred to future orbit) depends on core engine being proven

### Order of Operations

1. **Define type system** — `internal/llm/types.go` with `Template`, `TemplateContext`, `TemplateMetadata` structs
2. **Implement template engine** — `template_engine.go` with hydration logic and system/user prompt separation
3. **Implement template loader** — `template_loader.go` with filesystem discovery, version selection, and caching
4. **Write unit tests** — Verify parsing, hydration, error handling with test fixtures
5. **Create first template** — `intent_document_v1.tmpl` with complete Intent Agent instructions
6. **Refactor LLM Service** — Update `Generate` signature to accept separate prompts, map to Bedrock structure
7. **Integrate with Artifact Service** — Wire template loader into artifact generation flow
8. **Write integration tests** — End-to-end artifact generation using template system with real entity data
9. **Document conventions** — README and VERSIONING guides, update Copilot instructions
10. **Manual verification** — Generate Intent Document using template, human review for quality

---

## Risk Surface

### Edge Cases

**Missing or Null Entity Fields**
- **Scenario:** Intent in draft status may have null `Constraints` or incomplete `Acceptance` criteria
- **Impact:** Template hydration produces malformed prompt (e.g., "Constraints: <no value>") or fails entirely
- **Mitigation:** Define required fields per template in metadata (`RequiredFields: [Intent.Outcome, Intent.TrustTier]`). Validate completeness before hydration, return validation error with specific missing fields. Use template conditionals for truly optional fields: `{{if .Intent.Constraints}}Constraints: {{.Intent.Constraints}}{{end}}`

**Template Parse Errors at Runtime**
- **Scenario:** Template has invalid Go template syntax (unclosed braces, undefined variables) that passes filesystem checks but fails during hydration
- **Impact:** Artifact generation fails mid-request, poor error message to user
- **Mitigation:** Parse and validate all templates at service startup, fail-fast if any template is malformed. Cache compiled templates to avoid re-parsing. Add CI check that compiles all templates against mock entity data (static analysis)

**Version Selection Ambiguity**
- **Scenario:** Multiple templates match requested artifact type, no explicit version specified in request, unclear which version to use
- **Impact:** Non-deterministic artifact generation, inconsistent output quality
- **Mitigation:** Default to highest version number (lexicographic sort) if not specified. Log template version used for each artifact generation (observable in audit trail). Future: add version pinning configuration per trajectory or project

**Concurrent Template Modification During Deployment**
- **Scenario:** Rolling deployment updates template files while old instances are still serving requests
- **Impact:** Single request may use stale template, brief inconsistency window
- **Mitigation:** Templates cached in memory, parsed once per process lifecycle. No runtime template reloading. Immutable deployment strategy (new container image = new templates). If hot-reload added later, implement cache invalidation with read-write locks

### Potential Regressions

**LLM Service Signature Change**
- **Risk:** Updating `Generate` method to accept `systemPrompt, userPrompt` instead of single `prompt` could break existing callers if any exist outside artifact generation flow
- **Likelihood:** Low — T2-004 just implemented LLM Service, unlikely to have many callers yet
- **Impact:** Compilation failure, easy to catch
- **Mitigation:** Grep codebase for `llmService.Generate` calls before refactoring. Update all call sites in same commit. Add deprecation warning if backward compatibility needed (unlikely for internal API)

**Artifact Service Contract Changes**
- **Risk:** Changing artifact generation internal logic could inadvertently alter response format or error behavior visible to controllers
- **Likelihood:** Low — changes are internal to service, controllers call same `GenerateArtifact` method
- **Impact:** Frontend may not handle new error types or response structure
- **Mitigation:** No controller interface changes planned. Verify artifact response schema unchanged in integration tests. Add test that compares artifact structure before/after template system integration

**Performance Degradation in Artifact Generation**
- **Risk:** Adding template loading + hydration step increases artifact generation latency beyond acceptable threshold
- **Likelihood:** Low — template operations are in-memory string processing, <5ms expected
- **Impact:** Violates <50ms performance budget, degrades user experience
- **Mitigation:** Add performance benchmarks in `template_engine_test.go` that fail if hydration exceeds 10ms (conservative margin). Profile template caching hit rate. Monitor p95 latency of artifact generation endpoint before/after deployment

### Security Considerations

**Template Injection / Code Execution**
- **Risk:** Malicious template content or entity data could exploit template engine to execute arbitrary code
- **Likelihood:** Very Low — templates authored by trusted developers in version-controlled repo, entity data from database
- **Impact:** Critical if possible — code execution, data exfiltration, privilege escalation
- **Mitigation:** Use `text/template` (NOT `html/template` with unsafe functions). Never use `template.FuncMap` with OS interaction functions. Sanitize entity data before hydration: strip control characters, validate UTF-8, escape special chars. Add integration test that attempts injection patterns (`{{.Entity | exec "rm -rf /"}}`) and verifies they render as literal text, not execute

**Sensitive Data Leakage in Templates**
- **Risk:** Template accidentally includes hardcoded credentials, API keys, or production URLs
- **Likelihood:** Low — templates should only contain instructions, not config
- **Impact:** High — credential exposure in version control
- **Mitigation:** Add pre-commit hook that scans templates for credential patterns (API keys, tokens, passwords). Document in README that templates must not include environment-specific values. Code review checklist includes "no sensitive data in templates"

**Entity Data Exposure in Logs**
- **Risk:** Template hydration errors log full entity context, potentially exposing sensitive user data
- **Likelihood:** Medium — error logging often includes context for debugging
- **Impact:** Low-Medium — PII or business-sensitive data in logs
- **Mitigation:** Redact entity data in error messages, log only entity IDs and field names (e.g., "Intent.Outcome is null for intent INT-123"). Never log full entity structs. Review logging statements in template engine and loader

### Performance Concerns

**Template File I/O on Cold Start**
- **Concern:** First artifact generation request after deployment incurs filesystem reads for all template files, causing latency spike
- **Expected Impact:** ~50-100ms one-time cost for reading 5-10 template files from disk, amortized across all future requests
- **Mitigation:** Implement lazy loading (load on first use per template) OR eager loading on service startup (pre-cache all templates). Measure cold start time in integration tests. Consider using Go `embed` directive to bundle templates in binary (zero filesystem dependency, instant load time)

**Template Cache Memory Footprint**
- **Concern:** Caching compiled templates consumes memory, could grow large with many template versions
- **Expected Impact:** ~10-50KB per compiled template, negligible for <100 templates
- **Mitigation:** Monitor memory usage per service instance. Implement cache eviction policy if needed (LRU, keep only active versions). Document expected memory footprint in architecture doc

**Hydration Performance with Large Entity Data**
- **Concern:** Hydrating templates with large entity descriptions or constraint text could exceed 50ms budget
- **Expected Impact:** Typical intent descriptions <2KB, hydration via string interpolation is O(n) where n=template size, expected <5ms
- **Mitigation:** Add benchmark test with max-size entity data (5KB descriptions). Set token budget per template (metadata field), fail hydration if input exceeds budget. Profile hydration with realistic data during development

---

## Scope Estimate

### Orbit Count: 1

This intent can be completed in a single orbit due to:
- **Clear scope boundary:** Only Intent Document template required for minimum viable, no other artifact types
- **No external dependencies:** All work is internal to Prometheus codebase
- **Incremental integration:** Template system integrates with existing artifact generation flow without requiring architectural changes
- **Proven patterns:** Go template engine is standard library, no custom parser needed

### Complexity: Medium

**Justification:**
- **Not Low** because this establishes new infrastructure (template engine, loader, versioning) that will be extended by future work. Requires careful design of abstractions (Template, TemplateContext, TemplateLoader interfaces) to avoid rework later.
- **Not High** because the technical implementation is straightforward (standard Go templates, filesystem I/O, string interpolation). No distributed systems concerns, no database migrations, no complex algorithms.
- **Medium** is appropriate for foundational infrastructure that must be extensible but uses well-understood patterns.

### Work Breakdown

**Phase 1: Foundation (40% of effort)**
- Type definitions and interfaces
- Template engine implementation
- Template loader with caching
- Unit tests for core logic
- **Output:** Working template engine that can hydrate mock templates with test data

**Phase 2: First Template (20% of effort)**
- Intent Document template creation
- Template validation logic
- Developer documentation (README, VERSIONING)
- **Output:** Complete, tested Intent Document template following established format

**Phase 3: Integration (30% of effort)**
- Refactor LLM Service for separate prompts
- Wire template system into Artifact Service
- Integration tests (end-to-end artifact generation)
- Performance benchmarks
- **Output:** Artifact generation flow uses template system, all tests pass

**Phase 4: Validation & Docs (10% of effort)**
- Manual artifact generation verification
- Architecture decision record
- Update Copilot instructions
- **Output:** Production-ready system with complete documentation

### Acceptance Gate

**Minimum Viable (Tier 2 Requirement):**
- [ ] `intent_document_v1.tmpl` exists with complete Intent Agent instructions
- [ ] Template engine hydrates template with Project, Trajectory, Intent, Orbit data
- [ ] Hydrated prompt generates valid Intent Document when submitted to Bedrock
- [ ] Integration point exists in Artifact Service to load and apply templates
- [ ] Template versioning mechanism functional (filename-based)
- [ ] Unit tests verify template loading, hydration, error handling

**Human Verification Required:**
- Generate Intent Document using template system with real intent data
- Compare output quality to manually-crafted prompt baseline
- Verify all required sections present and properly formatted
- Confirm entity context correctly injected (no placeholder values)
- Approve template content and prompt structure before production use

---

## Human Modifications

Pending human review.

---

**Proposal Status:** Ready for Review
**Next Action:** Human architect reviews implementation plan, validates risk mitigations, approves or requests modifications before orbit execution begins.