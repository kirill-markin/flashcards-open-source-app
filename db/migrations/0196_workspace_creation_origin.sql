-- Schemas touched/read explicitly: org, pg_catalog.
ALTER TABLE org.workspaces
  ADD COLUMN creation_origin TEXT NOT NULL DEFAULT 'unknown'
    CONSTRAINT workspaces_creation_origin_check
    CHECK (creation_origin IN ('unknown', 'automatic_starter', 'explicit')),
  ADD COLUMN starter_suppressed_at TIMESTAMPTZ;

COMMENT ON COLUMN org.workspaces.creation_origin IS
  'Server-owned creation cause. Unknown preserves historical rows and inserts from older serving code without guessing from names or bootstrap actors.';
COMMENT ON COLUMN org.workspaces.starter_suppressed_at IS
  'Reserved for account-combine starter suppression. This marker alone does not change visibility or access.';

CREATE FUNCTION org.prevent_workspace_creation_origin_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.creation_origin IS DISTINCT FROM OLD.creation_origin THEN
    RAISE EXCEPTION 'Workspace creation origin cannot change after creation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION org.prevent_workspace_creation_origin_update() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER prevent_workspace_creation_origin_update
BEFORE UPDATE OF creation_origin ON org.workspaces
FOR EACH ROW EXECUTE FUNCTION org.prevent_workspace_creation_origin_update();
