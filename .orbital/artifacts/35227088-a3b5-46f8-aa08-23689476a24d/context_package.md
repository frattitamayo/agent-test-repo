# Context Package: Create Template Project

## Codebase References

### Files to Create

**Root Level:**
- `package.json` — Project manifest defining dependencies, scripts, and metadata
- `package-lock.json` or `yarn.lock` — Dependency lock file for reproducible builds
- `.gitignore` — Standard Node.js/React gitignore patterns
- `README.md` — Setup instructions, project structure documentation, and development commands
- `.env.example` — Template for environment variables (empty or with placeholder comments)

**Configuration Files:**
- `.eslintrc.json` or `.eslintrc.js` — Linting rules for code quality
- `.prettierrc` or `.prettierrc.json` — Code formatting configuration (if using Prettier)
- `tsconfig.json` — TypeScript configuration (if implementing stretch outcome)
- `vite.config.js` or `webpack.config.js` — Build tool configuration (depending on chosen scaffolding tool)

**Source Directory (`src/`):**
- `src/index.js` or `src/main.jsx` — Application entry point
- `src/App.jsx` — Root application component
- `src/App.css` — Root component styling
- `src/index.css` — Global styles
- `src/components/` — Directory for reusable components (create example component if target outcome pursued)

**Public Directory (`public/`):**
- `public/index.html` — HTML template
- `public/favicon.ico` — Browser tab icon
- `public/robots.txt` — Search engine crawling rules (optional)

### Repository Context

**Repository Location:** `Fio Test Repo` — This is a testing repository, meaning:
- No production dependencies exist
- Experimental work is expected and encouraged
- Failures have no external impact
- Documentation can be more experimental/informal than production repos

**Repository Root:** All project files should be created at the repository root unless a specific subfolder structure already exists for organizing multiple projects.

## Architecture Context

### System Position

This intent creates a **standalone frontend application scaffold** with no integration points. The React application will:

- Run entirely in the browser with no backend communication
- Serve static assets from a development server during development
- Build to static files for potential deployment (though deployment is out of scope)
- Have no data persistence layer (no databases, APIs, or external services)

### React Application Architecture

**Single Page Application (SPA) Pattern:**
- All rendering happens client-side in the browser
- JavaScript bundle loads once; subsequent navigation happens via DOM manipulation
- Hot Module Replacement (HMR) enables live updates during development without full page reloads

**Component Hierarchy:**
```
index.html (public/)
  └─ index.js (src/)
       └─ App.jsx (src/)
            └─ [Future Components]
```

### Development vs. Production Modes

**Development Server:**
- Runs on localhost (typically port 3000 or 5173 for Vite)
- Provides HMR for instant feedback
- Includes source maps for debugging
- Unoptimized bundles for faster rebuilds

**Production Build:**
- Generates optimized, minified static assets
- Removes development-only code
- Creates compressed bundles
- Outputs to `dist/` or `build/` directory

### Tooling Decision Point

**Create React App (CRA):**
- Pros: Zero configuration, widely adopted, comprehensive
- Cons: Slower build times, larger dependency footprint, maintenance mode as of 2023

**Vite:**
- Pros: Lightning-fast dev server, modern ESM-based, smaller footprint
- Cons: Newer (less community resources for troubleshooting)
- **Recommended** for new projects in 2024+

**Manual Setup:**
- Pros: Full control, minimal dependencies
- Cons: Time-intensive, requires deep understanding of Webpack/Rollup
- **Not recommended** for template creation (defeats purpose of quick start)

### Infrastructure Constraints

**Node.js Version:** Requires Node.js 16.x or higher
- Vite requires Node.js 14.18+ or 16+
- React 18 requires Node.js 14+
- **Target: Node.js 18.x LTS** (current stable LTS as of late 2023/early 2024)

**Browser Compatibility:**
- Modern ES6+ syntax
- No IE11 support required (per constraints)
- Targets last 2 versions of major browsers

## Pattern Library

### React Component Patterns

**Functional Components with Hooks:**
```jsx
// src/components/ExampleComponent.jsx
import { useState } from 'react';

function ExampleComponent({ title }) {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <h2>{title}</h2>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </div>
  );
}

export default ExampleComponent;
```

**Avoid class components** — functional components with hooks are the modern React standard (React 16.8+).

### File Naming Conventions

**React Components:**
- PascalCase: `MyComponent.jsx` or `MyComponent.tsx`
- Use `.jsx` extension to distinguish from plain JavaScript

**Utilities and Helpers:**
- camelCase: `apiHelpers.js`, `formatUtils.js`
- Use `.js` extension

**Stylesheets:**
- Matching component name: `MyComponent.css` for `MyComponent.jsx`
- OR global: `index.css`, `App.css`

### Directory Structure

```
fio-test-repo/
├── public/
│   ├── index.html
│   └── favicon.ico
├── src/
│   ├── components/
│   │   └── ExampleComponent.jsx
│   ├── App.jsx
│   ├── App.css
│   ├── index.js
│   └── index.css
├── .gitignore
├── package.json
├── README.md
└── vite.config.js (or equivalent)
```

### NPM Scripts Standard

```json
{
  "scripts": {
    "dev": "vite",           // Start development server
    "build": "vite build",   // Create production build
    "preview": "vite preview", // Preview production build locally
    "lint": "eslint src --ext js,jsx", // Run linter
    "format": "prettier --write "src/**/*.{js,jsx}"" // Format code
  }
}
```

### Code Quality Configuration

**ESLint:**
- Extend `eslint:recommended` and `plugin:react/recommended`
- Configure `react/react-in-jsx-scope` as off (not needed in React 17+)
- Enable `plugin:react-hooks/recommended` for hooks rules

**Prettier:**
- 2-space indentation
- Single quotes
- Trailing commas: `es5`
- Semi-colons: true

### Git Commit Message Convention

For this template creation:
```
feat: initialize React project scaffold

- Configure Vite with React
- Add ESLint and Prettier
- Create basic component structure
- Document setup in README
```

## Prior Orbit References

### Current Orbit Context

**Orbit ORB-1:**
- **Phase:** Intent (current)
- **Status:** In Progress
- **Summary:** "Create a basic react project framework to build off of"

This is the **first orbit** in the "Testing GitHub Integration" trajectory. No prior work exists in this trajectory.

### Related Work in Repository

**Unknown:** This is a test repository with no provided history. Assume this is a **greenfield setup** — no existing React projects, no established patterns to inherit, no prior architectural decisions to respect.

### Lessons from Broader React Ecosystem

**React 18+ Considerations:**
- New root API: `ReactDOM.createRoot()` instead of `ReactDOM.render()`
- Automatic batching of state updates
- Concurrent rendering features available (not required for template)

**Deprecated Patterns to Avoid:**
- Class components (unless legacy code requires)
- `componentWillMount`, `componentWillReceiveProps` lifecycle methods
- Direct DOM manipulation (use refs when needed)
- Prop drilling (consider Context API for shared state in future)

## Risk Assessment

### Low-Severity Risks

**Risk: Tooling version mismatches**
- **Scenario:** Node.js version on developer machine differs from what template assumes
- **Impact:** Project may fail to install or start
- **Mitigation:** Document required Node.js version prominently in README; include `.nvmrc` file for nvm users
- **Probability:** Medium | **Severity:** Low

**Risk: Conflicting ESLint/Prettier rules**
- **Scenario:** Auto-formatting and linting produce conflicting feedback
- **Impact:** Developer confusion, inconsistent code style
- **Mitigation:** Use `eslint-config-prettier` to disable ESLint formatting rules that conflict with Prettier
- **Probability:** Medium | **Severity:** Low

**Risk: Port 3000 already in use**
- **Scenario:** Another process is using the default dev server port
- **Impact:** Dev server fails to start
- **Mitigation:** Vite auto-increments to next available port; document this behavior in README
- **Probability:** Low | **Severity:** Negligible

### Medium-Severity Risks

**Risk: Dependency vulnerabilities**
- **Scenario:** Newly installed packages contain known security vulnerabilities
- **Impact:** Security warnings in terminal, potential CI failures if vulnerability scanning is enabled
- **Mitigation:** Run `npm audit` after setup; update vulnerable dependencies before committing; this is a test repo with no production data, so risk is theoretical
- **Probability:** Low | **Severity:** Low (test repo context)

**Risk: Missing `.gitignore` entries**
- **Scenario:** Node modules or build artifacts accidentally committed to Git
- **Impact:** Bloated repository, merge conflicts on dependency updates
- **Mitigation:** Use comprehensive `.gitignore` template from gitignore.io or GitHub's Node template; verify `node_modules/` and `dist/` are excluded
- **Probability:** Very Low | **Severity:** Medium

**Risk: Undocumented setup steps**
- **Scenario:** README omits critical setup information (e.g., environment variables, special configuration)
- **Impact:** Next developer cannot reproduce setup; trajectory stalls
- **Mitigation:** Test README instructions in a fresh environment; include troubleshooting section
- **Probability:** Low | **Severity:** Medium

### Negligible Risks

**Risk: Hot reload fails**
- **Scenario:** HMR breaks due to syntax error or configuration issue
- **Impact:** Developer must manually refresh browser (annoying but not blocking)
- **Mitigation:** No special mitigation needed; HMR failures are self-evident and easily resolved with server restart
- **Probability:** Low | **Severity:** Negligible

**Risk: Build output size**
- **Scenario:** Production build is larger than expected
- **Impact:** Slower initial page loads if deployed (not a concern for template-only work)
- **Mitigation:** No action needed at template stage; can be optimized later if project goes to production
- **Probability:** Not Applicable | **Severity:** Negligible

### Risk Summary

This intent carries **minimal risk** due to its isolated nature (test repository, no production impact) and reversibility (can be deleted or reverted without consequences). The most significant risk is poor documentation leading to setup friction for future developers, which is mitigated by thorough README content and testing setup instructions before committing.

**No security, data, or availability risks** — this is a static frontend template with no authentication, backend, or user data.