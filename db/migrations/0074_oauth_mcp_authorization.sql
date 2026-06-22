-- OAuth Authorization Server and MCP access-token validation storage.
-- Backs Dynamic Client Registration, the authorization-code + PKCE flow, and
-- access/refresh token issuance and validation for the MCP server.
--
-- Access model (deliberate): these auth.oauth_* tables intentionally mirror the
-- per-user, secret-bearing auth.guest_sessions/auth.user_identities tables
-- (db/migrations/0031) rather than auth.agent_api_keys (db/migrations/0024,
-- 0030). Like guest_sessions, they have NO Row Level Security: per-user
-- isolation is enforced at the application layer via explicit WHERE user_id = ...
-- (and resolution by hashed-secret point lookup), not by RLS. RLS was not
-- partially applied here on purpose, to avoid pre-committing the access model
-- that later items own. The management/token-resolution access model
-- (RLS policies vs. SECURITY DEFINER resolver, e.g. mirroring
-- auth.authenticate_agent_api_key) is finalized when the resolver and endpoints
-- land in items 03 and 04.
--
-- Runtime-role grants (deliberate): grants are limited to backend_app, matching
-- the guest_sessions precedent (0031). There is no auth_app resolver for
-- guest_sessions either. If the OAuth authorize/token endpoints in items 03/06
-- run under auth_app (as the existing OTP/Cognito auth path does), those items
-- add the matching GRANT ... TO auth_app in the same change.
--
-- Code cleanup (deliberate): auth.oauth_authorization_codes is single-use
-- (consumed_at) and time-bounded (expires_at), and is removed on account
-- deletion via the org.user_settings ON DELETE CASCADE chain, exactly like the
-- guest_sessions sibling it mirrors. Periodic reaping of consumed/expired codes
-- belongs to the token-exchange path in item 03.

CREATE TABLE IF NOT EXISTS auth.oauth_clients (
  client_id                  TEXT        PRIMARY KEY,
  redirect_uris              TEXT[]      NOT NULL,
  token_endpoint_auth_method TEXT        NOT NULL,
  client_name                TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.oauth_connections (
  connection_id         UUID        PRIMARY KEY,
  user_id               TEXT        NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  client_id             TEXT        NOT NULL REFERENCES auth.oauth_clients(client_id) ON DELETE CASCADE,
  label                 TEXT        NOT NULL,
  selected_workspace_id UUID        REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at          TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user_created
  ON auth.oauth_connections(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_connections_active_user
  ON auth.oauth_connections(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.oauth_authorization_codes (
  code_hash             TEXT        PRIMARY KEY,
  client_id             TEXT        NOT NULL,
  connection_id         UUID        NOT NULL REFERENCES auth.oauth_connections(connection_id) ON DELETE CASCADE,
  redirect_uri          TEXT        NOT NULL,
  code_challenge        TEXT        NOT NULL,
  code_challenge_method TEXT        NOT NULL DEFAULT 'S256' CHECK (code_challenge_method IN ('S256')),
  scope                 TEXT,
  resource              TEXT        NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_client
  ON auth.oauth_authorization_codes(client_id);

-- No partial active index on code_hash: unlike auth.guest_sessions (whose active
-- index is on the non-PK session_secret_hash), code_hash is already the PRIMARY
-- KEY here. An active-code lookup `WHERE code_hash = $1 AND consumed_at IS NULL`
-- is fully served by the PK index, with consumed_at as a cheap residual filter on
-- the single matched row, so a partial index would add write/storage cost with no
-- read benefit.

CREATE TABLE IF NOT EXISTS auth.oauth_access_tokens (
  token_hash    TEXT        PRIMARY KEY,
  connection_id UUID        NOT NULL REFERENCES auth.oauth_connections(connection_id) ON DELETE CASCADE,
  scope         TEXT,
  resource      TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_connection
  ON auth.oauth_access_tokens(connection_id);

CREATE TABLE IF NOT EXISTS auth.oauth_refresh_tokens (
  token_hash    TEXT        PRIMARY KEY,
  connection_id UUID        NOT NULL REFERENCES auth.oauth_connections(connection_id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_connection
  ON auth.oauth_refresh_tokens(connection_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_clients TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_connections TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_authorization_codes TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_access_tokens TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.oauth_refresh_tokens TO backend_app;
