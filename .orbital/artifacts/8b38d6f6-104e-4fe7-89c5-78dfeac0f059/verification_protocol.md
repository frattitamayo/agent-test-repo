# Verification Protocol — T3-004: Build repository viewer page (frontend)

**Protocol ID:** VP-T3-004-1  
**Generated:** 2024-02-17  
**Intent:** T3-004  
**Proposal:** PROP-T3-004-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Display connected repo file tree | File tree renders from API response with nested folder structure | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/renders_nested_structure | Test passes | Yes |
| AG-02 | Collapsible directory tree sidebar | Clicking folder icon expands/collapses children | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/expand_collapse_interaction | Test passes | Yes |
| AG-03 | File content viewer with syntax highlighting | File content renders with correct language-specific syntax colors | `__tests__/components/repository/FileViewer.test.tsx` — TestFileViewer/syntax_highlighting_applied | Test passes | Yes |
| AG-04 | Branch selector dropdown | Dropdown lists all branches from API, selection triggers callback | `__tests__/components/repository/BranchSelector.test.tsx` — TestBranchSelector/branch_list_and_selection | Test passes | Yes |
| AG-05 | Diff view mode showing changes from orbit branch vs. main | Diff viewer renders side-by-side comparison with add/remove/context lines | `__tests__/components/repository/DiffViewer.test.tsx` — TestDiffViewer/side_by_side_diff_rendering | Test passes | Yes |
| AG-06 | Handle repositories with thousands of files without freezing | Virtual scrolling renders only visible rows for 10K+ file tree | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/virtual_scrolling_performance | DOM nodes < 100 for 10K file tree | Yes |
| AG-07 | Lazy-loading of file tree children | Expanding folder triggers API call for children only | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/lazy_load_on_expand | API called with correct path, children appended | Yes |
| AG-08 | Empty repository state | Empty file tree response shows "No files found" message | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/empty_state | Message displayed, no infinite spinner | Yes |
| AG-09 | Binary file detection | Attempting to view binary file shows "Cannot display binary file" | `__tests__/components/repository/FileViewer.test.tsx` — TestFileViewer/binary_file_handling | Warning message displayed, no syntax highlighting attempted | Yes |
| AG-10 | Large file warning | File >5MB shows warning banner, renders as plain text | `__tests__/components/repository/FileViewer.test.tsx` — TestFileViewer/large_file_warning | Warning banner + plain `<pre>` tag, not syntax highlighter | Yes |
| AG-11 | Branch deleted mid-session | 404 from API after branch deletion shows toast, resets to default branch | `__tests__/pages/repository.test.tsx` — TestRepositoryPage/deleted_branch_handling | Toast notification + branch selector reset | Yes |
| AG-12 | Path traversal prevention | File path with `../` characters is sanitized before API call | `__tests__/lib/api/repository.test.tsx` — TestRepositoryAPI/path_sanitization | Path normalized, no traversal sequences in URL | Yes |
| AG-13 | Branch name encoding | Branch name with special characters (`;`, `&`) is properly URI-encoded | `__tests__/lib/api/repository.test.tsx` — TestRepositoryAPI/branch_name_encoding | Encoded correctly in API URL | Yes |
| AG-14 | Unauthorized access blocked | Non-member attempting to access repository page sees 403/redirect | `__tests__/pages/repository.test.tsx` — TestRepositoryPage/unauthorized_access | Redirect to projects list or 403 error | Yes |
| AG-15 | Initial page load completes | Full page render (tree + viewer + branch selector) within 5 seconds | Integration test with performance timing | Time to interactive < 5s for 1000-file repo | Yes |
| AG-16 | Syntax highlighting bundle size | Lazy-loaded language modules keep initial bundle under 350KB gzipped | Build analysis with `next/bundle-analyzer` | Main bundle < 350KB gzipped | Yes |
| AG-17 | Project navigation updated | Repository link appears in project sidebar navigation | `__tests__/pages/layout.test.tsx` — TestProjectLayout/repository_nav_link | Link present with correct href | Yes |
| AG-18 | Existing navigation responsive behavior | Project nav sidebar remains functional on mobile (768px width) | Visual regression test with Playwright | No layout overflow, all nav items accessible | Yes |
| AG-19 | API error propagation | Repository API errors trigger existing toast notification system | `__tests__/hooks/useRepository.test.tsx` — TestRepositoryHooks/error_handling | Toast notification shown with error message | Yes |
| AG-20 | No file content logging | File viewer does not log file contents to console or analytics | Static code analysis + runtime test | No `console.log` or analytics calls with file content | Yes |
| AG-21 | Deep nested folders render | File tree with 25+ nesting levels renders without stack overflow | `__tests__/components/repository/FileTree.test.tsx` — TestFileTree/deep_nesting | Iterative rendering completes successfully | Yes |
| AG-22 | Unicode filename handling | Filenames with emoji and non-ASCII characters render and fetch correctly | `__tests__/lib/api/repository.test.tsx` — TestRepositoryAPI/unicode_paths | URI-encoded correctly, file content fetched | Yes |
| AG-23 | Concurrent branch switches | Rapidly switching branches cancels in-flight requests | `__tests__/hooks/useRepository.test.tsx` — TestRepositoryHooks/query_cancellation | Only latest branch data rendered, no race condition | Yes |
| AG-24 | Diff viewer virtual scrolling | 2000-line diff renders only visible viewport | `__tests__/components/repository/DiffViewer.test.tsx` — TestDiffViewer/virtual_scrolling | DOM nodes < 200 for 2000-line diff | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | File content viewer with syntax highlighting | Verify syntax colors match language conventions (e.g., TypeScript keywords blue, strings green) | Manual inspection in staging with sample `.tsx`, `.py`, `.go` files | UI/UX Engineer |
| HV-02 | Collapsible directory tree sidebar + File content viewer | Verify layout feels natural: tree width (30%) allows folder names to be readable, viewer (70%) doesn't feel cramped | Demo walkthrough with real repository structure | UI/UX Engineer |
| HV-03 | Diff view mode showing changes | Verify side-by-side diff is easy to scan: line alignment correct, add/remove colors intuitive (green/red), context lines not distracting | Manual comparison in staging with orbit branch containing 50+ line changes | UI/UX Engineer |
| HV-04 | Branch selector dropdown | Verify branch selection UX: current branch clearly indicated, dropdown accessible via keyboard, branch names truncate gracefully if long | Manual test with repository having 20+ branches | UI/UX Engineer |
| HV-05 | Handle repositories with thousands of files without freezing | Confirm UI remains responsive during scroll through 5000-file tree: no jank, smooth 60fps scroll, expand/collapse instant | Manual performance test in staging with large repository | System Architect |
| HV-06 | Respect existing authentication boundaries | Verify user without project membership cannot access `/projects/:projectId/repository` via direct URL | Manual unauthorized access attempt in staging | Security Engineer |
| HV-07 | No sensitive data leaks in error messages | Trigger various error states (404 branch, 500 API error) and confirm error messages do not contain file paths, branch names, or internal system details | Manual error boundary testing in staging | Security Engineer |
| HV-08 | No repository authentication tokens in client bundle | Inspect browser Network tab and Application/Storage to verify no tokens or credentials present client-side | Manual devtools inspection during page load | Security Engineer |
| HV-09 | Project navigation sidebar responsive behavior | Verify repository link doesn't break mobile layout: test on 375px (mobile), 768px (tablet), 1024px (desktop) | Manual responsive testing in staging | UI/UX Engineer |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Display connected repo file tree (browseable) | AG-01, AG-07, AG-08, HV-05 |
| Collapsible directory tree sidebar | AG-02, HV-02 |
| File content viewer with syntax highlighting | AG-03, AG-09, AG-10, HV-01 |
| Branch selector dropdown | AG-04, HV-04 |
| Diff view mode showing changes from orbit/intent branch vs. main | AG-05, HV-03, AG-24 |
| Handle repositories with thousands of files without freezing UI | AG-06, AG-21, HV-05 |
| Respect existing authentication boundaries | AG-14, HV-06 |
| Fetch everything from backend APIs (no direct Git access) | AG-07, AG-11, AG-12, AG-13, AG-19, AG-22, AG-23 |
| Read-only (no editing or committing) | _(implicit — no edit controls exist to test)_ |
| Security: no path traversal, no branch injection, no sensitive data leaks | AG-12, AG-13, AG-20, HV-07, HV-08 |
| Performance: <5s initial load, syntax highlighting under budget | AG-15, AG-16, HV-05 |
| Existing navigation remains functional | AG-17, AG-18, HV-09 |
| API error handling integrates with existing toast system | AG-19 |

**Orphan checks:** None  
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| Unit test failure (AG-01 through AG-13, AG-17, AG-19, AG-20, AG-21, AG-22) | re-orbit — fix implementation and re-run | AI Agent |
| Performance test failure (AG-06, AG-15, AG-16, AG-24) | re-orbit — profile and optimize; if architectural bottleneck (e.g., API response too slow), escalate | AI Agent → System Architect |
| Unauthorized access test failure (AG-14) | re-orbit — security-critical, must fix middleware/auth check before merge | AI Agent |
| Integration test failure (AG-23) | re-orbit — React Query cancellation may need explicit `signal` handling | AI Agent |
| Visual regression failure (AG-18) | re-orbit — adjust responsive CSS, re-test on target breakpoints | AI Agent |
| Syntax highlighting UX concern (HV-01) | re-orbit — adjust color theme or language definition | UI/UX Engineer → AI Agent |
| Layout proportions feel wrong (HV-02) | modify-intent — if 30/70 split is fundamentally unsuitable, need intent amendment for different layout | UI/UX Engineer → Intent Architect |
| Diff view confusing (HV-03) | re-orbit — adjust diff rendering library configuration or line styling | UI/UX Engineer → AI Agent |
| Branch selector UX issue (HV-04) | re-orbit — fix keyboard navigation or truncation logic | UI/UX Engineer → AI Agent |
| Scroll jank in large tree (HV-05) | escalate — virtual scrolling not sufficient, may need pagination or backend-side tree API changes | System Architect |
| Authentication boundary bypassed (HV-06) | re-orbit — security-critical, must fix immediately | Security Engineer → AI Agent |
| Error messages leak internals (HV-07) | re-orbit — sanitize error message construction | Security Engineer → AI Agent |
| Tokens found client-side (HV-08) | escalate — architectural violation, backend API design must change | Security Engineer → System Architect |
| Mobile navigation broken (HV-09) | re-orbit — fix responsive styles for nav sidebar | UI/UX Engineer → AI Agent |

---

## Verification Sequence

Execute checks in this order to fail fast and minimize wasted effort:

### Phase 1: Static Analysis & Security (Pre-Build)
1. AG-20 — No file content logging (static code scan)
2. AG-12 — Path traversal prevention (code review of `lib/api/repository.ts`)
3. AG-13 — Branch name encoding (code review of API client)

### Phase 2: Unit Tests (Post-Build, Pre-Integration)
4. AG-01 through AG-11 — Component unit tests
5. AG-21, AG-22 — Edge case unit tests

### Phase 3: Integration Tests (Pre-Deployment to Staging)
6. AG-14 — Unauthorized access
7. AG-17, AG-18 — Navigation integration
8. AG-19 — API error propagation
9. AG-23 — Concurrent branch switches

### Phase 4: Performance Tests (Staging Environment)
10. AG-06 — Virtual scrolling with 10K files
11. AG-15 — Initial page load <5s
12. AG-16 — Bundle size analysis
13. AG-24 — Diff viewer virtual scrolling

### Phase 5: Human Verification (Staging Environment)
14. HV-01 through HV-09 — Manual UX/security checks

### Phase 6: Regression Validation
15. Re-run existing project navigation test suite to confirm no breaks

---

## Success Criteria

**Orbit Closure Authorized When:**
- All automated gates (AG-01 through AG-24) pass
- All human verification points (HV-01 through HV-09) signed off by designated roles
- No orphan checks or uncovered acceptance criteria
- All escape criteria actions resolved (no pending re-orbits or escalations)