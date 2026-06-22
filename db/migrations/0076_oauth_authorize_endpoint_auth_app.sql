-- OAuth /authorize endpoint (item 06) runtime support.
--
-- The browser-facing /authorize endpoint runs inside the auth service
-- (auth_app). After login + consent it upserts the (user, client)
-- auth.oauth_connections row and writes a single-use
-- auth.oauth_authorization_codes row. db/migrations/0074 granted these tables
-- only to backend_app; db/migrations/0075 added the auth_app grants the /token
-- and /register endpoints need (SELECT on connections; SELECT + UPDATE on
-- codes). This migration adds the remaining auth_app grants the consent path
-- needs:
--   - oauth_connections: INSERT (mint a new connection) + UPDATE (reuse/un-revoke
--     an existing (user, client) connection on reconnect). SELECT already granted
--     in 0075.
--   - oauth_authorization_codes: INSERT (write the single-use code). SELECT +
--     UPDATE already granted in 0075.
--
-- The user/workspace bootstrap the consent path performs (org.user_settings,
-- org.workspaces, org.workspace_memberships, sync.devices) reuses the same
-- helper as the agent-API-key flow, whose auth_app grants already exist
-- (db/migrations/0024).

GRANT INSERT, UPDATE ON auth.oauth_connections TO auth_app;
GRANT INSERT ON auth.oauth_authorization_codes TO auth_app;
