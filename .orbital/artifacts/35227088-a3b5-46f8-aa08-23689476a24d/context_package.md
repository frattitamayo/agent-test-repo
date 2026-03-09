# Context Package: Create Template Project

## Codebase References

### Repository Structure
This is a greenfield initiative in the Fio Test Repo. No existing React codebase exists. The following structure will be created:

**Root Level:**
- `package.json` - Project manifest and dependency declarations
- `README.md` - Setup and usage documentation
- `.gitignore` - Git exclusion patterns for Node.js/React projects
- `tsconfig.json` or `jsconfig.json` - Type configuration (depending on tooling choice)
- `.eslintrc.js` or `.eslintrc.json` - Linting rules
- `.prettierrc` - Code formatting rules (if included)

**Source Directory:**
- `src/` - Application source code root
- `src/App.jsx` or `src/App.tsx` - Root application component
- `src/index.jsx` or `src/index.tsx` - Application entry point
- `src/components/` - Reusable UI components directory
- `src/assets/` - Static assets (images, fonts, etc.)

**Configuration:**
- `public/` - Static public assets and index.html
- `vite.config.js` or `webpack.config.js` - Build tool configuration (depending on scaffolding tool)

**Testing:**
- `src/__tests__/` or `src/App.test.jsx` - Test files location
- `jest.config.js` or `vitest.config.js` - Test runner configuration

### No Existing Dependencies
This repository currently contains no React-specific code. The agent will initialize the project from scratch using one of the following approved scaffolding tools:
- Vite (recommended for modern, fast development)
- Create React App (stable, widely documented)
- Next.js (if server-side rendering is anticipated)

## Architecture Context

### System Positioning
This template serves as the foundational layer for all future frontend development in the Fio Test Repo. It exists in isolation with no integration dependencies, external APIs, or backend services at this stage.

**Architecture Pattern:** Single-Page Application (SPA)
- Browser-rendered React application
- Client-side routing (if routing is included)
- Static asset serving from public directory
- Development server with hot module replacement
- Production build generating optimized static bundles

**Data Flow (Initial State):**
```
User Browser → Static HTML (index.html) → React Bundle Load → Component Render → DOM Update
```

No external data sources, authentication layers, or API integrations exist at this stage.

### Build Pipeline
**Development Mode:**
- Local development server (typically port 3000 or 5173)
- Fast refresh/HMR for instant feedback
- Source maps for debugging
- No minification or optimization

**Production Mode:**
- Static bundle generation with tree-shaking
- Minification and code splitting
- Asset optimization (images, CSS)
- Output to `dist/` or `build/` directory

### Technology Stack Constraints
- **Node.js:** v18.x or higher (LTS requirement)
- **React:** Latest stable version (18.x or 19.x as of 2024)
- **Package Manager:** npm (default), yarn, or pnpm acceptable
- **Build Tool:** Must support ESM, TypeScript (optional), and JSX transformation
- **Browser Targets:** Modern evergreen browsers (Chrome, Firefox, Safari, Edge) - no IE11 support required

## Pattern Library

### Project Structure Convention
```
fio-test-repo/
├── src/
│   ├── components/     # Reusable UI components (PascalCase names)
│   ├── pages/          # Page-level components (if routing exists)
│   ├── utils/          # Helper functions and utilities
│   ├── hooks/          # Custom React hooks (useXxx naming)
│   ├── assets/         # Images, fonts, static files
│   ├── App.jsx         # Root component
│   └── index.jsx       # Entry point
├── public/             # Static public assets
├── package.json
├── README.md
└── .gitignore
```

### Component Patterns
**Functional Components (Preferred):**
```jsx
// PascalCase component names
export default function ComponentName() {
  return <div>...</div>;
}
```

**File Naming:**
- Components: `ComponentName.jsx` or `ComponentName.tsx`
- Tests: `ComponentName.test.jsx` or `ComponentName.spec.jsx`
- Utilities: `camelCase.js`

### Code Quality Standards
**Linting Configuration:**
- Use ESLint with `eslint:recommended` and `plugin:react/recommended` baseline
- React Hooks rules enabled (`eslint-plugin-react-hooks`)
- Consistent indentation (2 spaces default for React community)

**Formatting:**
- Prettier integration (if included) with single quotes, trailing commas, semicolons
- Consistent brace style and line breaks

### Git Workflow
- Initialize git repository in project root
- `.gitignore` must exclude:
  - `node_modules/`
  - Build outputs (`dist/`, `build/`, `.cache/`)
  - Environment files (`.env.local`, `.env`)
  - IDE-specific files (`.vscode/`, `.idea/`)
  - OS files (`.DS_Store`, `Thumbs.db`)

## Prior Orbit References

### No Prior Orbits
This is **Orbit 1** in the Fio Test Repo trajectory. No previous intents or orbits exist to reference. This template establishes the foundational patterns for all future frontend work.

### Future Orbit Enablement
Subsequent orbits may build upon this template by:
- Adding routing configuration (React Router, Tanstack Router)
- Implementing state management (Context API, Zustand, Redux)
- Integrating API communication layers
- Adding UI component libraries (Material-UI, Chakra, Tailwind)
- Configuring authentication flows
- Setting up deployment pipelines

## Risk Assessment

### Tooling Selection Risk
**Risk:** Choosing a scaffolding tool that becomes deprecated or poorly maintained.
**Impact:** Medium - may require migration effort in 1-2 years.
**Mitigation:** 
- Prefer Vite (actively maintained, modern, fast) over Create React App (maintenance mode)
- Avoid experimental or beta tooling
- Document tooling choice in README for future reference

### Dependency Bloat Risk
**Risk:** Including unnecessary dependencies increases bundle size and maintenance burden.
**Impact:** Low - affects initial load performance and update frequency.
**Mitigation:**
- Use scaffolding tool defaults without adding extras
- Audit package.json for dependencies vs. devDependencies separation
- Run production build verification to check bundle size (<250KB gzipped target)

### Configuration Complexity Risk
**Risk:** Over-configured template creates barriers for new developers.
**Impact:** Low - slows onboarding and increases cognitive load.
**Mitigation:**
- Minimize custom configuration files
- Rely on scaffolding tool defaults where possible
- Document every non-default configuration choice in README
- Provide clear setup instructions with expected outcomes

### Breaking Changes in React Ecosystem
**Risk:** React 19 or future versions introduce breaking changes.
**Impact:** Low - framework is stable with clear migration paths.
**Mitigation:**
- Pin major version in package.json (e.g., `"react": "^18.0.0"`)
- Document React version constraint in README
- Test with latest LTS Node.js version to ensure compatibility

### Build Failure on Different Environments
**Risk:** Project works locally but fails in CI/CD or other developer machines.
**Impact:** Medium - blocks collaboration and deployment.
**Mitigation:**
- Lock Node.js version with `.nvmrc` or `engines` field in package.json
- Use lockfile (`package-lock.json`, `yarn.lock`) and commit to repository
- Test with `npm ci` instead of `npm install` to ensure reproducible builds
- Include build verification step in README setup instructions

### Security Vulnerabilities in Dependencies
**Risk:** Initial dependencies contain known CVEs.
**Impact:** Low at template stage, grows with project evolution.
**Mitigation:**
- Run `npm audit` immediately after scaffolding
- Use latest stable versions of scaffolding tools (includes patched dependencies)
- Document dependency update policy in README
- Consider adding `npm audit` to CI pipeline in future orbits

### Git Repository Initialization Issues
**Risk:** Improper .gitignore causes sensitive files or large artifacts to be committed.
**Impact:** Medium - pollutes repository history, potential security risk.
**Mitigation:**
- Verify .gitignore includes all Node.js/React standard exclusions
- Test with `git status` before first commit to ensure no unwanted files staged
- Add `.env.example` if environment variables are used (do not commit `.env`)

### Performance Baseline Not Established
**Risk:** No initial performance metrics captured for future comparison.
**Impact:** Low - harder to detect regressions in future orbits.
**Mitigation:**
- Document initial bundle sizes in README or commit message
- Run Lighthouse audit on initial template and record score
- Set performance budget targets in documentation for future reference