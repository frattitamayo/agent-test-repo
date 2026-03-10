# T2-005 · Add Prompt Template Management

## Desired Outcome

The Prometheus platform gains a structured, version-controlled prompt template system that enables consistent, high-quality artifact generation across all ORBITAL phases. Developers can define, version, and maintain artifact-specific prompt templates as code, ensuring reproducible AI behavior and simplified prompt evolution. When an artifact generation request is made, the system automatically selects and hydrates the appropriate template with entity context, producing well-formed prompts that guide LLM responses according to defined specifications and quality criteria.

## Constraints

- **Storage Medium:** Templates MUST be stored in the codebase (filesystem or embedded resources), NOT in the database. This ensures version control, code review, and deployment atomicity.
- **Template Format:** Templates MUST support structured variable interpolation for entity context (project, trajectory, intent, orbit metadata). No dynamic code execution or unsafe eval patterns.
- **Versioning Strategy:** Each template MUST have an explicit version identifier. The system MUST support multiple concurrent template versions to enable gradual rollout and A/B testing.
- **No Breaking Changes:** Template system MUST integrate with existing artifact generation flow without requiring changes to controller interfaces or frontend contracts.
- **Performance Budget:** Template resolution and hydration MUST complete in <50ms (p95) to avoid degrading artifact generation latency.
- **Security Boundary:** Template content MUST NOT include credentials, API keys, or environment-specific configuration. All sensitive context injected at runtime through secure parameter passing.
- **Non-Goal:** This intent does NOT include automatic prompt optimization, LLM response parsing, or multi-step prompt chaining. Those belong in future orbits.

## Acceptance Boundaries

### Minimum Viable (Tier 2 Gate Requirement)

- At least one complete prompt template exists for Intent Document generation, stored in version-controlled code
- Template includes clearly demarcated sections for: system instructions, entity context injection points, output format specification, and quality criteria
- Template engine can hydrate the template with Project, Trajectory, Intent, and Orbit entity data
- Hydrated prompt successfully generates a well-formed Intent Document when submitted to AWS Bedrock
- Template versioning mechanism exists (filename, embedded metadata, or directory structure)
- Integration point exists in artifact generation service to load and apply templates

### Target Success (Optimal Outcome)

- Templates exist for all current artifact types: Intent Document, Context Package, Proposal, Code Changes, Verification Report
- Template structure follows a consistent schema across all artifact types
- Version selection logic allows routing requests to specific template versions via configuration or feature flags
- Template validation ensures all required injection points are populated before LLM submission
- Developer documentation explains template structure, versioning convention, and how to add new templates
- Unit tests verify template loading, hydration, and validation logic

### Exceptional (Exceeds Expectations)

- Template composition system allows reusable fragments (e.g., shared "entity context" section across all templates)
- Template quality metrics capture: token count, hydration time, and successful generation rate per template version
- Admin or developer interface displays available templates, versions, and usage statistics
- Template syntax validation prevents deployment of malformed templates
- Automated tests generate artifacts using multiple template versions and compare outputs for regression detection

## Trust Tier Assignment

**Assigned Tier:** 2 — Supervised

**Rationale:**

This intent touches the critical path of AI-assisted artifact generation — the core value proposition of Prometheus. While the blast radius is limited (templates are configuration, not runtime logic), incorrect template design or faulty hydration could degrade all AI-generated outputs, creating user confusion or broken workflows.

The supervised tier is appropriate because:

1. **Moderate Blast Radius:** Template errors affect artifact quality system-wide but do NOT compromise data integrity, security boundaries, or user authentication
2. **Reversible with Effort:** Rolling back a bad template requires redeployment but does NOT require database migrations or data repair
3. **Quality Verification Required:** Human review is essential to validate that templates produce coherent, actionable artifacts before production use
4. **No Autonomous Fallback:** Unlike feature flags or UI copy changes, prompt template quality cannot be automatically validated — it requires domain expertise to assess output correctness

A tier 1 (autonomous) assignment would be inappropriate because prompt template changes directly influence AI behavior in unpredictable ways. A tier 3 (gated) assignment would be excessive because the system does not touch authentication, payment, or irreversible state mutations.

## Dependencies

### Internal Dependencies

- **T2-004 · Establish AWS Bedrock Integration:** Template system depends on a functioning LLM client to test prompt effectiveness. Template design must align with Bedrock API request structure (system/user message separation, token limits).
- **Existing Artifact Generation Flow:** Templates must integrate with the current artifact service architecture without requiring controller or route changes.
- **Entity Context Schema:** Template hydration requires stable access to Project, Trajectory, Intent, and Orbit metadata. Any changes to these entity schemas will require template updates.

### External Dependencies

- **AWS Bedrock API Stability:** Template token counts and formatting assumptions depend on Bedrock API contracts (particularly Claude 3 Sonnet prompt structure).
- **Version Control System:** Template versioning and history depend on Git for storage, diff tracking, and rollback capability.

### Data Dependencies

- **Entity Metadata Completeness:** Templates assume entity context fields are populated (project name, trajectory description, intent details). Missing or null fields must be handled gracefully in hydration logic.

### Prior Orbit References

None — this is the first orbit to establish prompt template infrastructure. Future orbits will extend template coverage and add advanced features (composition, metrics, validation).