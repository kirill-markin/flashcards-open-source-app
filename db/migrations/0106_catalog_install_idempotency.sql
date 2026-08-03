-- Migration status: Current / additive.
-- Introduces: durable request/result idempotency for workspace catalog package installs.
-- Schemas touched/read explicitly: sync, org, security, pg_catalog.

CREATE TABLE IF NOT EXISTS sync.catalog_package_install_idempotency (
  workspace_id                UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  install_id                  TEXT        NOT NULL,
  package_version_id          UUID        NOT NULL,
  installed_at                TIMESTAMPTZ NOT NULL,
  client_updated_at           TIMESTAMPTZ NOT NULL,
  last_modified_by_replica_id UUID        NOT NULL,
  operation_id_prefix         TEXT        NOT NULL,
  add_import_tag              BOOLEAN     NOT NULL,
  import_tag                  TEXT,
  remove_tags                 TEXT[]      NOT NULL,
  install_result              JSONB       NOT NULL,
  completed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, install_id),
  CONSTRAINT catalog_package_install_idempotency_install_id_valid CHECK (
    install_id = pg_catalog.btrim(install_id)
    AND pg_catalog.char_length(install_id) BETWEEN 1 AND 128
  ),
  CONSTRAINT catalog_package_install_idempotency_operation_id_prefix_valid CHECK (
    operation_id_prefix = pg_catalog.btrim(operation_id_prefix)
    AND pg_catalog.char_length(operation_id_prefix) BETWEEN 1 AND 1007
  ),
  CONSTRAINT catalog_package_install_idempotency_import_tag_shape CHECK (
    (add_import_tag AND import_tag IS NOT NULL AND import_tag = pg_catalog.btrim(import_tag) AND import_tag <> '')
    OR (NOT add_import_tag AND import_tag IS NULL)
  ),
  CONSTRAINT catalog_package_install_idempotency_remove_tags_valid CHECK (
    pg_catalog.array_position(remove_tags, NULL) IS NULL
  ),
  CONSTRAINT catalog_package_install_idempotency_result_object CHECK (
    pg_catalog.jsonb_typeof(install_result) = 'object'
  )
);

COMMENT ON TABLE sync.catalog_package_install_idempotency IS
  'Completed catalog install request identities and exact results retained only for atomic idempotent replay.';
COMMENT ON COLUMN sync.catalog_package_install_idempotency.install_id IS
  'Caller-generated idempotency key scoped to one workspace.';
COMMENT ON COLUMN sync.catalog_package_install_idempotency.install_result IS
  'Exact successful API result returned for an identical retry after the original transaction committed.';

ALTER TABLE sync.catalog_package_install_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_package_install_idempotency_scoped_select_runtime
  ON sync.catalog_package_install_idempotency;
DROP POLICY IF EXISTS catalog_package_install_idempotency_scoped_insert_runtime
  ON sync.catalog_package_install_idempotency;

CREATE POLICY catalog_package_install_idempotency_scoped_select_runtime
  ON sync.catalog_package_install_idempotency
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY catalog_package_install_idempotency_scoped_insert_runtime
  ON sync.catalog_package_install_idempotency
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

GRANT SELECT, INSERT ON sync.catalog_package_install_idempotency TO backend_app;
