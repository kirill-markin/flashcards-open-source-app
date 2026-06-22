-- OAuth Authorization Server and MCP access-token validation storage.
-- Backs Dynamic Client Registration, the authorization-code + PKCE flow, and
-- access/refresh token issuance and validation for the MCP server.

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
  code_challenge_method TEXT        NOT NULL DEFAULT 'S256',
  scope                 TEXT,
  resource              TEXT        NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  consumed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_client
  ON auth.oauth_authorization_codes(client_id);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_active
  ON auth.oauth_authorization_codes(code_hash)
  WHERE consumed_at IS NULL;

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
