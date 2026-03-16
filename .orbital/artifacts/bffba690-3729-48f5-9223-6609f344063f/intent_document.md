# Implement Settings Page

## Desired Outcome

Users can manage their account preferences and profile information through a fully functional Settings page that replaces the current "Coming Soon" placeholder. When complete, authenticated users access a dedicated settings interface where they can update their profile (name, email, password), configure theme preferences, manage notification settings, and view/manage connected GitHub accounts. The settings persist across sessions and immediately reflect in the application UI when changed.

## Constraints

- **Authentication Required:** All settings pages and API endpoints must be protected by existing JWT authentication. No anonymous access to settings functionality.
- **UI Framework:** Use existing React + TypeScript stack. Settings UI must follow established component patterns and styling from the current application (no new UI libraries).
- **Theme Integration:** Theme preferences already exist in Zustand state management. Settings page must read/write to existing theme store, not create parallel state.
- **API Architecture:** Follow existing backend API patterns (Express routes, parameterized queries, error handling structure established in prior orbits).
- **Security Baseline:** Password changes require current password verification. Email changes require re-authentication or confirmation flow. No plaintext password storage.
- **Data Persistence:** User settings stored in existing database (PostgreSQL/MySQL). Use existing connection pool infrastructure.
- **GitHub Integration:** Display connected GitHub accounts read-only initially. OAuth connection flow is out of scope for this orbit.
- **Performance Budget:** Settings page initial load under 500ms. Form submissions under 1 second response time.
- **Non-Goals:** Multi-factor authentication setup, API key management, billing/subscription settings, team/organization management, advanced notification routing, email verification flows for new addresses.

## Acceptance Boundaries

**Minimum Viable (Must Have):**
- Settings page replaces "Coming Soon" placeholder at `/settings` route (or equivalent)
- User Profile section displays current user name and email (read from authenticated session)
- Password change form accepts current password, new password, confirmation password with basic validation (length, match)
- Theme toggle switches between light/dark modes, persists preference to database, updates Zustand store
- Notification preferences section with at least 2 toggleable options (e.g., email notifications, system alerts)
- Connected GitHub accounts section displays placeholder text or empty state ("No connected accounts")
- Form validation provides inline error messages for invalid inputs
- Successful save operations display confirmation message
- All settings API calls authenticated (401 if no valid token)

**Target State (Should Have):**
- Settings page organized into collapsible or tabbed sections for better UX
- User profile section allows editing name and email with save button
- Password validation enforces minimum 8 characters, at least one number, one uppercase letter
- Email validation checks format and uniqueness (returns error if email already taken)
- Password change requires current password verification before allowing update
- Notification preferences include: email notifications (on/off), push notifications (on/off), activity summaries (on/off)
- Settings changes persist immediately (no need to refresh page to see updated theme/name in nav bar)
- Loading states shown during API calls (spinner or skeleton)
- Responsive design works on mobile and tablet viewports
- Settings page accessible via user menu dropdown in navigation

**Stretch (Nice to Have):**
- Email change sends confirmation to old email address before applying
- Password strength indicator during password change
- Recently updated timestamp shown for each settings section
- Notification preferences include frequency options (instant, daily digest, weekly)
- Connected GitHub accounts section shows account username and avatar if connection exists
- "Disconnect" button for GitHub accounts (soft delete, preserves history)
- Settings export/import functionality (JSON download of user preferences)
- Accessibility features (ARIA labels, keyboard navigation, screen reader support)

## Trust Tier Assignment

**Tier 2: Supervised**

**Rationale:** This orbit modifies user authentication data (password changes) and introduces new database schema for settings storage, both of which have moderate security and data integrity risks. The settings page integrates with existing authentication middleware and state management (Zustand), requiring careful coordination to avoid breaking current functionality or introducing security vulnerabilities.

Key review areas for tier 2 supervision:
1. **Password Change Flow:** Ensure current password verification prevents unauthorized password resets. Hash comparison must be secure (bcrypt, no timing attacks).
2. **Email Change Validation:** Prevent email hijacking by validating uniqueness and ownership before updating.
3. **Database Schema Changes:** Settings table migration must not conflict with existing user schema or break authentication queries.
4. **State Management Integration:** Theme preference updates must correctly sync between database, Zustand store, and UI without race conditions.
5. **API Security:** Settings endpoints must enforce authentication and validate all user inputs (no SQL injection, XSS in stored settings).

This is not tier 1 (autonomous) due to the security-sensitive nature of password changes and authentication data modification. It's not tier 3 (gated) because the patterns are standard (CRUD operations on user settings) and the blast radius is limited to individual user accounts (not system-wide infrastructure).

A mid-level engineer should review the password change logic, email validation, and database schema before deployment to production.

## Dependencies

**Prior Orbit Dependencies:**
- **Authentication System:** JWT authentication middleware must be active and functional. Settings endpoints depend on `req.user` being populated by authenticate middleware (established in prior authentication orbit).
- **Database Connection Pool:** Settings data persistence requires `backend/database/connection.js` from authentication orbit.
- **User Table Schema:** Assumes `users` table exists with `user_id`, `username`, `email`, `password_hash` columns from authentication orbit.

**Codebase Dependencies:**
- **React Application Structure:** Frontend routing, component organization, and navigation patterns must support adding `/settings` route.
- **Zustand Theme Store:** Existing theme state management. Settings page must import and use existing theme store, not create new one.
- **UI Component Library:** Existing form components, buttons, input fields, and styling patterns should be reused for consistency.
- **Backend API Infrastructure:** Express server, route registration, error handling middleware from authentication orbit.

**Database Dependencies:**
- **users Table:** Must exist with columns for storing user profile (name, email) and authentication (password_hash).
- **user_settings Table:** New table required to store theme preferences, notification settings. Schema must be designed to avoid conflicts with users table.

**External Dependencies:**
- **bcrypt Library:** Required for password change verification and hashing (already installed from authentication orbit).
- **React Router:** Frontend routing library for `/settings` page navigation.
- **Zustand:** State management library for theme preferences (already in use).

**Knowledge Dependencies:**
- **Current Theme Implementation:** How theme is stored in Zustand, what values are used (light/dark), how it's applied to UI.
- **Navigation Structure:** Where to place settings link in UI (user menu, sidebar, navigation bar).
- **Existing User Profile Display:** Current location where username/email are shown (to ensure consistency after updates).

**Cross-Orbit Coordination:**
- **No Concurrent User Schema Changes:** This orbit should not run simultaneously with other orbits modifying the `users` table structure.
- **Theme Store Contract:** Settings page must not change Zustand theme store structure if other components depend on current interface.