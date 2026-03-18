-- Migration status: Historical / partially superseded.
-- Introduces: the backend_app/auth_app runtime-role split and the main replacement for legacy shared app-role access.
-- Current guidance: this migration defines the core runtime-role cutover, but its sync.changes and sync.applied_operations policy sections became historical after the hot-state rewrite.
-- Replaces or corrects: db/migrations/0003_sequence_grants.sql, db/migrations/0019_account_delete_tombstones.sql, db/migrations/0020_security_context_helpers.sql, db/migrations/0021_row_level_security.sql, db/migrations/0022_rls_policy_hardening.sql.
-- Replaced or refined by: db/migrations/0025_remove_legacy_app_role.sql, db/migrations/0028_sync_hot_state_rewrite.sql, db/migrations/0030_agent_api_key_selected_workspace_rls.sql.
-- See also: docs/architecture.md.
-- Split runtime database access by service and narrow auth schema privileges.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backend_app') THEN
    CREATE ROLE backend_app LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_app') THEN
    CREATE ROLE auth_app LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE flashcards TO backend_app;
GRANT CONNECT ON DATABASE flashcards TO auth_app;

GRANT USAGE ON SCHEMA org TO backend_app;
GRANT USAGE ON SCHEMA content TO backend_app;
GRANT USAGE ON SCHEMA sync TO backend_app;
GRANT USAGE ON SCHEMA auth TO backend_app;
GRANT USAGE ON SCHEMA security TO backend_app;

GRANT USAGE ON SCHEMA org TO auth_app;
GRANT USAGE ON SCHEMA sync TO auth_app;
GRANT USAGE ON SCHEMA auth TO auth_app;
GRANT USAGE ON SCHEMA security TO auth_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA content TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sync TO backend_app;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA org TO backend_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA content TO backend_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA sync TO backend_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backend_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backend_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backend_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA org
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backend_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA content
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backend_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sync
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backend_app;

GRANT SELECT, UPDATE ON auth.agent_api_keys TO backend_app;
GRANT SELECT, INSERT ON auth.deleted_subjects TO backend_app;

GRANT SELECT, INSERT ON auth.otp_send_events TO auth_app;
GRANT SELECT, INSERT, UPDATE ON auth.agent_otp_challenges TO auth_app;
GRANT SELECT, INSERT ON auth.agent_api_keys TO auth_app;
GRANT SELECT, INSERT, UPDATE ON auth.otp_verify_attempts TO auth_app;

GRANT SELECT, INSERT, UPDATE ON org.user_settings TO auth_app;
GRANT SELECT, INSERT ON org.workspace_memberships TO auth_app;
GRANT INSERT ON org.workspaces TO auth_app;
GRANT INSERT ON sync.devices TO auth_app;

GRANT EXECUTE ON FUNCTION security.current_user_id() TO backend_app;
GRANT EXECUTE ON FUNCTION security.current_workspace_id() TO backend_app;
GRANT EXECUTE ON FUNCTION security.user_has_workspace_access(UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION security.current_workspace_access_allowed(UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION security.current_user_is_workspace_owner(UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION security.current_user_is_sole_workspace_member(UUID) TO backend_app;

GRANT EXECUTE ON FUNCTION security.current_user_id() TO auth_app;
GRANT EXECUTE ON FUNCTION security.current_workspace_id() TO auth_app;
GRANT EXECUTE ON FUNCTION security.user_has_workspace_access(UUID) TO auth_app;
GRANT EXECUTE ON FUNCTION security.current_workspace_access_allowed(UUID) TO auth_app;
GRANT EXECUTE ON FUNCTION security.current_user_is_workspace_owner(UUID) TO auth_app;
GRANT EXECUTE ON FUNCTION security.current_user_is_sole_workspace_member(UUID) TO auth_app;

CREATE OR REPLACE FUNCTION auth.authenticate_agent_api_key(target_key_id TEXT)
RETURNS TABLE (
  connection_id UUID,
  user_id TEXT,
  key_hash TEXT,
  selected_workspace_id UUID,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    agent_api_keys.connection_id,
    agent_api_keys.user_id,
    agent_api_keys.key_hash,
    agent_api_keys.selected_workspace_id,
    agent_api_keys.last_used_at,
    agent_api_keys.revoked_at
  FROM auth.agent_api_keys AS agent_api_keys
  WHERE agent_api_keys.key_id = target_key_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth.authenticate_agent_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.authenticate_agent_api_key(TEXT) TO backend_app;

ALTER TABLE auth.agent_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_self_select_runtime ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_insert_runtime ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_update_runtime ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_delete_runtime ON org.user_settings;

CREATE POLICY user_settings_self_select_runtime
  ON org.user_settings
  FOR SELECT
  TO backend_app, auth_app
  USING (user_id = security.current_user_id());

CREATE POLICY user_settings_self_insert_runtime
  ON org.user_settings
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY user_settings_self_update_runtime
  ON org.user_settings
  FOR UPDATE
  TO backend_app, auth_app
  USING (user_id = security.current_user_id())
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      workspace_id IS NULL
      OR security.user_has_workspace_access(workspace_id)
    )
  );

CREATE POLICY user_settings_self_delete_runtime
  ON org.user_settings
  FOR DELETE
  TO backend_app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS workspace_memberships_access_select_runtime ON org.workspace_memberships;
DROP POLICY IF EXISTS workspace_memberships_self_insert_runtime ON org.workspace_memberships;

CREATE POLICY workspace_memberships_access_select_runtime
  ON org.workspace_memberships
  FOR SELECT
  TO backend_app, auth_app
  USING (security.user_has_workspace_access(workspace_id));

CREATE POLICY workspace_memberships_self_insert_runtime
  ON org.workspace_memberships
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND workspace_id = security.current_workspace_id()
  );

DROP POLICY IF EXISTS workspaces_access_select_runtime ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_insert_runtime ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_update_runtime ON org.workspaces;
DROP POLICY IF EXISTS workspaces_access_delete_runtime ON org.workspaces;

CREATE POLICY workspaces_access_select_runtime
  ON org.workspaces
  FOR SELECT
  TO backend_app
  USING (security.user_has_workspace_access(workspace_id));

CREATE POLICY workspaces_scoped_insert_runtime
  ON org.workspaces
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (
    security.current_user_id() IS NOT NULL
    AND workspace_id = security.current_workspace_id()
  );

CREATE POLICY workspaces_scoped_update_runtime
  ON org.workspaces
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY workspaces_access_delete_runtime
  ON org.workspaces
  FOR DELETE
  TO backend_app
  USING (
    security.current_user_is_workspace_owner(workspace_id)
    AND security.current_user_is_sole_workspace_member(workspace_id)
  );

DROP POLICY IF EXISTS cards_scoped_select_runtime ON content.cards;
DROP POLICY IF EXISTS cards_scoped_insert_runtime ON content.cards;
DROP POLICY IF EXISTS cards_scoped_update_runtime ON content.cards;
DROP POLICY IF EXISTS cards_scoped_delete_runtime ON content.cards;

CREATE POLICY cards_scoped_select_runtime
  ON content.cards
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_insert_runtime
  ON content.cards
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_update_runtime
  ON content.cards
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_delete_runtime
  ON content.cards
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS decks_scoped_select_runtime ON content.decks;
DROP POLICY IF EXISTS decks_scoped_insert_runtime ON content.decks;
DROP POLICY IF EXISTS decks_scoped_update_runtime ON content.decks;
DROP POLICY IF EXISTS decks_scoped_delete_runtime ON content.decks;

CREATE POLICY decks_scoped_select_runtime
  ON content.decks
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_insert_runtime
  ON content.decks
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_update_runtime
  ON content.decks
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_delete_runtime
  ON content.decks
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS review_events_scoped_select_runtime ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_insert_runtime ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_update_runtime ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_delete_runtime ON content.review_events;

CREATE POLICY review_events_scoped_select_runtime
  ON content.review_events
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_insert_runtime
  ON content.review_events
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_update_runtime
  ON content.review_events
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_delete_runtime
  ON content.review_events
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS devices_scoped_select_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_insert_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_update_runtime ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_delete_runtime ON sync.devices;

CREATE POLICY devices_scoped_select_runtime
  ON sync.devices
  FOR SELECT
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_insert_runtime
  ON sync.devices
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_update_runtime
  ON sync.devices
  FOR UPDATE
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  )
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_delete_runtime
  ON sync.devices
  FOR DELETE
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

DROP POLICY IF EXISTS applied_operations_scoped_select_runtime ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_insert_runtime ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_update_runtime ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_delete_runtime ON sync.applied_operations;

CREATE POLICY applied_operations_scoped_select_runtime
  ON sync.applied_operations
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_insert_runtime
  ON sync.applied_operations
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_update_runtime
  ON sync.applied_operations
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_delete_runtime
  ON sync.applied_operations
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS changes_scoped_select_runtime ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_insert_runtime ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_update_runtime ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_delete_runtime ON sync.changes;

CREATE POLICY changes_scoped_select_runtime
  ON sync.changes
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_insert_runtime
  ON sync.changes
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_update_runtime
  ON sync.changes
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_delete_runtime
  ON sync.changes
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS agent_api_keys_select_runtime ON auth.agent_api_keys;
DROP POLICY IF EXISTS agent_api_keys_insert_runtime ON auth.agent_api_keys;
DROP POLICY IF EXISTS agent_api_keys_update_runtime ON auth.agent_api_keys;

CREATE POLICY agent_api_keys_select_runtime
  ON auth.agent_api_keys
  FOR SELECT
  TO backend_app, auth_app
  USING (user_id = security.current_user_id());

CREATE POLICY agent_api_keys_insert_runtime
  ON auth.agent_api_keys
  FOR INSERT
  TO auth_app
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY agent_api_keys_update_runtime
  ON auth.agent_api_keys
  FOR UPDATE
  TO backend_app
  USING (user_id = security.current_user_id())
  WITH CHECK (user_id = security.current_user_id());
