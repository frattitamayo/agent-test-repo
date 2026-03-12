# Verification Protocol — T1-005: Fix or Remove Stubbed User Hooks

**Protocol ID:** VP-T1-005-1  
**Generated:** 2025-01-26  
**Intent:** T1-005  
**Proposal:** PROP-T1-005-1

---

## Automated Gates

### Path-Agnostic Gates (apply to both removal and implementation)

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Minimum: No console errors or unhandled exceptions when hooks are invoked | TypeScript compilation passes with no errors | `npm run type-check` | Exit code 0, zero TypeScript errors | Yes |
| AG-02 | Minimum: No console errors or unhandled exceptions when hooks are invoked | ESLint rules pass for all modified files | `npm run lint` | Exit code 0, zero lint violations | Yes |
| AG-03 | Minimum: No console errors or unhandled exceptions when hooks are invoked | Existing test suite passes without failures | `npm run test` | All tests pass, no new test failures introduced | Yes |

### Removal Path Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-04 | Minimum: If removed, zero references to these hooks remain in src/ directory | No import statements for removed hooks exist in codebase | `grep -r "from ['"]../hooks.*useUsers|useUser|useCurrentUser" src/ --include="*.ts" --include="*.tsx"` | Exit code 1 (no matches found) | Yes |
| AG-05 | Minimum: If removed, zero references to these hooks remain in src/ directory | No direct usage of hook functions exists in codebase | `grep -r "useUsers|useUser|useCurrentUser" src/ --include="*.ts" --include="*.tsx" --exclude-dir=hooks` | Exit code 1 (no matches found) | Yes |
| AG-06 | Minimum: All three hooks either function without throwing errors OR are removed | Hook files no longer exist in filesystem | `test ! -f src/hooks/useUsers.ts && test ! -f src/hooks/useUser.ts && test ! -f src/hooks/useCurrentUser.ts` | Exit code 0 (files do not exist) | Yes |
| AG-07 | Minimum: All three hooks either function without throwing errors OR are removed | Hook exports removed from barrel file | `grep -E "useUsers|useUser|useCurrentUser" src/hooks/index.ts` | Exit code 1 (no matches in index.ts) | Yes |

### Implementation Path Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-08 | Target: Unit tests covering hook behavior in success, loading, and error states | useUsers hook returns data successfully | Unit test: `src/hooks/__tests__/useUsers.test.ts` — "returns user list on successful fetch" | Test passes | Yes |
| AG-09 | Target: Unit tests covering hook behavior in success, loading, and error states | useUsers hook handles loading state | Unit test: `src/hooks/__tests__/useUsers.test.ts` — "shows loading state while fetching" | Test passes | Yes |
| AG-10 | Target: Unit tests covering hook behavior in success, loading, and error states | useUsers hook handles error state | Unit test: `src/hooks/__tests__/useUsers.test.ts` — "returns error state on fetch failure" | Test passes | Yes |
| AG-11 | Target: Unit tests covering hook behavior in success, loading, and error states | useUsers hook handles refetch | Unit test: `src/hooks/__tests__/useUsers.test.ts` — "refetches data when refetch is called" | Test passes | Yes |
| AG-12 | Target: Unit tests covering hook behavior in success, loading, and error states | useUser hook returns single user successfully | Unit test: `src/hooks/__tests__/useUser.test.ts` — "returns user by ID on successful fetch" | Test passes | Yes |
| AG-13 | Target: Unit tests covering hook behavior in success, loading, and error states | useUser hook handles loading state | Unit test: `src/hooks/__tests__/useUser.test.ts` — "shows loading state while fetching" | Test passes | Yes |
| AG-14 | Target: Unit tests covering hook behavior in success, loading, and error states | useUser hook handles error state | Unit test: `src/hooks/__tests__/useUser.test.ts` — "returns error state on fetch failure" | Test passes | Yes |
| AG-15 | Target: Unit tests covering hook behavior in success, loading, and error states | useUser hook validates required parameter | Unit test: `src/hooks/__tests__/useUser.test.ts` — "requires userId parameter" | Test passes | Yes |
| AG-16 | Target: Unit tests covering hook behavior in success, loading, and error states | useCurrentUser hook returns authenticated user | Unit test: `src/hooks/__tests__/useCurrentUser.test.ts` — "returns current user on successful fetch" | Test passes | Yes |
| AG-17 | Target: Unit tests covering hook behavior in success, loading, and error states | useCurrentUser hook handles loading state | Unit test: `src/hooks/__tests__/useCurrentUser.test.ts` — "shows loading state while fetching" | Test passes | Yes |
| AG-18 | Target: Unit tests covering hook behavior in success, loading, and error states | useCurrentUser hook handles error state | Unit test: `src/hooks/__tests__/useCurrentUser.test.ts` — "returns error state on fetch failure" | Test passes | Yes |
| AG-19 | Target: Unit tests covering hook behavior in success, loading, and error states | useCurrentUser hook handles unauthenticated state | Unit test: `src/hooks/__tests__/useCurrentUser.test.ts` — "returns error when not authenticated" | Test passes | Yes |
| AG-20 | Target: Unit tests covering hook behavior (≥80% coverage for hook logic) | Test coverage meets threshold | `npm run test -- --coverage --collectCoverageFrom="src/hooks/use{Users,User,CurrentUser}.ts"` | Line coverage ≥ 80%, branch coverage ≥ 75% | Yes |
| AG-21 | Minimum: All three hooks function without throwing errors | No hooks throw synchronous errors during render | Run all hook tests without mocking error handling | Zero unhandled exceptions, all errors returned via error state | Yes |
| AG-22 | Target: Hooks return typed data structures with at minimum loading and error states | Hook return types are fully typed | TypeScript compiler with `--strict` | No `any` types in hook return signatures, all states explicitly typed | Yes |
| AG-23 | Target: Stale-while-revalidate or similar caching strategy | React Query caching is configured | Static analysis of hook implementations | `staleTime` and `gcTime` options present in useQuery config | No |

---

## Human Verification Points

### Path Selection Verification

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Constraint: Backend availability must be verified before implementation | Verify backend endpoints exist and return valid responses | Manual API testing: `curl` or Postman requests to `/api/users`, `/api/users/:id`, `/api/me` | System Architect |
| HV-02 | Constraint: Authentication context must be understood before implementation | Identify and document existing auth mechanism | Code review: search for JWT storage, session management, auth guards | System Architect |

### Removal Path Verification

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-03 | Minimum: If removed, zero references to these hooks remain | Confirm automated search captured all usage patterns | Manual code review of search results + spot-check component tree for dynamic imports | Intent Architect |
| HV-04 | Non-goal: This intent does NOT include implementing a complete user management system | Verify no future feature work is blocked by removal | Review roadmap and active trajectory intents for user-related functionality dependencies | Product Owner or System Architect |

### Implementation Path Verification

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-05 | Target: Error boundaries established around components consuming user data | Verify consuming components handle error states gracefully | Manual testing: trigger API errors (network failure, 401, 500) and confirm UI shows error state without crashing | UX Reviewer or Intent Architect |
| HV-06 | Target: Hooks implemented with real backend integration | Verify data flow integrity from API to UI | End-to-end manual test: fetch users, verify data matches backend response structure, confirm loading states transition correctly | System Architect |
| HV-07 | Minimum: Hooks return typed data structures with at minimum loading and error states | Review TypeScript definitions for completeness | Code review: verify User type in `src/types/user.ts` includes all fields returned by backend API | System Architect |
| HV-08 | Constraint: No breaking changes to existing component interfaces | Confirm hook API matches established patterns | Code review: compare useUsers/useUser/useCurrentUser signatures to useProjects/useTrajectories patterns | System Architect |
| HV-09 | Constraint: Performance budget — user data fetching must not block initial page render | Verify hooks do not block app initialization | Manual testing: measure time-to-interactive with network throttling, confirm <Suspense> boundaries or conditional fetching | Performance Engineer or System Architect |
| HV-10 | Stretch: Documentation in Storybook or similar showing hook usage patterns | If documentation added, verify examples are accurate and helpful | Manual review: run Storybook, test example code, confirm patterns are production-ready | Technical Writer or Intent Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| **Minimum:** All three hooks either function without throwing errors OR are removed from the codebase entirely | AG-01 (type check), AG-03 (test suite), AG-06 (files removed), AG-21 (no sync errors if implemented) |
| **Minimum:** If removed, zero references to these hooks remain in src/ directory (verified via grep/search) | AG-04 (no imports), AG-05 (no usage), HV-03 (manual verification) |
| **Minimum:** If implemented, hooks return typed data structures with at minimum loading and error states | AG-22 (typed return values), HV-07 (type completeness review) |
| **Minimum:** No console errors or unhandled exceptions when hooks are invoked in development mode | AG-01 (type check), AG-03 (test suite), AG-21 (no unhandled exceptions), HV-05 (manual error testing) |
| **Target:** Hooks implemented with real backend integration (REST or GraphQL endpoint) | HV-01 (backend verification), HV-06 (data flow integrity) |
| **Target:** Stale-while-revalidate or similar caching strategy to minimize redundant network calls | AG-23 (React Query config present), HV-08 (pattern consistency) |
| **Target:** Error boundaries established around components consuming user data | HV-05 (error state handling verified) |
| **Target:** Unit tests covering hook behavior in success, loading, and error states (≥80% coverage for hook logic) | AG-08 through AG-19 (comprehensive test suite), AG-20 (coverage threshold) |
| **Stretch:** Optimistic updates for any user mutation operations | *(No verification defined — stretch goal deferred)* |
| **Stretch:** WebSocket or SSE integration for real-time user presence/status | *(No verification defined — stretch goal deferred)* |
| **Stretch:** Comprehensive integration tests demonstrating end-to-end user data flow | *(No verification defined — stretch goal deferred)* |
| **Stretch:** Documentation in Storybook or similar showing hook usage patterns | HV-10 (documentation review if added) |
| **Constraint:** No breaking changes to existing component interfaces | AG-04 (no new import errors if removed), HV-08 (API consistency if implemented) |
| **Constraint:** Backend availability (if implementing) | HV-01 (endpoint verification) |
| **Constraint:** Authentication context (if implementing) | HV-02 (auth mechanism documented) |
| **Constraint:** Performance budget — must not block initial page render | HV-09 (initialization performance verified) |
| **Constraint:** Type safety — no any types permitted | AG-22 (strict typing enforced) |

**Orphan checks:** None  
**Uncovered criteria:** None (Stretch goals intentionally not verified for this Tier 1 orbit)

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| AG-04 or AG-05 fails — callsites discovered after deletion | re-orbit — Remediate discovered callsites by either removing them (if dead code) or adding TODO comments with escalation note; retry removal | AI Agent → Intent Architect if callsites represent critical functionality |
| AG-08 through AG-19 — unit tests fail during implementation | re-orbit — Fix hook implementation to pass tests; if test expectations are wrong, update tests with justification in commit message | AI Agent |
| AG-20 fails — test coverage below 80% threshold | re-orbit — Add missing test cases to cover uncovered branches | AI Agent |
| HV-01 fails — backend endpoints do not exist or return errors | modify-intent — Implementation path is blocked; switch to removal path and document backend dependency for future orbit | Intent Architect |
| HV-02 fails — no authentication system identified | escalate — Implementing user hooks without auth is architectural risk; escalate to Tier 2 for auth system design or proceed with removal | System Architect |
| HV-05 fails — error states crash app or show poor UX | re-orbit — Add error boundaries and improve error messaging; if boundaries require architectural changes, escalate to Tier 2 | AI Agent → System Architect if error boundary pattern needs to be established project-wide |
| HV-06 fails — data flow integrity issues (type mismatches, missing fields) | re-orbit — Update User type definitions and hook implementations to match backend schema | AI Agent |
| HV-09 fails — hooks block initial render or exceed performance budget | re-orbit — Add conditional fetching (`enabled: false` until auth confirmed) or wrap consuming components in Suspense boundaries | AI Agent |
| AG-01, AG-02, or AG-03 fails — build, lint, or tests broken | re-orbit — Fix compilation errors, lint violations, or test failures; standard development cycle | AI Agent |
| HV-04 fails — removal blocks future roadmap features | modify-intent — Reverify with Product Owner; if user hooks are near-term dependency, escalate to implement with proper auth system design | Intent Architect → Product Owner |