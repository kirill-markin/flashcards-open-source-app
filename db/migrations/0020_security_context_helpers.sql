-- Migration status: Historical / partially superseded.
-- Introduces: the security schema and request-scoped helper functions used by runtime database isolation.
-- Current guidance: the helper functions remain canonical, but the legacy app-role grants are historical after the runtime-role split.
-- Replaced or refined by: db/migrations/0024_auth_runtime_roles.sql, db/migrations/0025_remove_legacy_app_role.sql.
-- See also: docs/architecture.md.
-- Helper schema and functions for request-scoped database isolation.

CREATE SCHEMA IF NOT EXISTS security;

GRANT USAGE ON SCHEMA security TO app;

CREATE OR REPLACE FUNCTION security.current_user_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION security.current_workspace_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION security.user_has_workspace_access(target_workspace_id UUID)
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
  );
$$;

CREATE OR REPLACE FUNCTION security.current_workspace_access_allowed(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT security.current_workspace_id() = target_workspace_id
    AND security.user_has_workspace_access(target_workspace_id);
$$;

REVOKE ALL ON FUNCTION security.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION security.current_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION security.user_has_workspace_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.current_workspace_access_allowed(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security.current_user_id() TO app;
GRANT EXECUTE ON FUNCTION security.current_workspace_id() TO app;
GRANT EXECUTE ON FUNCTION security.user_has_workspace_access(UUID) TO app;
GRANT EXECUTE ON FUNCTION security.current_workspace_access_allowed(UUID) TO app;

COMMENT ON FUNCTION security.current_user_id() IS 'Returns the current request-scoped authenticated user id from app.user_id.';
COMMENT ON FUNCTION security.current_workspace_id() IS 'Returns the current request-scoped workspace id from app.workspace_id.';
COMMENT ON FUNCTION security.user_has_workspace_access(UUID) IS 'Returns whether the request-scoped user belongs to the provided workspace.';
COMMENT ON FUNCTION security.current_workspace_access_allowed(UUID) IS 'Returns whether the request-scoped workspace matches the provided workspace and the request-scoped user belongs to it.';
