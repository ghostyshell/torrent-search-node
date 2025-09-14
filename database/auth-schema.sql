-- User Authentication Schema for Torrent Search Application
-- This schema supports Google OAuth authentication and user-specific data

-- Users table - stores user information from Google OAuth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Google user ID
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  picture TEXT, -- Google profile picture URL
  google_id TEXT NOT NULL UNIQUE,
  real_debrid_api_key TEXT, -- Encrypted Real Debrid API key
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_login_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  is_active BOOLEAN DEFAULT 1
);

-- User sessions table - manage login sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Update existing favorites table to be user-specific
-- Note: We'll need to migrate existing data
ALTER TABLE favorites ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Update existing cached_links table to be user-specific
ALTER TABLE cached_links ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Update existing favorite_entries table to be user-specific
ALTER TABLE favorite_entries ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_cached_links_user_id ON cached_links(user_id);
CREATE INDEX IF NOT EXISTS idx_favorite_entries_user_id ON favorite_entries(user_id);

-- Create views for easy querying
CREATE VIEW IF NOT EXISTS active_user_sessions AS
SELECT s.*, u.email, u.name
FROM user_sessions s
JOIN users u ON s.user_id = u.id
WHERE s.expires_at > strftime('%s', 'now') AND u.is_active = 1;