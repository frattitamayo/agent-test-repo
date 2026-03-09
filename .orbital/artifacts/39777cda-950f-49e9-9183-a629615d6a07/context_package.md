# Context Package: Greeting Button for Toast

**Generated:** 2025-02-17
**Package Type:** intent-specific
**Intent:** Greeting button for toast
**Orbit:** 1

---

## Codebase References

### Primary (will be modified or created)

- `src/components/GreetingButton.jsx` (or `.tsx`, `.vue` depending on framework)
- `src/components/GreetingButton.test.js`
- `src/pages/TestPage.jsx` (or equivalent page where button will be mounted)
- `src/styles/components/greeting-button.css` (if separate styling)

### Secondary (dependencies and interfaces)

- `src/components/Toast/` or `src/utils/toast.js` — existing toast/notification system
- `src/styles/globals.css` or `src/styles/theme.css` — global styling variables
- `src/utils/accessibility.js` — ARIA utilities if available
- `package.json` — verify existing toast library dependencies

### Tests

- `src/components/__tests__/` — existing component test patterns
- `src/setupTests.js` or test configuration files

---

## Architecture Context

This intent introduces an isolated UI interaction component in the presentation layer. The button component will be a self-contained module that integrates with the existing toast notification system.

**Data Flow:**
1. User clicks button → event handler triggered
2. Handler calls toast utility/service → toast queued
3. Toast manager renders notification → DOM updated
4. Auto-dismiss timer → toast removed from DOM

**Integration Points:**
- **UI Component Layer:** Button registers in component tree
- **Notification System:** Calls existing toast API (likely centralized service or context provider)
- **Accessibility Layer:** Button must emit ARIA events; toast must use live region

**Technology Stack Assumptions:**
- Frontend framework: React, Vue, or vanilla JavaScript
- State management: Framework-native (hooks, reactive data, or DOM manipulation)
- Styling: CSS modules, styled-components, or global CSS
- Testing: Jest + React Testing Library or equivalent

---

## Pattern Library

### Conventions (follow these)

- **Component Structure**: If React-based, see `src/components/Button/` or similar — functional components with hooks, props interface, test co-location
- **Toast Invocation**: Check `src/utils/toast.js` or existing notification component for API pattern (e.g., `toast.success("message")`, `showNotification({...})`)
- **Event Handlers**: Use descriptive handler names like `handleGreetingClick` or `onGreetingButtonClick`
- **Accessibility**: Follow established pattern for keyboard navigation (see `src/components/AccessibleButton.jsx` if exists) — must include `aria-label`, `role` if non-semantic element, visible focus states
- **Testing**: Table-driven or scenario-based tests (see existing component tests in `src/components/__tests__/`) — test rendering, click behavior, accessibility tree
- **Styling**: Check if project uses CSS modules (`.module.css`), styled-components, or global classes — maintain consistency

### Anti-patterns (avoid these)

- **Inline toast implementation**: Do not build custom toast logic if existing system is available — use established notification infrastructure
- **Blocking modals**: Do not use `alert()` or blocking dialogs — toast must be non-blocking per constraint
- **Tight coupling**: Button should not directly manipulate DOM for toast rendering — delegate to toast service/utility
- **Hardcoded timing**: Avoid magic numbers for animation/dismiss durations — use theme constants or configurable props
- **Missing cleanup**: If using timers for animations, ensure proper cleanup in component unmount

---

## Prior Orbit References

### Completed

- None — this is Orbit 1, initial implementation in the test repository

### Known Issues

- None currently tracked for this surface
- If toast system is not yet implemented in the test repo, this must be confirmed before starting (blocker noted in intent dependencies)

---

## Risk Assessment

### Risk: Toast system does not exist

**Likelihood:** Medium  
**Impact:** High (blocks implementation)  
**Mitigation:** Before starting, scan codebase for existing toast/notification utilities. If absent, select lightweight library (`react-hot-toast`, `sonner`, or vanilla implementation). Document choice for future intents.

### Risk: Multiple rapid clicks overwhelm UI

**Likelihood:** Medium  
**Impact:** Low (poor UX, not breaking)  
**Mitigation:** Implement either toast queuing (show sequentially) or replace-on-new (cancel previous, show latest). Document chosen behavior for consistency.

### Risk: Accessibility violations

**Likelihood:** Low (explicitly constrained)  
**Impact:** Medium (excludes users)  
**Mitigation:** Use semantic `<button>` element, add `aria-live="polite"` to toast container, verify with screen reader. Include accessibility tests.

### Risk: Performance regression on slower devices

**Likelihood:** Low  
**Impact:** Low  
**Mitigation:** Test button click to toast render timing. Avoid heavy animations. Keep toast component lightweight (< 5KB bundle impact).

### Risk: Browser compatibility issues

**Likelihood:** Low  
**Impact:** Medium  
**Mitigation:** Test in Chrome, Firefox, Safari, Edge. Avoid cutting-edge CSS features (e.g., container queries) without fallbacks. Verify polyfills for older browser versions if target includes IE11.

### Risk: Styling conflicts with existing components

**Likelihood:** Medium  
**Impact:** Low  
**Mitigation:** Namespace CSS classes or use CSS modules. Verify toast doesn't overlap critical UI elements. Use z-index appropriately.

---

## Constraints

### Build (must pass)

- `npm test` or equivalent test command
- `npm run lint` (if linter configured)
- `npm run build` (verify no bundle errors)

### Guardrails (do not violate)

- **No new external dependencies** — use existing toast library or build minimal implementation
- **Performance budget** — button click to toast render < 100ms (target 50ms)
- **Accessibility requirements** — button must be keyboard-navigable, toast must announce to screen readers
- **Non-blocking constraint** — toast must not prevent other interactions (no modals, no focus traps)