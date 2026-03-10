# Verification Protocol: Add Prompt Template Management

**Protocol ID:** VP-T2-005-1
**Generated:** 2026-02-17
**Intent:** T2-005
**Proposal:** PROP-T2-005-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Template directory exists in codebase with clear naming convention | Directory `prompts/templates/artifact_types/` exists with at least one `.md` file following `{type}_v{version}.md` pattern | Filesystem check in `template_service_test.go` — `TestTemplateDirectoryStructure` | Test passes, finds `intent_document_v1.md` | Yes |
| AG-02 | Template loader service reads and caches templates with version metadata | Loading same template twice hits cache on second call (no filesystem I/O) | Unit test `template_service_test.go` — `TestTemplateCaching` | First call reads file, second call returns cached version, filesystem read count = 1 | Yes |
| AG-03 | Template loader service reads and caches templates with version metadata | Template metadata parsed correctly from YAML front matter | Unit test `template_service_test.go` — `TestTemplateMetadataParsing` | Loaded template contains version=1, artifact_type="intent_document", author field present | Yes |
| AG-04 | At least ONE artifact type has complete template with system instructions section | `intent_document_v1.md` contains `# System Instructions` heading | Template validation test `validator_test.go` — `TestRequiredSections` | Validation passes for intent_document_v1.md | Yes |
| AG-05 | At least ONE artifact type has complete template with entity context injection markers | `intent_document_v1.md` contains at least `{{project.name}}`, `{{intent.description}}`, `{{intent.trust_tier}}` | Template validation test `validator_test.go` — `TestInjectionVariables` | Validation identifies all required variables present | Yes |
| AG-06 | At least ONE artifact type has complete template with output format specification | `intent_document_v1.md` contains `# Output Format` section with structured format rules | Template validation test `validator_test.go` — `TestRequiredSections` | Validation passes, output format section present | Yes |
| AG-07 | One generation endpoint uses template system to produce artifact | Integration test generates Intent Document via template path, artifact created successfully | Integration test `artifact_generator_test.go` — `TestGenerateFromTemplate` | Artifact entity persisted to database with content matching template structure | Yes |
| AG-08 | Template versioning strategy documented | `prompts/templates/artifact_types/README.md` exists and contains section on versioning (search for "version" or "v1") | Filesystem check + grep in CI script | README file exists, contains versioning explanation | Yes |
| AG-09 | Template validation on application startup (should have) | Application fails to start if template syntax invalid | Startup validation test `template_service_test.go` — `TestStartupValidation` | Malformed template causes panic/error, prevents server start | Yes |
| AG-10 | Injection variable reference documentation (should have) | README documents available injection variables per entity type | Grep check in `README.md` for "injection" or "variables" | README contains table/list of Project, Trajectory, Intent, Orbit fields | Yes |
| AG-11 | Code quality: lint and format checks pass | No lint violations in new template service and domain code | `make lint && make fmt` in CI pipeline | Zero lint errors, code formatted correctly | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | At least ONE artifact type has complete template with quality criteria/validation rules | Review `intent_document_v1.md` — does it encode ORBITAL framework rules (trust tier assignment, acceptance boundaries structure, etc.)? | Manual template review: read template file, verify instructions match ORBITAL spec from documentation | System Architect |
| HV-02 | One generation endpoint uses template system to produce artifact | Generate an actual Intent Document via `/api/artifacts/generate?use_template=true` in staging — assess quality, coherence, completeness | Manual artifact generation test: create test Intent, invoke endpoint, review generated document | Intent Architect |
| HV-03 | Template metadata header (version, author, last_modified, changelog) — should have | Review template file headers — are metadata fields present and meaningful? | Code review of `intent_document_v1.md` front matter | System Architect |
| HV-04 | Backward compatibility layer: old prompt code still works but logs deprecation warnings (should have) | Generate artifact via old inline prompt path (without `use_template` flag) — verify it works and check logs for deprecation warning | Manual test in staging + log inspection | Verification Engineer |
| HV-05 | Template injection logic does not expose security risks | Review `injection_context.go` and `template_service.go` — verify no code execution, only string replacement; entity data properly typed | Security-focused code review: check for `eval()`, script interpretation, raw string handling | System Architect |
| HV-06 | Template structure aligns with Bedrock message format requirements | Verify template sections map correctly to SystemMessage/UserMessage in `prompt_builder.go` | Code review of prompt_builder.go integration + manual trace through message construction | System Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Template directory exists in codebase with clear naming convention | AG-01 |
| At least ONE artifact type (Intent Document) has a complete template with: system instructions section | AG-04, HV-01 |
| At least ONE artifact type (Intent Document) has a complete template with: entity context injection markers | AG-05 |
| At least ONE artifact type (Intent Document) has a complete template with: output format specification | AG-06 |
| At least ONE artifact type (Intent Document) has a complete template with: quality criteria/validation rules | HV-01 |
| Template loader service reads and caches templates with version metadata | AG-02, AG-03 |
| One generation endpoint uses the template system to produce an artifact | AG-07, HV-02 |
| Template versioning strategy documented | AG-08 |
| Template validation on application startup (fail-fast if template malformed) — should have | AG-09 |
| Template metadata header (version, author, last_modified, changelog) — should have | AG-03, HV-03 |
| Injection variable reference documentation — should have | AG-10 |
| Backward compatibility layer: old prompt code still works but logs deprecation warnings — should have | HV-04 |

**Orphan checks:** None

**Uncovered criteria:**
- "Templates for 3+ artifact types" — deferred to Orbit 2, not blocking Orbit 1 completion

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01 through AG-06, AG-09, AG-11) | re-orbit — fix implementation, ensure template structure and service logic correct | AI Agent |
| Integration test failure (AG-07) | re-orbit — debug artifact generation flow, verify prompt_builder integration, check Bedrock message formatting | AI Agent → System Architect (if Bedrock integration issue) |
| Template quality assessment fails (HV-01) | re-orbit — revise template content to properly encode ORBITAL rules, resubmit for review | System Architect |
| Generated artifact quality poor (HV-02) | modify-intent — if template cannot produce acceptable artifact, approach may be wrong; escalate to reassess strategy | Intent Architect |
| Security concern identified (HV-05) | re-orbit — security-critical, must not ship with injection vulnerabilities or code execution risks | System Architect |
| Backward compatibility broken (HV-04) | re-orbit — old path must remain functional, deprecation warnings required but not blocking | AI Agent |
| Bedrock message format mismatch (HV-06) | re-orbit — template sections must map cleanly to SystemMessage/UserMessage; T2-004 integration dependency | System Architect |
| Documentation incomplete (AG-08, AG-10) | re-orbit — versioning strategy and injection variable reference are must-have for maintainability | AI Agent |
| Startup validation missing (AG-09) | re-orbit — fail-fast on malformed templates prevents production incidents, should-have elevated to must-have | AI Agent |