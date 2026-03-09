# Context Package: Greeting Button for Toast

## Codebase References

### UI Components Layer
- **Button Component**: Verify existence of reusable button component at `/src/components/Button` or `/src/components/ui/Button`
- **Toast/Notification System**: Check for existing implementation at `/src/components/Toast`, `/src/components/Notification`, or `/src/lib/toast`
- **Target Integration Point**: Identify parent component or page where button will be mounted (likely `/src/pages/*` or `/src/views/*`)

### Styling System
- **Style Files**: Locate global styles at `/src/styles/*` or component-level styles (`.module.css`, `.styled.js`, or Tailwind config)
- **Design Tokens**: Check `/src/styles/tokens.js`, `/src/theme/*`, or design system configuration for color variables, spacing units, timing values

### State Management (if applicable)
- **UI State**: Determine if toast state requires centralized management (Redux store, Zustand, Context API) or can be component-local
- **Toast Queue Logic**: Check for existing toast manager/queue implementation to prevent overlapping notifications

### Testing Infrastructure
- **Component Tests**: Locate test file patterns (`*.test.js`, `*.spec.js`) in `/src/__tests__/`, `/__tests__/`, or colocated with components
- **Accessibility Tests**: Verify presence of `@testing-library/react`, `jest-axe`, or similar a11y testing utilities

### Build Configuration
- **Package Manager**: Identify `package.json` at project root to verify installed dependencies and available toast libraries
- **Framework Detection**: Confirm React/Vue/Svelte/vanilla JS from `package.json` dependencies and file structure

## Architecture Context

### Application Layer
This feature operates entirely within the **presentation/UI layer**. No backend services, API endpoints, or database operations are required. The implementation is a pure client-side interaction pattern.

### Component Hierarchy
```
[Page/View Container]
  └── [Greeting Button Component] (new)
       └── onClick handler → trigger toast
  
[Toast Provider/Portal] (verify or implement)
  └── [Toast Component Instance] (ephemeral, auto-dismiss)
```

### Data Flow
1. User clicks button → Event handler invoked
2. Handler calls toast notification API/function with message "Hello sir"
3. Toast manager adds notification to queue (if queuing exists) or renders immediately
4. Toast component mounts to DOM via portal or absolute positioning
5. Auto-dismiss timer triggers unmount after 3-5 seconds
6. Component cleanup on unmount prevents memory leaks

### State Management Pattern
**Recommendation**: Local component state or lightweight toast context unless project already has centralized notification system. Avoid introducing Redux/complex state management for this isolated feature.

### Styling Approach
- **If using CSS Modules**: Create scoped styles for button and toast components
- **If using styled-components/Emotion**: Follow established component styling patterns
- **If using Tailwind**: Apply utility classes consistent with existing components
- **Animation**: Use CSS transitions or framework-native animation libraries (Framer Motion, React Spring) if already in project

### Accessibility Architecture
- Button must be semantic `<button>` element (not `<div>` with click handler)
- Toast must use ARIA `role="status"` or `role="alert"` for screen reader announcements
- Toast must be appended to a portal/live region for proper screen reader integration
- Focus management: Toast should not steal focus from button or page content

## Pattern Library

### Existing Button Patterns
**Verify and match these conventions:**
- Button sizing: Check for `size` prop variants (`small`, `medium`, `large`)
- Button variants: Identify primary/secondary/tertiary styling patterns
- Icon support: Determine if buttons support leading/trailing icons
- Loading states: Check for spinner or disabled state patterns during async operations
- Event handling: Confirm standard `onClick` prop naming convention

### Toast/Notification Patterns (if existing)
**If toast system exists, adopt its API:**
```javascript
// Example pattern to verify:
toast.success("Message");
toast.error("Message");
toast.info("Message");
toast({
  message: "Hello sir",
  duration: 4000,
  position: "top-right"
});
```

**If no toast system exists, follow these conventions:**
- **Position**: Top-right or bottom-right (consistent with UX norms)
- **Animation**: Slide-in from edge + fade-in (150-300ms duration)
- **Dismiss**: Auto-dismiss after 4 seconds (middle of 3-5s range)
- **Stacking**: If multiple toasts, stack vertically with consistent spacing

### Component File Structure
**Adopt project conventions:**
```
ComponentName/
  ├── index.js (export)
  ├── ComponentName.jsx (implementation)
  ├── ComponentName.module.css (styles)
  ├── ComponentName.test.js (tests)
  └── ComponentName.stories.js (Storybook, if used)
```

### Testing Patterns
**Match existing test structure:**
- Use `describe` blocks for component tests
- Use `it` or `test` for individual test cases
- Follow Arrange-Act-Assert pattern
- Use `@testing-library/react` queries (`getByRole`, `getByText`)
- Test accessibility with `toHaveAccessibleName()` or `axe` matcher

### Naming Conventions
- **Component names**: PascalCase (`GreetingButton`, `Toast`)
- **File names**: Match component name or kebab-case
- **CSS classes**: Verify BEM, camelCase, or utility-first approach
- **Event handlers**: `handle[Event]` (e.g., `handleClick`, `handleDismiss`)
- **Props**: camelCase, descriptive (`onDismiss`, `autoClose`, `duration`)

## Prior Orbit References

### Orbit Context
**Current Orbit**: Orbit 1 (Initial Orbit)
**Phase**: Verification
**Status**: In Progress

This is the **first orbit** of the "Testing GitHub Integration" trajectory. No prior orbit history exists for this trajectory.

### Related Intents (Cross-Trajectory)
**Action Required**: Query repository commit history and closed PRs for:
- Previous notification/toast implementations
- Similar UI pattern additions (modals, alerts, popups)
- Accessibility improvements to UI components
- Button component additions or modifications

### Lessons from Similar Features (Generic)
Without project-specific history, apply these common pitfalls from notification implementations:
- **Toast Z-Index Issues**: Ensure toast appears above all other UI elements (z-index: 9999+)
- **Mobile Viewport Problems**: Test toast positioning on small screens (avoid fixed positions that clip)
- **Rapid Click Handling**: Debounce or disable button briefly after click to prevent toast spam
- **Memory Leaks**: Always cleanup timers/intervals in component unmount lifecycle
- **Screen Reader Chaos**: Avoid aggressive `role="alert"` that interrupts every user action

## Risk Assessment

### Technical Risks

**Risk: Toast Library Selection**
- **Issue**: Choosing wrong library adds unnecessary bundle size or lacks required features
- **Likelihood**: Medium
- **Impact**: Low (can be replaced)
- **Mitigation**: Evaluate existing dependencies first; if none, prefer lightweight libraries (react-hot-toast ~3KB, sonner ~5KB) over heavy solutions

**Risk: Z-Index Conflicts**
- **Issue**: Toast renders behind modals, headers, or other overlays
- **Likelihood**: Medium
- **Impact**: Medium (feature unusable)
- **Mitigation**: Render toast in portal at document body root; use z-index value higher than any existing component (verify maximum z-index in codebase)

**Risk: Button Click Debouncing Missing**
- **Issue**: Rapid clicks create multiple overlapping toasts
- **Likelihood**: High (without explicit handling)
- **Impact**: Low (annoying but not breaking)
- **Mitigation**: Implement debounce (300ms) or temporary button disable state after click

**Risk: Animation Performance on Low-End Devices**
- **Issue**: Janky animations on older mobile devices
- **Likelihood**: Low
- **Impact**: Low (cosmetic)
- **Mitigation**: Use CSS transforms/opacity instead of position/layout properties; test on throttled CPU in DevTools

### Accessibility Risks

**Risk: Screen Reader Not Announcing Toast**
- **Issue**: User with screen reader misses notification
- **Likelihood**: High (without proper ARIA)
- **Impact**: High (accessibility failure)
- **Mitigation**: Use `role="status"` or `role="alert"` with `aria-live="polite"`; test with NVDA/JAWS/VoiceOver

**Risk: Insufficient Color Contrast**
- **Issue**: Toast text fails WCAG AA requirements (4.5:1 ratio)
- **Likelihood**: Medium
- **Impact**: High (accessibility violation)
- **Mitigation**: Use design system colors verified for contrast; run axe DevTools audit before commit

**Risk: Keyboard Navigation Broken**
- **Issue**: Button not focusable or Enter/Space don't trigger toast
- **Likelihood**: Low (if using semantic `<button>`)
- **Impact**: High (keyboard users excluded)
- **Mitigation**: Use native `<button>` element; verify focus ring visibility; test keyboard navigation flow

### User Experience Risks

**Risk: Toast Covers Important UI**
- **Issue**: Toast overlaps form fields, navigation, or CTA buttons
- **Likelihood**: Medium
- **Impact**: Medium (user frustration)
- **Mitigation**: Position toast in corner (top-right or bottom-right); ensure 16px margin from viewport edges; test on mobile viewports

**Risk: No Manual Dismiss Option**
- **Issue**: User cannot close toast early if needed
- **Likelihood**: Medium (depends on library)
- **Impact**: Low (4s auto-dismiss is short)
- **Mitigation**: Add close button (×) to toast; ensure button is keyboard accessible

**Risk: Toast Not Visible in Light/Dark Mode**
- **Issue**: Color scheme mismatch makes toast unreadable
- **Likelihood**: Medium (if theme switching exists)
- **Impact**: Medium (feature broken in one mode)
- **Mitigation**: Test in both theme modes; use theme-aware colors from design system

### Integration Risks

**Risk: Deployment Breaks Existing Tests**
- **Issue**: New component causes unrelated test failures
- **Likelihood**: Low
- **Impact**: High (blocks deployment)
- **Mitigation**: Run full test suite locally before commit; check for snapshot test failures; update snapshots if legitimate

**Risk: Framework Version Compatibility**
- **Issue**: Toast library requires newer React/Vue version than project uses
- **Likelihood**: Low
- **Impact**: High (cannot install)
- **Mitigation**: Check `peerDependencies` before installation; verify compatibility with project's framework version

**Risk: Bundle Size Increase Exceeds Budget**
- **Issue**: New library pushes bundle over performance budget
- **Likelihood**: Low (toast libraries are small)
- **Impact**: Medium (performance degradation)
- **Mitigation**: Use bundle analyzer to measure impact; consider tree-shaking; lazy-load toast component if possible

### Security Risks

**Risk: XSS via Toast Message**
- **Issue**: If toast later accepts user-generated content, unescaped HTML could execute
- **Likelihood**: Low (hardcoded message now)
- **Impact**: Critical (if exploited later)
- **Mitigation**: Always use text content, not `innerHTML`; document requirement to sanitize any future dynamic messages

**Risk: Clickjacking of Dismiss Button**
- **Issue**: Overlaid invisible element tricks user into clicking hidden action
- **Likelihood**: Very Low
- **Impact**: Low (isolated feature)
- **Mitigation**: Ensure toast has high z-index; no external scripts injecting overlays

### Monitoring & Rollback

**Observable Signals**:
- Browser console errors on button click
- Toast not appearing in staging environment
- Accessibility audit failures in CI/CD
- User reports of missing notifications

**Rollback Strategy**:
1. Remove button component from parent page
2. Delete toast implementation files
3. Revert `package.json` if new library added
4. Redeploy previous commit

**Success Metrics (post-deployment)**:
- Button click events logged (if analytics present)
- Zero console errors related to toast
- Lighthouse accessibility score unchanged or improved
- User feedback confirms toast visibility