# Create Template Project

## Desired Outcome

A foundational React project structure exists that enables rapid feature development without setup friction. Developers can clone, install dependencies, and begin building features within minutes. The template establishes consistent patterns for component architecture, state management, and build tooling that subsequent development orbits will extend.

## Constraints

- **Framework Lock:** Must use React 18+ as the core UI library; no alternative frameworks (Vue, Angular, Svelte)
- **Build Tool:** Must support modern JavaScript/TypeScript with fast refresh capability
- **Browser Compatibility:** Must support evergreen browsers (Chrome, Firefox, Safari, Edge) from the last 2 major versions
- **No Backend Logic:** Template contains only frontend code; no server-side rendering, API routes, or backend services
- **Dependency Hygiene:** Maximum 20 direct dependencies in package.json to minimize supply chain risk and maintenance burden
- **License Compatibility:** All dependencies must use MIT, Apache 2.0, or BSD licenses compatible with commercial use
- **No Opinionated State Management:** Do not prescribe Redux, MobX, Zustand, or any specific state library — leave state architecture decisions to future orbits

## Acceptance Boundaries

### Minimal Viable Template
- Project initializes with `npm install` or equivalent in <60 seconds on standard development hardware
- Development server starts with single command and hot-reloads on file changes
- Contains at least one example component demonstrating React hooks usage
- Includes basic folder structure: components/, assets/, and entry point clearly identifiable
- README with setup instructions (install, dev server, build) is present and accurate

### Production Readiness
- `npm run build` produces optimized static assets suitable for CDN deployment
- Build output includes source maps for debugging
- Production build size <500KB (uncompressed JavaScript) for initial bundle
- No console errors or warnings in browser when running development build
- Linting and formatting tooling configured (ESLint/Prettier or equivalent) with runnable commands

### Code Quality Baseline
- TypeScript configured with strict mode enabled, or JavaScript with JSDoc type hints
- At least 1 unit test file demonstrating testing setup and runner functionality
- Git repository initialized with .gitignore excluding node_modules/, build artifacts, and IDE files
- Package.json contains valid metadata: name, version, description, scripts for dev/build/test

## Trust Tier Assignment

**Tier 1: Autonomous**

This intent carries minimal blast radius and is fully reversible:

- **Low Risk Domain:** Project scaffolding affects only development environment, not production systems or user data
- **Reversibility:** Git repository allows complete rollback; no persistent state or external integrations to unwind
- **Standard Practice:** React project templates are well-established patterns with abundant reference implementations
- **Isolated Scope:** Changes are confined to a single repository with no dependencies on other systems or services
- **Validation Speed:** Developer can verify functionality in <5 minutes by running dev server and viewing example component

The autonomous tier is appropriate because template generation errors are immediately visible, easily corrected, and have no downstream impact until the template is actively used for feature development.

## Dependencies

### External Dependencies
- **Node.js Runtime:** Requires Node.js v18+ and npm/yarn package manager installed on development machine
- **Git:** Repository initialization requires Git CLI available in execution environment

### Ecosystem Assumptions
- **Package Registry Access:** npm registry (registry.npmjs.org) must be accessible for dependency installation
- **React Ecosystem Stability:** Assumes React 18.x stable release and compatible tooling ecosystem (Vite, Create React App, or equivalent)

### No Internal Dependencies
This is a foundational intent with no dependencies on other ORBITAL intents or prior orbits. It represents the starting point for the "Testing GitHub Integration" trajectory.