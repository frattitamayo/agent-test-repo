# Context Package: Implement Settings Page

## Codebase References

### Critical Context Gap: Frontend Structure Unknown

The repository structure provided shows only backend files (`backend/api/properties/search.js`, `backend/database/queries/property-search.sql`). **No frontend code is visible.** This is a React + TypeScript application per the Intent, but the following critical files cannot be located:

**Missing Frontend References:**
- React application entry point (e.g., `src/index.tsx`, `app/page.tsx`)
- Routing configuration (React Router setup)
- Zustand theme store implementation
- Current "Coming Soon" placeholder location
- Navigation/header component with user menu
- Existing component patterns and styling approach
- TypeScript configuration and type definitions

**Impact:** Without frontend structure visibility, implementation plan must make assumptions about:
- File organization (pages, components, hooks directories)
- Import paths and module resolution
- Component architecture (functional components, hooks patterns)
- Styling approach (CSS modules, styled-components, Tailwind, etc.)
- State management integration points

### Backend Files from Prior Orbits

**Existing Infrastructure (from Authentication Orbit):**
- **backend/database/connection.js** — Database connection pool (PostgreSQL/MySQL). Settings queries will use this same pool via `await pool.query(sql, params)` pattern.
- **backend/middleware/authenticate.js** — JWT authentication middleware. Settings endpoints must be protected: `router.get('/settings', authenticate, handler)`.
- **backend/api/auth/login.js** — Reference pattern for password hashing with bcrypt, error handling structure, validation approach.
- **backend/database/queries/auth-*.sql** — Pattern for parameterized SQL queries stored as separate files.

**User Schema Reference:**
Based on authentication orbit patterns, `users` table likely contains:
```sql
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,  -- May need to add if missing
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Assumption:** Email column may not exist yet (authentication orbit used username for login). Settings orbit may need to add email column via migration.

### Files to Create (Backend)

- **backend/api/settings/profile.js** — User profile update endpoint (name, email)
- **backend/api/settings/password.js** — Password change endpoint with current password verification
- **backend/api/settings/preferences.js** — Theme and notification preferences CRUD
- **backend/api/settings/github-accounts.js** — Read-only endpoint for connected GitHub accounts
- **backend/database/queries/settings-get-profile.sql** — Fetch user profile data
- **backend/database/queries/settings-update-profile.sql** — Update user name/email
- **backend/database/queries/settings-update-password.sql** — Update password hash
- **backend/database/queries/settings-get-preferences.sql** — Fetch user preferences
- **backend/database/queries/settings-upsert-preferences.sql** — Insert or update preferences
- **backend/database/migrations/003-add-user-settings.sql** — Create user_settings table and add email column to users if missing

### Files to Create (Frontend - Assumed Structure)

**Assumption:** Standard React project structure. Actual paths depend on build tool (Vite, Next.js, CRA).

- **src/pages/Settings.tsx** (or `app/settings/page.tsx` for Next.js) — Main settings page component
- **src/components/settings/ProfileSection.tsx** — User profile editing form
- **src/components/settings/PasswordChangeForm.tsx** — Password change form with validation
- **src/components/settings/ThemePreferences.tsx** — Theme toggle connected to Zustand
- **src/components/settings/NotificationPreferences.tsx** — Notification toggles
- **src/components/settings/GitHubAccounts.tsx** — Read-only display of GitHub connections
- **src/hooks/useSettings.ts** — Custom hook for settings API calls
- **src/types/settings.ts** — TypeScript types for settings data structures

### Files to Modify

**Backend:**
- **backend/server.js** — Register new settings routes: `app.use('/api/settings', authenticate, settingsRouter)`

**Frontend (locations unknown):**
- **Zustand theme store** — Identify current implementation, ensure settings page can read/write theme preference
- **Navigation component** — Add settings link in user menu dropdown
- **Routing configuration** — Add `/settings` route mapping to Settings page component

## Architecture Context

### Current System Architecture (Inferred)

**Frontend Tier:**
- React + TypeScript single-page application
- Client-side routing (React Router assumed)
- Zustand for global state management (theme at minimum)
- Component-based UI architecture
- Authentication state managed via JWT tokens (stored in localStorage or cookies)

**Backend Tier:**
- Express.js REST API
- JWT authentication middleware protecting routes
- SQL database (PostgreSQL or MySQL) with connection pooling
- Parameterized queries stored as .sql files (security pattern from auth orbit)
- Error handling with consistent response format: `{ error: 'CODE', message: '...' }`

**Data Persistence:**
- User authentication data in `users` table (user_id, username, password_hash)
- User settings data in new `user_settings` table (to be created)
- Theme preference could be stored in users table or user_settings table (decision needed)

### Settings Page Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
├─────────────────────────────────────────────────────────────────┤
│  Settings Page Component                                         │
│    ├─ ProfileSection: Fetch/update name, email                  │
│    ├─ PasswordChangeForm: Submit current + new password         │
│    ├─ ThemePreferences: Read/write Zustand + DB                 │
│    ├─ NotificationPreferences: Toggle settings                  │
│    └─ GitHubAccounts: Display connected accounts (read-only)    │
│                                                                  │
│  Zustand Theme Store                                             │
│    ├─ Read: theme preference (light/dark)                       │
│    └─ Write: update theme + persist to backend                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    JWT Bearer Token in Headers
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND API                              │
├─────────────────────────────────────────────────────────────────┤
│  Authentication Middleware                                       │
│    └─ Validate JWT → set req.user                              │
│                                                                  │
│  Settings Routes (/api/settings/*)                              │
│    ├─ GET  /profile       → Return user name, email            │
│    ├─ PUT  /profile       → Update name, email (validate)      │
│    ├─ POST /password      → Verify current, update hash        │
│    ├─ GET  /preferences   → Return theme, notifications        │
│    ├─ PUT  /preferences   → Update preferences                 │
│    └─ GET  /github        → Return connected accounts          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Parameterized SQL Queries
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE                                 │
├─────────────────────────────────────────────────────────────────┤
│  users table                                                     │
│    ├─ user_id (PK)                                              │
│    ├─ username                                                   │
│    ├─ email (nullable, may need migration to add)              │
│    ├─ password_hash                                              │
│    └─ updated_at                                                 │
│                                                                  │
│  user_settings table (NEW)                                      │
│    ├─ setting_id (PK)                                           │
│    ├─ user_id (FK → users.user_id)                             │
│    ├─ theme_preference (light/dark)                             │
│    ├─ email_notifications (boolean)                             │
│    ├─ push_notifications (boolean)                              │
│    ├─ activity_summaries (boolean)                              │
│    └─ updated_at                                                 │
│                                                                  │
│  github_connections table (FUTURE - read placeholder for now)   │
│    └─ Returns empty array or mock data                          │
└─────────────────────────────────────────────────────────────────┘
```

### Theme Synchronization Challenge

**Problem:** Theme preference exists in Zustand (frontend state) and must now persist to database. Two sources of truth must stay synchronized.

**Synchronization Pattern:**
1. **Initial Load:** Settings page fetches preferences from backend → updates Zustand store
2. **User Changes Theme:** 
   - Update Zustand immediately (instant UI feedback)
   - POST to backend to persist
   - On success: no-op (already updated)
   - On failure: revert Zustand to previous value
3. **Concurrent Tab Issue:** If user has multiple tabs open, theme change in one tab won't auto-update others (acceptable limitation for MVP)

**Implementation Decision:**
- Store theme in `user_settings` table (not `users` table) to keep authentication data separate
- On login, fetch preferences and populate Zustand
- Settings page becomes single point for modifying theme (don't allow theme toggle elsewhere until sync pattern established)

### Password Change Security Flow

```
1. User submits: { currentPassword, newPassword, confirmPassword }
2. Backend receives authenticated request (req.user.userId set)
3. Fetch password_hash for req.user.userId from database
4. bcrypt.compare(currentPassword, stored_hash)
   └─ If false: return 401 "Current password incorrect"
5. Validate newPassword requirements (length, complexity)
6. Validate newPassword === confirmPassword
7. hash = await bcrypt.hash(newPassword, 10)
8. UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2
9. Return 200 "Password updated successfully"
```

**Security Considerations:**
- Current password verification prevents unauthorized changes even if token stolen
- Bcrypt comparison timing-safe (no username enumeration risk)
- No password in response body or logs
- Rate limiting inherited from auth middleware (if implemented)

## Pattern Library

### Backend API Patterns (from Auth Orbit)

**Route Structure:**
```javascript
// backend/api/settings/profile.js
const express = require('express');
const router = express.Router();
const pool = require('../../database/connection');
const fs = require('fs');
const path = require('path');

// Load SQL queries
const getProfileQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-get-profile.sql'),
  'utf8'
);

// GET /api/settings/profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(getProfileQuery, [req.user.userId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to fetch profile' });
  }
});

module.exports = router;
```

**Error Response Format:**
```javascript
// Validation errors: 400
res.status(400).json({
  error: 'INVALID_INPUT',
  message: 'Email format is invalid',
  field: 'email'  // Field-level errors for target state
});

// Authentication errors: 401
res.status(401).json({
  error: 'UNAUTHORIZED',
  message: 'Current password is incorrect'
});

// Server errors: 500
res.status(500).json({
  error: 'SERVER_ERROR',
  message: 'Settings update failed'
});
```

**Validation Pattern:**
```javascript
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    throw { error: 'INVALID_INPUT', message: 'Email is required', field: 'email' };
  }
  const emailRegex = /^[^s@]+@[^s@]+.[^s@]+$/;
  if (!emailRegex.test(email)) {
    throw { error: 'INVALID_INPUT', message: 'Invalid email format', field: 'email' };
  }
  return email.trim().toLowerCase();
}

// Usage in route handler:
try {
  const validatedEmail = validateEmail(req.body.email);
  // Proceed with database update
} catch (validationError) {
  return res.status(400).json(validationError);
}
```

### Frontend Patterns (Assumed - React Best Practices)

**Component Structure:**
```typescript
// src/components/settings/ProfileSection.tsx
import React, { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';

export const ProfileSection: React.FC = () => {
  const { profile, updateProfile, loading, error } = useSettings();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setEmail(profile.email || '');
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfile({ name, email });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
};
```

**Custom Hook Pattern:**
```typescript
// src/hooks/useSettings.ts
import { useState, useEffect } from 'react';
import { getProfile, updateProfile as apiUpdateProfile } from '@/api/settings';

export const useSettings = () => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const data = await getProfile();
      setProfile(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await apiUpdateProfile(updates);
      setProfile(updated);
      return updated;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { profile, updateProfile, loading, error };
};
```

**Zustand Store Integration (Theme):**
```typescript
// Assumed existing theme store location: src/stores/themeStore.ts
import create from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeStore {
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

// Current implementation (to be enhanced with backend sync):
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'theme-storage' }
  )
);

// Settings page will need to:
// 1. Import useThemeStore
// 2. Call setTheme to update Zustand
// 3. Also POST to backend to persist
```

### Database Schema Patterns

**Migration File Structure:**
```sql
-- backend/database/migrations/003-add-user-settings.sql

-- Add email column to users table if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Create user_settings table
CREATE TABLE IF NOT EXISTS user_settings (
  setting_id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  theme_preference VARCHAR(20) DEFAULT 'light',
  email_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT false,
  activity_summaries BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
```

**Query File Pattern:**
```sql
-- backend/database/queries/settings-get-profile.sql
SELECT 
  user_id,
  username,
  email,
  name,
  created_at,
  updated_at
FROM users
WHERE user_id = $1;
```

```sql
-- backend/database/queries/settings-upsert-preferences.sql
INSERT INTO user_settings (user_id, theme_preference, email_notifications, push_notifications, activity_summaries)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id) 
DO UPDATE SET
  theme_preference = EXCLUDED.theme_preference,
  email_notifications = EXCLUDED.email_notifications,
  push_notifications = EXCLUDED.push_notifications,
  activity_summaries = EXCLUDED.activity_summaries,
  updated_at = CURRENT_TIMESTAMP
RETURNING *;
```

### Naming Conventions

**Backend:**
- API routes: `backend/api/{feature}/{action}.js` (e.g., `settings/profile.js`)
- SQL queries: `{feature}-{action}-{entity}.sql` (e.g., `settings-update-profile.sql`)
- Migration files: `{number}-{description}.sql` (e.g., `003-add-user-settings.sql`)
- Route paths: `/api/{feature}/{resource}` (e.g., `/api/settings/profile`)

**Frontend (assumed):**
- Pages: `src/pages/{PageName}.tsx` (e.g., `Settings.tsx`)
- Components: `src/components/{feature}/{ComponentName}.tsx` (e.g., `settings/ProfileSection.tsx`)
- Hooks: `src/hooks/use{Feature}.ts` (e.g., `useSettings.ts`)
- Types: `src/types/{feature}.ts` (e.g., `settings.ts`)

## Prior Orbit References

### Authentication System Orbit (Complete)

**Artifacts:** `.orbital/artifacts/bffba690-3729-48f5-9223-6609f344063f/`

**Established Patterns Relevant to Settings:**

1. **Password Hashing with bcrypt:**
   - Used in `backend/api/auth/login.js` for password verification
   - Settings password change must use same `bcrypt.compare()` for current password verification
   - Use `bcrypt.hash(newPassword, 10)` for new password storage
   - Async operations: `await bcrypt.compare()` and `await bcrypt.hash()`

2. **JWT Authentication Middleware:**
   - `backend/middleware/authenticate.js` validates tokens
   - Settings endpoints must apply middleware: `router.get('/settings', authenticate, handler)`
   - `req.user` populated with `{ userId, username }` after authentication
   - All settings operations scoped to `req.user.userId`

3. **Error Handling Consistency:**
   - 400 for validation errors with `{ error: 'CODE', message: '...', field: '...' }`
   - 401 for authentication failures
   - 500 for server errors (generic message, detailed logging)
   - Pattern established in `backend/api/auth/login.js`

4. **Database Connection Pool:**
   - `backend/database/connection.js` exports pool
   - Max 20 concurrent connections
   - Query pattern: `await pool.query(sqlString, [param1, param2])`
   - Settings queries will share this pool

5. **SQL Query Organization:**
   - Queries stored as separate .sql files in `backend/database/queries/`
   - Loaded via `fs.readFileSync(path.join(__dirname, '../../database/queries/...'))`
   - Parameterized queries only ($1, $2, etc.) for SQL injection prevention

6. **Users Table Schema:**
   ```sql
   CREATE TABLE users (
     user_id SERIAL PRIMARY KEY,
     username VARCHAR(50) UNIQUE NOT NULL,
     password_hash VARCHAR(255) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     last_login TIMESTAMP,
     login_attempts INTEGER DEFAULT 0,
     locked_until TIMESTAMP
   );
   ```
   **Note:** `email` and `name` columns likely missing, need migration to add.

### Property Search Filtering Orbit (Proposal Only)

**Artifacts:** `.orbital/artifacts/ffce316e-4d4e-46c6-bb4f-c5310e36a19f/`

**Status:** Incomplete (intent, context, proposal exist but no verification protocol)

**Relevant Patterns (if implemented):**
- Validation helper functions for input sanitization
- Query parameter parsing from `req.query`
- Inline validation vs dedicated validation module decision
- Performance considerations for database queries

**Lessons Learned (speculative):**
- Orbit may have stalled due to missing database schema information
- Importance of verifying actual column names before implementation
- Need for comprehensive test coverage (proposal mentioned but verification missing)

### Other Prior Orbit

**Artifacts:** `.orbital/artifacts/93d08324-efe3-4d8d-bbfd-abe2bed1568c/`

**Status:** Early orbit (only intent and orbit log, predates full artifact structure)

**Relevance:** None directly applicable to settings implementation.

## Risk Assessment

### High-Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Password Change Without Current Password Verification** | CRITICAL — Unauthorized password changes via stolen token | HIGH — Easy to forget verification step | Enforce bcrypt.compare(currentPassword, storedHash) before allowing update. Code review must verify this step present. Add integration test that fails password change with wrong current password. |
| **Email Uniqueness Not Validated** | HIGH — User can hijack another user's email | MEDIUM — May assume uniqueness constraint sufficient | Check email uniqueness in application code before UPDATE. Handle UNIQUE constraint violation gracefully. Return 400 "Email already in use" error. |
| **Zustand Store Out of Sync with Database** | MEDIUM — Theme appears changed but not persisted, or vice versa | HIGH — Race conditions between frontend state and backend | Update Zustand immediately (optimistic), POST to backend, revert on failure. On settings page load, fetch from backend and override Zustand. Document sync pattern for future features. |
| **Missing Email Column in Users Table** | HIGH — Settings page crashes on load | MEDIUM — Auth orbit may not have included email | Run migration to add email column before deploying settings code. Test with actual database schema, not assumptions. Add email column as nullable initially, make required later if needed. |
| **SQL Injection via Settings Input** | CRITICAL — Database compromise | LOW — Parameterized queries should prevent | Use parameterized queries exclusively. Never concatenate user input into SQL. Code review all .sql files. Add SQL injection test cases. |
| **Plaintext Password in Logs or Responses** | CRITICAL — Credential exposure | MEDIUM — Easy to accidentally log req.body | Never log password fields. Explicitly exclude password from response objects. Review all console.log and error messages. |

### Medium-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Settings Page Load Performance >500ms** | User perceives sluggishness | Optimize queries (use indexes on user_id). Fetch profile and preferences in parallel. Lazy load GitHub accounts section. Monitor P95 latency. |
| **No Loading State During API Calls** | Poor UX, multiple form submissions | Implement loading state (disabled submit button, spinner). Debounce rapid submissions. Show success/error messages. |
| **Password Strength Not Enforced** | Weak passwords allowed | Target state validation: min 8 chars, 1 number, 1 uppercase. Add password strength indicator (stretch goal). Consider rejecting common passwords. |
| **Theme Change Doesn't Update Nav Bar Without Refresh** | Inconsistent UI state | Zustand store should trigger re-render of nav component. Test theme toggle updates all themed components immediately. |
| **Connected GitHub Accounts Section Breaks If No Data** | UI crashes or shows error | Return empty array from endpoint. Handle empty state gracefully ("No connected accounts"). Add PropTypes or TypeScript validation. |
| **Email Change Without Confirmation** | Account takeover risk | Minimum viable: validate email format and uniqueness. Target state: send confirmation to old email before applying. Stretch: implement confirmation token flow. |

### Low-Priority Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Settings Not Responsive on Mobile** | Poor mobile UX | Use responsive CSS (flexbox, grid). Test on mobile viewport. Target state requirement includes mobile responsiveness. |
| **No Validation Error on Empty Profile Fields** | User can save blank name | Validate required fields. Trim whitespace. Provide inline error messages. |
| **Notification Preferences Not Affecting Actual Notifications** | User confusion (toggles don't do anything) | Document that notification preferences are UI-only for now. Implement actual notification logic in future orbit. |
| **TypeScript Type Mismatches** | Runtime errors, build failures | Define settings types explicitly. Use API response types. Validate with TypeScript strict mode. |

### Security Edge Cases

| Scenario | Risk | Mitigation |
|----------|------|------------|
| User changes email to admin's email | Email hijacking | Validate email uniqueness before update. Check UNIQUE constraint. |
| Stolen JWT token used to change password | Unauthorized access | Require current password verification (token alone insufficient). |
| XSS via malicious name/email stored in database | Script injection in UI | Sanitize inputs on backend. Escape outputs in frontend (React does this by default). |
| SQL injection via name field | Database compromise | Use parameterized queries. Never concatenate user input. |
| CSRF attack on settings endpoints | Unauthorized settings changes | CSRF protection inherited from auth middleware (if implemented). SameSite cookies. |
| Timing attack on current password verification | Password enumeration | Use bcrypt.compare (constant-time). Don't reveal whether user exists vs wrong password. |

### Performance Concerns

| Concern | Impact | Mitigation |
|---------|--------|------------|
| Multiple database queries on settings page load | Slow initial render | Use JOIN to fetch profile + preferences in single query. Or fetch in parallel with Promise.all(). |
| Theme change triggers full page re-render | Janky UI | Zustand should only re-render components that subscribe to theme. Optimize with React.memo if needed. |
| Password hash computation blocks event loop | API response slow | bcrypt.hash is already async (10 rounds ~100ms). Don't use hashSync. Monitor P95 latency. |
| GitHub accounts query slow (future) | Settings page load delay | Lazy load GitHub section (fetch after initial render). Show skeleton loader. |

### Data Integrity Risks

| Risk | Mitigation |
|------|------------|
| Concurrent updates from multiple tabs | Optimistic locking or last-write-wins (acceptable for settings). Display "Settings may be out of date" if updated_at changed. |
| Partial update failure (profile saved but preferences failed) | Use database transactions for atomic updates. Or handle partial failures gracefully with detailed error messages. |
| user_settings row not created on signup | Create default settings row on user registration (in auth orbit follow-up). Or use UPSERT in settings endpoint (INSERT ON CONFLICT). |
| Theme preference in Zustand conflicts with database | On settings page mount, fetch from database and override Zustand. Database is source of truth. |

### Frontend-Specific Risks (Assumed React Patterns)

| Risk | Mitigation |
|------|------------|
| Memory leak from useEffect without cleanup | Return cleanup function from useEffect. Cancel pending requests on unmount. |
| State update on unmounted component | Check isMounted flag or use AbortController. Suppress warnings with proper cleanup. |
| Uncontrolled form inputs | Use controlled components (value + onChange). Manage form state in React state or form library. |
| Missing error boundaries | Wrap settings sections in error boundaries to prevent full page crash. |
| Accessibility violations | Add ARIA labels (target state). Test with keyboard navigation. Use semantic HTML. |

### Monitoring & Observability Needs

**Metrics to Track:**
- Settings page load time (P50, P95, P99)
- Profile update success/failure rate
- Password change attempt rate and success rate
- Theme preference distribution (light vs dark users)
- Email change frequency
- API error rates by endpoint

**Logging Strategy:**
```javascript
// On successful settings update:
console.log('Settings updated:', {
  userId: req.user.userId,
  section: 'profile', // or 'password', 'preferences'
  fields: ['name', 'email'], // what changed
  timestamp: new Date().toISOString()
});

// On validation error:
console.warn('Settings validation failed:', {
  userId: req.user.userId,
  error: validationError.error,
  field: validationError.field
});

// Never log: passwords, full req.body, sensitive user data
```

**Alerting Thresholds:**
- Password change failure rate >10% → investigate bcrypt issues or attempted attacks
- Settings page load time P95 >500ms → performance regression
- Profile update error rate >5% → database or validation issues
- Theme preference API errors >1% → Zustand sync problem