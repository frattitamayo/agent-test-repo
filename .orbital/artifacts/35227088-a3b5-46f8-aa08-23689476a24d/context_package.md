# Context Package — Create Template Project (Orbit #1)

**Generated:** 2025-01-21  
**Package Type:** intent-specific  
**Intent:** Create Template Project  
**Trust Tier:** 1 (Standard - Requires Review)

---

## Executive Summary

This intent establishes the foundational React project structure for "Fio Test Repo". As a Tier 1 intent creating a new project template, this requires human review before implementation. The outcome will provide the base framework for future development work.

---

## Codebase Context

### Current State
This appears to be a **greenfield project initialization**. No existing React project structure detected.

### Primary Surfaces (will be created)
- `/package.json` — Project dependencies and scripts
- `/tsconfig.json` or `/jsconfig.json` — TypeScript/JavaScript configuration
- `/src/` — Source code directory
  - `/src/App.jsx` or `/src/App.tsx` — Main application component
  - `/src/index.jsx` or `/src/index.tsx` — Application entry point
  - `/src/index.css` — Base styles
- `/public/` — Static assets directory
  - `/public/index.html` — HTML template
- `/.gitignore` — Git ignore patterns
- `/README.md` — Project documentation

### Secondary Dependencies
- Build tooling configuration (Vite, Create React App, or similar)
- Testing framework setup (Jest, Vitest, React Testing Library)
- Linting configuration (ESLint)
- Formatting configuration (Prettier)

---

## Architecture Considerations

### Recommended Approach
- **Build Tool:** Modern React projects favor **Vite** for speed and developer experience
- **Language:** Consider TypeScript for type safety in larger applications
- **Structure:** Component-based architecture with clear separation of concerns
- **State Management:** Start with React hooks; add Redux/Zustand if complexity grows

### Folder Structure Pattern
```
project-root/
├── public/           # Static assets
├── src/
│   ├── components/   # Reusable UI components
│   ├── pages/        # Page-level components
│   ├── hooks/        # Custom React hooks
│   ├── utils/        # Helper functions
│   ├── styles/       # Global styles
│   └── App.jsx       # Root component
├── tests/            # Test files
└── package.json
```

---

## Implementation Patterns

### Modern React Best Practices (2024-2025)
1. **Functional Components** — Use function components with hooks (not class components)
2. **Component Composition** — Build complex UIs from simple, reusable components
3. **Hooks First** — useState, useEffect, useContext for state and side effects
4. **Prop Validation** — Use PropTypes or TypeScript interfaces
5. **CSS Modules or Styled Components** — Scoped styling to prevent conflicts
6. **Environment Variables** — Use `.env` files for configuration

### Anti-Patterns to Avoid
- ❌ **Inline styles everywhere** — Creates maintenance issues
- ❌ **Deeply nested components** — Flatten component hierarchies
- ❌ **Direct DOM manipulation** — Let React manage the DOM
- ❌ **Props drilling** — Use Context API or state management for deep data passing

---

## External References & Dependencies

### Core Dependencies
- **react** (^18.x) — Core React library
- **react-dom** (^18.x) — DOM rendering
- **vite** (^5.x) OR **create-react-app** — Build tooling

### Development Dependencies
- **@vitejs/plugin-react** — Vite React plugin
- **eslint** — Code linting
- **prettier** — Code formatting
- **@testing-library/react** — Component testing
- **vitest** — Fast unit test runner (if using Vite)

### Recommended Starter Command
```bash
npm create vite@latest fio-test-repo -- --template react
# or with TypeScript
npm create vite@latest fio-test-repo -- --template react-ts
```

### Official Documentation
- [React Docs](https://react.dev/) — Official React documentation
- [Vite Guide](https://vitejs.dev/guide/) — Vite build tool
- [React Patterns](https://reactpatterns.com/) — Community patterns

---

## Risk Assessment

### Potential Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Build tool choice** | High — Affects DX and build speed | Use Vite for modern projects; CRA for legacy compatibility needs |
| **TypeScript vs JavaScript** | Medium — Later migration is costly | Decide early based on team familiarity and project scale |
| **Over-engineering** | Medium — Adds unnecessary complexity | Start minimal; add complexity only when needed |
| **Package version conflicts** | Low — Dependency resolution issues | Pin major versions; use package-lock.json |
| **Missing linting/formatting** | Low — Code quality drift | Configure ESLint + Prettier from start |

### Success Criteria (Acceptance Tests)
- [ ] Project initializes and runs locally (`npm run dev`)
- [ ] Default React page renders without errors
- [ ] Hot module replacement (HMR) works during development
- [ ] Production build completes successfully (`npm run build`)
- [ ] ESLint runs without errors
- [ ] Basic component renders in tests

---

## Prior Art & Conventions

### Industry Standards
- **React 18** introduced concurrent features — ensure compatibility
- **ES6+ syntax** is standard (arrow functions, destructuring, modules)
- **Semantic versioning** for dependencies
- **MIT or Apache 2.0** common licenses for open source

### Project-Specific Decisions Needed
- [ ] TypeScript or JavaScript?
- [ ] Vite or alternative build tool?
- [ ] CSS approach (modules, styled-components, Tailwind)?
- [ ] Testing strategy (unit, integration, e2e)?
- [ ] State management needs (start with hooks)?

---

## Next Steps (Post-Approval)

1. **Initialize project** with chosen build tool
2. **Configure tooling** (ESLint, Prettier, Git hooks)
3. **Create basic structure** (folders, sample components)
4. **Document setup** in README
5. **Commit initial structure** with clear message
6. **Tag as v0.1.0** for template baseline

---

## Notes

- This is a **foundational intent** — future development will build on this structure
- Keep initial setup minimal; avoid premature optimization
- Consider team familiarity with tools when making architectural choices
- Document decisions in ADRs (Architecture Decision Records) for future reference