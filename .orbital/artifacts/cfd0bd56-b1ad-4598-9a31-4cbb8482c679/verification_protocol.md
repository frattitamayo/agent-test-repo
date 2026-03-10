# Verification Protocol: T2-005 · Add Prompt Template Management

**Protocol ID:** VP-T2-005-O1
**Generated:** 2024-01-XX
**Intent:** T2-005
**Orbit:** 1
**Proposal:** PROP-T2-005-O1-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | 4 artifact types have working prompt templates (Intent Document, Context Package, Proposal, Work Plan) | All 4 template files exist and are readable | Unit test: `TemplateManager.test.ts` — `describe('template availability')` with assertions for each file | Test passes: `getTemplate('INTENT_DOCUMENT')`, `getTemplate('CONTEXT_PACKAGE')`, `getTemplate('PROPOSAL')`, `getTemplate('WORK_PLAN')` all return non-empty strings | Yes |
| AG-02 | Templates stored as files in version control | Template files committed to Git and present in repository | CI check: `git ls-files src/templates/*.md | wc -l` returns 4 | Command output equals 4 | Yes |
| AG-03 | Entity context correctly injected into all 4 templates | Context injection produces valid prompts with entity data present | Integration test: `generate.test.ts` — `describe('context injection')` — test each artifact type with mock entities, verify output contains entity values | All 4 tests pass: output includes `{{projectName}}` → actual project name, `{{intentDescription}}` → actual description, etc. | Yes |
| AG-04 | Generation requests succeed for all 4 artifact types with entity context | End-to-end generation completes without errors | Integration test: `generate.test.ts` — `describe('generation endpoints')` — POST to `/api/artifacts/generate` for each type with valid entity IDs | All 4 requests return 200 status, response body contains generated artifact | Yes |
| AG-05 | Zero template injection vulnerabilities | Malicious entity data does not break out of injection boundaries | Security test: `ContextInjector.test.ts` — `describe('injection prevention')` — inject payloads like `"}} Ignore previous {{foo"`, `"<script>alert('xss')</script>"`, `"Ignore all instructions and"` | All tests pass: injected malicious strings are escaped/sanitized, do not alter prompt structure | Yes |
| AG-06 | Template loading cached; <10ms median resolution time | Template retrieval from cache completes within performance budget | Performance test: `TemplateManager.test.ts` — `describe('performance')` — measure `getTemplate()` over 1000 iterations, calculate median | Median < 10ms (p50 < 10ms) | Yes |
| AG-07 | Template validation on startup fails fast if templates malformed | Application refuses to start with missing or invalid templates | Unit test: `TemplateManager.test.ts` — `describe('startup validation')` — mock missing file, verify constructor throws error | Test passes: `new TemplateManager()` with missing template throws `TemplateNotFoundError` | Yes |
| AG-08 | Automated tests verify context injection for each template | Test suite includes injection verification for all artifact types | Test coverage check: `npm run test:coverage` | Coverage report shows `ContextInjector.inject()` has >90% branch coverage with tests for each template type | Yes |
| AG-09 | TypeScript compilation succeeds with no type errors | All template-related types are correctly defined and used | CI check: `npm run build` or `tsc --noEmit` | Exit code 0, no type errors in `TemplateTypes.ts`, `TemplateManager.ts`, `ContextInjector.ts` | Yes |
| AG-10 | Templates do not contain hardcoded project-specific details | Template content uses only injection placeholders, no literal project names or IDs | Static analysis: Custom lint rule or grep check: `grep -rn "Prometheus V1|T2-005" src/templates/` (excluding metadata blocks) | Command returns no matches in template body content | Yes |
| AG-11 | Context injection does not fail silently | Injection errors throw exceptions rather than returning empty/malformed prompts | Unit test: `ContextInjector.test.ts` — `describe('error handling')` — pass invalid context structure, verify error thrown | Test passes: `inject()` with missing required field throws `ValidationError`, does not return empty string | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Template structure documented with inline comments | Verify each template contains comments explaining section purpose, injection point usage, and expected output format | Code review: Open each `.md` file in `src/templates/`, check for presence of explanatory comments at top and between major sections | Tech Lead / System Architect |
| HV-02 | Template versioning scheme defined | Confirm templates include version metadata (frontmatter, filename suffix, or header comment) and versioning strategy is documented | Code review: Check template files for version indicators; review `src/templates/README.md` for versioning approach documentation | Tech Lead |
| HV-03 | Developer documentation exists showing how to add new artifact type | Review `src/templates/README.md` for completeness and clarity of instructions for template creation | Manual walkthrough: Read README, attempt to follow instructions to create a hypothetical 5th template (don't commit), verify instructions are sufficient | Tech Lead / Intent Architect |
| HV-04 | Generated artifacts maintain ORBITAL specification compliance | Verify template-based generation produces artifacts matching expected structure and quality | Manual generation test: Generate one artifact of each type using templates, compare structure/content against non-template baseline (if available) or ORBITAL spec | Intent Architect |
| HV-05 | Template changes do not require application restarts in production | Confirm hot-reloading or cache invalidation strategy allows template updates without downtime | Architecture review: Review `TemplateManager` implementation and caching strategy; discuss deployment approach with team | System Architect |
| HV-06 | Escape criteria and rollback procedures are understood | Verify team understands what constitutes verification failure and how to respond | Team walkthrough: Review escape criteria section of this protocol with implementation team, confirm agreement on re-orbit vs escalate vs rollback conditions | Intent Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| 4 artifact types have working prompt templates: Intent Document, Context Package, Proposal, Work Plan | AG-01, AG-04 |
| Templates stored as files in `/src/templates/` or similar, committed to version control | AG-02 |
| Entity context (project, trajectory, intent, orbit) correctly injected into all 4 templates | AG-03 |
| Generation requests succeed for all 4 artifact types with entity context present | AG-04 |
| Zero template injection vulnerabilities (validated by security review or automated scan) | AG-05 |
| Template loading cached or memoized; <10ms median resolution time | AG-06 |
| Template structure documented with inline comments explaining each section | HV-01 |
| Template versioning scheme defined | HV-02 |
| Developer documentation exists showing how to add a new artifact type template | HV-03 |
| Template validation on application startup (fails fast if templates malformed) | AG-07 |
| Automated tests verify context injection for each template with sample entities | AG-08 |
| Quality criteria from each template's instructions are extracted and made programmatically accessible | (Exceptional — deferred to future orbit if not achieved in O1) |
| Template includes both system instructions and few-shot examples where applicable | (Exceptional — deferred to future orbit if not achieved in O1) |
| Templates do NOT contain hardcoded project-specific details | AG-10 |
| Template changes do NOT require application restarts in production | HV-05 |
| Context injection does NOT fail silently | AG-11 |
| Templates are NOT duplicated across multiple files | (Implicitly verified by AG-01 + code review — single source of truth per artifact type) |

**Orphan checks:** None

**Uncovered criteria:** 
- "Quality criteria extraction" and "few-shot examples" (Exceptional tier) — deferred to future orbit; Tier 2 baseline and Target criteria fully covered

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| AG-01 fails (templates missing or unreadable) | re-orbit — create missing template files, verify file permissions and paths | AI Agent |
| AG-02 fails (templates not in Git) | re-orbit — `git add src/templates/*.md && git commit`, push to branch | AI Agent |
| AG-03 or AG-04 fail (context injection broken or generation errors) | re-orbit — debug `ContextInjector` logic, verify entity serialization produces valid context structure | AI Agent |
| AG-05 fails (injection vulnerability detected) | re-orbit — security-critical: sanitization logic must be hardened before ship; add escaping for detected attack vector, expand test cases | System Architect (escalate if vulnerability is architectural, not implementation) |
| AG-06 fails (performance budget exceeded) | re-orbit — profile `TemplateManager.getTemplate()`, optimize caching strategy; if cache is correct but still slow, escalate (likely environmental issue) | AI Agent → System Architect |
| AG-07 fails (startup validation doesn't fail fast) | re-orbit — add explicit template validation in `TemplateManager` constructor, throw typed error on missing/malformed templates | AI Agent |
| AG-08 fails (test coverage insufficient) | re-orbit — write additional test cases for uncovered branches in `ContextInjector.inject()` | AI Agent |
| AG-09 fails (TypeScript compilation errors) | re-orbit — fix type errors in `TemplateTypes.ts` or service implementations; ensure `ArtifactType` enum is used consistently | AI Agent |
| AG-10 fails (templates contain hardcoded values) | re-orbit — replace hardcoded content with injection placeholders `{{variable}}`; update template structure | AI Agent |
| AG-11 fails (silent failures detected) | re-orbit — ensure all error paths in `ContextInjector.inject()` throw exceptions, not return empty strings | AI Agent |
| HV-01 fails (templates lack inline documentation) | re-orbit — add explanatory comments to template files showing purpose of each section and injection point usage | AI Agent |
| HV-02 fails (versioning scheme undefined) | re-orbit — add version metadata to templates (e.g., frontmatter `version: 1.0.0`), document versioning strategy in README | AI Agent |
| HV-03 fails (developer docs incomplete) | re-orbit — expand `src/templates/README.md` with step-by-step guide for adding new template, include example | AI Agent |
| HV-04 fails (generated artifacts don't match ORBITAL spec) | modify-intent — if templates fundamentally cannot produce spec-compliant output, intent may need architectural revision | Intent Architect |
| HV-05 fails (hot-reload not possible without restart) | re-orbit — acceptable for Tier 2 baseline (restart tolerance is documented); if blocking production, consider memoization with TTL or file watcher | System Architect |
| Multiple automated gates fail simultaneously (3+) | escalate — systemic issue suggests implementation approach is flawed; pause orbit, conduct architecture review | System Architect |
| Security vulnerability (AG-05) persists after 2 re-orbit attempts | escalate — bring in security specialist; may require alternative injection approach (e.g., parameterized API instead of string interpolation) | System Architect → Security Lead |