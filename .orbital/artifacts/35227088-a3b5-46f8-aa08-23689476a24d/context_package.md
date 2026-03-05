# Context Package — Create Template Project

**Generated:** 2025-01-21  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Orbit:** #1  
**Trust Tier:** 1 (Standard Review Required)

---

## Codebase

### Primary (will be created)
- `package.json` — Project manifest with dependencies and scripts
- `index.html` — Root HTML template
- `vite.config.js` — Vite build configuration
- `src/main.jsx` — Application entry point
- `src/App.jsx` — Root React component
- `src/App.css` — Root component styles
- `src/index.css` — Global application styles
- `.gitignore` — Git exclusions
- `README.md` — Project documentation

### Secondary (configuration/tooling)
- `.eslintrc.cjs` — Linting configuration
- `public/` — Static assets directory
- `.env.example` — Environment variables template

### Tests
- `src/App.test.jsx` — Initial component test
- `vitest.config.js` — Test runner configuration

---

## Architecture

Modern React SPA using Vite for build tooling and development server. Follows component-based architecture with functional components and hooks. No backend — purely client-side rendering for now.

**Reference docs:**
- [React 18 Documentation](https://react.dev/)
- [Vite Configuration Reference](https://vitejs.dev/config/)

---

## Patterns

### Conventions (follow these)
- **Vite Standard Setup**: Official `create-vite` React template structure
- **Functional Components**: Arrow functions with hooks (see [React docs](https://react.dev/learn))
- **File naming**: PascalCase for components (`App.jsx`), camelCase for utilities
- **Import organization**: React first, third-party libraries, local imports last

### Anti-patterns (avoid these)
- **Class components**: Use functional components with hooks instead
- **Direct DOM manipulation**: Never bypass React's rendering (no `document.getElementById`)
- **Massive components**: Keep components focused; split when > 200 lines

---

## Dependencies

### Internal
None — greenfield project

### External
- **react** (^18.2) — UI library
- **react-dom** (^18.2) — DOM rendering
- **vite** (^5.0) — Build tool and dev server
- **@vitejs/plugin-react** — React Fast Refresh support
- **eslint** — Code linting
- **vitest** — Unit testing framework
- **@testing-library/react** — Component testing utilities

---

## Prior Art

### Completed
None — this is the initial project setup

### Known Issues
None

### Reference Templates
- [Vite React Template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react) — Official minimal React + Vite starter

---

## External References

**Quick Start:**
```bash
npm create vite@latest . -- --template react
npm install
npm run dev
```

**Key Documentation:**
- React Hooks: https://react.dev/reference/react
- Vite Guide: https://vitejs.dev/guide/
- ESLint React Rules: https://github.com/jsx-eslint/eslint-plugin-react

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Wrong Node version** | High | Require Node.js 18+ in README |
| **Dependency vulnerabilities** | Medium | Run `npm audit` after initialization |
| **No test coverage** | Medium | Include vitest config from start |
| **Inconsistent code style** | Low | Configure ESLint + Prettier |
| **Port 5173 occupied** | Low | Vite auto-assigns alternative port |

---

## Constraints

### Build (must pass)
- `npm run dev` — Development server starts
- `npm run build` — Production build succeeds
- `npm run lint` — Zero ESLint errors

### Guardrails (do not violate)
- No hardcoded secrets in source files
- Must include `.gitignore` for `node_modules/` and `dist/`
- Package-lock.json must be committed for reproducible builds
- Minimum Node.js version: 18.0.0

---

**Success Criteria:** Project initializes, dev server runs, default page renders, production build succeeds.