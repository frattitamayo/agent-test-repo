# Prompt Template Management System

## Desired Outcome

Artifact generation becomes consistent, maintainable, and version-controlled through a structured prompt template system. Every artifact type (Intent Documents, Context Packages, Proposals, Code Artifacts, Verification Reports) has a canonical prompt template that orchestrates AI behavior through explicit system instructions, entity context injection, output formatting rules, and quality criteria. Changes to artifact generation logic happen through code reviews and version control rather than ad-hoc prompt editing.

When complete:
- Developers understand artifact requirements by reading prompt templates as documentation
- AI agents receive deterministic instructions for artifact generation regardless of which trajectory or intent triggers the request
- Prompt evolution is tracked through git history with clear attribution and rationale
- New artifact types can be added by following the established template pattern
- Prompt templates serve as both executable specifications and human-readable contracts

## Constraints

**No Database Storage**: Templates must live in the codebase under version control. No prompt content in database tables, configuration files, or external storage systems.

**Backward Compatibility**: Existing artifact generation flows (Context Packages, Proposals, Code Artifacts) continue working without modification during template system rollout. New system must be additive, not disruptive.

**Template Version Immutability**: Once deployed, a template version cannot be edited in place. Changes require creating a new version with an incremented identifier.

**Zero Runtime Compilation**: Templates are static text files or code constants. No dynamic template assembly from fragments, no Jinja/Handlebars/Liquid preprocessing, no runtime string interpolation beyond entity context injection.

**Entity Context Boundaries**: Templates declare required context fields (project, trajectory, intent, orbit metadata) but never embed hardcoded entity values. Context injection happens at request time through a standardized interface.

**LLM Provider Agnostic**: Templates must not assume Bedrock-specific features, token counting mechanisms, or response formats. Design for portability across Anthropic, OpenAI, and future providers.

**Security Posture**: Templates are code artifacts subject to security review. No user-generated content in template files. No dynamic evaluation of template content (eval, exec, Function constructor).

## Acceptance Boundaries

### Functional Requirements

**Template Discovery**:
- All artifact types have corresponding template files discoverable through consistent naming convention (e.g., `intent_document.prompt.md`, `context_package.prompt.md`)
- Templates are grouped by artifact type in a dedicated directory structure within the codebase
- A manifest or registry allows programmatic enumeration of available templates

**Template Structure**:
- Each template contains these identifiable sections: System Instructions, Entity Context Placeholders, Output Format Specification, Quality Criteria, Example Output (optional)
- Entity context placeholders use a consistent syntax (e.g., `{{project.name}}`, `{{intent.description}}`) that is documented and validated
- Templates include inline comments explaining the purpose of each section and any non-obvious instructions

**Version Management**:
- Templates have semantic version identifiers (e.g., `v1.0.0`, `v1.1.0`) tracked in filenames or metadata headers
- Breaking changes increment major version; additive changes increment minor version
- A changelog or commit history clearly documents what changed between versions

**Runtime Integration**:
- Artifact generation requests specify which template to use (by artifact type or explicit template identifier)
- A template loader reads template content and validates required context fields are provided
- Context injection replaces placeholders with actual entity values before sending to LLM
- Template loading failures result in explicit error messages identifying the missing template or invalid context

**Testing Coverage**:
- At least one artifact generation flow uses the new template system end-to-end (from request through LLM call to artifact persistence)
- Unit tests validate template loading, context injection, and placeholder replacement
- Integration test demonstrates that a templated artifact generation produces valid output matching quality criteria

### Quality Thresholds

- **Template Completeness**: 100% of existing artifact types (5 types: Intent, Context, Proposal, Code, Verification) have corresponding v1.0.0 templates checked into the repository
- **Context Coverage**: Templates inject ≥90% of entity metadata fields currently used in artifact generation (measured by static analysis of existing prompt construction code)
- **Documentation Clarity**: Template files include inline explanations sufficient that a new contributor can understand the purpose of each section without external documentation (validated through code review)
- **Version Traceability**: Git history shows clear commit messages for each template version change with rationale (e.g., "v1.1.0: Add trust tier rationale to Intent template per feedback from orbit T1-003-O2")

### Non-Goals (Explicitly Out of Scope)

- **Prompt Optimization**: This intent establishes the *structure*, not the *content*. Refining prompt instructions for better LLM output is a separate effort
- **Multi-Language Templates**: English-only for v1.0.0. Internationalization is a future enhancement
- **Template Composition**: No template inheritance, partials, or includes. Each template is self-contained
- **Dynamic Prompt Routing**: No A/B testing, multi-armed bandits, or adaptive template selection based on LLM performance metrics
- **UI for Template Editing**: Templates are edited as code files through standard development workflow. No admin interface or visual editor

## Trust Tier Assignment

**Tier 2: Supervised** — Changes require human review before deployment.

**Rationale**:

This intent introduces a foundational system that directly controls how AI agents interpret requirements and generate artifacts. The blast radius is substantial: a malformed template could cause every artifact generation request to produce invalid output, blocking all ORBITAL workflows. The domain risk is moderate: prompt engineering errors can lead to AI agents misinterpreting constraints, ignoring acceptance criteria, or producing outputs that violate security/compliance boundaries.

However, the risk is contained through several factors:
- Templates are code artifacts reviewed through standard PR process before merge
- Template changes are reversible through git revert
- Artifact generation already has downstream validation (human review, CI checks, verification phases) that catch low-quality outputs
- The system is additive — existing flows continue working while new template system is adopted incrementally

Tier 1 (Autonomous) would be appropriate for subsequent template content refinements once the system proves stable. Tier 3 (Gated) would be excessive given the reversibility and existing safeguards. Supervised review strikes the right balance: catch structural errors and ensure template quality without blocking iterative improvement.

## Dependencies

**Hard Dependencies** (must exist before this intent can complete):

- **AWS Bedrock Integration** (T2-001 through T2-004): Template system requires a working LLM invocation pipeline to test end-to-end artifact generation. Specifically depends on:
  - Bedrock client initialization and credential management
  - Request/response handling with Claude models
  - Streaming and non-streaming response processing
  
- **Artifact Domain Models**: TypeScript interfaces or database schemas defining the structure of Intent Documents, Context Packages, Proposals, Code Artifacts, and Verification Reports. Template context injection needs to know which fields exist on each entity type.

- **Entity Context Access**: API or repository layer that can fetch Project, Trajectory, Intent, and Orbit metadata given an identifier. Template rendering requires hydrating placeholders with actual entity values.

**Soft Dependencies** (improve outcome but not blocking):

- **Existing Artifact Generation Flows**: Understanding current prompt construction logic (if any) accelerates template design by preserving proven patterns. Not blocking because templates can be authored from first principles using the ORBITAL framework documentation.

- **Prior Orbit Learnings**: Insights from T2-001 through T2-004 orbits about Claude's behavior, token limits, and response formatting preferences inform better template instructions. Templates can be refined post-launch based on observed LLM performance.

**No External System Dependencies**: This intent is self-contained within the Prometheus codebase. No third-party services, external APIs, or infrastructure changes required beyond the Bedrock integration already established.