# Context Package — INT-001: Create Template Project

**Generated:** 2026-03-05
**Package Type:** intent-specific
**Intent:** INT-001

---

## Codebase

### Primary (will be created)

**Root Configuration:**
- `package.json` — Project metadata, dependencies, scripts
- `package-lock.json` or `yarn.lock` — Dependency lock file
- `.gitignore` — Git ignore patterns
- `README.md` — Project documentation and setup
- `.env.example` — Environment variable template
- `tsconfig.json` or `jsconfig.json` — TypeScript/JavaScript config

**Build Tool Configuration:**
- `vite.config.js` OR `webpack.config.js` OR `craco.config.js` — Build tool setup

**Public Assets:**
- `public/index.html` — Entry HTML template
- `public/favicon.ico` — Browser icon
- `public/manifest.json` — PWA manifest
- `public/robots.txt` — Crawler instructions

**Source Code (Core):**
- `src/index.js` or `src/index.jsx` — Application entry point
- `src/App.js` or `src/App.jsx` — Root React component
- `src/App.css` — Root component styles
- `src/index.css` — Global styles

**Component Structure:**
- `src/components/` — Reusable components directory
- `src/components/Example.jsx` — Sample component demonstrating structure

**Additional Directories:**
- `src/assets/` — Static assets (images, fonts, icons)
- `src/utils/` — Utility functions
- `src/hooks/` — Custom React hooks
- `src/styles/` — Shared/global stylesheets

**Linting & Formatting:**
- `.eslintrc.js` or `.eslintrc.json` — ESLint configuration
- `.prettierrc` — Prettier configuration
- `.editorconfig` — Editor configuration

### Secondary (dependencies and interfaces)
- N/A — Greenfield project; all dependencies will be external npm packages

### Tests
- `src/App.test.js` — Root component tests
- `src/setupTests.js` — Test environment configuration
- `jest.config.js` — Jest configuration (if custom setup)

---

## Architecture

React SPA following component-based architecture with unidirectional data flow. Entry point (`src/index.js`) mounts root component (`App.jsx`) into DOM. Components organized by feature/function with clear separation between presentation and logic layers.

**Reference docs:**
- React Official Documentation: https://react.dev
- Modern JavaScript Tutorial: https://javascript.info

---

## Patterns

### Conventions (follow these)
- **Functional Components with Hooks**: Modern React pattern — use function components with `useState`, `useEffect`, etc. instead of class components
- **Component File Naming**: PascalCase for component files (e.g., `MyComponent.jsx`), co-located styles (e.g., `MyComponent.css`)
- **Project Structure**: Feature-based organization in `src/components/`, utility functions in `src/utils/`, custom hooks in `src/hooks/`
- **Testing**: Use React Testing Library for component tests, focusing on user behavior over implementation details

### Anti-patterns (avoid these)
- **Class Components**: Use functional components with hooks instead
- **Inline Styles for Everything**: Use CSS modules or styled-components for maintainable styling
- **Prop Drilling**: If passing props through multiple levels, consider Context API or state management
- **Mutating State Directly**: Always use setState functions from hooks

---

## Dependencies

### Internal
- N/A — Greenfield project

### External
- **React 18+** — Core UI library
- **React DOM** — React rendering for web
- **Build Tool** (one of):
  - **Vite** — Fast, modern build tool (recommended)
  - **Create React App** — Official React bootstrapping tool
  - **Webpack** — Custom configuration option
- **Testing Libraries**:
  - **Jest** — Test runner
  - **React Testing Library** — Component testing utilities
  - **@testing-library/jest-dom** — Custom matchers
- **Linting/Formatting**:
  - **ESLint** — Code linting
  - **Prettier** — Code formatting
  - **eslint-config-react-app** — React-specific ESLint rules

---

## Prior Art

### Completed
- N/A — Greenfield project (first implementation)

### Known Issues
- **Build Tool Decision**: Must choose between Vite (faster), Create React App (simpler), or custom Webpack (more control)
- **TypeScript vs JavaScript**: Consider adding TypeScript for type safety from the start
- **CSS Strategy**: Decide on CSS approach (modules, styled-components, Tailwind, etc.) early

---

## Constraints

### Build (must pass)
- `npm install` or `yarn install` — Successful dependency installation
- `npm start` or `yarn start` — Development server starts without errors
- `npm test` or `yarn test` — All tests pass
- `npm run build` or `yarn build` — Production build completes successfully
- `npm run lint` — No linting errors (if configured)

### Guardrails (do not violate)
- Must use React 18+ (latest stable version)
- Must include README with setup instructions
- Must include at least one working test file
- Must not include business logic or domain-specific code (template only)
- Must not commit `node_modules/` or build artifacts
- All configuration files must use standard naming conventions

---

## Risk Assessment

### High Risk Areas

**1. Build Tool Choice**
- **Risk**: Decision impacts developer experience and build performance
- **Mitigation**: Use Vite for modern, fast builds; fallback to CRA for simplicity

**2. Dependency Conflicts**
- **Risk**: npm package version mismatches can break the build
- **Mitigation**: Use exact versions in `package.json`, commit lock file

**3. Testing Setup**
- **Risk**: Incorrect test configuration can block development
- **Mitigation**: Use React Testing Library defaults, minimal custom configuration

**4. TypeScript Decision**
- **Risk**: Adding TypeScript later requires significant refactoring
- **Mitigation**: Decide upfront; if uncertain, start with TypeScript for future-proofing

**5. CSS Architecture**
- **Risk**: Inconsistent styling approach leads to maintenance issues
- **Mitigation**: Choose one CSS strategy (CSS Modules, Styled Components, or Tailwind) and document in README

### Implementation Steps

1. Choose build tool (Vite recommended)
2. Initialize project structure with chosen tool
3. Install core dependencies (React 18+, React DOM)
4. Configure testing environment (Jest + React Testing Library)
5. Set up linting (ESLint) and formatting (Prettier)
6. Create sample component demonstrating conventions
7. Write comprehensive README with setup instructions
8. Verify all acceptance criteria pass
9. Add `.gitignore` to exclude `node_modules/` and build artifacts
10. Create `.env.example` for environment variable template