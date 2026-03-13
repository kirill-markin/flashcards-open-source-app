-- Harden row-level security policies for selected workspace updates and workspace deletion.

CREATE OR REPLACE FUNCTION security.current_user_is_workspace_owner(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.user_id = security.current_user_id()
      AND memberships.workspace_id = target_workspace_id
      AND memberships.role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION security.current_user_is_sole_workspace_member(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (
    SELECT COUNT(*)
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = target_workspace_id
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.user_id = security.current_user_id()
      AND memberships.workspace_id = target_workspace_id
  );
$$;

REVOKE ALL ON FUNCTION security.current_user_is_workspace_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.current_user_is_sole_workspace_member(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security.current_user_is_workspace_owner(UUID) TO app;
GRANT EXECUTE ON FUNCTION security.current_user_is_sole_workspace_member(UUID) TO app;

COMMENT ON FUNCTION security.current_user_is_workspace_owner(UUID) IS 'Returns whether the request-scoped user is an owner of the provided workspace.';
COMMENT ON FUNCTION security.current_user_is_sole_workspace_member(UUID) IS 'Returns whether the request-scoped user is the only membership row in the provided workspace.';

DROP POLICY IF EXISTS user_settings_self_update ON org.user_settings;

CREATE POLICY user_settings_self_update
  ON org.user_settings
  FOR UPDATE
  TO app
  USING (user_id = security.current_user_id())
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      workspace_id IS NULL
      OR security.user_has_workspace_access(workspace_id)
    )
  );

DROP POLICY IF EXISTS workspaces_access_delete ON org.workspaces;

CREATE POLICY workspaces_access_delete
  ON org.workspaces
  FOR DELETE
  TO app
  USING (
    security.current_user_is_workspace_owner(workspace_id)
    AND security.current_user_is_sole_workspace_member(workspace_id)
  );

DROP POLICY IF EXISTS workspace_memberships_self_delete ON org.workspace_memberships;
