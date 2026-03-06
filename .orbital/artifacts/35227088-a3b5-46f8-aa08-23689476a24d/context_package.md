# Context Package: Create Template Project

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Trust Tier:** Tier 1 (Autonomous)

## Codebase References

### Primary (will be created)
- `/package.json` — project manifest with dependencies, scripts, and metadata
- `/README.md` — setup and usage documentation
- `/src/` — source code directory
- `/src/index.jsx` or `/src/main.jsx` — application entry point
- `/src/App.jsx` — root application component
- `/src/components/` — component directory with example component
- `/public/` — static assets directory
- `/public/index.html` — HTML entry point
- `/.gitignore` — Git exclusions (node_modules, build artifacts, IDE files)
- `/tsconfig.json` or `/jsconfig.json` — TypeScript/JavaScript configuration
- `/.eslintrc.json` — ESLint configuration
- `/.prettierrc` — Prettier configuration
- `/vite.config.js` or equivalent — build tool configuration

### Secondary (dependencies and patterns)
- Node.js v18+ runtime environment
- npm or yarn package manager
- React 18.x from npm registry
- Build tooling (Vite recommended for fast refresh, or Create React App)
- Testing library (Jest, Vitest, or React Testing Library)

### Tests
- `/src/__tests__/` or `/src/components/__tests__/` — test directory
- At least one `.test.jsx` or `.spec.jsx` file demonstrating test setup

## Architecture Context

This intent establishes the **foundational layer** for the "Testing GitHub Integration" trajectory. No prior architecture exists — this creates it.

**Architectural Pattern:** Single-page application (SPA) with client-side rendering only. No server-side rendering, API routes, or backend services. The template follows React's component-based architecture with unidirectional data flow through props and hooks.

**Build Architecture:** Static site generation pattern where source code is transpiled and bundled into optimized JavaScript/CSS assets suitable for CDN deployment. Development mode uses hot module replacement for fast feedback.

**Folder Structure Convention:**
```
/
├── public/          # Static assets (HTML, images, fonts)
├── src/             # Source code
│   ├── components/  # React components
│   ├── assets/      # JavaScript-imported assets
│   └── index.jsx    # Entry point
├── package.json
└── README.md
```

**Data Flow:** No external data sources in template. Example component demonstrates local state management with React hooks (useState, useEffect). Future orbits will add state management solutions as needed.

**Browser Target:** Modern evergreen browsers with ES2020+ JavaScript support. No IE11 polyfills required.

## Pattern Library

### Conventions (establish these)

Since this is a greenfield template, the following patterns should be established as the baseline:

- **Component Structure**: Functional components using React hooks (no class components). One component per file with matching filename (e.g., `Button.jsx` exports `Button`).

- **File Naming**: PascalCase for component files (`ExampleComponent.jsx`), camelCase for utility files (`formatDate.js`), lowercase with hyphens for config files (`vite.config.js`).

- **Import Organization**: Third-party imports first, then internal imports, then relative imports. Group by type (React, libraries, components, utilities, styles).

- **Testing Pattern**: Co-locate tests with components or use `__tests__` directory. Test files named `ComponentName.test.jsx`. Use React Testing Library patterns for component testing.

- **TypeScript/JSDoc**: If TypeScript: strict mode enabled with `strict: true` in tsconfig. If JavaScript: JSDoc type hints on function parameters and returns.

- **Code Quality Gates**: ESLint with React plugin for linting, Prettier for formatting. Both runnable via npm scripts (`npm run lint`, `npm run format`).

### Anti-patterns (avoid these)

- **No Inline Styles**: Avoid style objects in JSX. Use CSS modules, CSS-in-JS library, or external stylesheets.
  
- **No Hard-coded Configuration**: Environment-specific values (API URLs, feature flags) should not be committed. Use environment variables or config files with defaults.

- **No Circular Dependencies**: Component imports must form a directed acyclic graph. Components should not import their parents.

- **No Prop Drilling Beyond 2 Levels**: If passing props through more than 2 component levels, consider component composition or context (but don't prescribe specific state management library).

- **No Console Statements in Production**: Development logging is acceptable, but production builds must not ship with console.log/warn/error.

## Prior Orbit References

### Completed
None. This is Orbit 1, the first orbit in the "Testing GitHub Integration" trajectory. No prior work exists in this repository.

### Known Issues
None. This is a clean slate with no inherited technical debt or known problems.

### Ecosystem Context
- React 18.x is stable and widely adopted (released March 2022)
- Vite has become the preferred build tool for React projects due to fast startup and HMR performance
- Create React App (CRA) is in maintenance mode but still valid for simple templates
- TypeScript adoption is >70% in React projects but JavaScript with JSDoc remains viable

## Risk Assessment

### Risk: Dependency Version Lock-in
**Impact:** Medium  
**Description:** Choosing specific versions of React, build tools, and dependencies creates maintenance burden as ecosystem evolves.  
**Mitigation:** Use caret (^) or tilde (~) version ranges in package.json for minor/patch updates. Document major version update strategy in README. Pin only dependencies with known security issues or breaking changes.

### Risk: Build Tool Obsolescence
**Impact:** Low  
**Description:** If using Create React App, future migrations to Vite or other tools may be required due to CRA's maintenance status.  
**Mitigation:** If selecting CRA, document that it's a simple template suitable for migration. Prefer Vite for longer-term viability. Ensure no CRA-specific patterns that impede migration.

### Risk: Excessive Dependencies
**Impact:** Medium  
**Description:** Including too many dependencies increases supply chain risk, bundle size, and update burden.  
**Mitigation:** Enforce 20-dependency maximum from constraints. Every dependency must have clear justification. Prefer standard library solutions over npm packages where feasible.

### Risk: TypeScript Configuration Drift
**Impact:** Low  
**Description:** If using TypeScript, overly permissive configuration (non-strict mode) leads to gradual type safety erosion.  
**Mitigation:** Enable strict mode from day one. Configure `noImplicitAny`, `strictNullChecks`, and `strictFunctionTypes`. Include type coverage tooling in CI.

### Risk: Testing Setup Incomplete
**Impact:** Medium  
**Description:** Insufficient testing configuration makes it difficult for future orbits to add test coverage.  
**Mitigation:** Include working test file with assertions. Configure test runner (Jest/Vitest) with React component testing support. Add `npm test` script that runs successfully on clean install.

### Risk: Build Output Size Bloat
**Impact:** Low  
**Description:** Initial bundle exceeds 500KB constraint, failing acceptance criteria.  
**Mitigation:** Use production build mode with minification. Enable tree-shaking. Verify bundle size with `npm run build` before completion. Remove unnecessary dependencies if size exceeds threshold.

### Risk: Browser Compatibility Gaps
**Impact:** Low  
**Description:** Modern JavaScript features or CSS properties may not work in target browsers (last 2 major versions of evergreen browsers).  
**Mitigation:** Configure Babel/SWC with browserslist targeting last 2 versions. Test in actual browser versions, not just dev tools emulation. Include polyfills only for confirmed gaps.

### Risk: Git Configuration Omissions
**Impact:** Low  
**Description:** Missing .gitignore entries lead to committing node_modules, build artifacts, or IDE files.  
**Mitigation:** Use comprehensive .gitignore template from gitignore.io or GitHub templates. Verify clean `git status` after build and after IDE usage.

### Risk: README Inaccuracy
**Impact:** Medium  
**Description:** Outdated or incorrect README instructions prevent developers from running the project.  
**Mitigation:** Test README instructions in clean environment (fresh clone, no prior setup). Document every prerequisite (Node version, package manager). Include troubleshooting section for common issues.

### Risk: No Rollback Strategy
**Impact:** Very Low  
**Description:** Template errors are discovered after initial commit.  
**Mitigation:** Risk already mitigated by Git version control. Any issues can be fixed with subsequent commits or branch reset. Template changes are fully reversible.