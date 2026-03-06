# Context Package: Create Template Project

**Generated:** 2025-02-17  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Trust Tier:** Tier 1 (Autonomous)

---

## Codebase References

### Primary (will be created)

- `/package.json` — project manifest defining dependencies, scripts, and metadata
- `/README.md` — setup documentation with install, dev, build, and test instructions
- `/src/` — source code root directory
- `/src/index.jsx` or `/src/main.jsx` — application entry point mounting React to DOM
- `/src/App.jsx` — root React component
- `/src/components/` — React components directory
- `/src/components/ExampleComponent.jsx` — example component demonstrating hooks usage
- `/src/assets/` — static assets imported by JavaScript (images, fonts, styles)
- `/public/` — static assets served directly (HTML, favicon)
- `/public/index.html` — HTML entry point with root div
- `/.gitignore` — Git exclusions (node_modules/, dist/, build/, .env, IDE files)
- `/tsconfig.json` (if TypeScript) or `/jsconfig.json` (if JavaScript) — compiler configuration
- `/.eslintrc.json` or `/.eslintrc.js` — ESLint linting rules
- `/.prettierrc` or `/.prettierrc.json` — Prettier formatting rules
- `/vite.config.js` or equivalent build tool config — bundler configuration

### Tests

- `/src/__tests__/` or `/src/components/__tests__/` — test file directory
- `/src/components/ExampleComponent.test.jsx` — example test file demonstrating test setup

### Build Artifacts (excluded from Git)

- `/node_modules/` — installed dependencies
- `/dist/` or `/build/` — production build output
- `/.vite/` or equivalent build cache directories

---

## Architecture Context

This intent establishes the **foundational architecture** for the Fio Test Repo. No prior architecture exists — this creates the baseline from which all subsequent development will extend.

### Architectural Pattern

**Single-Page Application (SPA)** with client-side rendering. The template follows React's component-based architecture with unidirectional data flow through props and hooks (useState, useEffect, useContext).

### Build Architecture

**Static Site Generation:** Source code is transpiled (TypeScript → JavaScript or JSX → JavaScript) and bundled into optimized static assets. Development mode provides hot module replacement (HMR) for instant feedback. Production builds are minified, tree-shaken, and suitable for CDN deployment.

**Recommended Build Tool:** Vite (fast dev server, sub-second HMR, optimized production builds) or Create React App (simpler setup, maintenance mode but stable).

### Folder Structure

```
/
├── public/              # Static assets (HTML, favicon, manifest)
├── src/                 # Source code
│   ├── components/      # React components
│   ├── assets/          # JS-imported assets (images, styles)
│   ├── App.jsx          # Root component
│   └── index.jsx        # Entry point
├── package.json         # Dependencies and scripts
├── README.md            # Setup documentation
└── [config files]       # tsconfig, eslint, prettier, vite/webpack
```

### Data Flow

No external data sources in template. Example component demonstrates local state management with React hooks. Future orbits will add API integration, routing, and state management libraries as needed.

### Browser Compatibility

Target: Last 2 major versions of Chrome, Firefox, Safari, Edge (evergreen browsers). No Internet Explorer support. Transpilation targets ES2020+ with optional polyfills for confirmed gaps.

### Deployment Model

Build output is static files (HTML, JS, CSS). Deployable to any static hosting service (Netlify, Vercel, AWS S3 + CloudFront, GitHub Pages). No server-side rendering or API routes in template.

---

## Pattern Library

### Conventions (to establish)

Since this is a greenfield project, the following patterns should be **established as the baseline** for all future development:

#### Component Structure
- **Functional components only** — no class components
- **One component per file** — filename matches component name (`Button.jsx` exports `Button`)
- **Hooks-based state** — use `useState`, `useEffect`, `useContext`, `useReducer` (no external state management in template)
- **Props destructuring** — destructure props in function signature for clarity

#### File Naming
- **PascalCase** for component files: `ExampleComponent.jsx`, `UserProfile.jsx`
- **camelCase** for utility/helper files: `formatDate.js`, `apiClient.js`
- **kebab-case** for config files: `vite.config.js`, `eslint.config.js`
- **Lowercase** for markdown/docs: `README.md`, `CONTRIBUTING.md`

#### Import Organization
```javascript
// 1. React and third-party libraries
import React, { useState } from 'react';
import PropTypes from 'prop-types';

// 2. Internal components and utilities
import Button from './components/Button';
import { formatDate } from './utils/formatDate';

// 3. Styles and assets
import './App.css';
import logo from './assets/logo.svg';
```

#### Testing Pattern
- **Co-located tests** — place test files adjacent to components or in `__tests__/` directory
- **Naming convention** — `ComponentName.test.jsx` or `ComponentName.spec.jsx`
- **Testing Library** — use React Testing Library for component testing (user-centric assertions)
- **Test structure** — `describe` blocks for component suites, `it` or `test` for individual cases

#### Code Quality
- **TypeScript strict mode** (if using TS) — `"strict": true` in tsconfig.json
- **JSDoc type hints** (if using JS) — annotate function parameters and return types
- **ESLint** — React plugin enabled, no unused vars, consistent formatting
- **Prettier** — automated formatting on save, consistent style across team

#### Git Practices
- **Conventional commits** — use structured commit messages (`feat:`, `fix:`, `docs:`, `test:`)
- **Gitignore hygiene** — exclude node_modules, build output, environment files, IDE configs
- **Branch strategy** — (to be established in later orbits based on team needs)

### Anti-Patterns (to avoid)

#### Inline Styles
**Don't:** Avoid style objects directly in JSX
```jsx
<div style={{ color: 'red', fontSize: '14px' }}>Text</div>
```
**Do:** Use CSS modules, styled-components, or external stylesheets
```jsx
<div className={styles.errorText}>Text</div>
```

#### Prop Drilling
**Don't:** Pass props through more than 2 intermediate components
```jsx
<Parent data={data}>
  <Child data={data}>
    <GrandChild data={data}>
      <GreatGrandChild data={data} />
```
**Do:** Use component composition, React context, or consider state management in future orbits

#### Hard-Coded Configuration
**Don't:** Commit environment-specific values
```javascript
const API_URL = 'https://api.production.com';
```
**Do:** Use environment variables with defaults
```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```

#### Console Statements in Production
**Don't:** Ship console.log/warn/error to production builds
**Do:** Use build-time stripping or conditional logging based on environment

#### Circular Dependencies
**Don't:** Create import cycles (Component A imports B, B imports A)
**Do:** Maintain directed acyclic graph of dependencies; extract shared code to separate modules

---

## Prior Orbit References

### Completed Orbits
**None.** This is Orbit 1 in the "Testing GitHub Integration" trajectory. No prior work exists in this repository.

### Known Issues
**None.** Clean slate with no inherited technical debt or known problems.

### Trajectory Context
This orbit initiates the "Testing GitHub Integration" trajectory. The trajectory purpose and scope are undefined, suggesting this template may be used to test GitHub workflows, CI/CD pipelines, or collaboration patterns. Future orbits should document their relationship to the trajectory goal.

### Ecosystem Context
- **React 18.x:** Stable since March 2022, introduces concurrent rendering and automatic batching
- **Vite 4.x/5.x:** Fast becoming industry standard for React projects (sub-second cold start, instant HMR)
- **Create React App:** In maintenance mode but still viable for simple templates; consider Vite for long-term projects
- **TypeScript adoption:** >70% of React projects use TypeScript; JavaScript with JSDoc remains valid for smaller projects

---

## Risk Assessment

### Build Tool Selection Risk
**Impact:** Medium  
**Description:** Choosing Create React App risks obsolescence due to maintenance status; choosing Vite requires more configuration upfront.  
**Mitigation:** Prefer Vite for new projects. If using CRA, document migration path to Vite. Ensure no build-tool-specific patterns that lock in choice. Test both dev server startup time (<3s) and build time (<30s for initial template).

### Dependency Bloat Risk
**Impact:** Medium  
**Severity:** Exceeding 20-dependency constraint or including unused dependencies increases supply chain attack surface and maintenance burden.  
**Mitigation:** Audit every dependency before inclusion. Justify each in comments or README. Prefer zero-dependency solutions (e.g., CSS over CSS-in-JS library). Run `npm audit` before completion. Document dependency count in README (current/max).

### Bundle Size Overflow Risk
**Impact:** High  
**Severity:** Initial bundle exceeding 500KB fails acceptance criteria and impacts user experience.  
**Mitigation:** Run production build and measure uncompressed JavaScript size. Enable tree-shaking and minification. Remove unnecessary dependencies. Use `webpack-bundle-analyzer` or Vite's rollup-plugin-visualizer to identify bloat. Target <300KB to provide headroom.

### TypeScript Configuration Drift Risk
**Impact:** Low  
**Severity:** Non-strict TypeScript configuration allows gradual type safety erosion.  
**Mitigation:** Enable `"strict": true` from day one. Configure `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`. Add type coverage reporting in CI. If using JavaScript, enforce JSDoc type hints with ESLint rules.

### Testing Setup Incompleteness Risk
**Impact:** Medium  
**Severity:** Inadequate test configuration blocks future test-driven development.  
**Mitigation:** Include working test file with at least 2 assertions (render test + interaction test). Configure test runner (Jest/Vitest) with React component support. Add `npm test` script that passes on clean install. Document testing commands in README.

### Browser Compatibility Gap Risk
**Impact:** Low  
**Severity:** Modern JavaScript features fail in target browsers (last 2 versions of evergreen browsers).  
**Mitigation:** Configure browserslist in package.json targeting `> 0.5%, last 2 versions, not dead`. Verify transpilation includes necessary polyfills. Test in actual browsers (Chrome, Firefox, Safari, Edge), not just DevTools emulation.

### README Inaccuracy Risk
**Impact:** Medium  
**Severity:** Incorrect or incomplete setup instructions prevent developers from running project.  
**Mitigation:** Test README instructions in clean environment (fresh clone, no cached dependencies). Document Node.js version requirement explicitly. Include troubleshooting section for common errors (port conflicts, permission issues, package manager differences).

### Git Configuration Omission Risk
**Impact:** Low  
**Severity:** Incomplete .gitignore leads to committing node_modules, build artifacts, or IDE-specific files.  
**Mitigation:** Use comprehensive .gitignore template (gitignore.io or GitHub's Node template). Explicitly exclude: `node_modules/`, `dist/`, `build/`, `.env`, `.env.local`, `.DS_Store`, `*.log`, `.vscode/`, `.idea/`. Verify `git status` is clean after build and after opening in IDE.

### License Incompatibility Risk
**Impact:** Low  
**Severity:** Including GPL or other restrictive dependencies violates commercial use constraint.  
**Mitigation:** Run `npx license-checker --summary` to audit all dependency licenses. Exclude GPL, LGPL, AGPL licenses. Accept only MIT, Apache 2.0, BSD, ISC. Document license audit process in README.

### Hot Reload Failure Risk
**Impact:** Low  
**Severity:** Fast refresh/HMR not working blocks development flow per acceptance criteria.  
**Mitigation:** Test hot reload by starting dev server and modifying component while browser is open. Verify changes appear without full page reload. Ensure React Fast Refresh is enabled in build tool config. Document any file types that require manual refresh.

### Source Map Missing Risk
**Impact:** Low  
**Severity:** Production builds without source maps impede debugging (fails acceptance criteria).  
**Mitigation:** Verify `npm run build` generates `.map` files in build output. Configure build tool to emit source maps even in production mode (hidden from public but available for debugging). Test that stack traces in production build reference original source files.

### Rollback Strategy
**Impact:** Very Low  
**Severity:** Template errors discovered after initial commit require rollback.  
**Mitigation:** Risk already mitigated by Git version control. Any issues fixable with subsequent commits or `git reset`. Template changes are fully reversible with zero data loss (no database, no deployed services, no user data).