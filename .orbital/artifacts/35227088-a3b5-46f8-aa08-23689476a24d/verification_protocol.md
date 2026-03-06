# Verification Protocol: Create Template Project

**Protocol ID:** VP-INT-001-1  
**Generated:** 2025-01-17  
**Intent:** Create Template Project  
**Proposal:** PROP-INT-001-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | Repository contains all required files for immediate development | File existence validation | Script: `test -f package.json && test -f vite.config.ts && test -f tsconfig.json && test -f src/index.tsx && test -f src/App.tsx && test -f public/index.html && test -f .gitignore && test -f README.md` | All files exist, exit code 0 | Yes |
| AG-02 | Dependencies install without errors | Dependency installation | `npm ci` on fresh clone | Completes successfully, exit code 0, no error messages | Yes |
| AG-03 | Development server starts within 120 seconds | Startup time benchmark | `time npm run dev` with timeout | Server responds with 200 status at `http://localhost:5173` within 120 seconds | Yes |
| AG-04 | Application renders in browser | Functional smoke test | `npm run dev` followed by HTTP request to `http://localhost:5173` | HTTP 200 response, HTML contains `<div id="root">`, page loads without console errors | Yes |
| AG-05 | Build process completes successfully | Production build | `npm run build` | Build completes without errors, `/dist/` directory created with `index.html` and bundled assets | Yes |
| AG-06 | TypeScript compilation succeeds | Type checking | `npm run type-check` or `tsc --noEmit` | Zero type errors, exit code 0 | Yes |
| AG-07 | Code passes linting rules | ESLint validation | `npm run lint` | Zero linting errors, exit code 0 | Yes |
| AG-08 | Code follows formatting standards | Prettier validation | `npm run format:check` or `prettier --check "src/**/*.{ts,tsx}"` | All files conform to formatting rules, exit code 0 | Yes |
| AG-09 | No proprietary or restrictive licenses in dependencies | License audit | `npx license-checker --summary` piped through filter for MIT/Apache-2.0/BSD only | All dependencies use permissive licenses (MIT, Apache-2.0, BSD), no GPL/proprietary licenses | Yes |
| AG-10 | Works on Node.js LTS versions | Multi-version compatibility | CI matrix test with Node 18.x and 20.x: `npm ci && npm run build && npm run lint` | All commands succeed on both Node 18.x and 20.x | Yes |
| AG-11 | No external service dependencies in code | Static code analysis | `grep -r "process.env.API_KEY|process.env.*_TOKEN|fetch.*api." src/` | Zero matches for API keys or external API calls in source code | Yes |
| AG-12 | All generated files are gitignored | Git cleanliness check | After `npm install && npm run build`, run `git status` | Only tracked files shown, `node_modules/` and `/dist/` not listed as untracked | Yes |
| AG-13 | No security vulnerabilities in dependencies | Security audit | `npm audit --production` | Zero high or critical vulnerabilities | Yes |
| AG-14 | README contains setup instructions | Documentation completeness | `grep -q "npm install|npm ci" README.md && grep -q "npm run dev" README.md` | README contains installation and run commands | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | Template remains minimal without over-engineering | Review codebase complexity and architecture decisions | Code review: count number of dependencies in package.json (<20 total), verify no state management libraries (Redux/MobX/Zustand) present, confirm no complex build configuration beyond Vite defaults | System Architect |
| HV-02 | Folder structure and patterns demonstrate clarity for future development | Assess organizational coherence and extensibility | Manual inspection: verify `/src/components/` exists but contains only example component(s), `/src/styles/` present, no nested folder hierarchies beyond 2 levels, path aliases configured in vite.config.ts | Intent Architect |
| HV-03 | Developer experience from clone to running is frictionless | Execute the 2-minute setup test as a new developer would | Fresh machine test: clone repo, run `npm install && npm run dev`, measure time from clone to seeing rendered app in browser, note any confusion points or missing instructions | Verification Engineer |
| HV-04 | Standard React patterns are demonstrated correctly | Verify code examples follow modern React best practices | Code review: check that App.tsx uses functional components with hooks (no class components), TypeScript props are properly typed, component file naming follows conventions (PascalCase), no deprecated React APIs used | System Architect |
| HV-05 | Development workflow tooling is properly configured | Validate that ESLint/Prettier enhance rather than obstruct development | Developer experience test: make intentional formatting violation, save file, verify auto-fix on save works (if configured) or error is clearly shown, introduce TypeScript error, verify IDE shows error immediately | Verification Engineer |
| HV-06 | README serves as effective onboarding documentation | Assess documentation clarity and completeness for new developers | Read-through test: verify README explains what the project is, lists prerequisites (Node version), provides exact commands to run, includes troubleshooting section, explains folder structure, no jargon without explanation | Intent Architect |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| Any developer can clone the repository, run a single setup command, and see a working React application running locally within 2 minutes | AG-02, AG-03, AG-04, HV-03 |
| Must use React as the frontend framework | AG-04, HV-04 |
| Template must remain minimal; avoid premature optimization, complex state management libraries, or architectural patterns not immediately needed | HV-01 |
| Use widely-adopted, actively-maintained tools from the React ecosystem | HV-01, HV-04 |
| Template must run entirely locally without requiring API keys, database connections, or third-party service accounts | AG-11 |
| All configuration and code must be version-controlled | AG-01, AG-12 |
| All dependencies must use permissive open-source licenses (MIT, Apache 2.0, BSD) | AG-09 |
| Must support Node.js LTS versions (currently 18.x and 20.x) | AG-10 |
| Establishes the architectural foundation and development patterns that all subsequent work will follow | HV-02, HV-04 |
| Repository contains required files for immediate development (package.json, source files, build configuration) | AG-01 |
| Dependencies install without errors | AG-02 |
| Development server starts and application renders | AG-03, AG-04 |
| Production build succeeds | AG-05 |
| Code passes type checking | AG-06 |
| Code passes linting and formatting standards | AG-07, AG-08, HV-05 |
| No security vulnerabilities in dependencies | AG-13 |
| README contains setup instructions | AG-14, HV-06 |
| Folder structure demonstrates organizational clarity | HV-02 |
| Standard React patterns are correctly implemented | HV-04 |

**Orphan checks:** None  
**Uncovered criteria:** None

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| File existence check fails (AG-01) | re-orbit — generate missing files from proposal specification | AI Agent |
| Dependency installation fails (AG-02) | re-orbit — review package.json for incompatible dependency versions, lock file corruption, or network issues; if dependency conflict is architectural, escalate | AI Agent → System Architect |
| Startup time exceeds 120 seconds (AG-03) | re-orbit — profile Vite startup, check for slow dependencies; if inherent to tooling choice, escalate to reconsider build tool | AI Agent → System Architect |
| Application fails to render (AG-04) | re-orbit — debug React mount, check console errors, verify index.html includes root div | AI Agent |
| Build process fails (AG-05) | re-orbit — review TypeScript errors, missing dependencies, misconfigured build settings | AI Agent |
| TypeScript compilation errors (AG-06) | re-orbit — fix type errors in source files, ensure tsconfig.json is correct | AI Agent |
| Linting errors (AG-07) | re-orbit — run `npm run lint -- --fix` to auto-correct, manually fix remaining issues | AI Agent |
| Formatting violations (AG-08) | re-orbit — run `npm run format` to auto-fix all files | AI Agent |
| Proprietary license detected (AG-09) | re-orbit — identify offending dependency, find alternative with permissive license, or remove feature requiring that dependency; if no alternative exists, escalate to modify-intent | AI Agent → Intent Architect |
| Node.js compatibility failure (AG-10) | re-orbit — update dependencies to versions compatible with both LTS releases, or adjust package.json engines field | AI Agent |
| External service dependency found (AG-11) | re-orbit — remove API calls or environment variable references from template code; if external service is fundamental requirement, escalate to modify-intent | AI Agent → Intent Architect |
| Untracked build artifacts in git status (AG-12) | re-orbit — update .gitignore to exclude generated files | AI Agent |
| Security vulnerabilities found (AG-13) | re-orbit — run `npm audit fix`, manually update vulnerable dependencies; if no fix available and vulnerability is high/critical, replace dependency or escalate | AI Agent → System Architect |
| README missing setup instructions (AG-14) | re-orbit — add installation and run commands to README | AI Agent |
| Template assessed as over-engineered (HV-01) | re-orbit — remove unnecessary dependencies, simplify configuration, eliminate unused features | System Architect |
| Folder structure lacks clarity (HV-02) | re-orbit — reorganize directory structure to follow proposal specification, ensure path aliases work | Intent Architect |
| Setup friction exceeds 2 minutes or causes confusion (HV-03) | re-orbit — identify friction points, update README, simplify commands, or fix broken steps | Verification Engineer → AI Agent |
| Non-standard React patterns found (HV-04) | re-orbit — refactor to use functional components with hooks, update TypeScript typings, remove deprecated APIs | System Architect → AI Agent |
| Development tooling obstructs workflow (HV-05) | re-orbit — adjust ESLint/Prettier config to be less aggressive, or fix configuration errors | Verification Engineer → AI Agent |
| README fails to onboard new developer effectively (HV-06) | re-orbit — expand documentation, add prerequisites, include troubleshooting, explain folder structure | Intent Architect → AI Agent |