# Proposal Record: Add Prompt Template Management

**Proposal ID:** PROP-T2-005-1  
**Generated:** 2024-01-15  
**Intent:** T2-005  
**Context Package:** CTX-INT-T2-005  
**Trust Tier:** 2 — Supervised (core artifact generation pipeline modification)

---

## Interpreted Intent

When developers request artifact generation (Context Package, Proposal, Intent Document), the system currently uses hard-coded prompt strings embedded in `ArtifactGenerator.ts`. This creates maintenance burden, makes prompt evolution difficult to track, and prevents version control of the critical instructions given to the AI. The goal is to extract these prompts into versioned markdown template files stored in the codebase, with a structured system for loading, rendering with entity context, and caching. After this implementation, changing a prompt becomes a code change (reviewed, tested, rolled back) rather than a deployment risk. The system should support multiple versions of templates, allowing explicit version pinning while defaulting to the latest stable version.

This is foundational work for the broader LLM integration trajectory — establishing the pattern for how AI instructions are managed across all future AI-powered features. The constraint boundary is clear: templates are code assets committed to Git, not runtime configuration stored in the database. The security boundary is equally clear: user-supplied entity data must be safely escaped during context injection to prevent template injection attacks.

---

## Implementation Plan

### Files to Create

**Template System Core:**
- `src/services/ai/templates/TemplateLoader.ts` — Loads template files from disk, parses frontmatter metadata, caches parsed templates in memory. Exports `loadTemplate(type: ArtifactType, version?: string): Promise<Template>`.
- `src/services/ai/templates/TemplateRenderer.ts` — Injects entity context into template placeholders using safe substitution. Exports `render(template: Template, context: TemplateContext): string`.
- `src/services/ai/templates/types.ts` — TypeScript interfaces for `Template`, `TemplateMetadata`, `TemplateContext`, and `ArtifactType` enum.
- `src/services/ai/templates/TemplateRegistry.ts` — Maps artifact types to template file paths and default versions. Exports `resolveTemplate(type: ArtifactType): string` returning path like `prompts/context-package/v1.md`.

**Template Files (initial v1 migrations):**
- `src/services/ai/templates/prompts/context-package/v1.md` — Extracted from current `generateContextPackage()` method
- `src/services/ai/templates/prompts/proposal/v1.md` — Extracted from current `generateProposal()` method  
- `src/services/ai/templates/prompts/intent-document/v1.md` — Extracted from current `generateIntentDocument()` method
- `src/services/ai/templates/prompts/_base.md` — Shared instructions (role definition, output constraints, formatting rules) included by other templates

**Testing Infrastructure:**
- `src/services/ai/templates/__tests__/TemplateLoader.test.ts` — Unit tests for file loading, caching behavior, version resolution, error handling for missing templates
- `src/services/ai/templates/__tests__/TemplateRenderer.test.ts` — Unit tests for context injection, placeholder substitution, nested object access, array iteration, escaping of special characters
- `src/services/ai/templates/__tests__/fixtures/mock-entities.ts` — Sample entity data (Project, Intent, Orbit) for test cases
- `src/services/ai/templates/__tests__/fixtures/test-template.md` — Minimal template for parsing validation

**Validation Tooling:**
- `scripts/validate-templates.ts` — CI script that parses all templates, checks syntax, verifies required sections, runs smoke test with mock context
- `.husky/pre-commit` — Add template validation to pre-commit hook (existing hook file, append to it)

### Files to Modify

**Integration Layer:**
- `src/services/ai/ArtifactGenerator.ts` — Refactor to consume template system:
  - Add constructor dependencies: `TemplateLoader`, `TemplateRenderer`
  - Replace hard-coded template literals with template resolution and rendering
  - Keep existing method signatures (`generateContextPackage()`, etc.) unchanged for backwards compatibility
  - Add private method `_renderTemplateForArtifact(type, context)` as shared rendering logic
  - Add feature flag check: `if (useTemplateSystem)` with fallback to legacy prompts during rollout

**Context Assembly:**
- `src/services/ai/ArtifactGenerator.ts` (same file, context building section) — Extract entity context assembly into dedicated method `_buildTemplateContext(intentId, orbitNumber): TemplateContext`. Currently this logic is duplicated across generation methods.

**Type Definitions:**
- `src/services/ai/types.ts` — Add `ArtifactType` enum if not already defined, add `TemplateContext` interface matching entity structure

**Configuration:**
- `src/config/features.ts` — Add feature flag `USE_TEMPLATE_SYSTEM: boolean` (default: `process.env.NODE_ENV === 'development'`)

**Documentation:**
- `docs/templates/README.md` — Template authoring guide: syntax, versioning policy, testing workflow, example template walkthrough
- `docs/templates/CHANGELOG.md` — Template version history tracking changes to prompts over time

### Approach

Follow a **strangler fig pattern** — build the new template system alongside the existing hard-coded prompts, then gradually migrate artifact types one at a time. The legacy code path remains fully functional as a fallback.

**Phase 1: Template Infrastructure (Orbit 1)**  
Build the core template loading, rendering, and caching system without touching existing artifact generation logic. Templates are read from disk, parsed (frontmatter extraction), and cached in memory. Context injection uses safe string substitution with explicit type checking.

**Phase 2: Extract First Template (Orbit 1)**  
Migrate Context Package generation to templates. Copy the existing hard-coded prompt into `prompts/context-package/v1.md` as-is. Wire `ArtifactGenerator.generateContextPackage()` to use the template loader and renderer. Run parallel validation: generate with both old and new code paths, compare outputs. Feature flag controls which path is active.

**Phase 3: Remaining Templates (Orbit 2)**  
Migrate Proposal and Intent Document generation following the same pattern. At this point, all artifact types use templates. Legacy code paths can be deprecated.

**Phase 4: Validation & Rollout (Orbit 2)**  
Enable templates in production behind feature flag. Monitor latency, error rates, and output quality. Gradual rollout: 10% traffic → 50% → 100%. Remove legacy code once stable.

**Template Syntax:**  
Use minimal custom syntax to avoid dependency on heavy templating libraries:
- `{{entity.field}}` for simple substitution  
- `{{entity.field ?? 'default'}}` for optional fields with defaults  
- `{{#each array}}...{{/each}}` for iteration (if needed)  
- Escape all context values by default (HTML entity encoding) to prevent injection

**Rendering Strategy:**  
Keep it simple — regex-based find-and-replace for placeholders. No eval(), no Function(), no arbitrary JavaScript execution. Template is a string, context is a typed object, output is a string. Security through simplicity.

### Order of Operations

1. **Define TypeScript interfaces** (`types.ts`) — Template, TemplateMetadata, TemplateContext, registry map
2. **Implement TemplateLoader** with caching and version resolution logic
3. **Implement TemplateRenderer** with safe context injection (unit test injection attacks first)
4. **Create TemplateRegistry** with hardcoded artifact type mappings
5. **Extract Context Package prompt** into `v1.md` template file with frontmatter
6. **Write template validation script** and integrate into CI
7. **Refactor `generateContextPackage()`** to use template system (feature-flagged)
8. **Add integration test** comparing old vs new output for Context Package generation
9. **Extract Proposal and Intent Document prompts** into template files
10. **Wire remaining generation methods** to template system
11. **Document template authoring** workflow and versioning policy
12. **Enable feature flag in staging** and validate with real requests
13. **Production rollout** with monitoring and gradual traffic shift

### Dependencies

- **T2-004 (Bedrock Integration)** must be complete — `BedrockClient.generate()` is the downstream consumer of rendered templates
- **Node.js file system APIs** (`fs.readFileSync`, `fs.readdirSync`) for template loading at startup
- **Existing entity services** (`ProjectService`, `IntentService`, `OrbitService`) provide context data
- **No external dependencies** — intentionally avoiding templating libraries (Handlebars, Mustache, EJS) to minimize attack surface and bundle size

---

## Risk Surface

### Edge Cases

**Scenario: Template file not found**  
Context: Developer requests artifact generation with `type: 'experiment-log'` but no template exists at `prompts/experiment-log/v1.md`.  
Mitigation: `TemplateLoader.loadTemplate()` throws `TemplateNotFoundError` with artifact type and searched paths. API layer catches and returns 400 with actionable message: "Artifact type 'experiment-log' not supported. Supported types: context-package, proposal, intent-document."  
Test: Unit test with non-existent artifact type, verify error message format.

**Scenario: Circular template includes**  
Context: `_base.md` includes `context-package.md` which includes `_base.md` — infinite loop during rendering.  
Mitigation: Not implementing template includes in v1 — each template is standalone. If includes are added later, track inclusion stack and throw error on circular reference.  
Test: N/A for v1 scope.

**Scenario: Malformed frontmatter YAML**  
Context: Template has invalid YAML syntax in frontmatter section (unclosed quote, indentation error).  
Mitigation: Use robust YAML parser with error handling. Validation script catches this during CI. Runtime loader logs parse error with file path and line number, then throws `TemplateSyntaxError`.  
Test: Create test template with broken YAML, verify validation script detects it, verify runtime error includes line number.

**Scenario: Context field missing at render time**  
Context: Template has `{{intent.trustTier}}` but intent entity loaded from database has no `trustTier` field (schema evolution, old data).  
Mitigation: Use optional chaining in renderer: missing fields render as empty string with warning logged. Template context builder includes explicit null checks and throws error during context assembly (before rendering) if required fields are undefined.  
Test: Unit test with incomplete entity data, verify error message identifies missing field, verify optional fields render as empty without error.

**Scenario: Unicode and special characters in entity data**  
Context: Intent name contains emoji, Markdown special characters (`#`, `*`, `[`), or non-breaking spaces.  
Mitigation: Renderer HTML-encodes all context values by default. Markdown special characters in rendered output are preserved (they're content, not formatting). Log warning if entity data contains control characters (null bytes, form feed).  
Test: Integration test with adversarial intent name: `# Intent {{process.exit()}} 💥 [link](javascript:alert(1))`

### Regressions

**Existing artifact generation endpoints breaking**  
Current behavior: `POST /api/artifacts/generate` with `type: 'context-package'` returns markdown artifact within ~2-3 seconds.  
Risk: Template system refactor introduces error, changes output format, or adds latency beyond acceptable threshold.  
Mitigation: Feature flag allows instant rollback. Integration tests compare output format (section headings, required content blocks) between old and new code paths. Load test verifies latency within bounds. Parallel run in staging for 48 hours before production rollout.  
Evidence: Integration test suite with snapshot testing of artifact structure, performance benchmark with 100 concurrent requests.

**Template changes affecting downstream parsing**  
Current behavior: Frontend parses generated artifacts expecting specific heading structure (e.g., "## Codebase References" in Context Package).  
Risk: Template author changes heading text, breaks frontend artifact display.  
Mitigation: Document required sections and heading format in template authoring guide. Validation script checks for required section presence. Consider output schema validation (e.g., artifact must have frontmatter, specific headings, minimum word count).  
Evidence: Validation script runs on every template change, CI fails if required sections missing.

### Security

**Template injection via user-supplied entity data**  
Attack vector: Malicious user creates intent with name `{{process.env.AWS_SECRET_KEY}}` or `${require('child_process').execSync('rm -rf /')}`, attempting code execution during template rendering.  
Mitigation: Renderer uses string replacement only — no `eval()`, no `Function()`, no arbitrary code execution. All context values are treated as data, not code. Even if attacker includes template syntax in entity data, it's escaped and rendered as literal text. Template parsing happens on static files only, never on user input.  
Test: Unit test with injection payloads from OWASP cheat sheet, verify they render as escaped strings.

**Unauthorized template modification**  
Attack vector: Attacker gains write access to template files in production, modifies prompts to leak sensitive data or produce harmful artifacts.  
Mitigation: Templates are read-only in production (file system permissions). Template loading happens at startup or first use, not on every request. Changes require code deploy through standard CI/CD pipeline with code review. Production container image is immutable.  
Monitoring: File integrity monitoring alerts on unexpected changes to `templates/` directory.

**Information disclosure through template errors**  
Attack vector: Attacker triggers template rendering error to leak internal file paths, AWS credentials, or database schema through error messages.  
Mitigation: Error responses sanitize paths (show relative path from project root, not absolute file system path). Stack traces never exposed to API responses (logged server-side only). Template metadata (frontmatter) does not include sensitive config.  
Test: Integration test verifies error response format, checks for sensitive data leakage.

### Performance

**Template loading latency**  
Concern: Reading template file from disk on every artifact generation request adds 50-100ms, violating performance constraint.  
Mitigation: In-memory cache holds parsed templates after first load. Cache key is `${artifactType}:${version}`. Cache is populated at application startup (warmup phase loads all templates). Cache has no TTL — templates are immutable once deployed. Only cache miss (new template version) incurs file system read.  
Target: Template cache hit < 1ms, cache miss < 50ms, median artifact generation latency increase < 10ms.  
Monitoring: Latency histogram per artifact type, cache hit rate metric.

**Template parsing overhead**  
Concern: Parsing markdown frontmatter and rendering context on every request adds CPU overhead.  
Mitigation: Frontmatter parsed once at load time, stored in cached Template object. Rendering is lightweight string substitution (regex-based find/replace). No AST parsing, no markdown compilation during rendering.  
Target: Rendering latency < 5ms for typical context size (5KB entity data).  
Benchmark: Load test with 100 req/sec sustained, monitor CPU usage and P95 latency.

**Memory footprint of template cache**  
Concern: Caching all template versions in memory increases RAM usage, risks OOM in resource-constrained environments.  
Mitigation: Template files are small (~5-10KB each). With 10 artifact types × 3 versions each = 30 templates × 10KB = 300KB total. Negligible compared to typical Node.js heap (512MB+). Cache size is bounded by template count (known at deploy time).  
Monitoring: Heap usage metric, cache entry count.

---

## Scope Estimate

### Complexity Assessment

**Medium Complexity** — New system but well-defined boundaries. Not modifying authentication, database schema, or distributed system concerns. Primary complexity is ensuring backwards compatibility during migration and covering edge cases in template rendering. Follows established patterns (service-oriented architecture, dependency injection, unit testing). No novel algorithms or complex state management.

Justification:
- Creating new subsystem (template management) rather than modifying existing critical paths
- Clear interface contracts (load template → inject context → return string)
- Risk mitigation through feature flags and parallel validation
- Well-understood domain (file loading, string substitution, caching)
- Moderate test coverage requirements (edge cases in rendering logic)

### Estimated Orbit Count

**2 Orbits**

**Orbit 1 Breakdown:**
- Template infrastructure (loader, renderer, registry, types)
- First template migration (Context Package)
- Validation tooling and CI integration
- Unit test suite for template system
- Integration test comparing old vs new Context Package output
- Documentation (authoring guide)

**Orbit 2 Breakdown:**
- Remaining template migrations (Proposal, Intent Document)
- Feature flag rollout in staging
- Performance benchmarking and optimization
- Production rollout with monitoring
- Deprecation of legacy code paths
- Template version history documentation

### Work Phase Breakdown

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| **Foundation** | 2 days | Types, TemplateLoader, TemplateRenderer with unit tests |
| **First Migration** | 2 days | Context Package template, integration with ArtifactGenerator, parallel validation |
| **Validation Infrastructure** | 1 day | CI script, pre-commit hook, error handling |
| **Remaining Templates** | 2 days | Proposal and Intent Document templates, full feature flag integration |
| **Testing & Rollout** | 2 days | Load testing, staging validation, gradual production rollout |
| **Documentation & Cleanup** | 1 day | Authoring guide, version history, legacy code removal |

**Total estimated effort:** 10 developer-days across 2 orbits (assuming 1 developer, ~1 week per orbit with review cycles)

### Estimated Test Count

- **Unit tests:** 15-20 (loader edge cases, renderer escaping, caching behavior, version resolution)
- **Integration tests:** 6 (one per artifact type × old vs new comparison, plus error scenarios)
- **Validation scripts:** 1 (template syntax and structure checks)
- **Load tests:** 1 (latency and throughput with templates enabled)

---

## Human Modifications

Pending human review.