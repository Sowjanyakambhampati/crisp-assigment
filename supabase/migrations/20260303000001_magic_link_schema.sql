-- Magic Link Authentication Schema
-- Designed for Exercise 1a of the Crisp Technical Assessment

-- Users table: stores registered users
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login  TIMESTAMPTZ
);

-- Magic link tokens table: stores one-time login tokens
--
-- Design rationale:
--   - We store a SHA-256 hash of the token, NOT the raw token itself.
--     This mirrors best practice from password storage: if the database
--     is compromised, the attacker cannot reconstruct valid login URLs.
--   - The raw token is only ever held in memory during generation and
--     sent to the user via email. It is never persisted.
--   - expires_at enforces a short TTL (e.g. 15 minutes).
--   - used_at marks a token as consumed, preventing replay.
--   - created_ip / used_ip are optional audit fields.
CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BYTEA NOT NULL,           -- SHA-256 of the raw token
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,              -- NULL = unused
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_ip      INET,
    used_ip         INET
);

-- Sessions table: created upon successful magic link verification
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BYTEA NOT NULL UNIQUE,    -- hashed session token
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

-- ============================================================
-- INDEXES (Exercise 1c reasoning)
-- ============================================================
--
-- For the magic_link_tokens table:
--   1. B-tree index on token_hash: This is the PRIMARY lookup path.
--      When a user clicks a magic link, we need to find the row by
--      its hashed token value. Without this index, Postgres would do
--      a sequential scan over potentially 500M rows.
--
--   2. We do NOT add a standalone index on user_id here. While we
--      might query "all tokens for user X" for admin/audit purposes,
--      this is infrequent. Each index costs ~8-16 GB of RAM/disk for
--      500M rows, so we avoid indexes that don't serve the hot path.
--
--   3. We do NOT add an index on expires_at. Expiry checks happen
--      inline after the token_hash lookup finds a single row, so
--      there's no need to index the timestamp column. A background
--      cleanup job can use a partial index or just scan in batches.
--
--   4. Partial index on unused tokens only: this keeps the index
--      small (only rows where used_at IS NULL), which is exactly the
--      set we query. Once a token is used, it drops out of the index.

CREATE UNIQUE INDEX idx_magic_link_token_hash
    ON magic_link_tokens (token_hash)
    WHERE used_at IS NULL;

-- For periodic cleanup of expired tokens (batch job, not hot path)
CREATE INDEX idx_magic_link_expires
    ON magic_link_tokens (expires_at)
    WHERE used_at IS NULL;

-- Sessions: lookup by hashed session token on every authenticated request
CREATE INDEX idx_sessions_token_hash
    ON sessions (token_hash)
    WHERE revoked_at IS NULL;

-- Seed some demo users
INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com', 'Bob'),
    ('charlie@example.com', 'Charlie');
