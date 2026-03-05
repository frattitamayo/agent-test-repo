# Context Package — Create Template Project

**Generated:** 2025-01-21  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Orbit:** #1  
**Trust Tier:** 1 (Standard Review Required)

---

## Codebase

### Primary (will be created)
- `package.json` — Project dependencies, scripts, and metadata
- `index.html` — Application entry HTML
- `vite.config.js` — Build tool configuration
- `src/main.jsx` — React application bootstrap
- `src/App.jsx` — Root component
- `src/App.css` — Root component styles
- `src/index.css` — Global styles
- `.gitignore` — Version control exclusions
- `README.md` — Setup and usage documentation

### Secondary (configuration)
- `.eslintrc.cjs` — Code linting rules
- `public/` — Static assets directory
- `.env.example` — Environment variable template

### Tests
- `src/App.test.jsx` — Initial component test
- `vitest.config.js` — Test framework configuration

---

## Architecture

React SPA with Vite build tooling. Component-based UI architecture using functional components and React hooks. Client-side only (no backend integration in this phase).

**Reference docs:**
- [React 18 Docs](https://react.dev/)
- [Vite Guide](https://vitejs.dev/guide/)

---

## Patterns

### Conventions (follow these)
- **Vite React Template**: Standard `create-vite` structure
- **Functional Components**: Hooks-based, no class components
- **CSS Modules**: Component-scoped styling (`.module.css`)
- **Named Exports**: Better tree-shaking and refactoring

### Anti-patterns (avoid these)
- **Class Components**: Use functional components with hooks
- **Direct DOM Access**: Let React manage the DOM
- **Deep Prop Drilling**: Use Context API for deeply nested data

---

## Dependencies

### Internal
None (greenfield project)

### External
- **react** (^18.2) — Core library
- **react-dom** (^18.2) — DOM rendering
- **vite** (^5.0) — Build tool
- **@vitejs/plugin-react** — React Fast Refresh
- **eslint** — Code quality
- **vitest** — Testing framework

---

## Prior Art

### Completed
None (initial setup)

### Known Issues
None

### Reference
- [Vite React Template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react)

---

## External References

**Setup:**
```bash
npm create vite@latest . -- --template react
npm install
```

**Docs:**
- React: https://react.dev/
- Vite: https://vitejs.dev/

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Node version mismatch | High | Document Node 18+ requirement |
| Security vulnerabilities | Medium | Run `npm audit` post-setup |
| No testing | Medium | Include vitest from start |
| Code inconsistency | Low | Configure ESLint/Prettier |

---

## Constraints

### Build (must pass)
- `npm run dev` — Starts successfully
- `npm run build` — Completes without errors
- `npm run lint` — Zero errors

### Guardrails
- No secrets in source code
- Include `.gitignore` for `node_modules/`
- Commit `package-lock.json`
- Node.js ≥18.0.0

---

**Success Criteria:** Dev server runs, default page renders, production build succeeds, tests pass.