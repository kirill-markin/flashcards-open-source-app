-- OAuth token endpoint (item 03) runtime support.
--
-- The machine-facing OAuth Authorization Server endpoints (RFC 8414 metadata,
-- RFC 7591 DCR, and the token endpoint) run inside the auth service, which
-- connects as auth_app. db/migrations/0074 deliberately granted the auth.oauth_*
-- tables only to backend_app (mirroring the guest_sessions precedent) and left
-- the auth_app grants to "the resolver and endpoints" items. This migration
-- adds the auth_app grants that the token/register endpoints need.
--
-- It also adds scope/resource to auth.oauth_refresh_tokens so the refresh_token
-- grant can re-mint an access token that carries the same audience (resource)
-- and scope as the original authorization_code grant without a second lookup.
-- The authorization-code and access-token tables already store resource/scope;
-- only the refresh-token table was missing them.

ALTER TABLE auth.oauth_refresh_tokens
  ADD COLUMN IF NOT EXISTS scope    TEXT,
  ADD COLUMN IF NOT EXISTS resource TEXT;

-- auth_app grants for the OAuth Authorization Server endpoints:
--   - oauth_clients: SELECT (token grant client check) + INSERT (DCR /register)
--   - oauth_connections: SELECT (joined when rotating refresh tokens)
--   - oauth_authorization_codes: SELECT + UPDATE (single-use consume)
--   - oauth_access_tokens: INSERT (mint on token grant)
--   - oauth_refresh_tokens: SELECT + INSERT + DELETE (mint + rotation; SELECT is
--     required because rotation runs DELETE ... RETURNING, and Postgres needs
--     SELECT on every RETURNING column)
GRANT SELECT, INSERT ON auth.oauth_clients TO auth_app;
GRANT SELECT ON auth.oauth_connections TO auth_app;
GRANT SELECT, UPDATE ON auth.oauth_authorization_codes TO auth_app;
GRANT INSERT ON auth.oauth_access_tokens TO auth_app;
GRANT SELECT, INSERT, DELETE ON auth.oauth_refresh_tokens TO auth_app;
