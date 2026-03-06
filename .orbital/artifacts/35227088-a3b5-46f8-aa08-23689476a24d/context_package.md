# Context Package — Create Template Project

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** Create Template Project

---

## Codebase

### Primary (will be created)
- `/package.json` — project manifest with dependencies, scripts, and metadata
- `/README.md` — setup and usage documentation
- `/src/` — source code root directory
- `/src/index.jsx` or `/src/main.jsx` — application entry point
- `/src/App.jsx` — root React component
- `/src/components/` — React components directory
- `/src/components/ExampleComponent.jsx` — example component demonstrating hooks
- `/src/assets/` — JavaScript-imported assets directory
- `/public/` — static assets directory
- `/public/index.html` — HTML entry point
- `/.gitignore` — Git exclusions (node_modules, build artifacts, IDE files)
- `/tsconfig.json` or `/jsconfig.json` — TypeScript/JavaScript compiler configuration
- `/.eslintrc.json` — ESLint configuration
- `/.prettierrc` — Prettier formatting configuration
- `/vite.config.js` or equivalent — build tool configuration

### Secondary (dependencies)
- Node.js v18+ runtime environment
- npm or yarn package manager
- React 18.x from npm registry
- Build tooling (Vite or Create React App)
- Testing framework (Jest, Vitest, or React Testing Library)
- ESLint with React plugin
- Prettier code formatter

### Tests
- `/src/__tests__/` or `/src/components/__tests__/` — test directory
- `/src/components/ExampleComponent.test.jsx` — example test file demonstrating test setup

---

## Architecture

This intent establishes the foundational architecture for Fio Test Repo. No prior architecture exists — this creates the baseline single-page application structure with client-side rendering only. The template follows React's component-based architecture with unidirectional data flow through props and hooks. Development uses hot module replacement for fast feedback; production builds generate optimized static assets for CDN deployment.

**Reference docs:**
- None yet (to be created in future orbits as architecture evolves)

---

## Patterns

### Conventions (establish these as baseline)

- **Functional Components**: See React 18 hooks documentation — components use `useState`, `useEffect`, `useContext` (no class components)
- **File Structure**: Components in `/src/components/`, one component per file, PascalCase filenames matching component names
- **Import Organization**: Third-party imports first, internal imports second, relative imports third, styles last
- **Test Co-location**: Tests adjacent to components or in `__tests__/` directory with `.test.jsx` extension
- **TypeScript Strict Mode**: If using TypeScript, enable `"strict": true` in tsconfig.json
- **JSDoc Type Hints**: If using JavaScript, annotate function parameters and return types

### Anti-patterns (avoid these)

- **No Inline Styles**: Use CSS modules, styled-components, or external stylesheets instead of style objects in JSX
- **No Prop Drilling Beyond 2 Levels**: If passing props through more than 2 components, use composition or context
- **No Hard-Coded Config**: Environment-specific values must use environment variables, not committed constants
- **No Console Statements in Production**: Development logging acceptable, but production builds must strip console.log/warn/error
- **No Circular Dependencies**: Component imports must form directed acyclic graph

---

## Dependencies

### Internal
- None yet (greenfield project)

### External
- **React 18.x** — core UI library with concurrent rendering and automatic batching
- **Vite or Create React App** — build tooling with fast refresh capability
- **ESLint + React Plugin** — code linting and quality checks
- **Prettier** — automated code formatting
- **Testing Library (Jest/Vitest)** — unit testing framework with React component testing support

---

## Prior Art

### Completed
- None. This is Orbit 1 in the "Testing GitHub Integration" trajectory. No prior work exists in this repository.

### Known Issues
- None. Clean slate with no inherited technical debt.

---

## Constraints

### Build (must pass)
- `npm install` — completes in <60 seconds
- `npm run dev` — starts development server with hot reload
- `npm run build` — generates optimized production build <500KB uncompressed JavaScript
- `npm run lint` — ESLint passes with zero errors
- `npm run format` — Prettier formatting check passes
- `npm test` — test suite runs and passes

### Guardrails (do not violate)
- Maximum 20 direct dependencies in package.json
- All dependencies must use MIT, Apache 2.0, or BSD licenses
- No backend logic, server-side rendering, or API routes in template
- No opinionated state management libraries (Redux, MobX, Zustand)
- Browser compatibility: last 2 major versions of Chrome, Firefox, Safari, Edge
- Production build must include source maps
- No console errors or warnings in development build