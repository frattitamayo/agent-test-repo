# Context Package: Create Template Project

## Codebase References

### Files to Create
- `/react-template/` — Root directory for the React template project
- `/react-template/package.json` — Project manifest defining dependencies and scripts
- `/react-template/public/index.html` — HTML entry point
- `/react-template/src/index.js` or `/react-template/src/index.tsx` — Application entry point
- `/react-template/src/App.js` or `/react-template/src/App.tsx` — Root component
- `/react-template/src/components/` — Directory for example components
- `/react-template/README.md` — Setup and usage documentation
- `/react-template/.gitignore` — Node and build artifact exclusions

### Optional Files (Target/Stretch Goals)
- `/react-template/src/App.test.js` — Basic test example
- `/react-template/.eslintrc.json` — Linting configuration
- `/react-template/.prettierrc` — Code formatting rules
- `/react-template/tsconfig.json` — TypeScript configuration (if TypeScript is included)

### Repository Root Impact
- No modifications to existing files at repository root
- New top-level directory `/react-template/` contains all template content
- Repository `.gitignore` may need verification to ensure no template build artifacts leak to root

## Architecture Context

### Repository Structure
This is a testing repository with no established architecture or existing React projects. The template will:
- Live in a self-contained directory (`/react-template/`)
- Function as a standalone, copyable unit
- Avoid coupling to any other potential projects in the repo

### Template Architecture Pattern
Standard Create React App or Vite structure:
- **Public directory:** Static assets, HTML entry point
- **Source directory:** JavaScript/TypeScript components and application logic
- **Component-based architecture:** React functional components with hooks
- **Build toolchain:** Webpack (CRA) or Vite for bundling and development server

### Data Flow
- No external data sources or APIs required
- Component state managed locally via React hooks (useState, useEffect)
- Props flow unidirectionally from parent to child components

### Service Boundaries
- No backend services
- No database connections
- No authentication or authorization
- Pure frontend template with local development server

## Pattern Library

### React Component Patterns
Since this is a new template in a testing repository, establish these conventions:

**Functional Components with Hooks:**
```javascript
function ExampleComponent({ propName }) {
  const [state, setState] = useState(initialValue);
  
  return (
    <div>
      {/* JSX content */}
    </div>
  );
}
```

**File Naming:**
- Components: PascalCase (e.g., `App.js`, `ExampleComponent.js`)
- Utilities: camelCase (e.g., `helpers.js`)
- Tests: `ComponentName.test.js` pattern

**Project Structure Convention:**
```
react-template/
├── public/
│   └── index.html
├── src/
│   ├── components/
│   │   └── ExampleComponent.js
│   ├── App.js
│   └── index.js
├── package.json
└── README.md
```

**Dependency Management:**
- Pin major versions but allow minor/patch updates (e.g., `"react": "^18.0.0"`)
- Keep dependencies minimal — only include what's necessary for core functionality
- Document any non-obvious dependencies in README

**Documentation Standards:**
- README must include: Prerequisites, Installation, Running Locally, Building for Production
- Use numbered lists for step-by-step instructions
- Include one troubleshooting section for common issues

## Prior Orbit References

### Trajectory Context
This is **Orbit #1** in the "Testing GitHub Integration" trajectory. No prior orbits exist for reference.

### Trajectory Intent
The trajectory's purpose is to validate that GitHub integration works correctly. This template serves as proof that:
- Code can be committed and pushed to the repository
- Standard development workflows (install, run, build) function as expected
- The repository can host working projects

### Learning from Orbit #1
Future orbits in this trajectory should reference:
- Whether the template creation process revealed any GitHub workflow issues
- What tooling choices worked well and should be reused
- Any repository structure decisions that should be maintained or revised

## Risk Assessment

### Low-Risk Factors
- **Isolated scope:** Template exists in dedicated directory with no dependencies on other code
- **Testing environment:** Repository is explicitly for testing, not production
- **Reversible:** Git allows complete rollback if template is problematic
- **No user impact:** No end users depend on this repository
- **No sensitive data:** Template contains only boilerplate code

### Potential Issues and Mitigations

**Issue: Tooling version conflicts**
- *Risk:* Node.js or npm version mismatches cause installation failures
- *Mitigation:* Document required versions in README (e.g., "Node 18.x or higher"), use `engines` field in package.json
- *Severity:* Low — easy to diagnose and fix

**Issue: Bloated dependencies**
- *Risk:* Including unnecessary packages increases template complexity and maintenance burden
- *Mitigation:* Start with minimal dependencies (react, react-dom, react-scripts OR vite), add only what's needed for target goals
- *Severity:* Low — can be pruned in subsequent orbits

**Issue: Non-portable configuration**
- *Risk:* Development environment specifics (file paths, OS-specific commands) prevent template from working on other machines
- *Mitigation:* Use cross-platform npm scripts, relative paths, standard conventions
- *Severity:* Low — testing on a second machine during orbit validates portability

**Issue: Incomplete documentation**
- *Risk:* Developers cannot use template because setup steps are unclear or missing
- *Mitigation:* Follow the 5-step maximum documentation constraint, test instructions by following them literally
- *Severity:* Low — can be improved through feedback

**Issue: Build output polluting repository**
- *Risk:* Build artifacts (`/build`, `/dist`, `/node_modules`) accidentally committed to Git
- *Mitigation:* Ensure `.gitignore` includes standard React build and dependency directories
- *Severity:* Low — easily fixed with `.gitignore` update and history cleanup if needed

### Security Considerations
- **Dependency vulnerabilities:** Run `npm audit` before finalizing template to check for known CVEs
- **No secrets:** Template must not include API keys, tokens, or credentials (even dummy ones)
- **Public repository assumption:** Treat all template code as public-facing

### Performance Considerations
- **Development server startup:** Should complete in <10 seconds on standard hardware
- **Hot reload:** Changes should reflect in browser within 1-2 seconds
- **Production build:** Should complete without errors; build size is not critical for a template but should be <5MB for basic app

### Validation Checkpoints
Before considering orbit complete:
1. `npm install` runs without errors
2. `npm start` launches development server successfully
3. Application renders in browser at `http://localhost:3000` (or configured port)
4. `npm run build` creates production bundle without errors
5. README instructions can be followed by someone unfamiliar with the template
6. `.gitignore` prevents build artifacts from being staged
7. Commit history is clean (no "fix typo" or "oops forgot file" commits — squash if needed)