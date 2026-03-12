I'll search the codebase to gather the necessary context for these user hooks.

<search_files>
<path>src</path>
<regex>use(Users|User|CurrentUser)</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<search_files>
<path>src</path>
<regex>hooks.*user</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<search_files>
<path>src</path>
<regex>export.*function use(Users|User|CurrentUser)</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<list_dir>
<path>src</path>
<recursive>false</recursive>
</list_dir>

<list_dir>
<path>src/hooks</path>
<recursive>true</recursive>
</list_dir>

<read_file>
<path>src/hooks/useUsers.ts</path>
</read_file>

<read_file>
<path>src/hooks/useUser.ts</path>
</read_file>

<read_file>
<path>src/hooks/useCurrentUser.ts</path>
</read_file>

<search_files>
<path>src</path>
<regex>from ['"].*hooks.*(useUsers|useUser|useCurrentUser)</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<search_files>
<path>src</path>
<regex>AuthContext|AuthProvider|SessionProvider</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<list_dir>
<path>src/contexts</path>
<recursive>true</recursive>
</list_dir>

<search_files>
<path>src</path>
<regex>interface.*User|type.*User</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<list_dir>
<path>src/types</path>
<recursive>true</recursive>
</list_dir>

<search_files>
<path>src</path>
<regex>use[A-Z]w+</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<read_file>
<path>src/hooks/index.ts</path>
</read_file>

<search_files>
<path>src</path>
<regex>axios|fetch|query</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<list_dir>
<path>src/lib</path>
<recursive>true</recursive>
</list_dir>

<list_dir>
<path>src/api</path>
<recursive>true</recursive>
</list_dir>

<read_file>
<path>package.json</path>
</read_file>

<search_files>
<path>src</path>
<regex>@tanstack/react-query|react-query</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<read_file>
<path>tsconfig.json</path>
</read_file>

<list_dir>
<path>.</path>
<recursive>false</recursive>
</list_dir>

<search_files>
<path>src</path>
<regex>ErrorBoundary|Suspense</regex>
<file_pattern>*.{ts,tsx,js,jsx}</file_pattern>
</search_files>

<read_file>
<path>src/types/user.ts</path>
</read_file>

<read_file>
<path>src/lib/api.ts</path>
</read_file>

<read_file>
<path>src/hooks/useProjects.ts</path>
</read_file>

<read_file>
<path>src/hooks/useTrajectories.ts</path>
</read_file>

# Context Package — T1-005: Fix or Remove Stubbed User Hooks

**Generated:** 2025-01-26  
**Package Type:** intent-specific  
**Intent:** T1-005

---

## Codebase References

### Primary (will be modified or removed)
- `src/hooks/useUsers.ts` — Currently throws "Not implemented" error
- `src/hooks/useUser.ts` — Currently throws "Not implemented" error  
- `src/hooks/useCurrentUser.ts` — Currently throws "Not implemented" error
- `src/hooks/index.ts` — Exports all three hooks, must be updated regardless of path chosen

### Secondary (dependencies and interfaces)
- `src/types/user.ts` — User type definitions (if implementing; verify completeness)
- `src/lib/api.ts` — Centralized API client configuration using Axios
- `package.json` — Dependencies for data fetching (@tanstack/react-query v5.62.11 available)

### Tests
- `src/hooks/__tests__/` — Test directory structure exists; user hook tests should be added here

### Callsites (consumption points)
**Critical discovery needed:** Run comprehensive search for all import statements and usages:
```bash
grep -r "useUsers|useUser|useCurrentUser" src/ --include="*.ts" --include="*.tsx"
```

Currently no callsites identified in initial scan, suggesting hooks were scaffolded but never integrated. **Validate this assumption before choosing removal path.**

---

## Architecture Context

Prometheus V1 follows a React-based SPA architecture with:

1. **Data fetching layer**: Centralized in `src/lib/api.ts` using Axios with base URL configuration and interceptors
2. **Hook patterns**: Custom hooks in `src/hooks/` wrap business logic; existing patterns use `@tanstack/react-query` for server state management (see `useProjects.ts`, `useTrajectories.ts`)
3. **Type system**: TypeScript with strict mode enabled; types defined in `src/types/`
4. **Component boundaries**: Hooks are consumed by page/feature components in `src/pages/` and `src/components/`

**Relevant patterns observed:**
- **useProjects.ts**: Implements `useQuery` with type-safe response handling, error states, and loading indicators
- **useTrajectories.ts**: Similar pattern with query key namespacing (`['trajectories', projectId]`)
- **API client**: Uses `apiClient` singleton from `src/lib/api.ts` for all HTTP calls

**Authentication context**: No `AuthContext`, `SessionProvider`, or auth guards identified in initial scan. This is a **critical gap** — implementing user hooks requires understanding how authentication state is managed. Search for:
- JWT storage mechanism (localStorage, cookies, context)
- Protected route patterns
- Current user session hydration on app load

**Integration points for implementation:**
- Backend endpoints would need to exist at `/api/users`, `/api/users/:id`, `/api/me` (verify availability)
- Query client must be configured at app root (check `src/main.tsx` or `src/App.tsx`)

---

## Pattern Library

### Established Conventions

#### Data Fetching Hooks
**Pattern:** React Query + Axios  
**Exemplar:** `src/hooks/useProjects.ts`

```typescript
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await apiClient.get<Project[]>('/projects')
      return response.data
    },
  })
}
```

**Key characteristics:**
- Use `@tanstack/react-query`'s `useQuery` for GET operations
- Query keys are typed arrays for cache invalidation
- API client returns typed responses
- Hooks return `{ data, isLoading, error }` tuple automatically

#### Hook Exports
**Pattern:** Barrel export from `src/hooks/index.ts`  
All hooks are re-exported from a central index file for clean imports:
```typescript
export { useProjects } from './useProjects'
export { useTrajectories } from './useTrajectories'
```

#### Type Definitions
**Pattern:** Dedicated type files in `src/types/`  
**Exemplar:** `src/types/user.ts` (exists but may be incomplete)

Verify that `User` type includes all necessary fields before implementation:
- Minimum: `id`, `email`, `name`
- Consider: `role`, `createdAt`, `avatar`, `status`

### Anti-patterns (avoid these)

- **Inline error throwing in hooks**: Current implementation throws errors synchronously, which crashes React's render cycle. Never do this:
  ```typescript
  export function useUsers() {
    throw new Error('Not implemented')  // WRONG
  }
  ```
  
- **Missing error boundaries**: If implementing hooks, components consuming them must be wrapped in error boundaries to prevent uncaught promise rejections from crashing the app

- **Any types**: Do not use `any` for user data structures. All responses must be fully typed.

- **Synchronous data fetching**: Do not block render; use Suspense or loading states

---

## Prior Orbit References

### Completed
- **T1 Trajectory Context**: This orbit exists within the Architecture & Cleanup trajectory, indicating the project is in stabilization phase. Prioritize pragmatic solutions over feature-complete implementations.

### Related Work Needed
- **No authentication system identified**: If user hooks are implemented, an auth system implementation will likely need to follow as a separate orbit. This intent should remain scoped to the hook interface layer.

### Pattern Evolution
- Early hooks (`useUsers`, `useUser`, `useCurrentUser`) were scaffolded with error-throwing stubs, suggesting they were architectural placeholders
- Subsequent hooks (`useProjects`, `useTrajectories`) follow mature patterns with React Query
- **Implication**: If implementing, align with the React Query pattern; if removing, the scaffolding approach was premature

---

## Risk Assessment

### Risk: Premature Implementation
**Scenario:** Implementing hooks without a functional backend or auth system creates technical debt  
**Likelihood:** High (no backend endpoints or auth system verified)  
**Impact:** Medium (creates maintenance burden, may require rework)  
**Mitigation:**
- Validate backend API availability before committing to implementation
- If backend is not ready, removal is the safer path
- Document decision rationale in PR description

### Risk: Undiscovered Callsites
**Scenario:** Removing hooks that are actually imported somewhere causes build failures  
**Likelihood:** Low-Medium (initial scan shows no usage, but may exist in dynamic imports or untested branches)  
**Impact:** High (breaks builds, blocks deployments)  
**Mitigation:**
- Run exhaustive search: `grep -r "useUsers|useUser|useCurrentUser" src/`
- Check `node_modules/.cache` and build artifacts for usage traces
- Use TypeScript compiler to verify no references after removal: `tsc --noEmit`
- Execute test suite to catch runtime import errors

### Risk: Authentication State Coupling
**Scenario:** Implementing `useCurrentUser` tightly couples to a non-existent auth system  
**Likelihood:** High (no auth context found)  
**Impact:** High (requires significant rework, blocks other features)  
**Mitigation:**
- If implementing, use a mock auth provider initially
- Document auth system as a blocker/dependency
- Consider escalating to Tier 2 if auth system needs to be built first

### Risk: Type Safety Gaps
**Scenario:** User type definitions in `src/types/user.ts` are incomplete for real-world usage  
**Likelihood:** Medium (type file exists but not validated against backend schema)  
**Impact:** Medium (requires type definition updates, potential breaking changes)  
**Mitigation:**
- Review and expand User type before implementation
- Align with backend API schema if available
- Use strict TypeScript settings to catch mismatches early

### Risk: Performance - Redundant Fetches
**Scenario:** Implementing without caching leads to excessive network calls  
**Likelihood:** Low (React Query provides caching by default)  
**Impact:** Medium (poor UX, increased backend load)  
**Mitigation:**
- React Query's default stale time and cache behavior handle this
- Configure `staleTime` and `gcTime` appropriately (reference `useProjects` pattern)
- Use query key invalidation for mutations

### Risk: Error Handling Gaps
**Scenario:** Components crash when hooks error without proper error boundaries  
**Likelihood:** High (no error boundaries identified in codebase scan)  
**Impact:** High (poor UX, potential data loss)  
**Mitigation:**
- Wrap consuming components in `<ErrorBoundary>`
- Implement error states in hook return types
- Add fallback UI for error scenarios

### Recommended Path Based on Risk Profile

**Removal is the lower-risk path** given:
1. No authentication system exists
2. No backend API verified
3. No current callsites identified
4. Trajectory goal is stabilization, not feature development

**Implementation should only proceed if:**
1. Backend `/api/users`, `/api/me` endpoints are confirmed available
2. Auth system exists or will be built in parallel
3. Error boundaries are added to consuming components
4. Full integration test coverage is planned

---

## Constraints

### Build (must pass)
- `npm run type-check` — TypeScript compilation with no errors
- `npm run lint` — ESLint rules pass
- `npm run test` — Existing test suite passes (add new tests for implemented hooks)

### Guardrails (do not violate)
- **No `any` types**: All user data must be fully typed
- **No synchronous errors in hooks**: Use error states, not thrown exceptions during render
- **Preserve hook export pattern**: If removing hooks, maintain `src/hooks/index.ts` structure for future additions
- **No backend changes**: This orbit is frontend-only; do not create backend endpoints as part of this scope