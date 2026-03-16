# Verification Protocol: Implement Settings Page

## Automated Gates

### G1: Database Schema Migration Verification
**Test:** Verify database schema changes applied successfully
```sql
-- Check users table has email and name columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('email', 'name');

-- Expected output:
-- email  | varchar(255) | YES
-- name   | varchar(255) | YES

-- Check user_settings table exists with correct structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'user_settings'
ORDER BY ordinal_position;

-- Expected columns:
-- setting_id, user_id, theme_preference, email_notifications, 
-- push_notifications, activity_summaries, created_at, updated_at

-- Verify indexes created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('users', 'user_settings')
AND indexname LIKE '%email%' OR indexname LIKE '%user_settings%';
```
**Pass Criteria:** All columns exist with correct types, indexes present, triggers functional
**Intent Reference:** Data Persistence constraint, Acceptance Boundary (Minimum Viable) - settings persist to database

### G2: Backend API Authentication Enforcement
**Test:** Verify all settings endpoints require authentication
```javascript
// test/api/settings-auth.test.js
describe('Settings API Authentication', () => {
  const endpoints = [
    { method: 'GET', path: '/api/settings/profile' },
    { method: 'PUT', path: '/api/settings/profile' },
    { method: 'POST', path: '/api/settings/password' },
    { method: 'GET', path: '/api/settings/preferences' },
    { method: 'PUT', path: '/api/settings/preferences' },
    { method: 'GET', path: '/api/settings/github' }
  ];

  endpoints.forEach(({ method, path }) => {
    it(`${method} ${path} should return 401 without auth token`, async () => {
      const response = await request(app)[method.toLowerCase()](path);
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it(`${method} ${path} should return 401 with invalid token`, async () => {
      const response = await request(app)[method.toLowerCase()](path)
        .set('Authorization', 'Bearer invalid.token.here');
      expect(response.status).toBe(401);
    });
  });
});
```
**Pass Criteria:** All 12 test cases pass (6 endpoints × 2 scenarios)
**Intent Reference:** Constraint - Authentication Required, Acceptance Boundary (Minimum Viable) - All settings API calls authenticated

### G3: Password Change Security Verification
**Test:** Current password verification enforced
```javascript
describe('POST /api/settings/password', () => {
  let authToken, testUserId;

  beforeAll(async () => {
    // Create test user with known password
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('OriginalPass123!', 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['test_password_user', hash]
    );
    testUserId = result.rows[0].user_id;

    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test_password_user', password: 'OriginalPass123!' });
    authToken = loginResponse.body.token;
  });

  it('should reject password change with incorrect current password', async () => {
    const response = await request(app)
      .post('/api/settings/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        currentPassword: 'WrongPassword',
        newPassword: 'NewPass456!',
        confirmPassword: 'NewPass456!'
      })
      .expect(401);

    expect(response.body.error).toBe('INCORRECT_PASSWORD');
    expect(response.body.field).toBe('currentPassword');
  });

  it('should allow password change with correct current password', async () => {
    const response = await request(app)
      .post('/api/settings/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        currentPassword: 'OriginalPass123!',
        newPassword: 'NewPass456!',
        confirmPassword: 'NewPass456!'
      })
      .expect(200);

    expect(response.body.message).toContain('success');

    // Verify password actually changed in database
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE user_id = $1',
      [testUserId]
    );
    const newHash = userResult.rows[0].password_hash;
    const isNewPasswordValid = await bcrypt.compare('NewPass456!', newHash);
    expect(isNewPasswordValid).toBe(true);
  });

  it('should reject weak passwords', async () => {
    const weakPasswords = ['short', '12345678', 'nouppercaseornumber', 'NoNumber'];
    
    for (const weak of weakPasswords) {
      const response = await request(app)
        .post('/api/settings/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'NewPass456!',
          newPassword: weak,
          confirmPassword: weak
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('WEAK_PASSWORD');
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
  });
});
```
**Pass Criteria:** All tests pass, password change only succeeds with correct current password
**Intent Reference:** Constraint - Security Baseline (Password changes require current password verification), Acceptance Boundary (Target State) - Password change requires current password verification

### G4: Email Uniqueness Validation
**Test:** Duplicate email addresses rejected
```javascript
describe('PUT /api/settings/profile - Email Uniqueness', () => {
  let user1Token, user2Token, user1Id, user2Id;

  beforeAll(async () => {
    // Create two test users
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('TestPass123!', 10);
    
    const result1 = await pool.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      ['user1_email', hash, 'user1@example.com']
    );
    user1Id = result1.rows[0].user_id;

    const result2 = await pool.query(
      'INSERT INTO users (username, password_hash, email) VALUES ($1, $2, $3) RETURNING user_id',
      ['user2_email', hash, 'user2@example.com']
    );
    user2Id = result2.rows[0].user_id;

    // Get auth tokens
    const login1 = await request(app).post('/api/auth/login')
      .send({ username: 'user1_email', password: 'TestPass123!' });
    user1Token = login1.body.token;

    const login2 = await request(app).post('/api/auth/login')
      .send({ username: 'user2_email', password: 'TestPass123!' });
    user2Token = login2.body.token;
  });

  it('should reject email change to another user's email', async () => {
    const response = await request(app)
      .put('/api/settings/profile')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ email: 'user1@example.com' })
      .expect(400);

    expect(response.body.error).toBe('EMAIL_TAKEN');
    expect(response.body.field).toBe('email');
  });

  it('should allow email change to unused email', async () => {
    const response = await request(app)
      .put('/api/settings/profile')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ email: 'user2_new@example.com' })
      .expect(200);

    expect(response.body.email).toBe('user2_new@example.com');
  });

  it('should allow user to update to their own current email (no-op)', async () => {
    const response = await request(app)
      .put('/api/settings/profile')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ email: 'user1@example.com' })
      .expect(200);

    expect(response.body.email).toBe('user1@example.com');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE user_id IN ($1, $2)', [user1Id, user2Id]);
  });
});
```
**Pass Criteria:** All tests pass, duplicate emails rejected with 400 status
**Intent Reference:** Constraint - Email changes require validation, Acceptance Boundary (Target State) - Email validation checks uniqueness

### G5: SQL Injection Prevention
**Test:** Parameterized queries prevent injection
```javascript
describe('Settings API SQL Injection Prevention', () => {
  let authToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
  });

  it('should safely handle SQL injection attempts in name field', async () => {
    const maliciousInputs = [
      "Robert'; DROP TABLE users; --",
      "' OR '1'='1",
      "'; DELETE FROM user_settings WHERE '1'='1'; --"
    ];

    for (const malicious of maliciousInputs) {
      const response = await request(app)
        .put('/api/settings/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: malicious });

      // Should either succeed (treating as literal string) or fail validation
      // but never execute SQL injection
      expect([200, 400]).toContain(response.status);

      // Verify tables still exist
      const tableCheck = await pool.query(
        "SELECT COUNT(*) FROM users"
      );
      expect(tableCheck.rows).toBeDefined();
    }
  });

  it('should verify SQL files use parameterized queries', () => {
    const sqlFiles = [
      'backend/database/queries/settings-get-profile.sql',
      'backend/database/queries/settings-update-profile.sql',
      'backend/database/queries/settings-update-password.sql',
      'backend/database/queries/settings-get-preferences.sql',
      'backend/database/queries/settings-upsert-preferences.sql'
    ];

    sqlFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      
      // Check for parameterized placeholders ($1, $2, etc.)
      expect(content).toMatch(/$d+/);
      
      // Check for absence of string concatenation patterns
      expect(content).not.toMatch(/+s*['"`]/);
      expect(content).not.toMatch(/CONCATs*(/i);
    });
  });
});
```
**Pass Criteria:** All injection attempts handled safely, SQL files use parameterized queries
**Intent Reference:** Constraint - Security Baseline (SQL injection prevention), Constraint - API Architecture (parameterized queries)

### G6: Theme Preference Persistence
**Test:** Theme changes persist to database and sync with Zustand
```javascript
describe('Theme Preference Synchronization', () => {
  let authToken, userId;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
    userId = loginResponse.body.user.userId;
  });

  it('should persist theme preference to database', async () => {
    // Update theme to dark
    const response = await request(app)
      .put('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ theme_preference: 'dark' })
      .expect(200);

    expect(response.body.theme_preference).toBe('dark');

    // Verify persisted in database
    const dbResult = await pool.query(
      'SELECT theme_preference FROM user_settings WHERE user_id = $1',
      [userId]
    );
    expect(dbResult.rows[0].theme_preference).toBe('dark');
  });

  it('should fetch persisted theme preference', async () => {
    const response = await request(app)
      .get('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.theme_preference).toBe('dark');
  });

  it('should toggle theme back to light', async () => {
    const response = await request(app)
      .put('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ theme_preference: 'light' })
      .expect(200);

    expect(response.body.theme_preference).toBe('light');
  });
});
```
**Pass Criteria:** Theme changes persist to database and can be retrieved
**Intent Reference:** Constraint - Theme Integration (read/write existing Zustand store), Acceptance Boundary (Minimum Viable) - Theme toggle persists preference to database

### G7: Notification Preferences CRUD
**Test:** Notification toggles persist correctly
```javascript
describe('Notification Preferences', () => {
  let authToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
  });

  it('should return default preferences for new user', async () => {
    const response = await request(app)
      .get('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveProperty('email_notifications');
    expect(response.body).toHaveProperty('push_notifications');
    expect(response.body).toHaveProperty('activity_summaries');
  });

  it('should update individual notification preferences', async () => {
    const response = await request(app)
      .put('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ 
        email_notifications: false,
        push_notifications: true,
        activity_summaries: true
      })
      .expect(200);

    expect(response.body.email_notifications).toBe(false);
    expect(response.body.push_notifications).toBe(true);
    expect(response.body.activity_summaries).toBe(true);
  });

  it('should persist notification changes', async () => {
    const response = await request(app)
      .get('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.email_notifications).toBe(false);
    expect(response.body.push_notifications).toBe(true);
  });
});
```
**Pass Criteria:** All notification preference tests pass
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Notification preferences section with at least 2 toggleable options

### G8: Input Validation Tests
**Test:** Invalid inputs rejected with descriptive errors
```javascript
describe('Settings Input Validation', () => {
  let authToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
  });

  it('should reject invalid email format', async () => {
    const response = await request(app)
      .put('/api/settings/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.body.error).toBe('INVALID_INPUT');
    expect(response.body.field).toBe('email');
    expect(response.body.message).toContain('email');
  });

  it('should reject password mismatch', async () => {
    const response = await request(app)
      .post('/api/settings/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPass456!',
        confirmPassword: 'DifferentPass789!'
      })
      .expect(400);

    expect(response.body.error).toBe('PASSWORD_MISMATCH');
    expect(response.body.field).toBe('confirmPassword');
  });

  it('should reject invalid theme value', async () => {
    const response = await request(app)
      .put('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ theme_preference: 'rainbow' })
      .expect(400);

    expect(response.body.error).toBe('INVALID_INPUT');
    expect(response.body.message).toContain('light');
    expect(response.body.message).toContain('dark');
  });

  it('should reject non-boolean notification preference', async () => {
    const response = await request(app)
      .put('/api/settings/preferences')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ email_notifications: 'yes' })
      .expect(400);

    expect(response.body.error).toBe('INVALID_INPUT');
    expect(response.body.message).toContain('boolean');
  });
});
```
**Pass Criteria:** All validation tests pass with 400 status and descriptive error messages
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Form validation provides inline error messages

### G9: Performance Benchmark Tests
**Test:** API endpoints meet performance budget
```javascript
describe('Settings API Performance', () => {
  let authToken;

  beforeAll(async () => {
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
  });

  it('should load settings data in under 500ms', async () => {
    const iterations = 10;
    const latencies = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await Promise.all([
        request(app).get('/api/settings/profile')
          .set('Authorization', `Bearer ${authToken}`),
        request(app).get('/api/settings/preferences')
          .set('Authorization', `Bearer ${authToken}`),
        request(app).get('/api/settings/github')
          .set('Authorization', `Bearer ${authToken}`)
      ]);
      latencies.push(Date.now() - start);
    }

    const avgLatency = latencies.reduce((a, b) => a + b) / iterations;
    console.log(`Average settings load time: ${avgLatency}ms`);
    expect(avgLatency).toBeLessThan(500);
  });

  it('should complete profile update in under 1 second', async () => {
    const start = Date.now();
    await request(app)
      .put('/api/settings/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Performance Test' })
      .expect(200);
    const duration = Date.now() - start;

    console.log(`Profile update time: ${duration}ms`);
    expect(duration).toBeLessThan(1000);
  });

  it('should complete password change in under 1 second', async () => {
    const start = Date.now();
    await request(app)
      .post('/api/settings/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        currentPassword: 'TestPassword123!',
        newPassword: 'NewPass456!',
        confirmPassword: 'NewPass456!'
      })
      .expect(200);
    const duration = Date.now() - start;

    console.log(`Password change time: ${duration}ms (includes bcrypt)`);
    expect(duration).toBeLessThan(1000);
  });
});
```
**Pass Criteria:** All performance tests pass within budget
**Intent Reference:** Constraint - Performance Budget (Settings page initial load under 500ms, form submissions under 1 second)

### G10: TypeScript Type Safety
**Test:** Frontend types match backend responses
```typescript
// test/types/settings-api.test.ts
import { UserProfile, UserPreferences, GitHubConnection } from '@/types/settings';

describe('Settings API Type Safety', () => {
  it('should match UserProfile type to API response', async () => {
    const mockResponse = {
      user_id: 1,
      username: 'testuser',
      email: 'test@example.com',
      name: 'Test User',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z'
    };

    // TypeScript compilation should pass
    const profile: UserProfile = mockResponse;
    expect(profile.user_id).toBe(1);
  });

  it('should match UserPreferences type to API response', async () => {
    const mockResponse = {
      theme_preference: 'dark' as const,
      email_notifications: true,
      push_notifications: false,
      activity_summaries: true
    };

    const prefs: UserPreferences = mockResponse;
    expect(prefs.theme_preference).toBe('dark');
  });

  it('should reject invalid theme_preference values at compile time', () => {
    // This should fail TypeScript compilation if uncommented:
    // const invalid: UserPreferences = { theme_preference: 'rainbow', ... };
    expect(true).toBe(true); // Placeholder for type check
  });
});
```
**Pass Criteria:** TypeScript compilation succeeds, types match API contracts
**Intent Reference:** Constraint - UI Framework (Use existing React + TypeScript stack)

### G11: Frontend Route Registration
**Test:** Settings page accessible at /settings route
```typescript
// test/routes/settings-route.test.tsx
import { render, screen } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SettingsPage } from '@/pages/Settings';

describe('Settings Route', () => {
  it('should render Settings page at /settings route', () => {
    render(
      <BrowserRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    );

    expect(screen.getByText(/settings/i)).toBeInTheDocument();
  });

  it('should show authentication warning if not logged in', () => {
    // Mock unauthenticated state
    render(
      <BrowserRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    );

    // Should either redirect or show auth required message
    // (Exact behavior depends on auth implementation)
  });
});
```
**Pass Criteria:** Settings page renders at /settings route
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Settings page replaces "Coming Soon" placeholder at /settings route

## Human Verification Points

### H1: Security Review Checklist
**Reviewer Role:** Security Engineer or Senior Backend Engineer

**Steps:**

1. **Password Change Flow Review**
   - Open `backend/api/settings/password.js`
   - Verify line containing `bcrypt.compare(currentPassword, storedHash)` exists
   - Confirm this check happens BEFORE any password update query
   - Verify 401 status returned if comparison fails
   - Check that new password is hashed with `bcrypt.hash(newPassword, 10)` (minimum 10 rounds)

2. **Email Uniqueness Check**
   - Open `backend/api/settings/profile.js`
   - Find email update logic
   - Verify query to `settings-check-email-exists.sql` runs before UPDATE
   - Confirm 400 status with EMAIL_TAKEN error returned if duplicate found
   - Check UNIQUE constraint on email column in database schema

3. **SQL Injection Prevention**
   - Review all `.sql` files in `backend/database/queries/settings-*.sql`
   - Verify ALL queries use `$1, $2, $3` parameterization (PostgreSQL) or `?` (MySQL)
   - Search for string concatenation: `grep -r "+" backend/api/settings/` should find no SQL concatenation
   - Check that user input never appears in raw SQL strings

4. **Plaintext Password Prevention**
   - Search codebase for `console.log(req.body)` in settings files
   - Verify password fields excluded from logs
   - Check that API responses never include `password` or `password_hash` fields
   - Confirm error messages don't leak sensitive data (password hints, hash formats)

5. **Token Validation**
   - Verify `authenticate` middleware applied to ALL settings routes in `backend/server.js`
   - Test manually with curl: requests without Authorization header should return 401
   - Test with expired/invalid tokens: should return 401 with appropriate error

**Pass Criteria:** All 5 security areas reviewed with no critical issues found. Document any findings in Human Modifications section.

**Intent Reference:** Trust Tier (Tier 2: Supervised) - Password change logic requires review, Constraint - Security Baseline (All validation requirements)

### H2: Zustand Theme Store Integration Review
**Reviewer Role:** Frontend Engineer or Tech Lead

**Steps:**

1. **Locate Existing Zustand Theme Store**
   - Search codebase for `useThemeStore` or theme-related Zustand implementation
   - Document actual file location (e.g., `src/stores/themeStore.ts`)
   - Review current interface: `{ theme: 'light' | 'dark', setTheme: (theme) => void }`

2. **Verify Settings Page Integration**
   - Open `src/components/settings/ThemePreferences.tsx`
   - Confirm imports from correct Zustand store location
   - Verify `setTheme()` called on theme change
   - Check that theme change also POSTs to backend API

3. **Test Synchronization Pattern**
   - **Test A: Page Load Sync**
     - Clear browser local storage
     - Set theme to "dark" in database manually
     - Load settings page
     - Verify UI shows dark theme (Zustand populated from backend)
   
   - **Test B: Optimistic Update**
     - Change theme in UI
     - Verify UI updates immediately (Zustand updated first)
     - Check network tab shows POST to /api/settings/preferences
   
   - **Test C: Failure Reversion**
     - Disconnect network or mock 500 error
     - Change theme
     - Verify theme reverts to previous value after error
     - Check error message displayed to user

4. **Check Navigation Bar Updates**
   - Change theme in settings page
   - Verify navigation bar (or other themed components) updates immediately
   - Confirm no page refresh required

5. **Multi-Tab Behavior** (acceptable limitation)
   - Open settings in two browser tabs
   - Change theme in tab 1
   - Note: Tab 2 will NOT update until refresh (document this limitation)

**Pass Criteria:** Theme changes sync correctly between Zustand and database, UI updates immediately, no Zustand store structure modified
**Intent Reference:** Constraint - Theme Integration (read/write existing Zustand store), Acceptance Boundary (Target State) - Settings changes persist immediately

### H3: User Experience Flow Validation
**Reviewer Role:** Product Manager or UX Designer

**Steps:**

1. **Complete User Journey Test**
   - Log in as test user
   - Navigate to settings (verify link exists in user menu/navigation)
   - Complete all sections in order:
     - Update profile name and email
     - Change password
     - Toggle theme preference
     - Toggle notification preferences
     - View GitHub accounts section

2. **Form Validation UX**
   - **Profile Section:**
     - Try invalid email (e.g., "not-email") → expect inline error
     - Try duplicate email → expect clear error message
     - Submit valid changes → expect success confirmation
   
   - **Password Section:**
     - Try wrong current password → expect error on "current password" field
     - Try weak password → expect specific error (too short, no number, etc.)
     - Try mismatched passwords → expect error on "confirm password" field
     - Submit valid password change → expect success message and form clear

3. **Loading States**
   - Slow down network (Chrome DevTools: Network → Slow 3G)
   - Submit profile update → verify button shows "Saving..." or spinner
   - Verify button disabled during save (can't double-submit)
   - Verify success message appears after completion

4. **Error Message Quality**
   - Trigger each validation error
   - Assess if messages are:
     - Clear and actionable (not cryptic error codes)
     - Specific to the field (not generic "invalid input")
     - Helpful (suggest what to fix)
   - Check that server errors show friendly message (not stack trace)

5. **Visual Consistency**
   - Compare settings page styling to rest of application
   - Verify form inputs match existing component library
   - Check button styles consistent with other pages
   - Verify responsive layout on mobile (resize browser or use device toolbar)

6. **Accessibility Spot Check**
   - Tab through all form fields → verify logical tab order
   - Check that error messages are announced (inspect with screen reader or ARIA)
   - Verify labels associated with inputs (click label focuses input)

**Pass Criteria:** All user flows complete successfully, validation errors clear and helpful, consistent with application UX patterns
**Intent Reference:** Acceptance Boundary (Minimum Viable) - Form validation with inline errors, success messages; Acceptance Boundary (Target State) - Loading states, responsive design

### H4: Backend Code Quality Review
**Reviewer Role:** Senior Backend Engineer or Tech Lead

**Steps:**

1. **Code Organization Consistency**
   - Verify settings routes follow established patterns from auth orbit:
     - SQL queries in separate `.sql` files
     - Route handlers in `backend/api/settings/*.js`
     - Error handling consistent across all endpoints
   - Check that validation logic location is consistent (inline or dedicated module)

2. **Error Handling Completeness**
   - Review all route handlers for try-catch blocks
   - Verify database errors caught and return 500 with generic message
   - Check that validation errors return 400 with specific field information
   - Confirm no sensitive data in error responses

3. **Database Query Efficiency**
   - Review `settings-get-profile.sql` and `settings-get-preferences.sql`
   - Verify queries use indexes (WHERE user_id = $1 should use primary key)
   - Check for N+1 query problems (none expected in settings, but verify)
   - Run EXPLAIN ANALYZE on queries to confirm index usage

4. **Code Duplication**
   - Check for duplicated validation logic across files
   - Verify email validation, password validation consistent
   - Consider if validation helpers should be extracted to shared module

5. **Logging Appropriateness**
   - Review all `console.log()` statements
   - Verify success operations logged with userId (not sensitive data)
   - Check that failed attempts logged for security monitoring
   - Confirm NO passwords, tokens, or full req.body logged

6. **Server Registration**
   - Open `backend/server.js`
   - Verify all settings routes registered with `authenticate` middleware
   - Check route path consistency: `/api/settings/*`
   - Confirm routes loaded in correct order (public before protected)

**Pass Criteria:** Code follows established patterns, no security/performance red flags, appropriate logging
**Intent Reference:** Constraint - API Architecture (Follow existing backend API patterns), Trust Tier (Tier 2: Supervised) - Middleware injection points require review

### H5: Frontend Architecture Validation
**Reviewer Role:** Frontend Engineer or Tech Lead

**Steps:**

1. **Component Structure Review**
   - Verify components organized in `src/components/settings/` directory
   - Check each section is a separate component (ProfileSection, PasswordChangeForm, etc.)
   - Confirm SettingsPage composes these sections
   - Review if component hierarchy makes sense for future maintenance

2. **Custom Hook Implementation**
   - Review `src/hooks/useSettings.ts`
   - Verify hook handles loading states correctly
   - Check error state management
   - Confirm API calls use proper error handling (try-catch)
   - Verify hook uses React best practices (useEffect cleanup, dependency arrays)

3. **API Client Review**
   - Open `src/api/settings.ts`
   - Verify all endpoints match backend routes
   - Check auth headers included in all requests
   - Confirm error responses parsed and thrown correctly
   - Verify TypeScript return types match expected responses

4. **State Management**
   - Check if local component state used appropriately
   - Verify no unnecessary global state (Zustand) for form fields
   - Confirm Zustand only used for theme (as per constraint)
   - Review if optimistic updates implemented correctly

5. **TypeScript Usage**
   - Verify all components have proper TypeScript types
   - Check that `any` types are not used (or justified if necessary)
   - Confirm API response types defined in `src/types/settings.ts`
   - Verify no TypeScript errors in build

6. **Testing Coverage** (if tests exist)
   - Check if component tests cover main user flows
   - Verify custom hook tested in isolation
   - Confirm edge cases covered (loading states, errors)

**Pass Criteria:** Frontend architecture clean and maintainable, follows React best practices, TypeScript properly used
**Intent Reference:** Constraint - UI Framework (Follow established component patterns), Constraint - Theme Integration (Zustand usage)

### H6: Database Migration Safety Review
**Reviewer Role:** Database Administrator or Senior Backend Engineer

**Steps:**

1. **Migration Script Review**
   - Open `backend/database/migrations/003-add-user-settings.sql`
   - Verify uses `IF NOT EXISTS` clauses (idempotent)
   - Check that migrations are additive (no DROP statements)
   - Confirm migrations can run multiple times safely

2. **Test Migration on Staging**
   - Run migration on staging database
   - Verify no errors or warnings
   - Check that existing data not affected
   - Confirm indexes created successfully
   - Run migration again → verify idempotency (no errors on second run)

3. **Rollback Plan Verification**
   - Document rollback steps if migration needs reverting
   - For this migration:
     - Can leave tables/columns (no harm)
     - If must revert: DROP user_settings, DROP github_connections, ALTER TABLE users DROP COLUMN email, DROP COLUMN name
   - Verify rollback doesn't break existing data

4. **Index Performance Check**
   - Run EXPLAIN on queries using new indexes
   - Verify query planner uses indexes (Index Scan, not Seq Scan)
   - Check index sizes reasonable (not bloated)
   - Confirm indexes on correct columns

5. **Constraint Validation**
   - Verify UNIQUE constraint on users.email working
   - Test CHECK constraint on theme_preference (light/dark only)
   - Confirm CASCADE delete works (if user deleted, settings deleted)

6. **Production Deployment Plan**
   - Verify migration can run during off-peak hours
   - Confirm CONCURRENTLY keyword used for index creation (PostgreSQL)
   - Check migration won't lock tables for extended period
   - Document rollback steps for production

**Pass Criteria:** Migration is safe, idempotent, and performant; rollback plan documented
**Intent Reference:** Constraint - Data Persistence (settings stored in database), Risk Assessment - Missing email column migration

## Intent Traceability

### Minimum Viable Requirements (Must Have)

| Acceptance Criterion | Verification Gate(s) | Type | Status |
|---------------------|---------------------|------|--------|
| Settings page replaces "Coming Soon" placeholder at /settings route | G11: Frontend Route Registration, H5: Frontend Architecture Validation (step 1) | Automated + Human | ☐ |
| User Profile section displays current user name and email | H3: User Experience Flow Validation (step 1), Manual test of profile display | Human | ☐ |
| Password change form with validation (length, match) | G3: Password Change Security Verification (test 3: weak passwords), H3: UX Validation (step 2: password section) | Automated + Human | ☐ |
| Theme toggle switches modes, persists to database, updates Zustand | G6: Theme Preference Persistence, H2: Zustand Integration Review | Automated + Human | ☐ |
| Notification preferences section with 2+ toggleable options | G7: Notification Preferences CRUD, H3: UX Validation (step 1: notification section) | Automated + Human | ☐ |
| Connected GitHub accounts section displays placeholder/empty state | Manual test of GitHub section, H3: UX Validation (step 1: GitHub section) | Human | ☐ |
| Form validation provides inline error messages | G8: Input Validation Tests, H3: UX Validation (step 2: form validation) | Automated + Human | ☐ |
| Successful save operations display confirmation message | H3: UX Validation (step 2: success messages) | Human | ☐ |
| All settings API calls authenticated (401 if no valid token) | G2: Backend API Authentication Enforcement | Automated | ☐ |

### Target State Requirements (Should Have)

| Acceptance Criterion | Verification Gate(s) | Type | Status |
|---------------------|---------------------|------|--------|
| Settings page organized into sections for better UX | H3: UX Validation (step 1: page organization), H5: Frontend Architecture Validation (step 1: component structure) | Human | ☐ |
| User profile section allows editing name and email with save button | H3: UX Validation (step 2: profile section edit mode) | Human | ☐ |
| Password validation enforces min 8 chars, 1 number, 1 uppercase | G3: Password Change Security Verification (test 3: weak password rejection) | Automated | ☐ |
| Email validation checks format and uniqueness | G4: Email Uniqueness Validation, G8: Input Validation (invalid email format) | Automated | ☐ |
| Password change requires current password verification | G3: Password Change Security Verification (test 1: incorrect current password) | Automated | ☐ |
| Notification preferences include 3 options (email, push, activity summaries) | G7: Notification Preferences CRUD (check response has 3 fields) | Automated | ☐ |
| Settings changes persist immediately (no refresh needed) | H2: Zustand Integration Review (step 4: nav bar updates), Manual test | Human | ☐ |
| Loading states shown during API calls | H3: UX Validation (step 3: loading states) | Human | ☐ |
| Responsive design works on mobile and tablet viewports | H3: UX Validation (step 5: responsive layout) | Human | ☐ |
| Settings page accessible via user menu dropdown | H3: UX Validation (step 1: navigation link), Manual navigation test | Human | ☐ |

### Constraint Validation

| Constraint | Verification Gate(s) | Type | Status |
|-----------|---------------------|------|--------|
| Authentication Required: All endpoints protected | G2: Backend API Authentication Enforcement | Automated | ☐ |
| UI Framework: React + TypeScript, follow established patterns | G10: TypeScript Type Safety, H5: Frontend Architecture Validation | Automated + Human | ☐ |
| Theme Integration: Read/write existing Zustand store | H2: Zustand Theme Store Integration Review | Human | ☐ |
| API Architecture: Follow backend patterns (Express, parameterized queries) | H4: Backend Code Quality Review, H1: Security Review (SQL injection check) | Human | ☐ |
| Security Baseline: Password changes require current password verification | G3: Password Change Security Verification, H1: Security Review (password flow) | Automated + Human | ☐ |
| Data Persistence: Settings stored in database | G1: Database Schema Migration Verification, G6: Theme Persistence | Automated | ☐ |
| GitHub Integration: Display read-only (OAuth out of scope) | Manual test of GitHub section showing empty state or placeholder | Human | ☐ |
| Performance Budget: Page load <500ms, submissions <1s | G9: Performance Benchmark Tests | Automated | ☐ |

### Security & Risk Validation

| Risk | Verification Gate(s) | Type | Status |
|------|---------------------|------|--------|
| Password change without current password verification | G3: Password Change Security Verification (test 1), H1: Security Review (step 1) | Automated + Human | ☐ |
| Email uniqueness not enforced | G4: Email Uniqueness Validation, H1: Security Review (step 2) | Automated + Human | ☐ |
| SQL injection via user inputs | G5: SQL Injection Prevention, H1: Security Review (step 3) | Automated + Human | ☐ |
| Plaintext password in logs or responses | H1: Security Review (step 4), Code review of logging statements | Human | ☐ |
| Zustand/Database theme desync | H2: Zustand Integration Review (step 3: synchronization tests) | Human | ☐ |

## Escape Criteria

### E1: Automated Gate Failure
**Trigger:** Any automated gate (G1-G11) fails

**Severity Assessment:**

| Failed Gate(s) | Severity | Immediate Action | Re-Orbit Decision |
|---------------|----------|-----------------|-------------------|
| G1 (Database Schema) | CRITICAL | STOP deployment, verify migration script | Full re-orbit if schema conflicts detected, return to Proposal phase |
| G2 (Authentication) | CRITICAL | STOP deployment, fix middleware application | Partial re-orbit: Fix route registration, re-verify G2 |
| G3 (Password Security) | CRITICAL | STOP deployment, security vulnerability | Full re-orbit: Return to Proposal phase for password flow redesign |
| G4 (Email Uniqueness) | HIGH | Fix validation logic before human review | Targeted fix: Add uniqueness check, re-run G4 |
| G5 (SQL Injection) | CRITICAL | STOP deployment, immediate security review | Full re-orbit: Review all SQL queries, return to Implementation |
| G6 (Theme Persistence) | MEDIUM | Continue to human review | Document limitation, fix before target state acceptance |
| G7 (Notifications CRUD) | MEDIUM | Continue to human review | Minimum viable may still pass, fix for target state |
| G8 (Input Validation) | MEDIUM | Fix validation logic | Targeted fix: Improve validators, re-run G8 |
| G9 (Performance) | HIGH | Investigate performance bottleneck | If >2x budget, re-orbit for optimization |
| G10 (TypeScript) | LOW | Fix type errors | Inline fix: Correct types, recompile |
| G11 (Route Registration) | HIGH | Fix routing configuration | Targeted fix: Register route, re-verify G11 |

**Escalation Triggers:**
- 2+ CRITICAL gates fail → Full re-orbit to Proposal phase, escalate to Tech Lead
- G3 + G5 (both security) fail → Immediate security engineer review, hold deployment indefinitely
- G9 performance >2x budget → Escalate to DevOps for infrastructure assessment
- Same gate fails 3+ times → Architectural issue, escalate to Tech Lead

### E2: Human Verification Failure
**Trigger:** Human reviewer identifies critical issues in H1-H6

**Response Procedure:**

**Issue Categorization:**

| Issue Type | Severity | Action | Re-Orbit Scope |
|-----------|----------|--------|---------------|
| H1: Password flow missing current password check | CRITICAL | STOP deployment, fix immediately, full security re-review | Partial re-orbit: Fix password logic, re-verify H1 + G3 |
| H1: SQL injection possible despite parameterized queries | CRITICAL | STOP deployment, security audit all queries | Full re-orbit: Return to Implementation, re-verify H1 + G5 |
| H2: Zustand store structure changed (breaks other components) | HIGH | STOP deployment, revert changes or fix dependents | Partial re-orbit: Redesign integration, re-verify H2 |
| H2: Theme doesn't sync between Zustand and database | HIGH | Fix synchronization logic | Targeted fix: Implement proper sync, re-verify H2 |
| H3: Critical UX issues (confusing validation, broken flows) | MEDIUM | Fix UX issues, re-review H3 | Inline fixes: Improve messaging, re-verify H3 |
| H3: Settings not responsive on mobile | MEDIUM | Add responsive CSS | Targeted fix: Implement media queries, re-verify H3 |
| H4: Code quality issues (duplication, poor error handling) | MEDIUM | Refactor as needed | Inline fixes: Clean up code, re-verify H4 |
| H5: Frontend architecture doesn't follow patterns | MEDIUM | Refactor or justify deviations | Targeted refactor: Align with patterns, re-verify H5 |
| H6: Migration will lock database tables | HIGH | Revise migration (add CONCURRENTLY) | Targeted fix: Update migration script, re-test H6 |

**Re-Orbit Conditions:**

**Full Re-Orbit (return to Proposal phase):**
- Security vulnerabilities discovered in password or email logic
- Zustand integration incompatible with existing implementation
- Database schema conflicts require major redesign
- Multiple HIGH severity issues across H1-H6 (3+)

**Partial Re-Orbit (return to Implementation phase):**
- Single HIGH severity issue with clear fix path
- Performance optimization needed (refactor queries, add caching)
- Frontend architecture misaligned (restructure components)

**Targeted Re-Work (stay in Verification phase):**
- Medium severity issues with obvious fixes
- UX improvements needed (better error messages, responsive design)
- Code quality cleanup (refactoring, reducing duplication)

**Human Modifications Documentation:**
All issues must be documented in Proposal Record → Human Modifications section:

```markdown
## Human Modifications

**Review Date:** YYYY-MM-DD
**Reviewer:** [Name/Role]

### Issues Identified:
1. **H1-Security:** Password change missing bcrypt.compare check [CRITICAL]
2. **H3-UX:** Email validation error message unclear [MEDIUM]

### Resolutions:
1. Added bcrypt.compare verification before password UPDATE (line 45 of password.js)
2. Updated error message to: "Email format is invalid. Example: user@example.com"

**Re-verification Required:** G3, H1
**Sign-off:** [Reviewer name] [Date]
```

### E3: Performance Regression
**Trigger:** G9 Performance Benchmark Tests show latency exceeding budget

**Response Matrix:**

| Measured Latency | Status | Action |
|-----------------|--------|--------|
| Settings load <500ms | TARGET MET | Proceed to deployment |
| Settings load 500-750ms | MINIMUM VIABLE | Accept with documented limitation, optimization ticket created |
| Settings load 750-1000ms | PERFORMANCE ISSUE | Investigate bottleneck, targeted optimization required |
| Settings load >1000ms | CRITICAL REGRESSION | STOP deployment, immediate investigation |
| Form submit <1s | TARGET MET | Proceed to deployment |
| Form submit 1-2s | ACCEPTABLE | Document, monitor in production |
| Form submit >2s | TOO SLOW | Investigate (likely bcrypt rounds or database query issue) |

**Investigation Procedure:**

1. **Identify Bottleneck:**
   ```bash
   # Profile API endpoints
   curl -w "@curl-format.txt" -o /dev/null -H "Authorization: Bearer $TOKEN" 
     http://localhost:3000/api/settings/profile
   
   # Check database query performance
   EXPLAIN ANALYZE 
   SELECT * FROM users WHERE user_id = 1;
   
   EXPLAIN ANALYZE
   SELECT * FROM user_settings WHERE user_id = 1;
   ```

2. **Common Performance Issues & Fixes:**

   **Issue A: Multiple Sequential Database Queries**
   - **Problem:** Fetching profile, preferences, GitHub accounts sequentially
   - **Fix:** Use Promise.all() in useSettings hook or JOIN query in SQL
   
   **Issue B: Missing Database Indexes**
   - **Problem:** Sequential scan on user_settings table
   - **Fix:** Verify indexes created (G1), rebuild if corrupted
   
   **Issue C: Bcrypt Rounds Too High**
   - **Problem:** Password change takes >1s due to bcrypt computation
   - **Fix:** Verify using 10 rounds (not 12+), consider async worker if needed
   
   **Issue D: Large GitHub Accounts Result Set**
   - **Problem:** Fetching hundreds of GitHub connections
   - **Fix:** Add LIMIT to query, implement pagination

3. **Mitigation Strategies (in order of preference):**
   - **Strategy A:** Optimize queries (add indexes, use JOINs)
   - **Strategy B:** Implement caching (Redis for user preferences)
   - **Strategy C:** Lazy load sections (fetch GitHub accounts only when tab opened)
   - **Strategy D:** Database read replica for settings queries

4. **Re-verification:**
   - Apply chosen mitigation
   - Re-run G9 Performance Benchmark Tests
   - If still failing after 2 attempts, escalate to DevOps
   - Document chosen strategy in Proposal Record → Human Modifications

**Performance Regression Acceptance:**
- If minimum viable (<500ms load, <1s submit) met but target state (<300ms load) missed:
  - Accept deployment with documented limitation
  - Create follow-up optimization ticket
  - Add performance monitoring to production
  - Schedule follow-up orbit if degradation worsens

### E4: Frontend Structure Blocker
**Trigger:** Phase 0 frontend discovery reveals incompatible structure

**Critical Blockers:**

| Blocker | Severity | Response |
|---------|----------|----------|
| Zustand theme store doesn't exist | CRITICAL | Re-orbit: Update Intent (assumption was wrong), design theme persistence from scratch |
| Zustand theme store incompatible API | HIGH | Re-orbit to Proposal: Design adapter/wrapper for theme integration |
| Frontend uses different framework (Vue, Angular) | CRITICAL | STOP orbit: Intent assumes React, must rewrite entire proposal |
| No routing system (static pages) | HIGH | Re-orbit: Add routing infrastructure first, then settings page |
| Build tool incompatible with TypeScript | HIGH | Re-orbit: Configure TypeScript support or use JavaScript |
| Component library requires specific form patterns | MEDIUM | Adapt components to match library, may extend timeline |

**Discovery Validation Checklist:**
Before proceeding to frontend implementation (Phase 3), human must confirm:

- [ ] Frontend root directory location documented
- [ ] Zustand theme store found and interface matches assumptions
- [ ] React Router (or equivalent) configured
- [ ] TypeScript configuration supports path aliases (@/)
- [ ] Component styling approach identified (CSS Modules, Tailwind, etc.)
- [ ] Navigation component identified for adding settings link
- [ ] "Coming Soon" placeholder location confirmed

**If ANY checklist item fails:**
1. Document actual structure in Context Package update
2. Revise Proposal Record Phase 3 with correct paths/patterns
3. Re-estimate timeline based on integration complexity
4. Get approval for revised proposal before implementation

### E5: Database Migration Failure
**Trigger:** G1 Database Schema Migration Verification fails or migration causes errors

**Immediate Response:**

1. **Rollback Migration:**
   ```sql
   -- If migration partially applied, rollback
   DROP TABLE IF EXISTS github_connections CASCADE;
   DROP TABLE IF EXISTS user_settings CASCADE;
   ALTER TABLE users DROP COLUMN IF EXISTS email;
   ALTER TABLE users DROP COLUMN IF EXISTS name;
   
   -- Drop indexes if created
   DROP INDEX IF EXISTS idx_users_email;
   DROP INDEX IF EXISTS idx_user_settings_user_id;
   DROP INDEX IF EXISTS idx_github_connections_user_id;
   ```

2. **Investigate Failure:**
   - Check database logs for error messages
   - Verify database permissions (CREATE TABLE, ALTER TABLE)
   - Check for conflicts with existing columns/tables
   - Verify SQL syntax compatible with database version

3. **Common Migration Issues:**

   **Issue A: Email column already exists**
   - **Cause:** Previous migration or manual schema change
   - **Fix:** Update migration to use `ADD COLUMN IF NOT EXISTS` (already in migration)
   - **Verify:** Check if existing email column has UNIQUE constraint
   
   **Issue B: user_settings table name conflict**
   - **Cause:** Table exists from previous failed migration
   - **Fix:** Add `CREATE TABLE IF NOT EXISTS` (already in migration)
   - **Verify:** Check existing table structure matches new schema
   
   **Issue C: UNIQUE constraint violation on email**
   - **Cause:** Existing users have duplicate emails
   - **Fix:** Clean up duplicates before adding constraint:
     ```sql
     -- Find duplicates
     SELECT email, COUNT(*) FROM users 
     WHERE email IS NOT NULL 
     GROUP BY email HAVING COUNT(*) > 1;
     
     -- Resolve manually or set duplicates to NULL
     ```
   
   **Issue D: Index creation fails**
   - **Cause:** Insufficient disk space or memory
   - **Fix:** Use CONCURRENTLY (doesn't lock table but needs more resources)

4. **Migration Retry Procedure:**
   - Fix identified issue
   - Test migration on local/staging database first
   - Document changes in migration script comments
   - Re-run G1 verification
   - If fails again, escalate to DBA

**Rollback to Previous State:**
If migration cannot be fixed and settings implementation must be abandoned:

1. Revert all backend/frontend code changes (git revert)
2. Ensure "Coming Soon" placeholder restored
3. Document migration failure root cause
4. Create follow-up orbit to address schema conflicts before retry

### E6: Partial Acceptance
**Trigger:** Minimum Viable requirements met but Target State requirements failed

**Decision Matrix:**

| Target State Criteria Met | Decision | Action |
|---------------------------|----------|--------|
| 8-10 of 10 criteria | ACCEPT | Deploy, document remaining items as technical debt |
| 5-7 of 10 criteria | CONDITIONAL ACCEPT | Deploy with follow-up orbit scheduled (within 2 sprints) |
| 0-4 of 10 criteria | REJECT | Return to Implementation phase, target state is too incomplete |

**Partial Acceptance Documentation:**

Update Intent Document → Acceptance Boundaries section:

```markdown
## Acceptance Boundaries Status

**Minimum Viable (Must Have):** ✅ ACHIEVED (9 of 9 criteria met)

**Target State (Should Have):** ⚠️ PARTIAL (7 of 10 met)
- ✅ Settings page organized into sections
- ✅ Profile editing with save button
- ✅ Password validation (8 chars, number, uppercase)
- ✅ Email validation (format and uniqueness)
- ✅ Current password verification required
- ✅ Notification preferences (3 options)
- ✅ Settings persist immediately (Zustand sync working)
- ❌ Loading states incomplete (missing on password change) - **Technical Debt #1245**
- ❌ Responsive design not working on mobile <768px - **Technical Debt #1246**
- ✅ Settings accessible via user menu dropdown

**Stretch (Nice to Have):** ⬜ DEFERRED (0 of 8 attempted)
- Stretch goals intentionally deferred to future orbit
```

**Technical Debt Ticketing:**

For each unmet target state criterion, create ticket:

**Example: Technical Debt #1245**
```
Title: Add loading states to password change form
Priority: Medium
Description: Password change button should show "Changing..." 
            text and be disabled during API call
Acceptance: Loading state visible, button disabled, success 
            message shown after completion
Linked Orbit: T8-001 Settings Page Implementation
Timeline: Include in next sprint
```

**Approval Required:**
- Product Owner: Business acceptance of missing features
- Tech Lead: Architectural acceptance of implementation
- Security Engineer: If any security-related target state unmet

Document approval in Proposal Record → Human Modifications:

```markdown
## Partial Acceptance Approval

**Date:** YYYY-MM-DD
**Minimum Viable Status:** COMPLETE (9/9)
**Target State Status:** PARTIAL (7/10)

**Unmet Target State Items:**
1. Loading states incomplete (Technical Debt #1245)
2. Mobile responsive issues (Technical Debt #1246)

**Approval Sign-offs:**
- Product Owner: [Name] - Accepted with follow-up in Sprint N+1
- Tech Lead: [Name] - Implementation quality acceptable
- Security Engineer: [Name] - No security issues with partial state

**Follow-up Orbit:** Scheduled for Sprint N+1 (Target State completion)
```

### E7: Zustand Theme Store Conflict
**Trigger:** H2 Zustand Integration Review discovers theme store structure incompatible with database sync

**Conflict Scenarios:**

| Scenario | Severity | Response |
|----------|----------|----------|
| Zustand store uses different theme values ('light-mode', 'dark-mode' vs 'light', 'dark') | MEDIUM | Add value mapping layer in ThemePreferences component |
| Zustand store is read-only (no setTheme function) | HIGH | Add setTheme function to store OR create settings-specific store |
| Zustand persist middleware conflicts with database persistence | HIGH | Disable Zustand persistence for theme, use database as single source of truth |
| Theme store doesn't exist (assumption was wrong) | CRITICAL | Full re-orbit: Design theme system from scratch |
| Multiple components depend on old Zustand API | HIGH | Create adapter layer to maintain backward compatibility |

**Resolution Strategy:**

**Option A: Adapter Layer (Preferred)**
```typescript
// src/adapters/themeStoreAdapter.ts
import { useThemeStore } from '@/stores/themeStore';
import { updatePreferences } from '@/api/settings';

export function useThemeWithSync() {
  const { theme, setTheme: setThemeLocal } = useThemeStore();
  
  const setTheme = async (newTheme: 'light' | 'dark') => {
    // Map to database format if different
    const dbTheme = newTheme === 'light' ? 'light' : 'dark';
    
    // Optimistic update to Zustand
    setThemeLocal(newTheme);
    
    try {
      // Persist to backend
      await updatePreferences({ theme_preference: dbTheme });
    } catch (error) {
      // Revert on failure
      setThemeLocal(theme);
      throw error;
    }
  };
  
  return { theme, setTheme };
}

// ThemePreferences component uses adapter instead of direct store
```

**Option B: Zustand Store Enhancement**
```typescript
// Modify existing store to add database sync
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      
      // New: Sync theme with backend
      syncThemeWithBackend: async (theme: 'light' | 'dark') => {
        set({ theme }); // Immediate UI update
        try {
          await fetch('/api/settings/preferences', {
            method: 'PUT',
            headers: { /* auth headers */ },
            body: JSON.stringify({ theme_preference: theme })
          });
        } catch (error) {
          // Revert on failure
          const previous = get().theme;
          set({ theme: previous === 'light' ? 'dark' : 'light' });
        }
      }
    }),
    { name: 'theme-storage' }
  )
);
```

**Option C: New Settings-Specific Store (if necessary)**
```typescript
// Create separate store for settings-managed theme
export const useSettingsThemeStore = create<ThemeStore>()(
  (set) => ({
    theme: 'light',
    setTheme: async (theme) => {
      set({ theme });
      await updatePreferences({ theme_preference: theme });
    }
  })
);

// Settings page uses this store
// Other components gradually migrate or use adapter
```

**Conflict Resolution Decision Tree:**

1. Can we modify existing Zustand store without breaking other components?
   - YES → Option B (enhance existing store)
   - NO → Continue to 2

2. Is adapter layer complexity acceptable?
   - YES → Option A (create adapter)
   - NO → Continue to 3

3. Create new store and plan migration
   - Use Option C (settings-specific store)
   - Document migration plan for other components
   - Schedule follow-up orbit to complete migration

**Documentation Required:**
- Document chosen approach in Proposal Record → Human Modifications
- Update Context Package with actual Zustand store structure
- If adapter used, document adapter API for future developers
- If migration needed, create technical debt ticket with migration plan