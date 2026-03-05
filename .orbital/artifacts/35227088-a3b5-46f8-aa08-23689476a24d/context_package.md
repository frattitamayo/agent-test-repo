# Context Package — Create Template Project

**Generated:** 2025-01-21  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Orbit:** #1  
**Trust Tier:** 1 (Requires Review)

---

## Codebase

### Primary (will be created)
- `package.json` — Dependencies and npm scripts
- `vite.config.js` — Build tool configuration
- `index.html` — Application shell
- `src/main.jsx` — React application entry point
- `src/App.jsx` — Root component
- `src/App.css` — Root component styles
- `src/index.css` — Global styles
- `.gitignore` — Version control exclusions
- `README.md` — Setup and usage documentation

### Secondary (supporting files)
- `.eslintrc.cjs` — Code linting rules
- `.prettierrc` — Code formatting configuration
- `public/` — Static asset directory
- `.env.example` — Environment variable template

### Tests
- `src/App.test.jsx` — Initial component test file
- `vitest.config.js` — Test runner configuration

---

## Architecture

This intent establishes a React single-page application using Vite for build tooling. The project follows modern React patterns with functional components, hooks-based state management, and a component-driven architecture where UI is composed from reusable pieces organized in `src/`.

**Reference docs:**
- [React Documentation](https://react.dev/)
- [Vite Configuration](https://vitejs.dev/config/)

---

## Patterns

### Conventions (follow these)
- **Vite Project Structure**: See official [template-react](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react) — minimal setup with fast HMR
- **Functional Components**: Use arrow functions with hooks, not class components
- **CSS Modules**: Scoped styles with `.module.css` suffix for component-specific styling
- **Named Exports**: Export components by name for better tree-shaking and debugging

### Anti-patterns (avoid these)
- **Class Components**: Deprecated approach; use functional components with hooks
- **Direct DOM Manipulation**: Never use `document.querySelector()` or similar; let React manage the DOM
- **Prop Drilling**: For deep component trees, use Context API instead of passing props through intermediaries
- **Inline Styles Everywhere**: Reserve for dynamic values only; use CSS modules or external stylesheets for static styles

---

## Dependencies

### Internal
None — this is a greenfield initialization with no existing codebase.

### External
- **react** (^18.2.0) — Core React library
- **react-dom** (^18.2.0) — DOM rendering
- **vite** (^5.0.0) — Build tool and dev server
- **@vitejs/plugin-react** — Vite React integration
- **eslint** — Code quality enforcement
- **prettier** — Code formatting
- **vitest** — Fast unit test runner
- **@testing-library/react** — Component testing utilities

---

## Prior Art

### Completed
None — this is the initial project setup.

### Known Issues
None — no existing technical debt for a new project.

### Reference Implementations
- [Vite React Template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react) — Official minimal starter
- [React Beta Docs Examples](https://react.dev/learn) — Modern React patterns and best practices

---

## External References

### Critical Documentation
- **React 18 Docs**: https://react.dev/ — Hooks, components, event handling
- **Vite Guide**: https://vitejs.dev/guide/ — Configuration, plugins, build optimization
- **ESLint React Plugin**: https://github.com/jsx-eslint/eslint-plugin-react — Linting rules for React

### Setup Command
```bash
npm create vite@latest fio-test-repo -- --template react
cd fio-test-repo
npm install
```

### Key Decisions Required
1. **TypeScript vs JavaScript** — JavaScript for faster setup; TypeScript for type safety
2. **Styling Solution** — CSS Modules (built-in), Tailwind, or styled-components
3. **Testing Library** — Vitest (recommended with Vite) or Jest

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Dependency vulnerabilities** | Medium | Run `npm audit` post-setup; update regularly |
| **Build configuration complexity** | Low | Use Vite defaults; customize only as needed |
| **Missing development tooling** | Medium | Include ESLint + Prettier from start |
| **No testing infrastructure** | Medium | Configure Vitest and Testing Library initially |
| **Unclear project structure** | Low | Document folder conventions in README |
| **Port conflicts (5173)** | Low | Vite auto-increments port if occupied |

### Mitigations Applied
- Use official Vite template to minimize setup errors
- Lock dependency versions in `package-lock.json`
- Include comprehensive `.gitignore` from template
- Document all npm scripts in README

---

## Constraints

### Build (must pass)
- `npm run dev` — Dev server starts without errors
- `npm run build` — Production build succeeds
- `npm run lint` — ESLint passes with zero errors
- `npm run test` — All tests pass (minimum 1 smoke test)

### Guardrails (do not violate)
- No secrets or credentials in source code — use `.env` files
- No modifications to `node_modules/` — all changes via `package.json`
- Project must work on Node.js 18+ LTS versions
- Bundle size for initial load must be < 500KB (uncompressed)

---

## Success Criteria

✅ Project initializes with `npm create vite`  
✅ All dependencies install without errors  
✅ `npm run dev` starts development server  
✅ Browser displays default React welcome screen  
✅ Hot Module Replacement (HMR) works  
✅ `npm run build` produces optimized production bundle  
✅ ESLint configuration in place  
✅ At least one passing test  
✅ README documents setup and available commands  
✅ `.gitignore` configured for Node.js/React  

---

## Implementation Notes

- This is a **Tier 1 intent** requiring human review before merge
- Start with minimal configuration; extend as requirements emerge
- Consider using TypeScript template (`--template react-ts`) for larger projects
- Tag initial commit as `v0.1.0` for baseline reference