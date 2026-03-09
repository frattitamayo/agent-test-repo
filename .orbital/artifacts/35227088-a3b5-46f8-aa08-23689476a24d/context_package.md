# Context Package: Create Template Project

## Codebase References

### Target Location
- **Root Directory**: `/` — New React project will be scaffolded at repository root
- **Expected Structure** (post-creation):
  - `/src/` — Application source code
  - `/public/` — Static assets
  - `/package.json` — Dependency manifest
  - `/README.md` — Project documentation
  - `/.gitignore` — Version control exclusions
  - `/node_modules/` — Dependencies (not committed)

### Configuration Files (to be created)
- `/package.json` — Must include `start`, `build`, `test` scripts
- `/eslintrc.*` or `eslint.config.js` — Linting configuration
- `/tsconfig.json` — TypeScript configuration (stretch goal)
- `/.prettierrc` — Code formatting rules (stretch goal)
- `/.husky/` — Git hooks directory (stretch goal)
- `/.github/workflows/ci.yml` — CI validation workflow (stretch goal)

### No Existing Codebase
This intent creates the foundational project structure. No prior implementation exists to reference or modify.

## Architecture Context

### Project Type
Standalone React single-page application (SPA) with client-side rendering. No server-side rendering (SSR) or static site generation (SSG) required at this stage.

### Build Tooling Decision Matrix
Three viable approaches exist for React project initialization:

1. **Create React App (CRA)**
   - Pros: Zero-config, official React tooling, extensive documentation
   - Cons: No longer actively maintained (as of 2023), webpack-based (slower)
   - Use Case: Maximum stability, minimal customization needs

2. **Vite**
   - Pros: Fast HMR, modern ESM-based, active development, plugin ecosystem
   - Cons: Newer ecosystem, some library compatibility gaps
   - Use Case: Performance priority, modern development experience

3. **Next.js (Pages Router, CSR only)**
   - Pros: Production-ready, extensive tooling, easy future SSR migration
   - Cons: Heavier than needed for pure SPA, opinionated structure
   - Use Case: Future-proofing for server features

**Recommended Approach**: Vite with React template (`npm create vite@latest . -- --template react` or `--template react-ts` for TypeScript).

**Rationale**: Aligns with "Build Performance" constraint (<10s start time), provides modern DX with HMR, actively maintained, and satisfies all acceptance criteria without over-engineering.

### Development Workflow
```
Developer → npm install → npm run dev → localhost:5173
                         ↓
                    Code changes → HMR → Browser updates
                         ↓
                    npm run build → dist/ folder (production assets)
```

### Folder Structure Convention
```
/
├── src/
│   ├── components/        # Reusable UI components
│   ├── assets/            # Images, fonts, static resources
│   ├── utils/             # Helper functions, utilities
│   ├── App.jsx (or .tsx)  # Root component
│   └── main.jsx (or .tsx) # Application entry point
├── public/                # Static files served as-is
├── dist/                  # Build output (gitignored)
└── package.json
```

### No Backend Integration
This template is frontend-only. API integration, authentication, and backend services are explicitly scoped out (per "Non-Goals" in intent). Future intents will handle those concerns.

### Browser Target Configuration
Must transpile/polyfill for:
- Chrome/Edge: last 2 versions
- Firefox: last 2 versions
- Safari: last 2 versions

No IE11 support required (per "evergreen browsers" constraint).

## Pattern Library

### React Patterns (Established Best Practices)
Since this is a greenfield project, adopt these React ecosystem standards:

1. **Component Structure**
   - Functional components only (no class components)
   - Hooks for state and side effects
   - Props destructuring in function signature
   - Example:
     ```jsx
     function ExampleComponent({ title, onAction }) {
       const [state, setState] = useState(initialValue);
       
       useEffect(() => {
         // side effect
       }, [dependencies]);
       
       return <div>{title}</div>;
     }
     ```

2. **File Naming**
   - Components: PascalCase (e.g., `Button.jsx`, `UserProfile.tsx`)
   - Utilities: camelCase (e.g., `formatDate.js`, `apiHelpers.js`)
   - Constants: UPPER_SNAKE_CASE in dedicated files (e.g., `API_ENDPOINTS.js`)

3. **Import Organization**
   ```javascript
   // 1. External dependencies
   import React, { useState } from 'react';
   import { someLibrary } from 'external-package';
   
   // 2. Internal modules
   import { utilityFunction } from './utils/helpers';
   
   // 3. Styles/assets
   import './Component.css';
   import logo from './assets/logo.svg';
   ```

4. **ESLint Rules (Recommended Baseline)**
   - `react/jsx-uses-react`: off (React 17+ JSX transform)
   - `react/react-in-jsx-scope`: off (React 17+ JSX transform)
   - `react/prop-types`: warn (or use TypeScript)
   - `no-unused-vars`: error
   - `no-console`: warn (production should not ship console logs)

5. **Testing Patterns** (if stretch goal achieved)
   - Test files co-located with components: `Button.test.jsx`
   - Use React Testing Library over Enzyme (modern standard)
   - Test user behavior, not implementation details

### Anti-Patterns to Avoid
- **Direct DOM manipulation**: Use React state/refs, not `document.getElementById`
- **Prop drilling**: If passing props >3 levels deep, consider context or composition
- **Premature optimization**: Do not add Redux/Zustand/etc. unless state complexity demands it
- **Mixing concerns**: Keep business logic separate from presentational components

### Package.json Script Conventions
```json
{
  "scripts": {
    "dev": "vite",              // Development server
    "build": "vite build",      // Production build
    "preview": "vite preview",  // Preview production build
    "lint": "eslint src",       // Code linting
    "test": "vitest"            // Test runner (if configured)
  }
}
```

## Prior Orbit References

### Trajectory Context
- **Trajectory Name**: Testing GitHub Integration
- **Trajectory Description**: (Not provided — assume this validates GitHub integration workflows)

### Prior Intents
**None.** This is Intent #1 in the trajectory (OBT-1, Orbit 1). No previous implementation exists.

### Lessons from Ecosystem
While no prior orbits exist, common pitfalls from React project creation across industry:

1. **CRA Deprecation** (2023): Create React App is no longer maintained. Avoid unless there's a compelling legacy reason.
2. **Node Version Mismatch**: Lock Node.js version using `.nvmrc` or `engines` field in `package.json` to prevent "works on my machine" issues.
3. **Dependency Sprawl**: Keep initial dependencies minimal. Resist adding libraries before they're needed.
4. **Ignoring TypeScript**: While optional here (stretch goal), starting with TypeScript is easier than retrofitting later. Strongly consider using `react-ts` template.

## Risk Assessment

### Risk 1: Tooling Choice Lock-In
**Severity**: Medium  
**Description**: Choosing Create React App could saddle project with deprecated tooling; choosing Next.js could over-engineer for current needs.  
**Mitigation**: Use Vite as recommended. It's actively maintained, performant, and doesn't impose unnecessary architecture. Document the decision in README.md with rationale.

### Risk 2: Dependency Vulnerability
**Severity**: Low (manageable)  
**Description**: Fresh installs pull latest package versions, which may have unpatched vulnerabilities.  
**Mitigation**: 
- Run `npm audit` immediately after `npm install`
- Add GitHub Dependabot configuration to trajectory for automated vulnerability alerts
- Pin major versions in `package.json` to prevent breaking changes

### Risk 3: Development Environment Variability
**Severity**: Medium  
**Description**: Different Node.js versions or package manager choices (npm vs. yarn vs. pnpm) can cause inconsistent behavior.  
**Mitigation**:
- Add `.nvmrc` with specific Node version (e.g., `18.18.0` or `20.10.0`)
- Document required Node version in README.md
- Use `package-lock.json` (npm) or `yarn.lock` — commit it to ensure deterministic installs

### Risk 4: HMR Failure on File System Watchers
**Severity**: Low  
**Description**: On some systems (especially Windows, WSL2), file watchers may not trigger HMR properly.  
**Mitigation**: Vite has robust defaults; document troubleshooting steps in README if issues arise (e.g., increasing file watcher limits on Linux).

### Risk 5: Missing Documentation
**Severity**: High  
**Description**: Per acceptance boundaries, lack of documentation makes template unusable for other developers.  
**Impact**: Blocks subsequent intents, reduces trajectory velocity  
**Mitigation**: 
- Treat README.md as mandatory, not optional
- Must include: setup steps, available scripts, folder structure explanation, how to extend
- Add inline comments in key files (`main.jsx`, `vite.config.js`) explaining non-obvious choices

### Risk 6: Overcomplication (Scope Creep)
**Severity**: Medium  
**Description**: Temptation to add routing, state management, UI libraries despite "Non-Goals" constraint.  
**Mitigation**: 
- Strictly adhere to acceptance criteria
- Stretch goals (TypeScript, testing, Prettier, husky) are acceptable as they enhance DX without changing architecture
- State management, routing, component libraries are explicitly future intents — do not pre-implement

### Risk 7: Build Time Exceeding Constraint
**Severity**: Low  
**Description**: Development server start time exceeds <10 seconds on standard hardware.  
**Mitigation**: 
- Vite typically starts in <3 seconds for empty projects
- Test on mid-tier hardware (8GB RAM, quad-core) before considering acceptance met
- If exceeded, profile with `DEBUG=vite:* npm run dev` and optimize

### Security Considerations
- **No Secrets**: Ensure no API keys, tokens, or credentials are committed (add to `.gitignore` template)
- **Public Directory**: Anything in `/public` is served as-is — do not place sensitive files there
- **Script Injection**: Default Vite/React setup is safe; avoid `dangerouslySetInnerHTML` in example components

### Performance Baseline
- **Cold Start** (first `npm run dev`): <10 seconds (per constraint)
- **HMR Update**: <500ms for single component change
- **Production Build**: <30 seconds for minimal template
- **Bundle Size**: Initial bundle <200KB (gzipped) — baseline for future measurement

### Rollback Strategy
If this intent fails validation:
1. Delete project directory
2. Reset repository to previous commit
3. Re-run creation with adjusted parameters
4. No persistent state exists — complete rollback possible