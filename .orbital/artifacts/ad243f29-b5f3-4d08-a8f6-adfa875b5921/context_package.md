# Context Package: Add Prompt Template Management

## Codebase References

### Primary Files (to be created or modified)

**Template System Core:**
- `src/services/ai/templates/TemplateLoader.ts` — Template loading, parsing, and caching logic
- `src/services/ai/templates/TemplateRenderer.ts` — Context injection and rendering engine
- `src/services/ai/templates/types.ts` — TypeScript interfaces for template structure and context data
- `src/services/ai/templates/registry.ts` — Central registry mapping artifact types to template versions

**Template Files:**
- `src/services/ai/templates/prompts/context-package/v1.md` — Context Package generation template
- `src/services/ai/templates/prompts/proposal/v1.md` — Proposal generation template
- `src/services/ai/templates/prompts/intent-document/v1.md` — Intent Document generation template
- `src/services/ai/templates/prompts/_base.md` — Shared base template with common instructions

**Integration Layer:**
- `src/services/ai/ArtifactGenerator.ts` — Existing artifact generation service (modify to use templates)
- `src/services/ai/BedrockClient.ts` — AWS Bedrock API client (from T2-004, consume here)

**Testing:**
- `src/services/ai/templates/__tests__/TemplateLoader.test.ts`
- `src/services/ai/templates/__tests__/TemplateRenderer.test.ts`
- `src/services/ai/templates/__tests__/fixtures/` — Mock entity data for test cases

### Secondary Files (dependencies and interfaces)

**Entity Models:**
- `src/domain/entities/Project.ts`
- `src/domain/entities/Trajectory.ts`
- `src/domain/entities/Intent.ts`
- `src/domain/entities/Orbit.ts`
- `src/domain/entities/Artifact.ts`

**Service Layer:**
- `src/services/ProjectService.ts` — Provides entity context for template injection
- `src/services/IntentService.ts`
- `src/services/OrbitService.ts`

**API Layer:**
- `src/api/routes/artifacts.ts` — Artifact generation endpoints (must remain backwards-compatible)

## Architecture Context

Prometheus V1 follows a clean service-oriented architecture with clear separation between domain entities, service logic, and API endpoints. The artifact generation flow currently operates as:

1. **API Request** → `artifacts.ts` receives generation request with artifact type and entity IDs
2. **Context Assembly** → Services load entity data (Project, Trajectory, Intent, Orbit)
3. **Prompt Construction** → Hard-coded prompt strings in `ArtifactGenerator.ts`
4. **LLM Call** → `BedrockClient` sends prompt to AWS Bedrock (Claude 3.5 Sonnet)
5. **Response Processing** → Raw markdown output is validated and stored

**Template system insertion point:** Between steps 2 and 3. Instead of hard-coded prompts, `ArtifactGenerator` will:
- Resolve artifact type to template path via `TemplateRegistry`
- Load template file via `TemplateLoader` (with caching)
- Inject entity context via `TemplateRenderer`
- Pass rendered prompt to `BedrockClient` (existing integration)

**File System Strategy:** Templates stored in `src/services/ai/templates/prompts/` as markdown files with frontmatter for metadata. Node.js `fs` module reads files at runtime. Production deployment ensures template directory is included in build artifacts.

**Versioning Pattern:** Templates use directory structure for versioning: `prompts/{artifact-type}/v{N}.md`. Registry maps artifact types to specific versions. Default is always `latest` symlink or highest version number.

**No Database Storage:** Templates are code assets, not configuration data. Version control through Git provides audit trail, rollback capability, and code review workflow.

## Pattern Library

### TypeScript Patterns

**Service Layer Pattern:**
```typescript
// Existing pattern from ProjectService.ts
export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly logger: Logger
  ) null
  
  async getById(id: string): Promise<Project> {
    // Validation, fetch, error handling
  }
}
```
Follow dependency injection via constructor. Services are stateless. Error handling throws domain-specific errors, not generic exceptions.

**Type Safety for API Contracts:**
```typescript
// Pattern from src/api/routes/artifacts.ts
interface GenerateArtifactRequest {
  type: ArtifactType;
  intentId: string;
  orbitNumber: number;
}
```
All API request/response shapes are explicitly typed. No `any` types in public interfaces.

### File System Patterns

**Resource Loading:**
```typescript
// Pattern used in existing config loaders
import { readFileSync } from 'fs';
import { join } from 'path';

const templatePath = join(__dirname, 'prompts', artifactType, `v${version}.md`);
const content = readFileSync(templatePath, 'utf-8');
```
Use synchronous reads at startup for static resources. Async reads for runtime on-demand loading.

**Caching Strategy:**
```typescript
// Pattern from existing service caches
private templateCache = new Map<string, Template>();
```
In-memory caching for parsed templates. Cache key is `${artifactType}:${version}`. No cache invalidation needed in production (immutable templates).

### Template Syntax

**Markdown with Frontmatter:**
```markdown
---
version: "1.0"
artifact_type: "context-package"
model: "claude-3-5-sonnet-20241022"
---

# System Instructions
You are the Context Agent...

## Entity Context
{{intent.name}} — {{intent.description}}

## Output Format
Begin with heading: # Context Package: {{intent.name}}
```

**Placeholder Pattern:** Use `{{entity.field}}` for simple substitution. Use `{{#each items}}...{{/each}}` for iteration (adopt Handlebars-compatible syntax for potential future library integration).

### Naming Conventions

**File Names:** 
- Template files: `kebab-case.md` (e.g., `context-package`, `intent-document`)
- Version directories: `v1`, `v2`, `v3` (no dots)
- TypeScript modules: `PascalCase.ts` for classes, `camelCase.ts` for utilities

**Variable Names:**
- Template context objects: `context` (top-level), `entityContext` (entity data subset)
- Template metadata: `templateMeta`, `templateConfig`

## Prior Orbit References

### T2-004 (AWS Bedrock Integration)

**Status:** Assumed complete (dependency for this intent)

**Relevant Artifacts:**
- `BedrockClient.ts` — Established client interface for calling Claude models
- Authentication handled via AWS SDK credential chain
- Error handling pattern for API failures (retry logic, rate limiting)

**Integration Points:**
- `BedrockClient.generate(prompt: string)` method signature must remain unchanged
- Template rendering outputs a single `string` prompt compatible with existing call pattern

**Lessons Learned:**
- Bedrock API has strict payload size limits (~100KB for prompt text) — templates must not generate prompts exceeding this
- Model selection is currently hard-coded to `claude-3-5-sonnet-20241022` — template metadata can specify preferred model but client doesn't yet support overrides

### T1-003 (Artifact Generation Foundation)

**Context:** Initial implementation of artifact generation service that this intent is enhancing

**Current State:**
- `ArtifactGenerator.ts` contains hard-coded prompt strings as template literals
- Each artifact type has a dedicated method: `generateContextPackage()`, `generateProposal()`, etc.
- Context assembly logic is mixed with prompt construction — tight coupling

**Technical Debt:**
- No versioning of prompts — changes require code deploy and risk breaking generation
- Difficult to A/B test prompt variations
- Entity context assembly code duplicated across generation methods

**Migration Path:**
- Refactor `ArtifactGenerator` to delegate to `TemplateRenderer` while keeping method signatures intact
- Extract hard-coded prompts into initial `v1.md` templates as direct migration
- Preserve existing validation logic (markdown format checks, required sections)

### T1-002 (Entity Model Design)

**Relevant Patterns:**
- Entities use immutable value objects for IDs (`ProjectId`, `IntentId`)
- Timestamps stored as ISO 8601 strings
- Enums for status fields (`IntentStatus`, `OrbitPhase`, `TrustTier`)

**Context Injection Requirements:**
- Template context must serialize entities to plain objects (no class instances with methods)
- Nested relationships (Intent → Trajectory → Project) should be pre-flattened for template simplicity
- Sensitive fields (user emails, API keys) must be excluded from context objects

## Risk Assessment

### Risk: Template Injection Attacks

**Threat:** User-supplied entity data (intent names, descriptions) could contain malicious template syntax that escapes rendering and executes arbitrary code.

**Example:** Intent name like `{{process.exit()}}` or `${require('fs').unlinkSync('/')}` if using unsafe template engine.

**Mitigation:**
- Use safe template rendering that escapes all context values by default
- If using Handlebars/Mustache, enable strict mode with no custom helpers
- Validate entity data at ingestion (API layer) to reject invalid characters in text fields
- Unit test template renderer with adversarial input strings
- **Target:** All context values are HTML-escaped or equivalent before substitution

### Risk: Breaking Changes to Artifact Generation API

**Threat:** Template system refactor could introduce regressions in existing artifact generation endpoints, breaking downstream consumers (frontend, CLI tools).

**Example:** Changed output format, missing required sections, validation failures on previously valid requests.

**Mitigation:**
- Maintain existing `ArtifactGenerator` method signatures unchanged
- Implement feature flag: `USE_TEMPLATE_SYSTEM` (default: true in dev, false in prod initially)
- Parallel run: Generate artifacts with both old hard-coded prompts and new templates, compare outputs
- Integration tests for each artifact type with real entity data
- Gradual rollout: Enable templates per artifact type incrementally
- **Target:** 100% backwards compatibility verified by integration test suite

### Risk: Template Loading Performance

**Threat:** Reading template files from disk on every artifact generation request adds unacceptable latency (>50ms constraint).

**Example:** High request volume (10 req/sec) could cause file system contention or memory pressure from re-parsing templates.

**Mitigation:**
- Implement in-memory cache for parsed templates (keyed by `type:version`)
- Warm cache at application startup for all templates in `prompts/` directory
- Monitor P95 latency for artifact generation endpoint before/after template system
- Benchmark template loading: target <10ms for cache hit, <50ms for cache miss
- Consider read-only pre-parsed template bundle for production deployments
- **Target:** Median latency increase <5ms, P95 <20ms

### Risk: Template Version Conflicts

**Threat:** Multiple developers modifying same template version simultaneously causes merge conflicts or inconsistent behavior across environments.

**Example:** Dev environment uses local `v1.md` with experimental changes while prod uses Git HEAD version — artifacts differ unexpectedly.

**Mitigation:**
- Document versioning policy: Never edit released template versions — always create new version (v2, v3, etc.)
- Template registry uses explicit version numbers, not `latest` tag in production
- Pre-deploy validation: fail CI if template syntax is invalid or required sections missing
- Template diff tool for code review: show side-by-side changes between versions
- **Target:** Zero production incidents from template version mismatches

### Risk: Missing or Malformed Entity Context

**Threat:** Template expects entity field (e.g., `{{intent.trustTier}}`) but service fails to load that entity or field is null/undefined. Rendered prompt contains literal `{{intent.trustTier}}` text, confusing the LLM.

**Example:** Orbit entity loaded but referenced Intent is missing due to database inconsistency.

**Mitigation:**
- Type-safe context builder: Compile-time checks that all template placeholders have corresponding TypeScript types
- Runtime validation: Throw error if required context fields are missing before rendering
- Default values for optional fields (e.g., `{{intent.trustTier ?? 'tier_0'}}`)
- Unit tests with incomplete entity data to verify error handling
- Structured logging: Log full context object when template rendering fails
- **Target:** Template rendering fails fast with actionable error message, never produces partial/invalid prompts

### Risk: Template Syntax Errors

**Threat:** Developer introduces typo or invalid syntax in template markdown (e.g., unclosed placeholder, malformed frontmatter YAML). Error discovered at runtime during artifact generation, not at commit time.

**Example:** Template has `{{#each intents}` without closing `{{/each}}` — rendering throws exception and fails request.

**Mitigation:**
- Pre-commit hook: Lint all `.md` files in `prompts/` directory for valid syntax
- CI validation step: Parse all templates and render with mock context as smoke test
- Template validator utility: `npm run validate-templates` checks syntax and required sections
- Clear error messages: Template parse errors include file path, line number, and syntax fix suggestion
- **Target:** Zero runtime template parse errors in production