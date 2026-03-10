# T2-005 · Add Prompt Template Management

## Desired Outcome

Artifact generation requests consistently produce high-quality outputs that match ORBITAL specifications without manual prompt engineering. Developers can add new artifact types or update existing generation logic by modifying versioned template files in the codebase, with changes tracked through standard code review processes. The system injects project, trajectory, intent, and orbit context into prompts automatically, eliminating repetitive manual context assembly.

## Constraints

- **No database storage**: Templates must live in the codebase as files, not database records, to leverage Git version control and standard development workflows
- **No runtime template compilation**: Templates are loaded at application startup or cached; no dynamic string interpolation that could introduce injection vulnerabilities
- **Backward compatibility**: Existing artifact generation endpoints (Intent Document, Context Package, Proposal, Work Plan) must continue functioning during and after implementation
- **Performance budget**: Template resolution and context injection must complete in <50ms per generation request
- **Type safety**: Template-to-artifact-type mappings must be compile-time safe (no string-based lookups that could fail silently)
- **Non-goal**: This intent does NOT include multi-turn conversation support, template versioning UI, or user-customizable templates

## Acceptance Boundaries

**Minimum Viable (Tier 2 baseline):**
- 4 artifact types have working prompt templates: Intent Document, Context Package, Proposal, Work Plan
- Templates stored as files in `/src/templates/` or similar, committed to version control
- Entity context (project, trajectory, intent, orbit) correctly injected into all 4 templates
- Generation requests succeed for all 4 artifact types with entity context present
- Zero template injection vulnerabilities (validated by security review or automated scan)

**Target (Preferred outcome):**
- All acceptance criteria from minimum viable, plus:
- Template loading cached or memoized; <10ms median resolution time
- Template structure documented with inline comments explaining each section
- Template versioning scheme defined (e.g., semantic version in filename or frontmatter)
- Developer documentation exists showing how to add a new artifact type template

**Exceptional (Exceeds expectations):**
- All target criteria, plus:
- Template validation on application startup (fails fast if templates malformed)
- Automated tests verify context injection for each template with sample entities
- Quality criteria from each template's instructions are extracted and made programmatically accessible
- Template includes both system instructions and few-shot examples where applicable

**Unacceptable outcomes:**
- Templates contain hardcoded project-specific details instead of injection points
- Template changes require application restarts in production
- Context injection fails silently, producing malformed prompts
- Templates duplicated across multiple files instead of reused

## Trust Tier Assignment

**Tier 2 — Supervised**

**Rationale:**
This intent directly affects the quality and safety of all AI-generated artifacts in the ORBITAL system. Malformed templates or injection vulnerabilities could cause:
- Silent degradation of artifact quality across all users
- Prompt injection attacks if context interpolation is unsafe
- Production incidents if template loading blocks critical paths

However, the blast radius is contained:
- Changes are code-based and go through standard review
- Template errors surface immediately in testing
- No database migrations or data model changes
- Rollback is trivial (revert commit)

Tier 2 is appropriate because this is foundational infrastructure that requires human verification of security and quality implications, but does not touch authentication, payments, or user data directly (which would elevate to Tier 3).

## Dependencies

**Existing Systems:**
- AWS Bedrock integration (T2-001) — the LLM invocation layer that will consume these templates
- Artifact generation endpoints — current endpoints that manually construct prompts must be refactored to use templates

**Entity Data Model:**
- Project, Trajectory, Intent, Orbit entities must be accessible with their full context (name, description, status, relationships)
- Context injection requires stable entity serialization format (likely JSON or structured text)

**Prior Orbits:**
- T2-001 completion provides the LLM client that templates will integrate with
- If T2-001 is incomplete, this orbit can proceed using mock/stub LLM responses for template testing

**External Dependencies:**
- None — this is internal infrastructure with no external service dependencies