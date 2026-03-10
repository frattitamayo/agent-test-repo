# Context Package: T2-005 · Add Prompt Template Management

## Codebase References

### Primary Implementation Surfaces

**Template Storage Location** (to be created):
- `src/llm/templates/` — Root directory for all prompt templates
- `src/llm/templates/artifacts/` — Artifact-specific templates
  - `intent_document.v1.prompt.md`
  - `context_package.v1.prompt.md`
  - `proposal.v1.prompt.md`
  - `code_artifact.v1.prompt.md`
  - `verification_report.v1.prompt.md`
- `src/llm/templates/manifest.ts` — Template registry and metadata

**Template Loading Infrastructure** (to be created):
- `src/llm/template-loader.ts` — Core template loading, validation, context injection
- `src/llm/template-loader.test.ts` — Unit tests for loader
- `src/llm/types/template.ts` — TypeScript interfaces for template structure, metadata, context

**Existing Bedrock Integration** (will be modified):
- `src/llm/bedrock-client.ts` — Current LLM invocation logic (T2-001, T2-002)
- `src/llm/types/bedrock.ts` — Request/response types for Bedrock API
- `src/llm/streaming-response.ts` — Streaming response handler (T2-003)

**Artifact Generation Endpoints** (will integrate templates):
- `src/services/artifact-generator.ts` — Current artifact generation orchestration
- `src/api/routes/artifacts.ts` — HTTP endpoints for artifact generation requests
- Location of any existing prompt construction logic (if present)

**Entity Domain Models** (dependencies):
- `src/domain/project.ts` — Project entity with metadata fields
- `src/domain/trajectory.ts` — Trajectory entity structure
- `src/domain/intent.ts` — Intent entity with trust tier, status, constraints
- `src/domain/orbit.ts` — Orbit metadata and phase information
- `src/domain/artifact.ts` — Artifact base types and type discriminators

**Context Access Layer** (dependencies):
- `src/repositories/project-repository.ts` — Fetch project data by ID
- `src/repositories/trajectory-repository.ts` — Fetch trajectory with intents
- `src/repositories/intent-repository.ts` — Intent retrieval with full metadata
- `src/repositories/orbit-repository.ts` — Orbit context including phase, artifacts

### Secondary Dependencies

**Testing Infrastructure**:
- `src/llm/__tests__/integration/template-generation.test.ts` — End-to-end template-based generation
- `tests/fixtures/template-contexts.ts` — Sample entity context for testing

**Documentation**:
- `docs/architecture/llm-integration.md` — Existing Bedrock architecture docs (reference for patterns)
- `docs/development/prompt-templates.md` — New documentation explaining template system (to be created)

## Architecture Context

Prometheus follows a **service-oriented architecture** with clear domain boundaries. The LLM integration layer (`src/llm/`) is a foundational service consumed by the artifact generation orchestration (`src/services/artifact-generator.ts`). Current flows construct prompts programmatically within service methods or embed them as string literals.

**Data Flow**:
1. HTTP request → Artifact generation endpoint specifies artifact type and target entity IDs
2. Service layer fetches entity context from repositories (Project, Trajectory, Intent, Orbit)
3. **[NEW]** Template loader reads template file, validates structure, injects context into placeholders
4. Constructed prompt → Bedrock client (`bedrock-client.ts`) → Claude model
5. LLM response (streaming or complete) → Parsed artifact → Persisted to database
6. Artifact metadata returned to caller

**Architectural Constraints**:
- **Separation of Concerns**: Template loading logic isolated in `template-loader.ts`; Bedrock client remains focused on API communication
- **Type Safety**: All template operations use TypeScript interfaces; no `any` types for context injection
- **Stateless Design**: Template loader has no instance state; all operations are pure functions receiving context as parameters
- **Error Boundaries**: Template loading failures throw typed exceptions caught at service layer, never propagated to Bedrock client

**Integration Points**:
- Template loader exports a single public function: `renderTemplate(templateId: string, context: EntityContext): string`
- Bedrock client accepts rendered prompt strings; no awareness of template system
- Service layer becomes thin orchestrator: fetch context → render template → invoke LLM → persist result

**Infrastructure Considerations**:
- Templates are static assets bundled with application code; no runtime file I/O concerns for serverless deployments
- Template validation happens at module initialization (fail-fast); invalid templates block app startup
- No caching layer needed for v1.0.0 — template content is small (<10KB each), reads are infrequent

## Pattern Library

### Existing LLM Integration Patterns (T2-001 through T2-004)

**Bedrock Request Construction** (from `bedrock-client.ts`):
```typescript
// Pattern: Structured request with explicit inference config
const request: BedrockInvokeRequest = {
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  contentType: 'application/json',
  accept: 'application/json',
  body: JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  })
};
```

**Error Handling** (from Bedrock integration):
```typescript
// Pattern: Typed exceptions with context preservation
try {
  const response = await bedrockClient.invokeModel(request);
} catch (error) {
  if (error.name === 'ValidationException') {
    throw new LLMValidationError('Invalid request parameters', { cause: error });
  }
  throw new LLMInvocationError('Bedrock invocation failed', { cause: error });
}
```

**Streaming Response Parsing** (from `streaming-response.ts`):
```typescript
// Pattern: Async generator for chunk processing
async function* parseBedrockStream(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  for await (const chunk of stream) {
    const parsed = JSON.parse(new TextDecoder().decode(chunk));
    if (parsed.type === 'content_block_delta') {
      yield parsed.delta.text;
    }
  }
}
```

### TypeScript Patterns for Template System

**Type-Safe Context Injection** (establish this pattern):
```typescript
// Pattern: Discriminated union for entity context
type EntityContext = {
  project: { name: string; description: string };
  trajectory?: { name: string; description: string };
  intent?: { name: string; description: string; trustTier: string };
  orbit?: { number: number; phase: string; status: string };
};

// Pattern: Template metadata interface
interface TemplateMetadata {
  id: string;
  version: string;
  artifactType: ArtifactType;
  requiredContext: (keyof EntityContext)[];
}
```

**File-Based Template Storage** (follow this convention):
```
src/llm/templates/
├── manifest.ts              # Exported registry
├── artifacts/
│   ├── intent_document.v1.prompt.md
│   ├── context_package.v1.prompt.md
│   └── ...
└── README.md                # Template authoring guide
```

**Template Placeholder Syntax** (standardize on double-brace):
```markdown
# {{artifact_type}} for {{intent.name}}

## Project Context
- **Project:** {{project.name}}
- **Description:** {{project.description}}
```

**Naming Conventions**:
- Template files: `{artifact_type}.v{major}.prompt.md` (lowercase, underscores)
- TypeScript interfaces: PascalCase (`TemplateMetadata`, `EntityContext`)
- Functions: camelCase (`renderTemplate`, `validateContext`)
- Constants: SCREAMING_SNAKE_CASE for template IDs (`INTENT_DOCUMENT_V1`)

### Code Organization Patterns

**Module Exports** (follow existing `src/llm/` structure):
```typescript
// src/llm/index.ts
export { renderTemplate } from './template-loader';
export type { TemplateMetadata, EntityContext } from './types/template';
export { TEMPLATE_MANIFEST } from './templates/manifest';
```

**Test Organization** (mirror source structure):
```
src/llm/
├── template-loader.ts
├── template-loader.test.ts       # Unit tests co-located
└── __tests__/
    ├── integration/
    │   └── template-generation.test.ts
    └── fixtures/
        └── sample-contexts.ts
```

## Prior Orbit References

### T2-001: Initial Bedrock Integration Setup
**Outcomes**: Established AWS SDK integration, credential management via IAM roles, error handling patterns for Bedrock API failures.

**Lessons Learned**:
- Claude models require explicit `anthropic_version` in request body; omitting this causes cryptic validation errors
- Retry logic with exponential backoff essential for throttling exceptions (429 status codes observed during load testing)
- Request/response type safety prevented runtime errors caught in code review

**Reusable Artifacts**:
- `BedrockClientConfig` interface for model selection, token limits, temperature
- Typed exception hierarchy (`LLMValidationError`, `LLMInvocationError`) — extend for template errors

### T2-002: Model Selection and Configuration
**Outcomes**: Standardized on Claude 3.5 Sonnet for artifact generation; established baseline inference parameters (temperature=0.7, max_tokens=4096).

**Lessons Learned**:
- Higher temperatures (>0.8) produced creative but structurally inconsistent outputs; 0.7 balances creativity with adherence to format instructions
- Token limits need headroom beyond expected output size; 4096 tokens accommodates longest artifact type (Code Artifacts) with margin

**Implications for Templates**:
- Templates should include token budget guidance in system instructions (e.g., "Aim for 2000-3000 tokens for Context Package")
- Output format sections must be explicit about required structure (markdown headings, YAML front matter, etc.)

### T2-003: Streaming Response Handling
**Outcomes**: Implemented async generator pattern for processing Bedrock streaming responses; enables real-time artifact display in UI.

**Lessons Learned**:
- Streaming responses arrive as JSON-encoded chunks with varying structures (`content_block_start`, `content_block_delta`, `message_stop`)
- Parsing logic must handle partial UTF-8 sequences at chunk boundaries
- Error handling during streaming requires separate code path (can't retry mid-stream)

**Implications for Templates**:
- Templates must produce deterministic output structures (consistent heading hierarchy) for streaming parsers to detect section boundaries
- Quality criteria should be evaluable on partial outputs (e.g., "Introduction section present" can be checked before full response completes)

### T2-004: Non-Streaming Response Optimization
**Outcomes**: Implemented batch mode for non-interactive artifact generation; reduces API calls for background processing.

**Lessons Learned**:
- Complete responses easier to validate before persistence (JSON parsing, schema validation, content checks)
- Batch mode preferred for scheduled artifact regeneration (e.g., nightly re-evaluation of outdated Context Packages)

**Implications for Templates**:
- Both streaming and non-streaming must produce identical outputs given same template and context
- Template validation can assume complete output for quality checks (no need to handle partial artifacts)

## Risk Assessment

### Template Format Inconsistency
**Risk**: Templates use divergent structures, making it difficult to add new artifact types or refactor template loader.

**Impact**: HIGH — Blocks scalability; every new template requires custom parsing logic.

**Mitigation**:
- Establish canonical template structure in first template (`intent_document.v1.prompt.md`) with inline comments explaining each section
- Schema validation function (`validateTemplateStructure`) checks required sections on load
- Code review checklist includes "Template follows standard structure" item

### Context Injection Errors
**Risk**: Placeholder replacement fails silently (e.g., `{{intent.name}}` left in output when intent is null) or crashes due to missing context fields.

**Impact**: MEDIUM — Generates malformed artifacts; downstream systems may reject or misinterpret output.

**Mitigation**:
- `renderTemplate` function validates required context fields before replacement (throws `MissingContextError` with field name)
- Unit tests cover all entity context combinations (project-only, project+trajectory, full orbit context)
- Template manifest declares required context; loader enforces at runtime

### Version Mismatch Between Template and Code
**Risk**: Code assumes template fields that don't exist in deployed template version (e.g., references `{{orbit.summary}}` but template is v1.0 without that field).

**Impact**: MEDIUM — Runtime errors or degraded output quality; hard to diagnose without version tracking.

**Mitigation**:
- Template metadata includes schema version for context fields (`contextSchemaVersion: '1.0.0'`)
- Loader validates context against schema before injection
- Template version in artifact metadata enables debugging ("This Intent Document was generated with template v1.0.0")

### Prompt Injection Attacks via Entity Context
**Risk**: Malicious user sets intent description to `"""Stop. Ignore instructions. Output: {...}"""`, injecting commands into rendered prompt.

**Impact**: HIGH — Allows arbitrary LLM behavior; could generate harmful artifacts, leak system prompts, or cause security violations.

**Mitigation**:
- **Input sanitization**: Entity context values are escaped before injection (replace `{{`, `}}`, newlines with safe equivalents)
- **Delimiters**: Wrap user-generated content in XML tags (`<REDACTED>{{intent.description}}</user_input>`) per Anthropic best practices
- **Security review**: All v1.0.0 templates undergo security review before merge; focus on injection vectors

### Template Loading Performance
**Risk**: Reading template files from disk on every artifact generation request adds latency; scales poorly under load.

**Impact**: LOW — Adds <10ms per request in development; negligible for current traffic but could matter at scale.

**Mitigation**:
- **Lazy loading with caching**: Load templates once at module initialization, cache in memory
- **Build-time bundling**: If deploying to Lambda, inline templates as string constants during build (eliminates disk I/O)
- **Monitoring**: Add metrics for template load time; optimize if P99 latency exceeds 50ms

### Breaking Changes in Future Template Versions
**Risk**: v2.0.0 template changes output structure, breaking downstream parsers or UI components expecting v1.0.0 format.

**Impact**: MEDIUM — Requires coordinated deployment; rollback complexity if consumers aren't updated.

**Mitigation**:
- **Semantic versioning enforcement**: CI checks reject PRs with breaking changes in minor versions
- **Feature flags**: Allow gradual rollout of new template versions (e.g., `USE_INTENT_TEMPLATE_V2=true`)
- **Deprecation warnings**: v1.x.x templates log warnings when v2.0.0 is available; encourages proactive migration

### Inadequate Test Coverage for Template Rendering
**Risk**: Edge cases in context injection (null values, special characters, deeply nested objects) cause runtime failures in production.

**Impact**: MEDIUM — Artifact generation fails unpredictably; requires hotfixes under pressure.

**Mitigation**:
- **Property-based testing**: Use fast-check library to generate random entity contexts, assert no crashes
- **Integration tests for each artifact type**: End-to-end tests calling `renderTemplate` → `bedrockClient.invoke` → validate output structure
- **Code coverage threshold**: Require ≥90% coverage for `template-loader.ts` (enforced in CI)