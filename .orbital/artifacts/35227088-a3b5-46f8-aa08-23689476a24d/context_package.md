# Context Package — Create React Template Project

**Generated:** 2025-01-23  
**Package Type:** intent-specific  
**Intent:** Create Template Project (Orbit 1)  
**Trust Tier:** 1 (straightforward implementation)

---

## Codebase

### Primary (will be modified or created)
- `package.json` — React dependencies and scripts
- `src/` — React application source directory
- `src/index.js` or `src/index.tsx` — Application entry point
- `src/App.js` or `src/App.tsx` — Root component
- `public/` — Static assets and HTML template
- `public/index.html` — HTML entry point
- `.gitignore` — Ignore node_modules and build artifacts
- `README.md` — Project documentation

### Secondary (configuration and tooling)
- `tsconfig.json` — TypeScript configuration (if using TypeScript)
- `eslint.config.js` or `.eslintrc.json` — Linting rules
- `.prettierrc` — Code formatting rules
- `vite.config.js` or `webpack.config.js` — Build tool configuration

### Tests
- `src/App.test.js` — Basic component test setup
- `jest.config.js` or `vitest.config.js` — Test framework configuration

---

## Architecture

This intent establishes the foundational React project structure within the Fio Test Repo. As a template project, it should use modern React practices (functional components, hooks) and include essential tooling (build system, linting, testing). The structure should be extensible for future intents in the testing trajectory.

**Reference docs:**
- [React Documentation](https://react.dev/)
- [Vite Guide](https://vitejs.dev/guide/) (recommended for modern React projects)

---

## Patterns

### Conventions (follow these)
- **Modern React Tooling**: Use Vite instead of Create React App for faster builds and better DX
- **Functional Components**: Prefer function components with hooks over class components
- **Project Structure**: Follow `src/` for source, `public/` for static assets convention
- **Module Organization**: Group by feature rather than file type as project grows

### Anti-patterns (avoid these)
- **Create React App**: CRA is no longer recommended; use Vite or Next.js instead
- **Default Test Setup**: Don't rely on default test configuration; ensure tests can actually run
- **Missing TypeScript**: Consider TypeScript from the start to avoid migration pain later

---

## Dependencies

### Internal
- None (this is the foundational template)

### External
- **React** (~18.x) — UI library
- **ReactDOM** (~18.x) — React renderer for web
- **Vite** — Build tool and dev server
- **ESLint** — Code linting
- **Prettier** — Code formatting (optional but recommended)
- **Vitest** or **Jest** — Testing framework
- **@testing-library/react** — Component testing utilities

---

## Prior Art

### Completed
- None identified (this is the first intent)

### Known Issues
- None currently tracked

---

## Constraints

### Build (must pass)
- `npm install` or `yarn install` — Dependencies must install cleanly
- `npm run dev` or `yarn dev` — Dev server must start successfully
- `npm run build` or `yarn build` — Production build must complete
- `npm test` or `yarn test` — Tests must run (even if minimal)

### Guardrails (do not violate)
- Must use modern React (18+) with function components and hooks
- Must include working build and dev scripts
- Must be reproducible on fresh clone (all dependencies in package.json)
- Should not commit `node_modules/` or build artifacts

---

## Risk Assessment

### High Risk
- **Tooling Conflicts**: Different Node versions or package managers can cause issues
  - *Mitigation*: Document Node version requirement; consider `.nvmrc` file

### Medium Risk
- **Over-engineering**: Template could become too opinionated or complex
  - *Mitigation*: Keep it minimal; add features in subsequent intents
- **Missing Critical Config**: Forgetting ESLint, TypeScript, or test setup
  - *Mitigation*: Use established template (e.g., `npm create vite@latest`)

### Low Risk
- **Outdated Dependencies**: React ecosystem moves fast
  - *Mitigation*: Use latest stable versions at time of creation

---

## Recommended Approach

Given this is a tier_1 intent for a test repository:

1. **Use Vite Template**: Run `npm create vite@latest fio-test-app -- --template react` (or `react-ts` for TypeScript)
2. **Verify Basics**: Ensure dev server, build, and placeholder test all work
3. **Document Setup**: Update README with setup instructions
4. **Minimal First Version**: Don't add routing, state management, or complex features yet — keep it as a clean foundation for future intents

This provides a solid, modern React foundation that can be extended in subsequent orbits.