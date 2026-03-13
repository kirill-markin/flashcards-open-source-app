-- Row-level security for user- and workspace-scoped tables.

ALTER TABLE org.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE content.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE content.decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE content.review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.applied_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_self_select ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_insert ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_update ON org.user_settings;
DROP POLICY IF EXISTS user_settings_self_delete ON org.user_settings;

CREATE POLICY user_settings_self_select
  ON org.user_settings
  FOR SELECT
  TO app
  USING (user_id = security.current_user_id());

CREATE POLICY user_settings_self_insert
  ON org.user_settings
  FOR INSERT
  TO app
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY user_settings_self_update
  ON org.user_settings
  FOR UPDATE
  TO app
  USING (user_id = security.current_user_id())
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY user_settings_self_delete
  ON org.user_settings
  FOR DELETE
  TO app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS workspace_memberships_access_select ON org.workspace_memberships;
DROP POLICY IF EXISTS workspace_memberships_self_insert ON org.workspace_memberships;
DROP POLICY IF EXISTS workspace_memberships_self_delete ON org.workspace_memberships;

CREATE POLICY workspace_memberships_access_select
  ON org.workspace_memberships
  FOR SELECT
  TO app
  USING (security.user_has_workspace_access(workspace_id));

CREATE POLICY workspace_memberships_self_insert
  ON org.workspace_memberships
  FOR INSERT
  TO app
  WITH CHECK (
    user_id = security.current_user_id()
    AND workspace_id = security.current_workspace_id()
  );

CREATE POLICY workspace_memberships_self_delete
  ON org.workspace_memberships
  FOR DELETE
  TO app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS workspaces_access_select ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_insert ON org.workspaces;
DROP POLICY IF EXISTS workspaces_scoped_update ON org.workspaces;
DROP POLICY IF EXISTS workspaces_access_delete ON org.workspaces;

CREATE POLICY workspaces_access_select
  ON org.workspaces
  FOR SELECT
  TO app
  USING (security.user_has_workspace_access(workspace_id));

CREATE POLICY workspaces_scoped_insert
  ON org.workspaces
  FOR INSERT
  TO app
  WITH CHECK (
    security.current_user_id() IS NOT NULL
    AND workspace_id = security.current_workspace_id()
  );

CREATE POLICY workspaces_scoped_update
  ON org.workspaces
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY workspaces_access_delete
  ON org.workspaces
  FOR DELETE
  TO app
  USING (security.user_has_workspace_access(workspace_id));

DROP POLICY IF EXISTS cards_scoped_select ON content.cards;
DROP POLICY IF EXISTS cards_scoped_insert ON content.cards;
DROP POLICY IF EXISTS cards_scoped_update ON content.cards;
DROP POLICY IF EXISTS cards_scoped_delete ON content.cards;

CREATE POLICY cards_scoped_select
  ON content.cards
  FOR SELECT
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_insert
  ON content.cards
  FOR INSERT
  TO app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_update
  ON content.cards
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY cards_scoped_delete
  ON content.cards
  FOR DELETE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS decks_scoped_select ON content.decks;
DROP POLICY IF EXISTS decks_scoped_insert ON content.decks;
DROP POLICY IF EXISTS decks_scoped_update ON content.decks;
DROP POLICY IF EXISTS decks_scoped_delete ON content.decks;

CREATE POLICY decks_scoped_select
  ON content.decks
  FOR SELECT
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_insert
  ON content.decks
  FOR INSERT
  TO app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_update
  ON content.decks
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY decks_scoped_delete
  ON content.decks
  FOR DELETE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS review_events_scoped_select ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_insert ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_update ON content.review_events;
DROP POLICY IF EXISTS review_events_scoped_delete ON content.review_events;

CREATE POLICY review_events_scoped_select
  ON content.review_events
  FOR SELECT
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_insert
  ON content.review_events
  FOR INSERT
  TO app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_update
  ON content.review_events
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY review_events_scoped_delete
  ON content.review_events
  FOR DELETE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS devices_scoped_select ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_insert ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_update ON sync.devices;
DROP POLICY IF EXISTS devices_scoped_delete ON sync.devices;

CREATE POLICY devices_scoped_select
  ON sync.devices
  FOR SELECT
  TO app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_insert
  ON sync.devices
  FOR INSERT
  TO app
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_update
  ON sync.devices
  FOR UPDATE
  TO app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  )
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY devices_scoped_delete
  ON sync.devices
  FOR DELETE
  TO app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

DROP POLICY IF EXISTS applied_operations_scoped_select ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_insert ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_update ON sync.applied_operations;
DROP POLICY IF EXISTS applied_operations_scoped_delete ON sync.applied_operations;

CREATE POLICY applied_operations_scoped_select
  ON sync.applied_operations
  FOR SELECT
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_insert
  ON sync.applied_operations
  FOR INSERT
  TO app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_update
  ON sync.applied_operations
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY applied_operations_scoped_delete
  ON sync.applied_operations
  FOR DELETE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS changes_scoped_select ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_insert ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_update ON sync.changes;
DROP POLICY IF EXISTS changes_scoped_delete ON sync.changes;

CREATE POLICY changes_scoped_select
  ON sync.changes
  FOR SELECT
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_insert
  ON sync.changes
  FOR INSERT
  TO app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_update
  ON sync.changes
  FOR UPDATE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY changes_scoped_delete
  ON sync.changes
  FOR DELETE
  TO app
  USING (security.current_workspace_access_allowed(workspace_id));
