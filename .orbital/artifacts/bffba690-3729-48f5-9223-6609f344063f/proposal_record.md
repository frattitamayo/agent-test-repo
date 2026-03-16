# Proposal Record: Implement Settings Page

## Interpreted Intent

This orbit replaces the placeholder "Coming Soon" settings page with a fully functional user settings interface for the Prometheus V1 application. The implementation provides authenticated users with self-service management of their account profile (name, email, password), application preferences (theme via existing Zustand store, notification toggles), and visibility into connected GitHub accounts.

The core requirements are:

1. **User Profile Management** — Display and edit user name and email with backend persistence. Password change flow requires current password verification for security.

2. **Theme Preference Integration** — Sync existing Zustand theme state with database storage. Theme changes must update both Zustand (immediate UI feedback) and backend (persistence across sessions).

3. **Notification Preferences** — Boolean toggles for email notifications, push notifications, and activity summaries. These settings are UI-only for MVP (actual notification logic deferred to future orbit).

4. **GitHub Accounts Display** — Read-only section showing connected GitHub accounts or empty state. OAuth connection flow is explicitly out of scope.

5. **Security & Validation** — All endpoints protected by JWT authentication. Password changes require current password verification. Email changes validate uniqueness. Input validation with inline error messages.

6. **Performance** — Settings page loads in under 500ms, form submissions complete within 1 second.

Success is measured across three tiers: minimum viable (basic CRUD with validation), target state (enhanced UX with sections, mobile responsive, immediate UI updates), and stretch goals (email confirmation, password strength indicator, accessibility features).

**Critical Context Gap:** The repository structure shows only backend files. Frontend structure, Zustand theme store implementation, routing configuration, and styling patterns are unknown. Implementation plan must make reasonable assumptions about React project organization and defer to human review for verification.

## Implementation Plan

### Phase 0: Frontend Discovery & Verification (Human-Required)

**BLOCKER:** Repository structure visibility is limited to backend files. Before implementation can proceed, the following must be verified by human review:

**Required Information:**
1. **Frontend Root Location** — Is this `src/`, `app/`, `client/`, or other?
2. **Build Tool** — Vite, Next.js, Create React App, or custom webpack?
3. **Zustand Theme Store** — Current implementation location and interface (e.g., `useThemeStore()` signature)
4. **Current "Coming Soon" Placeholder** — File path and component name to replace
5. **Routing Setup** — React Router configuration location, how to add `/settings` route
6. **Component Styling** — CSS Modules, styled-components, Tailwind, plain CSS, or other?
7. **Navigation Component** — Where to add settings link (user menu dropdown location)
8. **TypeScript Config** — Path aliases configuration (e.g., `@/` for absolute imports)

**Action:** Human reviewer must provide frontend project structure overview or grant repository access to inspect these files directly.

**Assumption for Proposal:** Standard React + Vite + TypeScript project structure with `src/` root directory and Zustand theme store at `src/stores/themeStore.ts`.

### Phase 1: Database Schema Migration

**1.1 Create Migration File**

Create `backend/database/migrations/003-add-user-settings.sql`:

```sql
-- Migration: Add user settings tables and extend users table
-- Orbit: T8-001 Implement Settings Page

-- Step 1: Extend users table with profile fields
-- Add email and name columns if they don't exist (authentication orbit may have used only username)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Add indexes for email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Step 2: Create user_settings table for preferences
CREATE TABLE IF NOT EXISTS user_settings (
  setting_id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  
  -- Theme preference (syncs with Zustand store)
  theme_preference VARCHAR(20) DEFAULT 'light' CHECK (theme_preference IN ('light', 'dark')),
  
  -- Notification toggles (UI-only for MVP)
  email_notifications BOOLEAN DEFAULT true,
  push_notifications BOOLEAN DEFAULT false,
  activity_summaries BOOLEAN DEFAULT false,
  
  -- Audit timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast user settings lookup
CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- Step 3: Create github_connections table (placeholder for future OAuth)
-- For MVP, this returns empty array or mock data
CREATE TABLE IF NOT EXISTS github_connections (
  connection_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  github_username VARCHAR(255),
  github_user_id VARCHAR(255),
  avatar_url TEXT,
  connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_github_connections_user_id ON github_connections(user_id);

-- Step 4: Update function for automatic updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to user_settings table
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**1.2 Run Migration**

```bash
# PostgreSQL
psql -U $DB_USER -d $DB_NAME -f backend/database/migrations/003-add-user-settings.sql

# MySQL (if using MySQL instead, convert to MySQL syntax)
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < backend/database/migrations/003-add-user-settings.sql
```

**Verification:**
```sql
-- Verify users table has new columns
d users

-- Verify user_settings table created
SELECT * FROM user_settings LIMIT 1;

-- Verify indexes created
SELECT schemaname, tablename, indexname FROM pg_indexes 
WHERE tablename IN ('users', 'user_settings', 'github_connections');
```

### Phase 2: Backend API Implementation

**2.1 Create SQL Query Files**

**backend/database/queries/settings-get-profile.sql**
```sql
-- Fetch user profile data
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

**backend/database/queries/settings-update-profile.sql**
```sql
-- Update user profile (name and/or email)
UPDATE users
SET 
  name = COALESCE($2, name),
  email = COALESCE($3, email)
WHERE user_id = $1
RETURNING user_id, username, email, name, updated_at;
```

**backend/database/queries/settings-check-email-exists.sql**
```sql
-- Check if email already exists for another user
SELECT user_id 
FROM users 
WHERE email = $1 AND user_id != $2;
```

**backend/database/queries/settings-get-password-hash.sql**
```sql
-- Fetch password hash for verification (password change flow)
SELECT password_hash
FROM users
WHERE user_id = $1;
```

**backend/database/queries/settings-update-password.sql**
```sql
-- Update password hash after verification
UPDATE users
SET password_hash = $1
WHERE user_id = $2
RETURNING user_id, updated_at;
```

**backend/database/queries/settings-get-preferences.sql**
```sql
-- Fetch user preferences (theme + notifications)
SELECT 
  theme_preference,
  email_notifications,
  push_notifications,
  activity_summaries,
  updated_at
FROM user_settings
WHERE user_id = $1;
```

**backend/database/queries/settings-upsert-preferences.sql**
```sql
-- Insert or update user preferences (UPSERT pattern)
INSERT INTO user_settings (
  user_id, 
  theme_preference, 
  email_notifications, 
  push_notifications, 
  activity_summaries
)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id) 
DO UPDATE SET
  theme_preference = EXCLUDED.theme_preference,
  email_notifications = EXCLUDED.email_notifications,
  push_notifications = EXCLUDED.push_notifications,
  activity_summaries = EXCLUDED.activity_summaries
RETURNING *;
```

**backend/database/queries/settings-get-github-accounts.sql**
```sql
-- Fetch connected GitHub accounts (placeholder returns empty for MVP)
SELECT 
  connection_id,
  github_username,
  github_user_id,
  avatar_url,
  connected_at,
  last_synced,
  is_active
FROM github_connections
WHERE user_id = $1 AND is_active = true
ORDER BY connected_at DESC;
```

**2.2 Create Settings API Routes**

**backend/api/settings/profile.js**
```javascript
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
const updateProfileQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-update-profile.sql'),
  'utf8'
);
const checkEmailQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-check-email-exists.sql'),
  'utf8'
);

// Validation helpers
function validateEmail(email) {
  if (!email) return null; // Optional field
  if (typeof email !== 'string') {
    throw { error: 'INVALID_INPUT', message: 'Email must be a string', field: 'email' };
  }
  const emailRegex = /^[^s@]+@[^s@]+.[^s@]+$/;
  if (!emailRegex.test(email)) {
    throw { error: 'INVALID_INPUT', message: 'Invalid email format', field: 'email' };
  }
  return email.trim().toLowerCase();
}

function validateName(name) {
  if (!name) return null; // Optional field
  if (typeof name !== 'string') {
    throw { error: 'INVALID_INPUT', message: 'Name must be a string', field: 'name' };
  }
  const trimmed = name.trim();
  if (trimmed.length > 255) {
    throw { error: 'INVALID_INPUT', message: 'Name too long (max 255 characters)', field: 'name' };
  }
  return trimmed;
}

// GET /api/settings/profile
router.get('/profile', async (req, res) => {
  try {
    const result = await pool.query(getProfileQuery, [req.user.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'User profile not found'
      });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch profile'
    });
  }
});

// PUT /api/settings/profile
router.put('/profile', async (req, res) => {
  try {
    const { name, email } = req.body;
    
    // Validate inputs
    let validatedName, validatedEmail;
    try {
      validatedName = validateName(name);
      validatedEmail = validateEmail(email);
    } catch (validationError) {
      return res.status(400).json(validationError);
    }
    
    // If email provided, check uniqueness
    if (validatedEmail) {
      const existingResult = await pool.query(checkEmailQuery, [validatedEmail, req.user.userId]);
      if (existingResult.rows.length > 0) {
        return res.status(400).json({
          error: 'EMAIL_TAKEN',
          message: 'Email address is already in use',
          field: 'email'
        });
      }
    }
    
    // Update profile
    const result = await pool.query(updateProfileQuery, [
      req.user.userId,
      validatedName,
      validatedEmail
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'User not found'
      });
    }
    
    console.log('Profile updated:', {
      userId: req.user.userId,
      fields: { name: !!validatedName, email: !!validatedEmail },
      timestamp: new Date().toISOString()
    });
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to update profile'
    });
  }
});

module.exports = router;
```

**backend/api/settings/password.js**
```javascript
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../../database/connection');
const fs = require('fs');
const path = require('path');

// Load SQL queries
const getPasswordHashQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-get-password-hash.sql'),
  'utf8'
);
const updatePasswordQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-update-password.sql'),
  'utf8'
);

// Password validation
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw { error: 'INVALID_INPUT', message: 'Password is required', field: 'password' };
  }
  
  // Target state: minimum 8 characters, one number, one uppercase
  if (password.length < 8) {
    throw { error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters', field: 'newPassword' };
  }
  
  if (!/d/.test(password)) {
    throw { error: 'WEAK_PASSWORD', message: 'Password must contain at least one number', field: 'newPassword' };
  }
  
  if (!/[A-Z]/.test(password)) {
    throw { error: 'WEAK_PASSWORD', message: 'Password must contain at least one uppercase letter', field: 'newPassword' };
  }
  
  return password;
}

// POST /api/settings/password
router.post('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'Current password, new password, and confirmation are required'
      });
    }
    
    // Validate new password matches confirmation
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'PASSWORD_MISMATCH',
        message: 'New password and confirmation do not match',
        field: 'confirmPassword'
      });
    }
    
    // Validate new password strength (target state)
    try {
      validatePassword(newPassword);
    } catch (validationError) {
      return res.status(400).json(validationError);
    }
    
    // Fetch current password hash
    const userResult = await pool.query(getPasswordHashQuery, [req.user.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'User not found'
      });
    }
    
    const storedHash = userResult.rows[0].password_hash;
    
    // Verify current password (SECURITY CRITICAL)
    const isValidPassword = await bcrypt.compare(currentPassword, storedHash);
    if (!isValidPassword) {
      console.warn('Password change failed - incorrect current password:', {
        userId: req.user.userId,
        timestamp: new Date().toISOString()
      });
      return res.status(401).json({
        error: 'INCORRECT_PASSWORD',
        message: 'Current password is incorrect',
        field: 'currentPassword'
      });
    }
    
    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await pool.query(updatePasswordQuery, [newHash, req.user.userId]);
    
    console.log('Password changed successfully:', {
      userId: req.user.userId,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      message: 'Password updated successfully'
    });
    
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to update password'
    });
  }
});

module.exports = router;
```

**backend/api/settings/preferences.js**
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../../database/connection');
const fs = require('fs');
const path = require('path');

// Load SQL queries
const getPreferencesQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-get-preferences.sql'),
  'utf8'
);
const upsertPreferencesQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-upsert-preferences.sql'),
  'utf8'
);

// GET /api/settings/preferences
router.get('/preferences', async (req, res) => {
  try {
    const result = await pool.query(getPreferencesQuery, [req.user.userId]);
    
    // If no preferences exist yet, return defaults
    if (result.rows.length === 0) {
      return res.json({
        theme_preference: 'light',
        email_notifications: true,
        push_notifications: false,
        activity_summaries: false
      });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch preferences'
    });
  }
});

// PUT /api/settings/preferences
router.put('/preferences', async (req, res) => {
  try {
    const {
      theme_preference,
      email_notifications,
      push_notifications,
      activity_summaries
    } = req.body;
    
    // Validate theme preference
    if (theme_preference && !['light', 'dark'].includes(theme_preference)) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Theme must be either "light" or "dark"',
        field: 'theme_preference'
      });
    }
    
    // Validate boolean fields
    const validateBoolean = (value, field) => {
      if (value !== undefined && typeof value !== 'boolean') {
        throw {
          error: 'INVALID_INPUT',
          message: `${field} must be a boolean`,
          field
        };
      }
      return value !== undefined ? value : null;
    };
    
    try {
      const emailNotif = validateBoolean(email_notifications, 'email_notifications');
      const pushNotif = validateBoolean(push_notifications, 'push_notifications');
      const activitySum = validateBoolean(activity_summaries, 'activity_summaries');
      
      // UPSERT preferences
      const result = await pool.query(upsertPreferencesQuery, [
        req.user.userId,
        theme_preference || 'light',
        emailNotif !== null ? emailNotif : true,
        pushNotif !== null ? pushNotif : false,
        activitySum !== null ? activitySum : false
      ]);
      
      console.log('Preferences updated:', {
        userId: req.user.userId,
        theme: theme_preference,
        timestamp: new Date().toISOString()
      });
      
      res.json(result.rows[0]);
      
    } catch (validationError) {
      return res.status(400).json(validationError);
    }
    
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to update preferences'
    });
  }
});

module.exports = router;
```

**backend/api/settings/github-accounts.js**
```javascript
const express = require('express');
const router = express.Router();
const pool = require('../../database/connection');
const fs = require('fs');
const path = require('text');

// Load SQL query
const getGitHubAccountsQuery = fs.readFileSync(
  path.join(__dirname, '../../database/queries/settings-get-github-accounts.sql'),
  'utf8'
);

// GET /api/settings/github
router.get('/github', async (req, res) => {
  try {
    const result = await pool.query(getGitHubAccountsQuery, [req.user.userId]);
    
    // Return empty array if no connections (MVP behavior)
    res.json(result.rows);
    
  } catch (error) {
    console.error('Get GitHub accounts error:', error);
    res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to fetch GitHub accounts'
    });
  }
});

module.exports = router;
```

**2.3 Register Settings Routes in Server**

Modify `backend/server.js` (or equivalent server entry point):

```javascript
// ... existing imports ...
const authenticate = require('./middleware/authenticate');

// Import settings routes
const profileRouter = require('./api/settings/profile');
const passwordRouter = require('./api/settings/password');
const preferencesRouter = require('./api/settings/preferences');
const githubAccountsRouter = require('./api/settings/github-accounts');

// ... existing middleware (body-parser, etc.) ...

// Public auth routes
app.use('/api/auth', authRoutes);

// Protected settings routes (all require authentication)
app.use('/api/settings/profile', authenticate, profileRouter);
app.use('/api/settings/password', authenticate, passwordRouter);
app.use('/api/settings/preferences', authenticate, preferencesRouter);
app.use('/api/settings/github', authenticate, githubAccountsRouter);

// ... other protected routes ...
```

### Phase 3: Frontend Implementation (Assumptions Required)

**CRITICAL ASSUMPTION:** Frontend structure follows standard React + Vite + TypeScript pattern with `src/` root. Human review must validate this before implementation.

**3.1 Create TypeScript Types**

Create `src/types/settings.ts`:

```typescript
export interface UserProfile {
  user_id: number;
  username: string;
  email: string | null;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  theme_preference: 'light' | 'dark';
  email_notifications: boolean;
  push_notifications: boolean;
  activity_summaries: boolean;
  updated_at?: string;
}

export interface GitHubConnection {
  connection_id: number;
  github_username: string;
  github_user_id: string;
  avatar_url: string;
  connected_at: string;
  last_synced: string | null;
  is_active: boolean;
}

export interface PasswordChangeData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ApiError {
  error: string;
  message: string;
  field?: string;
}
```

**3.2 Create API Client**

Create `src/api/settings.ts`:

```typescript
import { UserProfile, UserPreferences, GitHubConnection, PasswordChangeData } from '@/types/settings';

const API_BASE = '/api/settings';

// Helper to get auth token (adjust based on actual auth implementation)
function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token'); // or however token is stored
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

export async function getProfile(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/profile`, {
    headers: getAuthHeaders()
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}

export async function updateProfile(updates: Partial<Pick<UserProfile, 'name' | 'email'>>): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/profile`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(updates)
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}

export async function changePassword(data: PasswordChangeData): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/password`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}

export async function getPreferences(): Promise<UserPreferences> {
  const response = await fetch(`${API_BASE}/preferences`, {
    headers: getAuthHeaders()
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}

export async function updatePreferences(prefs: Partial<UserPreferences>): Promise<UserPreferences> {
  const response = await fetch(`${API_BASE}/preferences`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(prefs)
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}

export async function getGitHubAccounts(): Promise<GitHubConnection[]> {
  const response = await fetch(`${API_BASE}/github`, {
    headers: getAuthHeaders()
  });
  if (!response.ok) {
    const error = await response.json();
    throw error;
  }
  return response.json();
}
```

**3.3 Create Custom Hook**

Create `src/hooks/useSettings.ts`:

```typescript
import { useState, useEffect } from 'react';
import { UserProfile, UserPreferences, GitHubConnection, ApiError, PasswordChangeData } from '@/types/settings';
import * as settingsApi from '@/api/settings';

export function useSettings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [githubAccounts, setGitHubAccounts] = useState<GitHubConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Fetch all settings data on mount
  useEffect(() => {
    fetchAllSettings();
  }, []);

  const fetchAllSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileData, prefsData, githubData] = await Promise.all([
        settingsApi.getProfile(),
        settingsApi.getPreferences(),
        settingsApi.getGitHubAccounts()
      ]);
      setProfile(profileData);
      setPreferences(prefsData);
      setGitHubAccounts(githubData);
    } catch (err: any) {
      setError(err);
      console.error('Failed to fetch settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<Pick<UserProfile, 'name' | 'email'>>) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await settingsApi.updateProfile(updates);
      setProfile(updated);
      return updated;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async (data: PasswordChangeData) => {
    setLoading(true);
    setError(null);
    try {
      const result = await settingsApi.changePassword(data);
      return result;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updatePreferences = async (prefs: Partial<UserPreferences>) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await settingsApi.updatePreferences(prefs);
      setPreferences(updated);
      return updated;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    profile,
    preferences,
    githubAccounts,
    loading,
    error,
    updateProfile,
    changePassword,
    updatePreferences,
    refetch: fetchAllSettings
  };
}
```

**3.4 Create Settings Page Components**

Create `src/components/settings/ProfileSection.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { UserProfile, ApiError } from '@/types/settings';

interface ProfileSectionProps {
  profile: UserProfile | null;
  onUpdate: (updates: Partial<Pick<UserProfile, 'name' | 'email'>>) => Promise<UserProfile>;
  loading: boolean;
}

export const ProfileSection: React.FC<ProfileSectionProps> = ({ profile, onUpdate, loading }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setEmail(profile.email || '');
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    try {
      await onUpdate({ name, email });
      setSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err);
    }
  };

  const handleCancel = () => {
    if (profile) {
      setName(profile.name || '');
      setEmail(profile.email || '');
    }
    setIsEditing(false);
    setError(null);
  };

  if (!profile) return <div>Loading profile...</div>;

  return (
    <div className="profile-section">
      <h2>User Profile</h2>
      
      {success && (
        <div className="success-message">Profile updated successfully!</div>
      )}
      
      {error && (
        <div className="error-message">{error.message}</div>
      )}

      {!isEditing ? (
        <div className="profile-display">
          <div className="profile-field">
            <label>Username:</label>
            <span>{profile.username}</span>
          </div>
          <div className="profile-field">
            <label>Name:</label>
            <span>{profile.name || 'Not set'}</span>
          </div>
          <div className="profile-field">
            <label>Email:</label>
            <span>{profile.email || 'Not set'}</span>
          </div>
          <button onClick={() => setIsEditing(true)} disabled={loading}>
            Edit Profile
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-field">
            <label htmlFor="name">Name:</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              disabled={loading}
            />
            {error?.field === 'name' && (
              <span className="field-error">{error.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="email">Email:</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={loading}
            />
            {error?.field === 'email' && (
              <span className="field-error">{error.message}</span>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={handleCancel} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
```

Create `src/components/settings/PasswordChangeForm.tsx`:

```typescript
import React, { useState } from 'react';
import { PasswordChangeData, ApiError } from '@/types/settings';

interface PasswordChangeFormProps {
  onChangePassword: (data: PasswordChangeData) => Promise<{ message: string }>;
  loading: boolean;
}

export const PasswordChangeForm: React.FC<PasswordChangeFormProps> = ({ onChangePassword, loading }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Client-side validation
    if (newPassword !== confirmPassword) {
      setError({
        error: 'PASSWORD_MISMATCH',
        message: 'New password and confirmation do not match',
        field: 'confirmPassword'
      });
      return;
    }

    try {
      await onChangePassword({ currentPassword, newPassword, confirmPassword });
      setSuccess(true);
      // Clear form
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 5000);
    } catch (err: any) {
      setError(err);
    }
  };

  return (
    <div className="password-change-section">
      <h2>Change Password</h2>

      {success && (
        <div className="success-message">Password changed successfully!</div>
      )}

      {error && !error.field && (
        <div className="error-message">{error.message}</div>
      )}

      <form onSubmit={handleSubmit} className="password-form">
        <div className="form-field">
          <label htmlFor="currentPassword">Current Password:</label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            disabled={loading}
          />
          {error?.field === 'currentPassword' && (
            <span className="field-error">{error.message}</span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="newPassword">New Password:</label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            disabled={loading}
          />
          {error?.field === 'newPassword' && (
            <span className="field-error">{error.message}</span>
          )}
          <small className="help-text">
            Minimum 8 characters, at least one number and one uppercase letter
          </small>
        </div>

        <div className="form-field">
          <label htmlFor="confirmPassword">Confirm New Password:</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
          />
          {error?.field === 'confirmPassword' && (
            <span className="field-error">{error.message}</span>
          )}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
};
```

Create `src/components/settings/ThemePreferences.tsx`:

```typescript
import React from 'react';
import { UserPreferences } from '@/types/settings';
import { useThemeStore } from '@/stores/themeStore'; // Assumed location

interface ThemePreferencesProps {
  preferences: UserPreferences | null;
  onUpdate: (prefs: Partial<UserPreferences>) => Promise<UserPreferences>;
  loading: boolean;
}

export const ThemePreferences: React.FC<ThemePreferencesProps> = ({ preferences, onUpdate, loading }) => {
  const { theme, setTheme } = useThemeStore();

  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    // Optimistic update: Change Zustand immediately
    setTheme(newTheme);

    try {
      // Persist to backend
      await onUpdate({ theme_preference: newTheme });
    } catch (error) {
      // Revert on failure
      setTheme(theme);
      console.error('Failed to update theme:', error);
    }
  };

  return (
    <div className="theme-preferences-section">
      <h2>Theme Preferences</h2>
      
      <div className="theme-toggle">
        <label>
          <input
            type="radio"
            name="theme"
            value="light"
            checked={theme === 'light'}
            onChange={() => handleThemeChange('light')}
            disabled={loading}
          />
          Light Mode
        </label>

        <label>
          <input
            type="radio"
            name="theme"
            value="dark"
            checked={theme === 'dark'}
            onChange={() => handleThemeChange('dark')}
            disabled={loading}
          />
          Dark Mode
        </label>
      </div>

      <p className="current-theme">
        Current theme: <strong>{theme}</strong>
      </p>
    </div>
  );
};
```

Create `src/components/settings/NotificationPreferences.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { UserPreferences, ApiError } from '@/types/settings';

interface NotificationPreferencesProps {
  preferences: UserPreferences | null;
  onUpdate: (prefs: Partial<UserPreferences>) => Promise<UserPreferences>;
  loading: boolean;
}

export const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ 
  preferences, 
  onUpdate, 
  loading 
}) => {
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);
  const [activitySum, setActivitySum] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (preferences) {
      setEmailNotif(preferences.email_notifications);
      setPushNotif(preferences.push_notifications);
      setActivitySum(preferences.activity_summaries);
    }
  }, [preferences]);

  const handleToggle = async (field: keyof UserPreferences, value: boolean) => {
    setSaving(true);
    setError(null);

    try {
      await onUpdate({ [field]: value });
    } catch (err: any) {
      setError(err);
      // Revert on failure
      if (field === 'email_notifications') setEmailNotif(!value);
      if (field === 'push_notifications') setPushNotif(!value);
      if (field === 'activity_summaries') setActivitySum(!value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notification-preferences-section">
      <h2>Notification Preferences</h2>

      {error && (
        <div className="error-message">{error.message}</div>
      )}

      <div className="notification-toggle">
        <label>
          <input
            type="checkbox"
            checked={emailNotif}
            onChange={(e) => {
              setEmailNotif(e.target.checked);
              handleToggle('email_notifications', e.target.checked);
            }}
            disabled={loading || saving}
          />
          Email Notifications
        </label>
        <span className="help-text">Receive updates and alerts via email</span>
      </div>

      <div className="notification-toggle">
        <label>
          <input
            type="checkbox"
            checked={pushNotif}
            onChange={(e) => {
              setPushNotif(e.target.checked);
              handleToggle('push_notifications', e.target.checked);
            }}
            disabled={loading || saving}
          />
          Push Notifications
        </label>
        <span className="help-text">Receive browser push notifications</span>
      </div>

      <div className="notification-toggle">
        <label>
          <input
            type="checkbox"
            checked={activitySum}
            onChange={(e) => {
              setActivitySum(e.target.checked);
              handleToggle('activity_summaries', e.target.checked);
            }}
            disabled={loading || saving}
          />
          Activity Summaries
        </label>
        <span className="help-text">Receive periodic summaries of your activity</span>
      </div>

      {saving && <p className="saving-indicator">Saving...</p>}
    </div>
  );
};
```

Create `src/components/settings/GitHubAccounts.tsx`:

```typescript
import React from 'react';
import { GitHubConnection } from '@/types/settings';

interface GitHubAccountsProps {
  accounts: GitHubConnection[];
  loading: boolean;
}

export const GitHubAccounts: React.FC<GitHubAccountsProps> = ({ accounts, loading }) => {
  if (loading) {
    return <div className="github-accounts-section">Loading GitHub accounts...</div>;
  }

  return (
    <div className="github-accounts-section">
      <h2>Connected GitHub Accounts</h2>

      {accounts.length === 0 ? (
        <div className="empty-state">
          <p>No connected GitHub accounts</p>
          <p className="help-text">
            Connect your GitHub account to enable repository integration (coming soon)
          </p>
        </div>
      ) : (
        <div className="accounts-list">
          {accounts.map((account) => (
            <div key={account.connection_id} className="account-item">
              {account.avatar_url && (
                <img 
                  src={account.avatar_url} 
                  alt={account.github_username} 
                  className="avatar" 
                />
              )}
              <div className="account-info">
                <strong>{account.github_username}</strong>
                <span className="connected-date">
                  Connected {new Date(account.connected_at).toLocaleDateString()}
                </span>
              </div>
              {/* Stretch goal: disconnect button */}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

**3.5 Create Main Settings Page**

Create `src/pages/Settings.tsx`:

```typescript
import React, { useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useThemeStore } from '@/stores/themeStore';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { PasswordChangeForm } from '@/components/settings/PasswordChangeForm';
import { ThemePreferences } from '@/components/settings/ThemePreferences';
import { NotificationPreferences } from '@/components/settings/NotificationPreferences';
import { GitHubAccounts } from '@/components/settings/GitHubAccounts';
import './Settings.css'; // Assumed styling location

export const SettingsPage: React.FC = () => {
  const {
    profile,
    preferences,
    githubAccounts,
    loading,
    error,
    updateProfile,
    changePassword,
    updatePreferences
  } = useSettings();

  const { setTheme } = useThemeStore();

  // Sync Zustand with fetched preferences on load
  useEffect(() => {
    if (preferences) {
      setTheme(preferences.theme_preference);
    }
  }, [preferences, setTheme]);

  if (loading && !profile) {
    return (
      <div className="settings-page loading">
        <h1>Settings</h1>
        <p>Loading your settings...</p>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="settings-page error">
        <h1>Settings</h1>
        <div className="error-message">
          Failed to load settings: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <h1>Settings</h1>

      <div className="settings-sections">
        <ProfileSection 
          profile={profile}
          onUpdate={updateProfile}
          loading={loading}
        />

        <PasswordChangeForm
          onChangePassword={changePassword}
          loading={loading}
        />

        <ThemePreferences
          preferences={preferences}
          onUpdate={updatePreferences}
          loading={loading}
        />

        <NotificationPreferences
          preferences={preferences}
          onUpdate={updatePreferences}
          loading={loading}
        />

        <GitHubAccounts
          accounts={githubAccounts}
          loading={loading}
        />
      </div>
    </div>
  );
};
```

**3.6 Add Settings Route**

Modify routing configuration (location depends on router setup):

```typescript
// Assumed location: src/App.tsx or src/routes.tsx
import { SettingsPage } from '@/pages/Settings';

// In router configuration:
<Route path="/settings" element={<SettingsPage />} />
```

**3.7 Add Settings Link to Navigation**

Modify navigation component (location unknown, human must identify):

```typescript
// Assumed: UserMenu dropdown component
<Link to="/settings">Settings</Link>
```

### Phase 4: Testing & Validation

**4.1 Backend Testing**

Create integration tests (location TBD based on test framework):

```javascript
// test/api/settings.test.js
describe('Settings API', () => {
  let authToken;

  beforeAll(async () => {
    // Login to get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'TestPassword123!' });
    authToken = loginResponse.body.token;
  });

  describe('GET /api/settings/profile', () => {
    it('should return user profile', async () => {
      const response = await request(app)
        .get('/api/settings/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('user_id');
      expect(response.body).toHaveProperty('username');
    });

    it('should return 401 without auth token', async () => {
      await request(app)
        .get('/api/settings/profile')
        .expect(401);
    });
  });

  describe('PUT /api/settings/profile', () => {
    it('should update name and email', async () => {
      const response = await request(app)
        .put('/api/settings/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test User', email: 'test@example.com' })
        .expect(200);

      expect(response.body.name).toBe('Test User');
      expect(response.body.email).toBe('test@example.com');
    });

    it('should reject invalid email', async () => {
      const response = await request(app)
        .put('/api/settings/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'not-an-email' })
        .expect(400);

      expect(response.body.error).toBe('INVALID_INPUT');
    });
  });

  describe('POST /api/settings/password', () => {
    it('should change password with correct current password', async () => {
      await request(app)
        .post('/api/settings/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'TestPassword123!',
          newPassword: 'NewPassword456!',
          confirmPassword: 'NewPassword456!'
        })
        .expect(200);
    });

    it('should reject with incorrect current password', async () => {
      const response = await request(app)
        .post('/api/settings/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'WrongPassword',
          newPassword: 'NewPassword456!',
          confirmPassword: 'NewPassword456!'
        })
        .expect(401);

      expect(response.body.error).toBe('INCORRECT_PASSWORD');
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/settings/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'TestPassword123!',
          newPassword: 'weak',
          confirmPassword: 'weak'
        })
        .expect(400);

      expect(response.body.error).toBe('WEAK_PASSWORD');
    });
  });

  describe('GET/PUT /api/settings/preferences', () => {
    it('should return default preferences if none exist', async () => {
      const response = await request(app)
        .get('/api/settings/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.theme_preference).toBeDefined();
    });

    it('should update theme preference', async () => {
      const response = await request(app)
        .put('/api/settings/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ theme_preference: 'dark' })
        .expect(200);

      expect(response.body.theme_preference).toBe('dark');
    });
  });
});
```

**4.2 Frontend Testing (Manual)**

- Navigate to `/settings` when logged in
- Verify all sections render without errors
- Test profile update with valid data
- Test profile update with invalid email (should show error)
- Test password change with correct current password
- Test password change with incorrect current password (should fail)
- Test theme toggle updates UI immediately
- Test notification toggles persist after page refresh
- Verify GitHub accounts shows empty state

**4.3 Performance Testing**

```bash
# Measure settings page load time
curl -w "@curl-format.txt" -o /dev/null -s 
  -H "Authorization: Bearer $TOKEN" 
  http://localhost:3000/api/settings/profile

# Expected: < 200ms
```

## Risk Surface

### Critical Security Risks

| Risk | Mitigation | Verification |
|------|------------|--------------|
| **Password change without current password verification** | bcrypt.compare() mandatory before UPDATE. Integration test verifies this fails with wrong password. | Code review: verify `bcrypt.compare()` call exists before password UPDATE. Test: attempt password change with wrong current password, expect 401. |
| **Email uniqueness not enforced** | Check uniqueness in application code before UPDATE. Handle UNIQUE constraint violation gracefully. | Test: attempt to update email to existing user's email, expect 400 with EMAIL_TAKEN error. |
| **SQL injection via user inputs** | Parameterized queries exclusively ($1, $2 syntax). Never concatenate user input. | Code review: verify all .sql files use $1, $2 parameters. Fuzzing test: inject SQL in name/email fields, expect safe handling. |
| **Plaintext password in logs** | Exclude password fields from console.log. Review all logging statements. | Code review: search codebase for `console.log(req.body)`. Verify password excluded from logs. |
| **Zustand/Database theme desync** | Fetch from database on settings page load, override Zustand. Optimistic update with revert on failure. | Test: change theme, reload page, verify theme persists. Test: simulate API failure, verify Zustand reverts. |

### Medium-Priority Risks

| Risk | Mitigation |
|------|------------|
| **Settings page load >500ms** | Fetch profile + preferences in parallel with Promise.all(). Monitor P95 latency. |
| **No loading state during API calls** | Disable submit buttons when loading=true. Show spinner. Debounce rapid submissions. |
| **Theme change doesn't update navigation** | Zustand store triggers re-render. Verify nav component subscribes to theme store. |
| **Empty result for GitHub accounts breaks UI** | Return empty array from API. Handle empty state gracefully in component. |
| **TypeScript type mismatches** | Define explicit types in settings.ts. Validate API responses match types. |

### Edge Cases Identified

| Scenario | Expected Behavior | Test Coverage |
|----------|-------------------|---------------|
| User updates email to own current email | Success (no-op) | Test: PUT same email, expect 200 |
| User submits empty name/email | Validation error or treat as "unset" | Test: PUT empty strings, expect 400 or null handling |
| Concurrent theme changes from multiple tabs | Last write wins (acceptable for MVP) | Manual test: open 2 tabs, change theme in each |
| Password change with newPassword = currentPassword | Allowed (no restriction) | Test: verify this succeeds (not an error) |
| User exists but no user_settings row yet | GET preferences returns defaults, PUT creates row | Test: new user fetches preferences, expect defaults |
| GitHub accounts query returns large result set | Pagination not implemented for MVP | Document limitation, add pagination in future orbit if needed |

### Performance Monitoring

**Metrics to Track:**
- Settings page initial load time (target <500ms)
- Profile update API latency (target <1s)
- Password change API latency (bcrypt adds ~100ms, target <1s total)
- Preferences update latency (target <500ms)
- Frontend render time after theme change

**Logging Strategy:**
```javascript
// Log successful operations (no sensitive data)
console.log('Settings operation:', {
  userId: req.user.userId,
  operation: 'update_profile',
  fields: ['name', 'email'], // what changed, not values
  timestamp: new Date().toISOString()
});

// Never log: passwords, full req.body, email addresses in production
```

## Scope Estimate

### Complexity Assessment: **MEDIUM-HIGH**

**Factors Increasing Complexity:**
- Frontend structure unknown (requires human discovery phase)
- Zustand theme store integration requires careful state synchronization
- Password change security flow is critical and must be tested thoroughly
- Multiple API endpoints and components to coordinate
- Database migration may conflict with existing schema (email column)

**Factors Reducing Complexity:**
- Patterns established from authentication orbit (bcrypt, JWT, SQL queries)
- Standard CRUD operations (no complex business logic)
- No external integrations (GitHub OAuth deferred)
- Clear acceptance criteria with tiered requirements

### Work Breakdown

**Phase 0: Frontend Discovery (Human-Required) — 1-2 hours**
- Identify frontend structure, Zustand store, routing, styling
- Document findings for implementation team
- **Blocker:** Cannot proceed to Phase 3 without this information

**Phase 1: Database Schema Migration — 1 hour**
- Write migration SQL
- Test migration on staging database
- Verify indexes created and triggers working
- **Exit Criteria:** users table has email/name columns, user_settings table exists

**Phase 2: Backend API Implementation — 4-5 hours**
- Write 6 SQL query files (profile, password, preferences, github)
- Implement 4 API route modules (profile.js, password.js, preferences.js, github-accounts.js)
- Register routes in server.js with authentication middleware
- Test all endpoints with Postman/curl
- **Exit Criteria:** All API endpoints return correct responses, authentication enforced

**Phase 3: Frontend Implementation — 5-6 hours** (BLOCKED until Phase 0)
- Create TypeScript types and API client
- Implement useSettings hook
- Build 5 settings section components
- Create main Settings page
- Add routing and navigation link
- **Exit Criteria:** Settings page renders and interacts with backend successfully

**Phase 4: Testing & Validation — 3-4 hours**
- Write backend integration tests
- Manual frontend testing (all user flows)
- Performance benchmarking
- Security testing (password change, SQL injection attempts)
- **Exit Criteria:** All tests pass, performance within budget, no security issues found

**Phase 5: Documentation & Deployment — 1-2 hours**
- Update README with settings API documentation
- Document Zustand-database sync pattern
- Deployment checklist and rollback plan
- **Exit Criteria:** Documentation complete, deployment ready

**Total Estimated Time:** 15-20 hours of development work

**Critical Path:** Phase 0 (frontend discovery) must complete before Phase 3 can begin. Phases 1-2 (backend) can proceed independently.

### Phased Rollout Strategy

**Week 1:**
- Phase 0: Human completes frontend discovery
- Phase 1: Deploy database migration to staging
- Phase 2: Deploy backend API to staging

**Week 2:**
- Phase 3: Implement frontend (after Phase 0 unblocked)
- Phase 4: Testing and validation in staging
- Security review by mid-level engineer

**Week 3:**
- Deploy to production with feature flag (disabled by default)
- Enable for 10% of users (canary)
- Monitor error rates, performance metrics
- Full rollout if no issues after 48 hours

### Success Metrics

**Minimum Viable Success:**
- Settings page loads in <500ms
- Profile, password, theme, notification sections functional
- All form validations working with inline errors
- Authentication required for all endpoints (401 without token)
- Password change requires current password verification
- No SQL injection vulnerabilities

**Target State Success:**
- Settings page load time <300ms (P95)
- Profile updates reflect immediately in navigation (name/email)
- Theme changes update Zustand and persist to database
- Password validation enforces complexity requirements
- Mobile responsive design tested on 3+ viewport sizes
- Zero production errors in first week

**Stretch Goal Success:**
- Email change confirmation flow implemented
- Password strength indicator working
- GitHub accounts section shows real connections (if OAuth implemented separately)
- Settings export/import functionality
- Accessibility audit passing with no critical issues

### Risk-Adjusted Timeline

**Best Case (15 hours):**
- Frontend structure simple and well-documented
- No conflicts in database schema migration
- All tests pass first try
- No unexpected Zustand integration issues

**Realistic Case (18 hours):**
- Some frontend discovery challenges
- Minor database migration adjustments needed
- Few test failures requiring debugging
- One round of security review feedback

**Worst Case (25 hours):**
- Frontend structure requires significant refactoring to add settings
- Zustand theme store incompatible with backend sync pattern (needs redesign)
- Email column already exists but with different constraints (migration conflict)
- Security issues found requiring rework of password change flow
- Performance issues requiring optimization

**Contingency Plan:** If worst-case timeline exceeded, consider:
- Minimum viable only (defer target state to follow-up orbit)
- Split into 2 orbits: Backend (Phase 1-2) and Frontend (Phase 3-5)
- Request additional context/access to frontend codebase

## Human Modifications

Pending human review.