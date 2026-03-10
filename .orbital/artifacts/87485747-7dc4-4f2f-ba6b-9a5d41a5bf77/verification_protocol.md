# Verification Protocol: T2-005 · Add Prompt Template Management

**Protocol ID:** VP-T2-005-O1
**Generated:** 2024-01-20
**Intent:** T2-005
**Proposal:** PROP-T2-005-O1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Template includes clearly demarcated sections for system instructions, entity context injection points, output format specification, and quality criteria | Template file contains required section delimiters | Unit test: `TestTemplateStructure/intent_document_v1_has_required_sections` parsing `intent_document_v1.tmpl` | Test identifies all four required sections using regex or comment markers | Yes |
| AG-02 | Template engine can hydrate the template with Project, Trajectory, Intent, and Orbit entity data | Template hydration succeeds with all entity types | Unit test: `TestTemplateHydration/hydrate_with_full_entity_context` | Returns `SystemPrompt` and `UserPrompt` without error, both strings non-empty | Yes |
| AG-03 | Template engine can hydrate the template with Project, Trajectory, Intent, and Orbit entity data | Hydrated template contains injected entity values | Unit test: `TestTemplateHydration/entity_values_present_in_output` | Output contains `Project.Name`, `Trajectory.Name`, `Intent.Outcome` values from test fixtures | Yes |
| AG-04 | Template versioning mechanism exists | Template loader identifies template version from filename or metadata | Unit test: `TestTemplateLoader/extract_version_from_filename` | Correctly parses version "v1" from `intent_document_v1.tmpl` | Yes |
| AG-05 | Template versioning mechanism exists | Template loader can list all available versions for an artifact type | Unit test: `TestTemplateLoader/list_versions` with multiple template files | Returns `[]string{"v1", "v2"}` for artifact type with two template versions | Yes |
| AG-06 | Integration point exists in artifact generation service to load and apply templates | Artifact Service calls template loader when generating artifacts | Unit test: `TestArtifactService/uses_template_loader` with mocked dependencies | Verifies `templateLoader.LoadTemplate()` called with correct artifact type | Yes |
| AG-07 | Integration point exists in artifact generation service to load and apply templates | Artifact Service passes hydrated prompts to LLM Service | Unit test: `TestArtifactService/passes_hydrated_prompts_to_llm` | Verifies `llmService.Generate()` receives separate `systemPrompt` and `userPrompt` | Yes |
| AG-08 | Unit tests verify template loading, hydration, and validation logic | Template engine test suite exists and passes | CI: `go test ./internal/llm/...` | All tests in `template_engine_test.go` and `template_loader_test.go` pass | Yes |
| AG-09 | Template validation ensures all required injection points are populated before LLM submission | Template hydration fails with validation error when required entity field is null | Unit test: `TestTemplateEngine/missing_required_field` | Returns error containing missing field name when `Intent.Outcome` is nil | Yes |
| AG-10 | Template validation ensures all required injection points are populated before LLM submission | Template hydration succeeds when optional field is null | Unit test: `TestTemplateEngine/missing_optional_field` | Successfully hydrates template when `Intent.Constraints` is nil using conditional block | Yes |
| AG-11 | Template versioning mechanism exists | Template loader caches parsed templates | Unit test: `TestTemplateLoader/caching_behavior` | Second load of same template returns cached instance (no filesystem read) | Yes |
| AG-12 | Performance budget: Template resolution and hydration < 50ms p95 | Template hydration completes within latency budget | Benchmark test: `BenchmarkTemplateHydration` with realistic entity data | p95 latency < 50ms over 1000 iterations | Yes |
| AG-13 | At least one complete prompt template exists for Intent Document generation, stored in version-controlled code | Intent Document template file exists in codebase | CI: File existence check `test -f internal/llm/templates/intent_document_v1.tmpl` | File exists and is committed to version control | Yes |
| AG-14 | Template syntax validation prevents deployment of malformed templates | Template parsing validates syntax at service startup | Integration test: `TestServiceInitialization/invalid_template_fails_startup` | Service initialization fails fast when template has parse errors | Yes |
| AG-15 | Template structure follows a consistent schema across all artifact types | All templates use Go text/template syntax | CI: Static analysis `grep -L "{{" internal/llm/templates/*.tmpl` | All `.tmpl` files contain template interpolation syntax | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Hydrated prompt successfully generates a well-formed Intent Document when submitted to AWS Bedrock | Generated Intent Document contains all required ORBITAL sections | Manual artifact generation with real intent data, inspect output structure | Intent Architect |
| HV-02 | Hydrated prompt successfully generates a well-formed Intent Document when submitted to AWS Bedrock | Generated Intent Document content is coherent and actionable | Read generated document, assess clarity of outcome, specificity of constraints, testability of acceptance criteria | Intent Architect |
| HV-03 | Template includes clearly demarcated sections for system instructions, entity context injection points, output format specification, and quality criteria | Template system instructions match Intent Agent skill document | Compare `intent_document_v1.tmpl` system section against Intent Agent skill reference | System Architect |
| HV-04 | Developer documentation explains template structure, versioning convention, and how to add new templates | README provides sufficient guidance for template creation | Review `internal/llm/templates/README.md`, attempt to create mock template following only README instructions | Developer (unfamiliar with system) |
| HV-05 | Developer documentation explains template structure, versioning convention, and how to add new templates | VERSIONING guide explains when to increment versions | Review `internal/llm/templates/VERSIONING.md`, verify policy covers breaking vs. non-breaking changes | System Architect |
| HV-06 | Integration point exists in artifact generation service to load and apply templates | Template system integration does not alter artifact generation controller interface | Review `ArtifactService.GenerateArtifact()` signature, verify controllers require no changes | System Architect |
| HV-07 | Template validation ensures all required injection points are populated before LLM submission | Error messages for missing entity fields are actionable | Trigger validation error by hydrating template with incomplete entity, assess error message clarity | Verification Engineer |
| HV-08 | Template structure follows a consistent schema across all artifact types | Template file structure is consistent and maintainable | Code review of `intent_document_v1.tmpl`, assess readability, section organization, comment clarity | System Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| **Minimum Viable:** At least one complete prompt template exists for Intent Document generation, stored in version-controlled code | AG-13, HV-01, HV-02, HV-03 |
| **Minimum Viable:** Template includes clearly demarcated sections for: system instructions, entity context injection points, output format specification, and quality criteria | AG-01, HV-03, HV-08 |
| **Minimum Viable:** Template engine can hydrate the template with Project, Trajectory, Intent, and Orbit entity data | AG-02, AG-03, AG-10 |
| **Minimum Viable:** Hydrated prompt successfully generates a well-formed Intent Document when submitted to AWS Bedrock | HV-01, HV-02 |
| **Minimum Viable:** Template versioning mechanism exists (filename, embedded metadata, or directory structure) | AG-04, AG-05, AG-11 |
| **Minimum Viable:** Integration point exists in artifact generation service to load and apply templates | AG-06, AG-07, HV-06 |
| **Target Success:** Template structure follows a consistent schema across all artifact types | AG-15, HV-08 |
| **Target Success:** Version selection logic allows routing requests to specific template versions via configuration or feature flags | AG-05 (partial — version selection mechanism exists, configuration not required for MV) |
| **Target Success:** Template validation ensures all required injection points are populated before LLM submission | AG-09, AG-10, HV-07 |
| **Target Success:** Developer documentation explains template structure, versioning convention, and how to add new templates | HV-04, HV-05 |
| **Target Success:** Unit tests verify template loading, hydration, and validation logic | AG-08 |
| **Exceptional:** Template syntax validation prevents deployment of malformed templates | AG-14 |
| **Constraint:** Performance budget: Template resolution and hydration < 50ms p95 | AG-12 |

**Orphan checks:** None

**Uncovered criteria (Target/Exceptional not required for Tier 2 gate):**
- Templates exist for all current artifact types (Intent Document only required for MV)
- Template composition system (deferred to future orbit)
- Template quality metrics (deferred to future orbit)
- Admin interface for template management (deferred to future orbit)
- Multi-version regression testing (deferred to future orbit)

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Automated gate failure (AG-01 through AG-15) | re-orbit — Fix implementation, run tests locally, re-submit for verification | AI Agent |
| Generated Intent Document missing required sections (HV-01) | re-orbit — Template structure incorrect, revise `intent_document_v1.tmpl` system instructions or format specification | Intent Architect |
| Generated Intent Document incoherent or low quality (HV-02) | re-orbit — Template prompt engineering inadequate, revise system instructions or add quality criteria examples | Intent Architect |
| Template system instructions diverge from Intent Agent skill (HV-03) | re-orbit — Update template to match canonical skill document, re-generate artifact for verification | System Architect |
| Documentation insufficient for template creation (HV-04) | re-orbit — Expand README with examples, clarify variable naming conventions, add troubleshooting section | AI Agent → System Architect review |
| Versioning policy unclear or ambiguous (HV-05) | re-orbit — Clarify version increment rules, add decision tree for breaking vs. non-breaking changes | System Architect |
| Template integration requires controller changes (HV-06) | modify-intent — Original constraint violated (no controller changes), escalate to re-scope or adjust implementation approach | System Architect → Intent Architect |
| Validation error messages unhelpful (HV-07) | re-orbit — Improve error message formatting, include field names and suggested fixes | AI Agent |
| Template file structure inconsistent or hard to maintain (HV-08) | re-orbit — Refactor template organization, add section comments, document structure in README | System Architect |
| Performance budget exceeded (AG-12) | re-orbit — Profile hydration, optimize template parsing or caching strategy; if architectural limitation, escalate | AI Agent → System Architect |
| Template parsing fails at service startup (AG-14) | re-orbit — Fix template syntax errors, ensure all templates compile before deployment | AI Agent |
| Integration test reveals template system breaks existing artifact generation | rollback — Critical regression, revert template system integration, investigate root cause offline | System Architect |