# Intent Document — T3-004 · Build repository viewer page (frontend)

**Project:** Prometheus V1  
**Trajectory:** Repository Viewer  
**Intent ID:** T3-004  
**Trust Tier:** 2 — supervised  
**Status:** draft  
**Generated:** 2024

---

## Objective

Enable users to browse their connected repository's file structure and view file contents through a dedicated repository viewer page. Users must be able to navigate the file tree, view file contents with syntax highlighting, switch between branches, and compare changes made by ORBITAL orbits against the main branch.

---

## Constraints

- **No direct Git operations from frontend** — All repository interactions must occur through existing backend APIs; the frontend must not implement Git commands or file system access
- **Read-only interface** — Users cannot edit, create, or delete files through this interface; viewing and diffing only
- **Performance boundary** — File tree rendering must support repositories with up to 10,000 files without pagination of the tree structure itself
- **Existing route structure** — Must follow established routing pattern `/projects/:projectId/repository` and integrate with current navigation
- **Authentication required** — Page access requires valid project membership; must respect existing authorization boundaries
- **No local file caching** — All file contents fetched on-demand from backend; no browser-based repository cloning

---

## Acceptance Criteria

### Functional Requirements

- [ ] Route `/projects/:projectId/repository` renders a new repository viewer page
- [ ] **Directory tree sidebar** displays hierarchical file structure with collapsible folders
- [ ] **File content viewer** renders selected file contents in main panel with syntax highlighting
- [ ] **Branch selector dropdown** allows switching between repository branches (minimum: main + orbit/intent branches)
- [ ] **Diff view mode** toggles between normal file view and side-by-side diff comparing orbit/intent branch against main branch
- [ ] Clicking a file in the tree loads its contents in the viewer
- [ ] Expanding/collapsing folders preserves state during same-session navigation
- [ ] Syntax highlighting supports at minimum: JavaScript, TypeScript, Python, JSON, YAML, Markdown, SQL
- [ ] Diff view clearly indicates added lines (green), removed lines (red), and unchanged context

### Non-Functional Requirements

- [ ] Initial page load (empty tree) completes in <500ms `[inferred]`
- [ ] File tree with 1,000 files renders in <2s `[inferred]`
- [ ] File content fetch and display completes in <1s for files up to 1MB `[inferred]`
- [ ] Branch switching updates tree view in <2s `[inferred]`
- [ ] UI remains responsive during file tree expansion/collapse operations
- [ ] Accessibility: keyboard navigation for tree (arrow keys, Enter, Space) and all interactive controls meet WCAG 2.1 AA
- [ ] Mobile viewport (≤768px) shows collapsible tree with overlay or drawer pattern

### Integration Requirements

- [ ] Page integrates with existing project navigation (sidebar, breadcrumbs)
- [ ] Branch selector lists all branches returned by backend repository API
- [ ] Diff mode correctly identifies orbit/intent branches by naming convention
- [ ] Error states handled: repository not connected, branch not found, file fetch failure, permission denied

---

## Trust Tier Rationale

**Tier 2 — Supervised**

This intent requires supervised trust because:

1. **User-facing feature with data sensitivity** — Displays repository contents which may contain sensitive code, credentials, or proprietary logic; incorrect access control could expose unauthorized data
2. **Cross-concern integration** — Touches routing, authentication boundaries, and external repository data; requires verification that authorization checks are correctly applied
3. **Performance impact** — Introduces new data-fetching patterns that could affect backend load; needs validation that large repositories don't degrade system performance
4. **Moderate reversibility** — While the feature can be feature-flagged or route-gated, once deployed it becomes part of the user's expected workflow and affects user trust in the platform

Not Tier 3 because: Implementation patterns (file tree, syntax highlighting, diff views) are well-established with mature libraries; no novel architectural decisions required.

Not Tier 1 because: Direct repository access and potential for exposing sensitive data requires human review before production deployment.

---

## Dependencies

### Required Backend APIs
- **GET** `/api/projects/:projectId/repository/tree?branch={branch}` — Returns file tree structure for specified branch
- **GET** `/api/projects/:projectId/repository/file?path={path}&branch={branch}` — Returns file contents for specified path and branch
- **GET** `/api/projects/:projectId/repository/branches` — Returns list of available branches
- **GET** `/api/projects/:projectId/repository/diff?path={path}&baseBranch={base}&compareBranch={compare}` — Returns diff between two branches for specified file

### Prior Intents
- Repository connection functionality must be implemented (user must be able to connect a repository to their project)
- Project authorization must be in place (`:projectId` route protection)

### External Libraries (Suggested Domain)
- Syntax highlighting library (e.g., Prism.js, Highlight.js, Monaco Editor)
- Diff rendering library (e.g., react-diff-view, diff2html)
- Virtual scrolling for large file trees (e.g., react-window, react-virtuoso)

### Data Requirements
- Project must have `repository_url` or `repository_id` configured
- Backend must have valid Git credentials/tokens for repository access
- User session must include project membership with `read` permission minimum

---

## Scope Boundaries

### In Scope
- Viewing repository file structure and contents
- Switching between branches
- Viewing diffs between orbit branches and main

### Out of Scope (Deferred to Future Intents)
- Editing files through the interface
- Committing changes from UI
- Merge conflict resolution
- File search within repository
- Blame/history view for individual files
- Code review features (comments, annotations)
- Download/export files
- Compare arbitrary branch combinations (limited to orbit branch vs. main)