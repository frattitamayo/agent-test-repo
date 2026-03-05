# Context Package — INT-001: Create Template Project

**Generated:** 2024-01-09  
**Package Type:** intent-specific  
**Intent:** INT-001

---

## Codebase

### Primary (will be modified or created)
- `package.json` — Project manifest with dependencies, scripts, and metadata
- `tsconfig.json` — TypeScript compiler configuration
- `tsconfig.node.json` — TypeScript config for Node.js tooling
- `vite.config.ts` — Vite bundler and dev server configuration
- `vitest.config.ts` — Test runner configuration
- `src/main.tsx` — Application entry point
- `src/App.tsx` — Root application component with routing
- `src/pages/Home.tsx` — Home page component
- `src/pages/About.tsx` — About page component
- `src/pages/Settings.tsx` — Settings page component
- `src/components/Navigation.tsx` — Navigation component for page switching
- `src/App.css` — Application-level styles
- `src/index.css` — Global styles
- `index.html` — HTML entry point
- `public/` — Static assets directory
- `.gitignore` — Git exclusion rules
- `README.md` — Project documentation

### Secondary (dependencies and interfaces)
- `src/vite-env.d.ts` — Vite environment type declarations
- `node_modules/` — Third-party dependencies (generated)
- `dist/` — Production build output (generated)

### Tests
- `src/App.test.tsx` — Application component tests
- `src/pages/__tests__/Home.test.tsx` — Home page tests
- `src/pages/__tests__/About.test.tsx` — About page tests
- `src/pages/__tests__/Settings.test.tsx` — Settings page tests
- `src/components/__tests__/Navigation.test.tsx` — Navigation component tests

---

## Architecture

This is a **foundation layer** project establishing a modern React application stack using TypeScript for type safety, Vite for fast development and optimized builds, and React Router for client-side navigation. The architecture follows React's component-based model with clear separation between pages, reusable components, and global configuration.

**Reference docs:**
- [React Documentation](https://react.dev/)
- [Vite Guide](https://vitejs.dev/guide/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [React Router Documentation](https://reactrouter.com/)
- [Vitest Documentation](https://vitest.dev/)

---

## Patterns

### Conventions (follow these)

- **Functional Components with TypeScript**: All React components use functional component syntax with TypeScript interfaces for props
  ```tsx
  interface PageProps {
    title: string;
  }
  
  export const Page: React.FC<PageProps> = ({ title }) => {
    return <div>{title}</div>;
  };
  ```

- **File Organization**: 
  - `src/pages/` — Top-level page components (Home, About, Settings)
  - `src/components/` — Reusable UI components (Navigation)
  - `src/` root — Application entry points and global files
  - `public/` — Static assets (images, fonts, favicon)

- **Naming Conventions**:
  - Components: PascalCase (`Navigation.tsx`, `Home.tsx`)
  - Tests: Co-located with `__tests__/` subdirectories or `.test.tsx` suffix
  - Styles: Match component names (`App.css` for `App.tsx`)

- **React Router Setup**: Use `BrowserRouter` with declarative route configuration
  ```tsx
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  </BrowserRouter>
  ```

- **Navigation Component**: Use React Router's `Link` component (not anchor tags)
  ```tsx
  import { Link } from 'react-router-dom';
  
  <nav>
    <Link to="/">Home</Link>
    <Link to="/about">About</Link>
    <Link to="/settings">Settings</Link>
  </nav>
  ```

- **Testing Pattern**: Use Vitest with React Testing Library
  ```tsx
  import { render, screen } from '@testing-library/react';
  import { describe, it, expect } from 'vitest';
  
  describe('Component', () => {
    it('renders correctly', () => {
      render(<Component />);
      expect(screen.getByText('text')).toBeInTheDocument();
    });
  });
  ```

### Anti-patterns (avoid these)

- **Class Components**: Do not use class-based components — use functional components with hooks
- **Inline Styles**: Avoid inline style objects; use CSS modules or separate stylesheets
- **Direct DOM Manipulation**: Do not use `document.querySelector()` or similar — let React manage the DOM
- **Anchor Tags for Internal Navigation**: Use React Router's `Link` component instead of `<a href>` for internal routes
- **Any Type Overuse**: Avoid using `any` in TypeScript; define proper interfaces and types

---

## Dependencies

### Internal
- N/A (this is a new template project with no existing internal packages)

### External

**Core Dependencies:**
- **React** (^18.x) — UI library for building component-based interfaces
- **React-DOM** (^18.x) — React renderer for web browsers
- **React Router DOM** (^6.x) — Client-side routing library

**Development Dependencies:**
- **Vite** (^5.x) — Build tool and development server with fast HMR
- **TypeScript** (^5.x) — Type safety and improved developer experience
- **@vitejs/plugin-react** — Vite plugin for React Fast Refresh
- **Vitest** (^1.x) — Unit test runner (Vite-native, Jest-compatible API)
- **@testing-library/react** — React component testing utilities
- **@testing-library/jest-dom** — Custom matchers for DOM assertions
- **jsdom** — DOM implementation for Node.js (test environment)
- **@types/react** — TypeScript type definitions for React
- **@types/react-dom** — TypeScript type definitions for React DOM

**Tooling:**
- **ESLint** (optional but recommended) — Code linting
- **Prettier** (optional but recommended) — Code formatting

---

## Prior Art

### Completed
- N/A (this is the first intent for this new project)

### Known Issues
- N/A (greenfield project with no existing issues)

### Industry Standards & Best Practices
- **Vite Official Template**: The `create vite@latest` command provides an official React + TypeScript template that follows industry conventions
- **React Documentation**: React's official docs demonstrate functional components with hooks as the standard approach
- **React Router v6**: Latest major version with simplified API and improved TypeScript support

---

## Constraints

### Build (must pass)
- `npm install` — All dependencies install without errors
- `npm run dev` — Development server starts successfully on localhost
- `npm run build` — Production build completes without errors
- `npm run test` — All tests pass with 0 failures
- `npm run lint` — (if configured) Linting passes with 0 errors

### Technology Requirements
- **React version**: Must use React 18.x or later (for concurrent features)
- **TypeScript**: Must use TypeScript 5.x for latest language features
- **Node.js**: Must support Node.js 18.x or later
- **Package Manager**: Must use npm (not yarn or pnpm unless explicitly specified)

### Guardrails (do not violate)

- **No Framework Mixing**: Must not include Vue, Angular, Svelte, or other framework code
- **No Business Logic**: Must not include feature-specific code, API integrations, authentication, or domain logic
- **No Production Config**: Must not include deployment configurations (Dockerfile, CI/CD, hosting configs)
- **No Experimental Tools**: Must use stable, widely-adopted tooling — avoid alpha/beta packages
- **Standard Structure**: Must maintain conventional React project structure:
  - Configuration files at root
  - Source code in `src/`
  - Static assets in `public/`
  - Build output in `dist/`
- **TypeScript Strictness**: Must enable strict mode in `tsconfig.json` (`"strict": true`)
- **Accessibility**: Navigation must be keyboard-accessible and use semantic HTML
- **Browser Compatibility**: Must support modern evergreen browsers (Chrome, Firefox, Safari, Edge)

### Quality Gates

- **Type Safety**: All components must have proper TypeScript interfaces
- **Test Coverage**: Each page and navigation component must have at least one test
- **HMR Functionality**: Hot module replacement must work in development mode
- **Build Size**: Initial bundle size should be < 200KB (pre-gzip) for empty template
- **Lighthouse Score**: Development server should achieve 90+ in Performance and Accessibility

---

## Risk Mitigation

### Identified Risks & Mitigations

1. **Dependency Conflicts**
   - **Risk**: Version mismatches between React, TypeScript, and Vite
   - **Mitigation**: Use Vite's official template as baseline; pin major versions in `package.json`

2. **Configuration Errors**
   - **Risk**: Misconfigured TypeScript or Vite settings causing runtime issues
   - **Mitigation**: Copy proven configurations from official templates; test build and dev mode

3. **Routing Issues**
   - **Risk**: React Router not functioning correctly or conflicting with Vite's dev server
   - **Mitigation**: Follow React Router v6 documentation; test all routes in both dev and production builds

4. **Testing Setup**
   - **Risk**: Vitest not configured correctly for React components
   - **Mitigation**: Install jsdom and @testing-library packages; verify one test passes before proceeding

5. **TypeScript Errors**
   - **Risk**: Type errors preventing compilation
   - **Mitigation**: Start with loose config, add strictness incrementally; ensure all Vite/React types are installed

---

## Implementation Checklist

- [ ] Initialize project with Vite React-TypeScript template
- [ ] Install React Router DOM and types
- [ ] Configure Vitest and React Testing Library
- [ ] Create project structure (pages/, components/ directories)
- [ ] Implement Navigation component with routing links
- [ ] Create Home, About, and Settings page components
- [ ] Configure routing in App.tsx
- [ ] Write tests for each component
- [ ] Verify dev server runs and HMR works
- [ ] Verify production build succeeds
- [ ] Verify all tests pass
- [ ] Update README with setup instructions
- [ ] Verify navigation works in browser

---

This comprehensive context package provides all the information needed to implement INT-001. The package follows the two-tier model (this is intent-specific, supplementing any architectural package that exists for the parent project), maps all expected files, establishes clear patterns with code examples, identifies all dependencies, and defines strict guardrails to ensure a clean, production-ready template.