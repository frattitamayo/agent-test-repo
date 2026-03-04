# Context Package — T3-004: Build repository viewer page (frontend)

**Generated:** 2024-02-17
**Package Type:** intent-specific
**Intent:** T3-004

---

## Codebase

### Primary (will be modified or created)
- `app/projects/[projectId]/repository/page.tsx` — Main repository viewer page component
- `app/projects/[projectId]/repository/layout.tsx` — Layout wrapper if needed
- `components/repository/FileTree.tsx` — Collapsible directory tree component
- `components/repository/FileViewer.tsx` — File content display with syntax highlighting
- `components/repository/BranchSelector.tsx` — Branch dropdown component
- `components/repository/DiffViewer.tsx` — Side-by-side diff component
- `lib/api/repository.ts` — API client functions for repository endpoints
- `types/repository.ts` — TypeScript interfaces for repository data structures
- `hooks/useRepository.ts` — Custom hooks for repository data fetching

### Secondary (dependencies and interfaces)
- `app/projects/[projectId]/layout.tsx` — Project layout with navigation sidebar
- `components/ui/` — Shared UI primitives (Button, Dropdown, Skeleton, Error states)
- `lib/api/client.ts` — Base API client with authentication
- `hooks/useProject.ts` — Project context and authorization
- `middleware.ts` — Route protection and authentication checks
- `app/api/` — Existing API route patterns for reference

### Tests
- `__tests__/components/repository/FileTree.test.tsx`
- `__tests__/components/repository/FileViewer.test.tsx`
- `__tests__/components/repository/BranchSelector.test.tsx`
- `__tests__/components/repository/DiffViewer.test.tsx`
- `__tests__/pages/repository.test.tsx` — Page-level integration tests

---

## Architecture

Prometheus V1 follows Next.js 13+ App Router architecture with client/server component separation. The repository viewer is a client-side feature that consumes backend APIs, living in the project-scoped route hierarchy. Data fetching uses React Query for caching and state management, with API client functions in `lib/api/` abstracting HTTP calls. Components follow atomic design with shared UI primitives in `components/ui/`.

**Reference docs:**
- `docs/architecture.md` — System architecture overview
- `docs/frontend-patterns.md` — Component and data fetching conventions
- `docs/api-integration.md` — Backend API contracts and error handling
- `.github/copilot-instructions.md` — Project-wide development guidelines

---

## Patterns

### Conventions (follow these)
- **Page Components**: See `app/projects/[projectId]/page.tsx` — Server components for layout, client components for interactivity, wrapped in `<ProjectLayout>`
- **API Client Functions**: See `lib/api/projects.ts` — Functions return typed promises, use `apiClient` wrapper, handle errors via `ApiError` class
- **Data Fetching Hooks**: See `hooks/useProjects.ts` — Custom hooks wrap React Query `useQuery`/`useMutation`, export loading/error states, invalidation patterns
- **Component Structure**: See `components/trajectories/` — One component per file, TypeScript interfaces at top, props destructured, error boundaries for fault isolation
- **UI Components**: See `components/ui/` — Shadcn-based primitives with Tailwind styling, Radix UI for accessible interactions
- **Route Protection**: See `middleware.ts` — Protected routes check authentication via `getServerSession`, redirect to login if unauthorized

### Anti-patterns (avoid these)
- **Client-side routing for auth**: Never check authentication in client components — auth checks happen in middleware or server components
- **Direct fetch calls**: Do not use raw `fetch()` — always use `apiClient` from `lib/api/client.ts` for consistent error handling and auth headers
- **Prop drilling**: Do not pass data through multiple component layers — use context or React Query cache for shared state
- **Inline API URLs**: Never hardcode `/api/...` paths in components — define in `lib/api/` with typed interfaces
- **Unkeyed lists**: Always provide stable `key` props for lists, never use array index as key for dynamic content

---

## Dependencies

### Internal
- `lib/api/client.ts` — Authenticated HTTP client with error handling, retry logic, and auth token injection
- `hooks/useProject.ts` — Project membership validation and authorization context
- `components/ui/` — Button, Dropdown, ScrollArea, Skeleton, Tabs, Toast components from shared UI library
- `lib/utils.ts` — Common utilities (cn, date formatting, error messages)
- `types/api.ts` — Shared API response types and error interfaces

### External
- **@monaco-editor/react** or **react-syntax-highlighter** — Syntax highlighting for file contents (evaluate based on bundle size vs. feature needs)
- **react-diff-view** or **diff2html** — Diff rendering with line-by-line comparison
- **@tanstack/react-query** — Data fetching, caching, and synchronization (already in use)
- **lucide-react** — Icon library for folder/file/branch icons (consistent with existing UI)
- **react-window** or **@tanstack/react-virtual** — Virtual scrolling for large file trees (10,000+ files)

### Backend APIs (contracts assumed from intent dependencies)
```typescript
// Expected API contracts
GET /api/projects/:projectId/repository/tree?branch={branch}
Response: { files: FileNode[], rootPath: string }

GET /api/projects/:projectId/repository/file?path={path}&branch={branch}
Response: { content: string, path: string, size: number, mimeType: string }

GET /api/projects/:projectId/repository/branches
Response: { branches: Branch[], defaultBranch: string }

GET /api/projects/:projectId/repository/diff?path={path}&baseBranch={base}&compareBranch={compare}
Response: { hunks: DiffHunk[], oldPath: string, newPath: string }
```

---

## Prior Art

### Completed
- Project routing structure established in `app/projects/[projectId]/` — follow existing layout and navigation patterns
- API client implementation in `lib/api/client.ts` — reuse for repository endpoints
- UI component library in `components/ui/` — leverage existing Button, Dropdown, ScrollArea for consistent styling
- Authentication middleware in `middleware.ts` — repository page must use same protection pattern

### Known Issues
- Large file rendering (>5MB) may cause browser performance issues — add file size check and warning before rendering
- Syntax highlighting libraries have significant bundle impact — evaluate lazy loading or web worker approach if bundle size exceeds 200KB
- Virtual scrolling with nested tree structures can cause scroll position jitter — may need custom scroll position management

---

## Constraints

### Build (must pass)
- `npm run build` — Next.js production build with zero TypeScript errors
- `npm run lint` — ESLint with project-specific rules (no-unused-vars, explicit-function-return-type)
- `npm run type-check` — Strict TypeScript validation
- `npm run test` — Jest/React Testing Library tests with >80% coverage for new components

### Guardrails (do not violate)
- **No direct Git operations in frontend** — All repository data must come from backend APIs; no client-side Git libraries
- **Route protection required** — `/projects/:projectId/repository` must enforce project membership in middleware
- **No sensitive data in client state** — Repository tokens, credentials, or private keys must never reach client bundle or localStorage
- **Accessibility mandatory** — All interactive elements must be keyboard navigable (tab, arrow keys, Enter, Space) and screen-reader compatible
- **Performance budget** — Initial page JS bundle must not exceed 500KB gzipped; defer syntax highlighting and diff libraries via dynamic imports if needed
- **Error boundaries required** — FileTree, FileViewer, and DiffViewer must each have error boundaries to prevent full page crashes on partial failures