# Add Prompt Template Management

## Desired Outcome

Artifact generation becomes consistent, maintainable, and version-controlled through a structured prompt template system. When developers or AI agents need to generate artifacts (Intent Documents, Context Packages, Proposals, etc.), they use standardized templates that inject entity context, enforce format specifications, and codify quality criteria — eliminating ad-hoc prompt construction and enabling systematic improvement of AI outputs through template versioning.

## Constraints

- **No database storage** — Templates MUST live in the codebase as files (`.md`, `.txt`, or similar) to enable Git-based version control, diff reviews, and deployment through standard CI/CD pipelines.
- **No breaking changes to existing generation flow** — Current artifact generation endpoints and workflows continue to function; templates augment but do not replace existing prompt logic until explicitly migrated.
- **Entity context remains dynamic** — Templates define injection points but do NOT hardcode entity data; context (Project name, Trajectory description, Intent details, etc.) is passed at runtime.
- **No LLM-specific syntax lock-in** — Template structure should be LLM-agnostic where possible; avoid Claude-only or GPT-only formatting that prevents future provider flexibility.
- **Read-only at runtime** — Application code reads templates but NEVER modifies them; all edits happen through code changes and deployment.

## Acceptance Boundaries

### Must Have (Tier 2 Gate)
- Template directory exists in codebase with clear naming convention (e.g., `prompts/templates/artifact_types/`)
- At least ONE artifact type (Intent Document) has a complete template with:
  - System instructions section
  - Entity context injection markers (e.g., `{{project.name}}`, `{{intent.description}}`)
  - Output format specification
  - Quality criteria/validation rules
- Template loader service reads and caches templates with version metadata
- One generation endpoint uses the template system to produce an artifact
- Template versioning strategy documented (e.g., `intent_document_v1.md`)

### Should Have (Supervised Approval)
- Templates for 3+ artifact types (Intent Document, Context Package, Proposal)
- Template validation on application startup (fail-fast if template malformed)
- Template metadata header (version, author, last_modified, changelog)
- Injection variable reference documentation (what variables are available per entity type)
- Backward compatibility layer: old prompt code still works but logs deprecation warnings

### Could Have (Future Iterations)
- Template composition (base template + artifact-specific overrides)
- A/B testing framework for template variations
- Template performance metrics (generation success rate, revision frequency)
- Developer CLI tool: `prometheus generate-artifact --template intent_document_v2 --intent INT-123`

## Trust Tier Assignment

**Tier 2: Supervised** — This intent touches the core AI generation pipeline that produces all downstream artifacts. While the blast radius is contained to artifact quality (no data corruption or auth bypass risk), poor template design directly impacts:

- **Developer trust in AI outputs** — Bad templates → bad artifacts → manual rework → eroded confidence in the system.
- **Orbit cycle time** — If templates generate low-quality proposals or context packages, every orbit iteration gets slower.
- **Technical debt accumulation** — Hardcoded prompts scattered across the codebase are already a maintenance burden; templates must actually solve this, not create a parallel unmaintained system.

The implementation is reversible (can revert to inline prompts), but the organizational cost of shipping broken templates is high. Requires human review of:
1. Template structure and injection logic
2. At least one generated artifact using the new template
3. Migration plan for existing artifact types

## Dependencies

### Internal
- **AWS Bedrock integration (T2-004)** — Template system must invoke the LLM client to generate artifacts; cannot exist without working Bedrock connection.
- **Entity data layer** — Templates inject Project, Trajectory, Intent, Orbit context; requires clean read access to these entities (already exists in current API).

### External
- **Version control (Git)** — Templates stored as files rely on Git for versioning, branching, and rollback.
- **Deployment pipeline** — Template changes deploy with application code; no separate release mechanism needed, but CI/CD must include template directory.

### Prior Work
- No prior orbits directly block this, but learnings from **T2-004 Orbit 1** (Bedrock integration) inform how templates structure system/user messages and handle response parsing.