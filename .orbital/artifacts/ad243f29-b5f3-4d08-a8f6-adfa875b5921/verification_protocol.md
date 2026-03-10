# Verification Protocol: Add Prompt Template Management

**Protocol ID:** VP-T2-005-1  
**Generated:** 2024-01-15  
**Intent:** T2-005  
**Proposal:** PROP-T2-005-1

---

## Automated Gates

### AG-01: Template File Structure Validation
**Traces to:** Minimal Acceptance — "Templates include system instructions, context injection placeholders, and output format specifications"  
**Check:** All template files under `src/services/ai/templates/prompts/` contain valid frontmatter YAML and required sections  
**Tool:** `npm run validate-templates` (script defined in `scripts/validate-templates.ts`)  
**Expected:** Script exits 0, reports 0 errors, confirms all templates have frontmatter with `version`, `artifact_type`, `model` fields, and at least one context injection placeholder  
**Blocking:** Yes

### AG-02: TypeScript Type Safety for Template Context
**Traces to:** Constraint — "Template context injection points must be statically typed"  
**Check:** `TemplateContext` interface in `types.ts` matches all entity field references in templates  
**Tool:** TypeScript compiler (`tsc --noEmit`) + custom lint rule checking template placeholders against context types  
**Expected:** Zero TypeScript compilation errors, zero mismatched placeholder warnings  
**Blocking:** Yes

### AG-03: Template Loader Unit Tests
**Traces to:** Target Acceptance — "Unit tests verify template rendering with mock entity data"  
**Check:** Template loading, caching, version resolution, and error handling  
**Tool:** Jest test suite `src/services/ai/templates/__tests__/TemplateLoader.test.ts`  
**Expected:** All test cases pass:
- `loadTemplate('context-package', 'v1')` returns parsed template with metadata
- Cache hit returns same object instance (reference equality)
- Non-existent template throws `TemplateNotFoundError` with artifact type and searched paths
- Malformed frontmatter throws `TemplateSyntaxError` with file path and line number
- Version resolution defaults to latest when version parameter omitted  
**Blocking:** Yes

### AG-04: Template Renderer Unit Tests
**Traces to:** Target Acceptance — "Unit tests verify template rendering with mock entity data"  
**Check:** Context injection, placeholder substitution, escaping of special characters  
**Tool:** Jest test suite `src/services/ai/templates/__tests__/TemplateRenderer.test.ts`  
**Expected:** All test cases pass:
- Simple substitution: `{{intent.name}}` renders as entity name
- Nested object access: `{{intent.trajectory.project.name}}` works correctly
- Optional field with default: `{{intent.trustTier ?? 'tier_0'}}` renders default when field missing
- HTML entity escaping: `<script>alert(1)</script>` in entity data renders as escaped string
- Template injection prevention: `{{process.exit()}}` in entity data renders as literal text, not executed
- Array iteration (if implemented): `{{#each items}}...{{/each}}` produces expected output  
**Blocking:** Yes

### AG-05: Template Injection Security Tests
**Traces to:** Constraint — "Templates must not allow arbitrary code execution or template injection attacks"  
**Check:** Adversarial input strings from OWASP injection payload list do not execute code  
**Tool:** Security test suite in `TemplateRenderer.test.ts` with injection payloads  
**Expected:** All payloads render as escaped literal text:
- `{{process.env.AWS_SECRET_KEY}}` → literal string output
- `${require('child_process').execSync('whoami')}` → literal string output
- `{{constructor.constructor('return process')()}}` → literal string output  
**Blocking:** Yes

### AG-06: Backwards Compatibility Integration Tests
**Traces to:** Constraint — "Existing artifact generation endpoints must continue to work"  
**Check:** Artifact generation with template system produces same structure as legacy hard-coded prompts  
**Tool:** Jest integration test `src/services/ai/__tests__/ArtifactGenerator.integration.test.ts`  
**Expected:** For each artifact type (Context Package, Proposal, Intent Document):
- Generated artifact has required section headings (snapshot comparison)
- Output format matches existing validation rules (frontmatter present, markdown structure correct)
- API endpoint returns 200 status with valid artifact JSON
- Legacy and template-based generation produce structurally equivalent output (diff < 5%)  
**Blocking:** Yes

### AG-07: Template Performance Benchmark
**Traces to:** Constraint — "Template loading and parsing must add < 50ms latency"  
**Check:** Template cache hit latency and artifact generation end-to-end latency  
**Tool:** Performance test in `src/services/ai/templates/__tests__/TemplateLoader.perf.test.ts`  
**Expected:**
- Template cache hit: p50 < 1ms, p95 < 5ms
- Template cache miss (first load): p50 < 30ms, p95 < 50ms
- End-to-end artifact generation with templates: median latency increase < 10ms compared to baseline (legacy prompts)  
**Blocking:** Yes

### AG-08: TypeScript Compilation
**Traces to:** General code quality baseline  
**Check:** All TypeScript files compile without errors  
**Tool:** `tsc --noEmit`  
**Expected:** Exit code 0, zero compilation errors  
**Blocking:** Yes

### AG-09: Linting and Formatting
**Traces to:** General code quality baseline  
**Check:** Code follows project style guide  
**Tool:** `npm run lint && npm run format:check`  
**Expected:** Zero lint violations, all files formatted correctly  
**Blocking:** Yes

### AG-10: Pre-commit Hook Validation
**Traces to:** Target Acceptance — "Template validation catches syntax errors before runtime"  
**Check:** Template validation runs automatically on commit  
**Tool:** Husky pre-commit hook executing `npm run validate-templates`  
**Expected:** Hook prevents commit if template validation fails, provides actionable error message  
**Blocking:** Yes

### AG-11: Version Control Verification
**Traces to:** Minimal Acceptance — "Template changes are visible in Git history"  
**Check:** Template files are committed to repository and tracked by Git  
**Tool:** `git ls-files src/services/ai/templates/prompts/*.md`  
**Expected:** All template files listed in Git index, `.gitignore` does not exclude template directory  
**Blocking:** Yes

### AG-12: File System Permissions Test
**Traces to:** Security — Templates are read-only in production  
**Check:** Template loading handles read-only file system correctly  
**Tool:** Unit test with mock `fs` module simulating read-only permissions  
**Expected:** Template loader succeeds when files are readable, throws appropriate error when files are missing (not permissions error)  
**Blocking:** Yes

---

## Human Verification Points

### HV-01: Template Content Quality Review
**Traces to:** Minimal Acceptance — "Templates include system instructions, context injection placeholders, and output format specifications"  
**Check:** Review template files for completeness, clarity, and alignment with AI agent roles  
**Method:** Code review of each template file (`context-package/v1.md`, `proposal/v1.md`, `intent-document/v1.md`)  
**Assessed by:** System Architect + Intent Architect  
**Criteria:**
- System instructions clearly define agent role and responsibilities
- Context injection placeholders reference correct entity fields with proper nesting
- Output format specifications include required sections and markdown structure
- Quality criteria are specific and measurable
- Template language is clear and unambiguous (no contradictory instructions)

### HV-02: Template vs Legacy Output Comparison
**Traces to:** Constraint — "Existing artifact generation endpoints must continue to work"  
**Check:** Manually compare artifacts generated by template system vs legacy hard-coded prompts  
**Method:** Generate same artifact (e.g., Context Package for a real intent) using both code paths, side-by-side review  
**Assessed by:** Verification Engineer  
**Criteria:**
- Both outputs contain same required sections
- Information completeness is equivalent (no missing entity data in template version)
- Markdown formatting is consistent (heading levels, list structure)
- Output length is comparable (within 20% of legacy version)
- Any differences are improvements, not regressions

### HV-03: Security Review of Renderer Implementation
**Traces to:** Constraint — "Templates must not allow arbitrary code execution"  
**Check:** Review `TemplateRenderer.ts` implementation for safe string handling  
**Method:** Code review focusing on placeholder substitution logic  
**Assessed by:** System Architect  
**Criteria:**
- No use of `eval()`, `Function()`, or `vm` module
- All context values are treated as data, never executed as code
- String replacement uses safe regex patterns without backreferences to user input
- HTML entity encoding applied to all substituted values
- Error messages don't leak sensitive paths or internal state

### HV-04: Documentation Completeness Review
**Traces to:** Target Acceptance — "Developer documentation explains template structure and authoring guidelines"  
**Check:** Review `docs/templates/README.md` and authoring guide  
**Method:** Read documentation as if you were a new developer authoring a template  
**Assessed by:** Intent Architect  
**Criteria:**
- Document explains frontmatter fields and their purpose
- Context injection syntax is documented with examples
- Versioning policy is clear (when to create new version vs modify existing)
- Testing workflow is explained (how to validate locally before commit)
- Example template walkthrough demonstrates all features
- Common pitfalls and debugging tips are included

### HV-05: Template Versioning Strategy Review
**Traces to:** Target Acceptance — "Template versioning system allows explicit version selection"  
**Check:** Review `TemplateRegistry.ts` implementation and versioning conventions  
**Method:** Code review + manual test of version resolution  
**Assessed by:** System Architect  
**Criteria:**
- Registry maps artifact types to explicit template paths (not dynamic path construction)
- Version resolution logic handles both explicit versions (`v1`, `v2`) and defaults correctly
- Multiple versions can coexist without conflicts
- Template metadata (frontmatter) includes version number that matches file path
- Version selection is deterministic (no race conditions or cache inconsistencies)

### HV-06: Feature Flag Rollout Plan Review
**Traces to:** Risk mitigation strategy from proposal  
**Check:** Review feature flag implementation and rollout procedure  
**Method:** Code review of `src/config/features.ts` + review of deployment plan  
**Assessed by:** System Architect  
**Criteria:**
- Feature flag defaults to safe value (templates off in prod initially)
- Rollout plan includes staging validation period (48+ hours)
- Monitoring is in place for latency, error rate, and output quality metrics
- Rollback procedure is documented and tested
- Flag can be toggled without redeployment (environment variable or runtime config)

### HV-07: End-to-End Generation Test
**Traces to:** Minimal Acceptance — "Template loader resolves and renders templates with entity context at runtime"  
**Check:** Manually trigger artifact generation through API with templates enabled  
**Method:** POST request to `/api/artifacts/generate` with real intent ID, review generated artifact  
**Assessed by:** Verification Engineer  
**Criteria:**
- Request completes successfully (200 status)
- Generated artifact contains all required sections
- Entity context is correctly injected (intent name, description, trajectory info visible in output)
- Output is valid markdown (no syntax errors, correct heading hierarchy)
- Artifact passes existing validation rules (can be saved and displayed)

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| At least 3 artifact types have versioned prompt templates | AG-01, AG-11, HV-01 |
| Templates include system instructions, context injection placeholders, and output format specifications | AG-01, HV-01 |
| Template loader resolves and renders templates with entity context at runtime | AG-03, AG-04, HV-07 |
| Template changes are visible in Git history with descriptive commit messages | AG-11 |
| All current artifact types have templates defined | AG-01, HV-01 |
| Templates include quality criteria and validation rules | HV-01 |
| Template versioning system allows explicit version selection | AG-03, HV-05 |
| Developer documentation explains template structure and authoring guidelines | HV-04 |
| Unit tests verify template rendering with mock entity data | AG-04 |
| Template validation catches syntax errors and missing required sections before runtime | AG-01, AG-10 |
| **Constraint:** Templates stored as code files in repository, not in database | AG-11 |
| **Constraint:** Template context injection points must be statically typed | AG-02 |
| **Constraint:** Existing artifact generation endpoints continue to work | AG-06, HV-02 |
| **Constraint:** Template loading adds < 50ms latency | AG-07 |
| **Constraint:** Templates don't allow arbitrary code execution or template injection attacks | AG-05, HV-03 |

**Orphan checks:** None  
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Template validation script fails (AG-01) | re-orbit — Fix template syntax errors, add missing frontmatter fields, verify required sections present | AI Agent |
| TypeScript compilation errors due to context type mismatches (AG-02) | re-orbit — Update `TemplateContext` interface or correct template placeholder references | AI Agent |
| Template loader or renderer unit tests fail (AG-03, AG-04) | re-orbit — Fix implementation bugs in template system, update tests if requirements changed | AI Agent |
| Template injection security tests fail (AG-05) | escalate — Security vulnerability, requires System Architect review before proceeding | System Architect |
| Backwards compatibility tests reveal breaking changes (AG-06) | re-orbit — Refactor template system to maintain output structure, add migration logic if needed | AI Agent → System Architect (if structural changes required) |
| Performance benchmarks exceed latency constraints (AG-07) | re-orbit — Profile and optimize template loading/rendering; if architectural issue, escalate | AI Agent → System Architect |
| Template content quality review identifies issues (HV-01) | re-orbit — Revise templates per review feedback, ensure alignment with agent roles and output standards | Intent Architect |
| Legacy vs template output comparison reveals regressions (HV-02) | re-orbit — Adjust templates to match legacy output structure, verify entity context completeness | Verification Engineer → AI Agent |
| Security review identifies unsafe renderer implementation (HV-03) | escalate — Critical security issue, requires redesign of rendering approach | System Architect |
| Documentation is incomplete or unclear (HV-04) | re-orbit — Expand documentation with missing sections, add examples, clarify ambiguous instructions | Intent Architect |
| Template versioning strategy has flaws (HV-05) | re-orbit — Refactor registry or version resolution logic, ensure deterministic behavior | System Architect → AI Agent |
| Feature flag or rollout plan review reveals gaps (HV-06) | re-orbit — Add missing monitoring, document rollback procedure, adjust rollout timeline | System Architect |
| End-to-end generation test fails or produces invalid artifacts (HV-07) | re-orbit — Debug template loading, context injection, or rendering pipeline | AI Agent |
| Pre-commit hook validation fails (AG-10) | re-orbit — Developer must fix template syntax before commit allowed | Developer |