-- Migration status: Current / canonical.
-- Introduces: the cleanup and finalization step that removes the legacy shared app role after the runtime-role cutover.
-- Current guidance: this migration is the canonical finalization of the runtime-role split introduced in db/migrations/0024_auth_runtime_roles.sql.
-- Replaces or corrects: db/migrations/0024_auth_runtime_roles.sql.
-- See also: db/migrations/0024_auth_runtime_roles.sql, docs/architecture.md.
-- Remove the legacy shared runtime role after backend_app and auth_app cut over.

DROP POLICY IF EXISTS user_settings_self_select ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_insert ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_update ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_delete ON org.user_settings;

DROP POLICY IF EXISTS workspace_memberships_access_select ON org.workspace_memberships;
DROP POLICY IF EXISTS workspace_memberships_self_insert ON org.workspace_memberships;
DROP POLICY IF EXISTS workspace_memberships_self_delete ON org.workspace_memberships;

DROP POLICY IF EXISTS workspaces_access_select ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_insert ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_update ON org.workspaces;
DROP POLICY IF EXISTS workspaces_access_delete ON org.workspaces;

DROP POLICY IF EXISTS cards_scoped_select ON content.cards;
DROP POLICY IF EXISTS cards_scoped_insert ON content.cards;
DROP POLICY IF EXISTS cards_scoped_update ON content.cards;
DROP POLICY IF EXISTS cards_scoped_delete ON content.cards;

DROP POLICY IF EXISTS decks_scoped_select ON content.decks;
DROP POLICY IF EXISTS decks_scoped_insert ON content.decks;
DROP POLICY IF EXISTS decks_scoped_update ON content.decks;
DROP POLICY IF EXISTS decks_scoped_delete ON content.decks;

DROP POLICY IF EXISTS review_events_scoped_select ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_insert ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_update ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_delete ON content.review_events;

DROP POLICY IF EXISTS devices_scoped_select ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_insert ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_update ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_delete ON sync.devices;

DROP POLICY IF EXISTS applied_operations_scoped_select ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_insert ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_update ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_delete ON sync.applied_operations;

DROP POLICY IF EXISTS changes_scoped_select ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_insert ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_update ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_delete ON sync.changes;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM app;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM app;

REVOKE EXECUTE ON FUNCTION security.current_user_id() FROM app;
REVOKE EXECUTE ON FUNCTION security.current_workspace_id() FROM app;
REVOKE EXECUTE ON FUNCTION security.user_has_workspace_access(UUID) FROM app;
REVOKE EXECUTE ON FUNCTION security.current_workspace_access_allowed(UUID) FROM app;
REVOKE EXECUTE ON FUNCTION security.current_user_is_workspace_owner(UUID) FROM app;
REVOKE EXECUTE ON FUNCTION security.current_user_is_sole_workspace_member(UUID) FROM app;

REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org FROM app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content FROM app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sync FROM app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth FROM app;

REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA org FROM app;
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA content FROM app;
REVOKE USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA sync FROM app;

REVOKE USAGE ON SCHEMA org FROM app;
REVOKE USAGE ON SCHEMA content FROM app;
REVOKE USAGE ON SCHEMA sync FROM app;
REVOKE USAGE ON SCHEMA auth FROM app;
REVOKE USAGE ON SCHEMA security FROM app;
REVOKE CONNECT ON DATABASE flashcards FROM app;

DROP ROLE IF EXISTS app;
