# Proposal Record — T3-004: Build repository viewer page (frontend)

**Proposal ID:** PROP-T3-004-1  
**Generated:** 2024-02-17  
**Intent:** T3-004  
**Context Packages:**
- Architectural: (not provided)
- Intent-specific: CTX-T3-004  
**Trust Tier:** 2 — supervised

---

## Interpreted Intent

Users need a way to see what files exist in their connected repository and inspect what's inside them without leaving the Prometheus platform. The page must show a navigable folder tree on the side, display file contents with colored syntax, let them pick different Git branches from a dropdown, and show a side-by-side comparison of changes between an orbit's branch and the main branch. This is read-only — users browse and compare, but don't edit or commit. The implementation must handle repositories with thousands of files without freezing the UI, respect existing authentication boundaries, and fetch everything from backend APIs without touching Git directly in the browser.

---

## Implementation Plan

### Files to Create
- `app/projects/[projectId]/repository/page.tsx` — Main page component (server component wrapper + client component orchestration)
- `components/repository/FileTree.tsx` — Recursive collapsible tree with folder/file icons and selection state
- `components/repository/FileViewer.tsx` — Syntax-highlighted code display with line numbers
- `components/repository/BranchSelector.tsx` — Dropdown for branch switching with current branch indicator
- `components/repository/DiffViewer.tsx` — Side-by-side diff with add/remove/context line coloring
- `components/repository/RepositoryLayout.tsx` — Split layout: tree sidebar (30%) + viewer panel (70%)
- `lib/api/repository.ts` — API client functions: `getFileTree()`, `getFileContent()`, `getBranches()`, `getFileDiff()`
- `types/repository.ts` — TypeScript interfaces: `FileNode`, `Branch`, `DiffHunk`, `RepositoryFile`
- `hooks/useRepository.ts` — React Query hooks: `useFileTree`, `useFileContent`, `useBranches`, `useFileDiff`
- `__tests__/components/repository/FileTree.test.tsx` — Unit tests: expand/collapse, selection, keyboard navigation
- `__tests__/components/repository/FileViewer.test.tsx` — Unit tests: syntax highlighting, loading states, error boundaries
- `__tests__/components/repository/BranchSelector.test.tsx` — Unit tests: branch list rendering, selection callback
- `__tests__/components/repository/DiffViewer.test.tsx` — Unit tests: line-by-line diff rendering, hunk display
- `__tests__/pages/repository.test.tsx` — Integration tests: page load, file selection flow, branch switching

### Files to Modify
- `app/projects/[projectId]/layout.tsx` — Add repository page link to project navigation sidebar
- `middleware.ts` — Add `/projects/:projectId/repository` to protected routes (if not already pattern-matched)
- `components/ui/index.ts` — Export any new shared UI primitives if created during implementation

### Approach

Follow the established Next.js 13 App Router pattern with server component for route protection and client components for interactivity. The page uses a three-panel layout: branch selector at top, collapsible file tree in left sidebar (30% width), and content viewer/diff viewer in main panel (70% width). 

State management uses React Query for caching file tree, file contents, and branches to minimize redundant API calls. The file tree component is recursive with lazy-loaded children (fetch on expand) to avoid loading 10,000+ files at once. Syntax highlighting uses `react-syntax-highlighter` with lazy-loaded language definitions (code-split by language) to keep initial bundle under budget. Diff view uses `react-diff-view` for side-by-side comparison.

Virtual scrolling via `@tanstack/react-virtual` handles large file trees without DOM bloat. All API calls go through `lib/api/repository.ts` client functions that use the existing `apiClient` wrapper for auth token injection and error handling.

### Order of Operations
1. Define TypeScript types in `types/repository.ts` (FileNode, Branch, DiffHunk structures)
2. Implement API client functions in `lib/api/repository.ts` with typed responses
3. Build React Query hooks in `hooks/useRepository.ts` wrapping API clients
4. Create `BranchSelector` component (simplest — dropdown with list)
5. Create `FileTree` component with virtual scrolling and lazy loading
6. Create `FileViewer` component with syntax highlighting (dynamic import for highlighter)
7. Create `DiffViewer` component with side-by-side hunks
8. Build `RepositoryLayout` orchestrating all child components with state coordination
9. Create page route in `app/projects/[projectId]/repository/page.tsx`
10. Add navigation link in project layout
11. Write component unit tests (FileTree, FileViewer, BranchSelector, DiffViewer)
12. Write page integration tests (full user flows)
13. Update middleware route protection if needed

### Dependencies
- Backend APIs must be implemented and return expected JSON structures (see Context Package API contracts)
- Project must have `repository_url` or `repository_id` configured in database
- User must have valid project membership with read permissions
- External packages: `react-syntax-highlighter`, `react-diff-view`, `@tanstack/react-virtual`, `lucide-react` (icons)

---

## Risk Surface

### Edge Cases
- **Empty repositories**: Tree query returns empty array — must show "No files found" state instead of infinite spinner
- **Binary files**: Backend may return non-text content (images, PDFs) — FileViewer must detect via MIME type and show "Cannot display binary file" message instead of attempting syntax highlighting
- **Extremely large files (>5MB)**: Syntax highlighting may freeze browser — add file size check in FileViewer, show warning banner "File too large to display, showing raw text" and render in plain `<pre>` tag
- **Branch deleted mid-session**: User has branch selected, backend returns 404 on next API call — must detect, show toast notification "Branch no longer exists", reset to default branch
- **Deep nested folders (>20 levels)**: Recursive tree rendering could hit stack limits — FileTree must use iterative queue-based rendering instead of naive recursion
- **Unicode filenames**: Paths with emoji or non-ASCII characters may break URL encoding in API calls — `lib/api/repository.ts` must properly URI-encode path parameters

### Regressions
- **Project navigation sidebar**: Adding repository link could push other nav items out of viewport on smaller screens — verify existing responsive behavior still works
- **API client error handling**: New repository API functions must not bypass existing error toast notifications from `apiClient` wrapper — test error states propagate correctly
- **Route middleware**: Overly broad pattern matching in middleware could unintentionally protect or expose other routes — verify `/projects/:projectId/repository` pattern doesn't conflict with existing routes

### Security
- **Path traversal via file path parameter**: Malicious path like `../../../../etc/passwd` could attempt to access files outside repository — backend must validate, but frontend should also sanitize path input before API calls
- **Branch name injection**: Specially crafted branch names (e.g., `main; rm -rf /`) could be interpolated into API URLs — must properly encode branch parameter in all API calls
- **Sensitive data in file contents**: Repository may contain credentials, API keys, or PII — page must not log file contents to console or analytics; error messages must not leak file paths or branch names
- **Repository access tokens**: If tokens are passed client-side (they shouldn't be per constraints), they could be exposed in browser devtools — verify all repository authentication happens server-side with tokens never reaching client bundle

### Performance
- **Initial file tree fetch with 10,000 files**: May return 2-5MB JSON payload — could take 3-5 seconds on slow connections and block UI. Mitigation: Show skeleton loader during fetch, consider pagination or root-level-only initial fetch with lazy-load on expand.
- **Syntax highlighting bundle size**: `react-syntax-highlighter` with all languages is ~300KB gzipped — exceeds performance budget. Mitigation: Lazy load language definitions per-file based on extension (e.g., `.tsx` loads TypeScript module on first TypeScript file view).
- **Diff rendering for large files (1000+ lines)**: Side-by-side diff with 2000 DOM nodes (1000 lines × 2 sides) may cause scroll jank. Mitigation: Virtual scrolling in DiffViewer, only render visible viewport + buffer.
- **Concurrent branch switches**: Rapidly switching branches could fire overlapping API requests, causing race conditions where older response overwrites newer selection. Mitigation: React Query automatically cancels in-flight queries when key changes, but verify cancellation works for repository hooks.

---

## Scope Estimate

| Metric | Value |
|--------|-------|
| Files affected | 17 (14 create + 3 modify) |
| Complexity | High — Introduces new subsystem (repository viewer) with multiple external dependencies (syntax highlighter, diff renderer, virtual scrolling), performance-critical rendering (10K files), and complex state coordination (branch selection affects tree and viewer). Novel integration: side-by-side diff tied to orbit branch detection. |
| Estimated test cases | 24 (FileTree: 6 [expand/collapse, selection, keyboard nav, lazy load, error, empty], FileViewer: 6 [syntax highlighting, loading, error boundary, binary file, large file, line numbers], BranchSelector: 4 [branch list, selection, default branch, error], DiffViewer: 4 [side-by-side hunks, add/remove/context lines, empty diff, error], Page integration: 4 [initial load, file selection flow, branch switch, unauthorized access]) |

---

## Authorization

| Field | Value |
|-------|-------|
| Status | pending |
| Authorized by | |
| Timestamp | |

---

## Human Modifications

_(No modifications yet — pending initial review)_