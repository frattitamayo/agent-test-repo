# Verification Protocol — Create Template Project

**Protocol ID:** VP-INT-001-1  
**Generated:** 2024-02-17  
**Intent:** Create Template Project  
**Proposal:** PROP-INT-001-1

---

## Automated Gates

| ID | Traces To | Check | Tool | Expected | Blocking |
|----|-----------|-------|------|----------|----------|
| AG-01 | `npm install` completes without errors | Package installation executes successfully without dependency resolution failures | Command: `npm install` in clean directory | Exit code 0, `node_modules/` directory populated, `package-lock.json` generated | Yes |
| AG-02 | `npm start` launches development server accessible at localhost | Development server starts and binds to port successfully | Command: `npm run dev`, then `curl http://localhost:5173` | HTTP 200 response, HTML content returned | Yes |
| AG-03 | Development server starts in <5 seconds on standard hardware | Server cold start time from command execution to ready state | Time measurement: `time npm run dev` until "Local: http://localhost:5173/" appears | Elapsed time <5 seconds | Yes |
| AG-04 | `npm run build` produces static assets in output directory | Production build completes and generates optimized artifacts | Command: `npm run build` | Exit code 0, `dist/` directory created with `index.html` and `assets/*.js` files | Yes |
| AG-05 | Build produces <500KB initial bundle size (before application code) | Production bundle size validation | Command: `npm run build`, then `du -sh dist/assets/*.js | awk '{print $1}'` | Total uncompressed JS <500KB | Yes |
| AG-06 | Project includes .gitignore with appropriate exclusions for React projects | Git status excludes build artifacts and dependencies | Command: `git status` after build | `node_modules/` and `dist/` not listed in untracked files | Yes |
| AG-07 | ESLint or similar linting configured with basic rules | Linting configuration exists and executes | Command: `npx eslint src/` (or check for `.eslintrc.*` file) | Configuration file present, linting executes without fatal errors | Yes |

---

## Human Verification Points

| ID | Traces To | Check | Method | Assessed By |
|----|-----------|-------|--------|-------------|
| HV-01 | At least one React component renders in the browser | Visual confirmation that React component tree mounts and renders visible content | Open browser to `http://localhost:5173` while dev server running, inspect rendered DOM | Verification Engineer |
| HV-02 | Hot reload reflects code changes in <2 seconds | Validate that Vite HMR updates browser without full page refresh | With dev server running, modify `src/App.js` (change text content), save file, observe browser update latency | Verification Engineer |
| HV-03 | README includes setup instructions and available commands | Documentation completeness review | Open `README.md`, verify presence of: Prerequisites section, Installation steps, Available npm scripts (`dev`, `build`, `preview`), Troubleshooting section | Verification Engineer |
| HV-04 | Project structure follows established React community conventions | File organization assessment | Review directory structure: `src/` for source code, `public/` for static assets, root config files (package.json, vite.config.js), component files use PascalCase naming | System Architect |
| HV-05 | No custom build configuration that would require specialized knowledge | Configuration simplicity review | Review `vite.config.js` and `.eslintrc.*` — verify minimal deviations from defaults, no complex plugins or custom transformations | System Architect |
| HV-06 | Package dependencies are pinned to specific versions | Dependency version audit | Review `package.json` — verify all dependencies use exact versions (no `^` or `~` prefixes) | Verification Engineer |
| HV-07 | Must not include credentials, API keys, or environment-specific configuration in version control | Security sweep of committed files | Review all committed files for hardcoded secrets, API keys, database credentials, or `.env` files | Security Reviewer (or Verification Engineer) |

---

## Intent Traceability

| Acceptance Criterion | Covered By |
|---------------------|------------|
| `npm install` completes without errors | AG-01 |
| `npm start` launches development server accessible at localhost | AG-02 |
| At least one React component renders in the browser | HV-01 |
| `npm run build` produces static assets in output directory | AG-04 |
| Development server starts in <5 seconds on standard hardware | AG-03 |
| Hot reload reflects code changes in <2 seconds | HV-02 |
| Build produces <500KB initial bundle size (before application code) | AG-05 |
| README includes setup instructions and available commands | HV-03 |
| Project includes .gitignore with appropriate exclusions for React projects | AG-06 |
| ESLint or similar linting configured with basic rules | AG-07 |
| Must use current stable React version (18.x or 19.x) | HV-06 (version pinning includes React version check) |
| Project structure must follow established React community conventions | HV-04 |
| No custom build configuration that would require specialized knowledge | HV-05 |
| Package dependencies must be pinned to specific versions | HV-06 |
| Must not include credentials, API keys, or environment-specific configuration in version control | HV-07 |

**Orphan checks:** None

**Uncovered criteria:**
- **Constraint:** "Must not include opinionated state management, routing, or styling solutions" — Implicit in AG-01/AG-04 (no additional dependencies beyond React + build tool), but could add explicit HV check if concern exists
- **Stretch goals:** TypeScript, testing framework, pre-commit hooks, CI/CD templates — Intentionally uncovered (stretch criteria not required for orbit closure)

---

## Escape Criteria

| Failure Mode | Action | Owner |
|-------------|--------|-------|
| AG-01 fails: npm install encounters dependency resolution conflict | re-orbit — Resolve version conflicts in package.json, update package-lock.json, re-run installation | AI Agent |
| AG-02 fails: Dev server fails to start (port conflict, missing dependencies) | re-orbit — Identify failure cause (check port availability, verify Node.js version), adjust configuration or document workaround in README troubleshooting section | AI Agent |
| AG-03 fails: Dev server start time exceeds 5 seconds | re-orbit — Profile startup time, verify hardware is standard (not severely constrained environment), consider pre-bundling optimization if Vite config issue | AI Agent |
| AG-04 fails: Production build errors (compilation failure, missing assets) | re-orbit — Fix build errors in source code or configuration, ensure all imports resolve correctly | AI Agent |
| AG-05 fails: Bundle size exceeds 500KB threshold | re-orbit — Analyze bundle composition with Vite build analyzer, identify unexpected large dependencies, consider build optimizations (tree-shaking verification) | AI Agent |
| AG-06 fails: Git tracking includes node_modules or dist artifacts | re-orbit — Verify .gitignore patterns, run `git rm --cached` on tracked artifacts, recommit with correct exclusions | AI Agent |
| AG-07 fails: ESLint configuration missing or misconfigured | re-orbit — Add/fix ESLint configuration file, ensure it runs without crashing, adjust rules if too strict for baseline template | AI Agent |
| HV-01 fails: Component does not render or renders blank page | re-orbit — Debug React mounting (check console errors, verify root element exists, ensure index.js imports App correctly) | AI Agent → Verification Engineer escalation if non-obvious |
| HV-02 fails: HMR not working or exceeds 2 second update latency | re-orbit — Verify Vite plugin configuration, test with simple component change, check for browser caching issues | AI Agent |
| HV-03 fails: README missing required sections or unclear instructions | re-orbit — Expand README with missing content, clarify setup steps based on reviewer feedback | AI Agent |
| HV-04 fails: File structure deviates significantly from conventions | re-orbit — Reorganize files to match standard React patterns (src/ for code, public/ for assets), update import paths | AI Agent |
| HV-05 fails: Configuration too complex or non-standard | re-orbit — Simplify configuration, remove custom plugins unless justified, document any necessary deviations | AI Agent → System Architect escalation if architectural justification needed |
| HV-06 fails: Dependencies use range versions (^, ~) instead of exact pins | re-orbit — Update package.json to pin exact versions, regenerate package-lock.json | AI Agent |
| HV-07 fails: Committed files contain secrets or environment-specific config | rollback — Remove sensitive files from git history (`git filter-branch` or BFG Repo-Cleaner), add to .gitignore, recommit clean version | Verification Engineer → Security escalation if credentials were pushed to remote |
| Multiple automated gates fail after re-orbit attempts | escalate — Fundamental issue with approach (wrong build tool, incompatible Node version, environment limitations) requires human architectural decision | System Architect |
| Human verification reveals fundamental UX or architecture problem | modify-intent — Template does not meet implicit usability requirements, intent needs refinement before re-orbiting | Intent Architect |