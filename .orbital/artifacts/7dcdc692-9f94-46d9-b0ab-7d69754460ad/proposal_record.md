# Proposal Record — T1-005: Fix or Remove Stubbed User Hooks

**Proposal ID:** PROP-T1-005-1  
**Generated:** 2025-01-26  
**Intent:** T1-005  
**Context Packages:**
- Architectural: None (project-level architectural context not provided)
- Intent-specific: CTX-INT-T1-005  
**Trust Tier:** 1 — autonomous

---

## Interpreted Intent

Three React hooks in the Prometheus V1 codebase — `useUsers`, `useUser`, and `useCurrentUser` — are currently non-functional stubs that throw runtime errors when invoked. This creates a latent bug: developers may attempt to use these hooks based on their presence in the exported hook index, only to encounter application crashes during development or testing.

The goal is to eliminate this failure mode by either implementing these hooks with real backend integration or removing them entirely from the codebase. Given the project's current Architecture & Cleanup trajectory phase, the removal path is the pragmatic choice unless backend user endpoints are confirmed to exist and be ready for integration.

The outcome is a codebase where the hook interface layer accurately reflects available functionality — if user hooks are exported, they work; if they're not needed yet, they don't exist to cause confusion.

---

## Implementation Plan

### Primary Path: Removal (recommended given current context)

#### Files to Modify
- `src/hooks/index.ts` — Remove export statements for the three user hooks
- `src/hooks/useUsers.ts` — Delete file entirely
- `src/hooks/useUser.ts` — Delete file entirely
- `src/hooks/useCurrentUser.ts` — Delete file entirely

#### Files to Create
None (removal path)

#### Approach

**Step 1 — Validate no callsites exist**  
Execute comprehensive search for any imports or usage of the three hooks:
```bash
grep -r "useUsers|useUser|useCurrentUser" src/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"
```

If any callsites are found, document them and assess whether they represent:
- Dead code paths (remove the callsite)
- Planned integration points (replace with mock or TODO comment)
- Critical functionality (escalate to Tier 2, may need implementation path instead)

**Step 2 — Remove hook implementations**  
Delete the three hook files. These are standalone modules with no complex dependencies.

**Step 3 — Update barrel export**  
Remove the export statements from `src/hooks/index.ts`. Verify that the file remains valid TypeScript and follows existing formatting conventions.

**Step 4 — Verify build passes**  
Run TypeScript compilation to confirm no orphaned imports:
```bash
npm run type-check
```

The compiler will catch any remaining references if the search missed them.

**Step 5 — Run test suite**  
Ensure no tests reference the removed hooks:
```bash
npm run test
```

#### Order of Operations
1. Search for callsites (validation step — if found, reassess path)
2. Delete hook implementation files
3. Remove exports from `src/hooks/index.ts`
4. Run `npm run type-check` to verify no build errors
5. Run `npm run test` to verify no test failures
6. Run `npm run lint` to ensure no linting violations
7. Commit with message: `fix(hooks): remove non-functional user hook stubs`

### Alternative Path: Implementation (only if backend endpoints verified)

This path should only be executed if Step 1 discovers:
- Backend API endpoints `/api/users`, `/api/users/:id`, and `/api/me` exist and return valid responses
- Authentication context or session management exists in the codebase
- At least one legitimate callsite requires these hooks

#### Files to Create (implementation path)
- `src/hooks/__tests__/useUsers.test.ts` — Unit tests for list users hook
- `src/hooks/__tests__/useUser.test.ts` — Unit tests for single user hook
- `src/hooks/__tests__/useCurrentUser.test.ts` — Unit tests for current user hook

#### Files to Modify (implementation path)
- `src/hooks/useUsers.ts` — Implement with React Query pattern matching `useProjects.ts`
- `src/hooks/useUser.ts` — Implement with parameterized query for single user
- `src/hooks/useCurrentUser.ts` — Implement with session-aware query
- `src/types/user.ts` — Expand User type definition if incomplete (verify fields: `id`, `email`, `name`, `role`, `createdAt`)

#### Implementation Pattern (if this path is taken)
```typescript
// src/hooks/useUsers.ts
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { User } from '@/types/user'

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiClient.get<User[]>('/api/users')
      return response.data
    },
  })
}
```

### Dependencies

**For removal path:**
- None — this is a pure deletion operation

**For implementation path (only if chosen):**
- Backend endpoints must exist and be accessible
- `@tanstack/react-query` QueryClient must be configured at app root (verify in `src/main.tsx` or `src/App.tsx`)
- Authentication mechanism must be in place (JWT token, session cookie, etc.)

---

## Risk Surface

### Edge Cases

**If removal path:**
- **Callsites discovered after deletion:** If the grep search misses a dynamic import or usage in a code path not covered by TypeScript's static analysis, build will fail. **Mitigation:** TypeScript compiler acts as final validation; any missed references will surface immediately during `npm run type-check`.

**If implementation path:**
- **Backend returns 401/403 on user endpoints:** If auth tokens are missing or invalid, hooks will error. **Mitigation:** React Query's error handling returns error state; consuming components must implement error boundaries or check `isError` flag.
- **User type mismatch with backend schema:** If `src/types/user.ts` doesn't match backend response structure, TypeScript will catch at compile time but runtime data may still have extra fields. **Mitigation:** Use strict typing and validate against OpenAPI schema if available.
- **Stale data after user mutation:** If users are updated elsewhere in the app, hooks may show outdated data. **Mitigation:** Implement query invalidation on mutation success using `queryClient.invalidateQueries(['users'])`.

### Regressions

**If removal path:**
- **No regression risk:** These hooks currently throw errors, so removing them cannot make existing functionality worse. Any component attempting to use them today would crash immediately.

**If implementation path:**
- **Performance impact on app initialization:** If `useCurrentUser` is called high in the component tree (e.g., in App root), it could block initial render. **Mitigation:** Wrap consuming components in `<Suspense>` boundary or use `enabled: false` flag until auth is confirmed.
- **Cache invalidation bugs:** If other parts of the app mutate user data without invalidating the React Query cache, stale data will display. **Mitigation:** Document query key naming convention and establish pattern for mutation hooks to invalidate dependent queries.

### Security

**If removal path:**
- No security implications — this is a deletion operation.

**If implementation path:**
- **Exposure of sensitive user data:** If hooks fetch user data without proper auth checks, unauthorized users could access other users' information. **Mitigation:** Backend must enforce authorization; frontend hooks should not assume any security role. Implement role-based access control at the API layer, not in the hooks.
- **Token leakage in error messages:** If API client logs errors with full request context, auth tokens could be exposed in logs. **Mitigation:** Verify `src/lib/api.ts` does not log sensitive headers; add redaction if needed.

### Performance

**If removal path:**
- Performance improves marginally — three unused modules removed from bundle (negligible impact, ~1-2KB).

**If implementation path:**
- **Network overhead:** Each hook invocation triggers a network request (mitigated by React Query's caching). Expect ~50-200ms per request depending on backend latency.
- **Bundle size increase:** Adding React Query usage for three hooks adds minimal overhead (library already included in dependencies). Estimated impact: <1KB.
- **Redundant fetches if hooks are co-located:** If `useCurrentUser` is called in 5 different components in the same render tree, React Query will deduplicate the requests to a single network call. No performance concern.

---

## Scope Estimate

### For Removal Path (primary recommendation)

| Metric | Value |
|--------|-------|
| Files affected | 4 (3 delete + 1 modify) |
| Complexity | **Low** — straightforward deletion with validation steps |
| Estimated test cases | 0 (no new tests needed; existing suite should pass unchanged) |
| Estimated duration | **0.5 orbit** — can be completed in a single execution phase |
| Risk level | **Minimal** — TypeScript compiler catches any missed references |

**Phases:**
1. **Discovery phase (5 min):** Search for callsites, validate none exist
2. **Deletion phase (5 min):** Remove files and exports
3. **Validation phase (5 min):** Run type-check, tests, and lint

### For Implementation Path (alternative)

| Metric | Value |
|--------|-------|
| Files affected | 7 (3 modify + 3 create for tests + 1 modify for types) |
| Complexity | **Medium** — requires backend endpoint verification, auth integration, and test coverage |
| Estimated test cases | 12 (4 per hook: success, loading, error, refetch) |
| Estimated duration | **2-3 orbits** — depends on backend availability and auth system maturity |
| Risk level | **Medium-High** — depends on backend stability and auth context |

**Phases:**
1. **Discovery phase (30 min):** Verify backend endpoints, auth mechanism, and User type completeness
2. **Implementation phase (2-3 hours):** Implement hooks following React Query pattern
3. **Testing phase (1-2 hours):** Write and verify unit tests
4. **Integration phase (1 hour):** Add error boundaries, validate in real components

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by | — |
| Timestamp | — |

---

## Human Modifications

Pending human review.