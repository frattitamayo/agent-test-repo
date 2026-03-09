# Greeting Button for Toast

## Desired Outcome

Users can trigger a friendly greeting toast notification by pressing a button. When activated, a non-blocking toast message appears on screen displaying "Hello and good day sir" and automatically dismisses after a standard duration. This provides immediate visual feedback for user interaction and demonstrates functional UI notification patterns in the test repository.

## Constraints

- **Visual consistency:** Toast must follow existing UI design patterns in the repository (color scheme, typography, positioning)
- **Non-blocking:** Toast must not interrupt or prevent other user interactions
- **Performance:** Button click to toast render must complete in <100ms
- **Accessibility:** Toast must be announced to screen readers; button must be keyboard-navigable with visible focus state
- **Browser compatibility:** Must function in Chrome, Firefox, Safari, and Edge (last 2 major versions)
- **No external dependencies:** Use existing toast/notification library already in the project; do not introduce new third-party packages

## Acceptance Boundaries

**Minimum viable:**
- Button renders on page and is clickable
- Toast appears with text "Hello and good day sir" on button press
- Toast auto-dismisses within 2-5 seconds
- No console errors on interaction

**Target:**
- Toast appears within 50ms of button click
- Toast positioned consistently (top-right or bottom-right)
- Toast has smooth enter/exit animations
- Button has clear label ("Show Greeting" or similar)
- Multiple rapid clicks queue toasts gracefully (show sequentially or replace)
- Accessible: ARIA live region announces toast content

**Stretch:**
- Toast includes icon (greeting/wave emoji or SVG)
- Button hover state with visual feedback
- Toast color matches positive/success theme
- Click-to-dismiss functionality on toast
- Configurable auto-dismiss duration

## Trust Tier Assignment

**Tier 1 — Informed**

**Rationale:**
- Low blast radius: Isolated UI feature with no data persistence, authentication, or business logic impact
- Fully reversible: Can be removed or modified without migrations or breaking changes
- No sensitive operations: Does not touch user data, payments, security boundaries, or critical workflows
- Observable outcome: Visual change is immediately verifiable through manual testing
- Minimal risk: Worst-case failure is a non-functional button or toast rendering issue affecting test environment only

This warrants post-deployment notification to maintain visibility, but does not require pre-deployment human approval given the contained scope and test repository context.

## Dependencies

**Internal:**
- Existing UI component library or toast/notification system in repository
- CSS/styling framework currently in use
- Event handling infrastructure (if using framework like React, Vue, etc.)

**External:**
- None (constraint specifies no new external dependencies)

**Assumptions:**
- Repository has a runnable UI environment where the button can be added
- Basic styling utilities or component primitives exist for button rendering
- Toast notification mechanism is available (either custom-built or via existing library)

**Blockers:**
- If no toast/notification system exists, must first implement or select one (recommend lightweight library like `react-hot-toast`, `notyf`, or native implementation)