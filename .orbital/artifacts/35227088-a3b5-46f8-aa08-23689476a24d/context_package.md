# Context Package: INT-001 — React Template Project Scaffolding

**Generated:** 2026-03-06  
**Package Type:** intent-specific  
**Intent:** INT-001

## Codebase References

### Primary (will be created)
- `/` — Root directory for React project initialization
- `/package.json` — Project manifest and dependency declarations
- `/src/` — Source code directory containing all React components and application logic
- `/src/index.js` or `/src/main.jsx` — Application entry point
- `/src/App.jsx` — Root React component
- `/public/` — Static assets directory (HTML template, favicon)
- `/public/index.html` — HTML shell for React application
- `/.gitignore` — Git exclusion patterns for node_modules and build artifacts
- `/README.md` — Project documentation with setup instructions

### Secondary (configuration and tooling)
- `/vite.config.js` or `/webpack.config.js` — Build tool configuration (if using Vite or custom webpack)
- `/tsconfig.json` — TypeScript configuration (if TypeScript is chosen)
- `/.eslintrc.js` or `/.eslintrc.json` — ESLint configuration (target tier)
- `/.prettierrc` — Prettier configuration (target tier)
- `/jest.config.js` or `/vitest.config.js` — Testing framework configuration (exceptional tier)
- `/.github/workflows/` — CI/CD pipeline definitions (exceptional tier)

### Tests (exceptional tier)
- `/src/__tests__/` or `/src/**/*.test.jsx` — Test files following framework conventions

## Architecture Context

This intent establishes a **greenfield React single-page application (SPA)** template with no existing system constraints. The architecture follows modern React ecosystem conventions:

**Build Tool:** Create React App (CRA) provides zero-configuration setup, or Vite for faster build times and modern tooling. Both are standard choices with broad community support.

**Project Structure:**
- `/src` contains all application source code
- `/public` contains static assets served without processing
- `/node_modules` (ignored by git) contains installed dependencies
- `/build` or `/dist` (ignored by git) contains production build output

**Data Flow:** Standard React unidirectional data flow. No state management library (Redux, Zustand) required at template level — components will use local state and props.

**No Backend:** This template is frontend-only. No API integration, authentication, or data persistence required. Development server runs entirely locally.

**No Prior Architecture:** This is the first component being added to the Fio Test Repo. No existing conventions to follow or conflicts to avoid.

## Pattern Library

### React Project Structure Conventions

**Standard CRA/Vite Structure:**
```
/src
  /components   - Reusable UI components (target tier)
  /pages        - Page-level components (target tier)
  /assets       - Images, fonts, static files (target tier)
  /utils        - Helper functions (optional)
  /hooks        - Custom React hooks (optional)
  App.jsx       - Root component
  index.jsx     - Entry point
```

### Component Patterns

**Functional Components (Modern Standard):**
```jsx
// Preferred: Arrow function components with named exports
export const MyComponent = () => {
  return <div>Content</div>;
};
```

**Avoid:**
- Class components (legacy pattern)
- Default exports for components (named exports improve refactoring)
- Mixing business logic with rendering (separate concerns)

### File Naming Conventions

**Files:**
- Components: `PascalCase.jsx` (e.g., `UserProfile.jsx`)
- Utilities: `camelCase.js` (e.g., `formatDate.js`)
- Tests: `ComponentName.test.jsx` (exceptional tier)

**Directories:**
- `camelCase` for utility folders (`utils/`, `hooks/`)
- `PascalCase` for component folders if nesting (e.g., `components/UserProfile/`)

### Dependency Management

**Use `npm` or `yarn` consistently:**
- Lock file (package-lock.json or yarn.lock) must be committed
- Use exact versions or caret ranges (^) for production stability
- Keep devDependencies separate from dependencies

### Build and Development Commands (Standard)

```json
{
  "scripts": {
    "dev": "vite" or "react-scripts start",
    "build": "vite build" or "react-scripts build",
    "preview": "vite preview" (if using Vite),
    "test": "jest" or "vitest" (exceptional tier),
    "lint": "eslint src/" (target tier)
  }
}
```

### .gitignore Patterns (Required)

```
node_modules/
build/
dist/
.DS_Store
.env.local
*.log
```

## Prior Orbit References

### Completed
**None.** This is Orbit #1 in the Fio Test Repo. No prior intents have been executed.

### Known Issues
**None.** This is a greenfield repository with no existing technical debt or open issues.

### Context from Intent Document
- **Trust Tier:** Tier 1 (Autonomous) — minimal blast radius, isolated scope, reversible changes
- **Acceptance Boundary Target:** Development server <5s startup, HMR functional, README included, TypeScript or PropTypes configured
- **Exceptional Tier Goals:** Testing framework, linting/formatting tools, CI/CD pipeline, component library integration

## Risk Assessment

### Risk: Dependency Vulnerabilities
**Impact:** Medium — npm packages may contain known security vulnerabilities  
**Likelihood:** Medium — React ecosystem moves quickly; new CVEs are common  
**Mitigation:**
- Run `npm audit` after installation
- Use only packages with recent maintenance activity (last 6 months)
- Pin major versions to avoid breaking changes
- Document any audit warnings in README

### Risk: Build Tool Misconfiguration
**Impact:** Low — Development server fails to start or HMR doesn't work  
**Likelihood:** Low — CRA/Vite provide sensible defaults  
**Mitigation:**
- Use official React scaffolding tools (CRA or `npm create vite@latest`)
- Test `npm install` and `npm run dev` before marking complete
- Include troubleshooting section in README for common Node.js version issues

### Risk: License Compliance Violation
**Impact:** High — Legal risk if non-permissive licenses are included  
**Likelihood:** Low — Most React ecosystem uses MIT/Apache 2.0  
**Mitigation:**
- Check package.json "license" field for all dependencies
- Use `npm-license-checker` or similar tool (exceptional tier)
- Exclude GPL/AGPL licensed packages

### Risk: Large Repository Size
**Impact:** Low — Slow clones and unnecessary storage usage  
**Likelihood:** Medium — Easy to accidentally commit node_modules or build artifacts  
**Mitigation:**
- **Critical:** Verify .gitignore is in place BEFORE running `npm install`
- Test that `node_modules/` is ignored: run `git status` after install
- Add `.gitignore` as first commit, installation commands as second

### Risk: Incompatible Node.js Version
**Impact:** Medium — Installation or build fails on contributor machines  
**Likelihood:** Medium — Node.js has multiple active LTS versions  
**Mitigation:**
- Document required Node.js version in README (18.x+ per constraints)
- Add `"engines"` field to package.json: `"node": ">=18.0.0"`
- Consider adding `.nvmrc` file for nvm users (exceptional tier)

### Risk: Unclear Setup Instructions
**Impact:** Low — Developer confusion, support burden  
**Likelihood:** Medium — README may be overlooked or incomplete  
**Mitigation:**
- Include explicit step-by-step setup in README
- List all available npm scripts and their purposes
- Provide example of expected output when server starts successfully
- Document common errors (port conflicts, permission issues)

### Risk: No Rollback Path
**Impact:** Low — Changes are isolated to new files  
**Likelihood:** Low — Intent is fully reversible  
**Mitigation:**
- All changes are additions, not modifications to existing code
- Complete rollback possible by deleting created files
- No database migrations or infrastructure changes involved