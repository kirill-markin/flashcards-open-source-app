-- Migration status: Current / additive.
-- Introduces: workspace-scoped media asset metadata registry for private S3-backed transfers.
-- Schemas touched/read explicitly: content, org, sync, security.

CREATE TABLE IF NOT EXISTS content.media_assets (
  media_asset_id              UUID        PRIMARY KEY,
  workspace_id                UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  mime_type                   TEXT        NOT NULL,
  size_bytes                  BIGINT      NOT NULL CHECK (size_bytes >= 0),
  sha256                      TEXT        NOT NULL,
  storage_key                 TEXT        NOT NULL UNIQUE,
  source_url                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL,
  client_updated_at           TIMESTAMPTZ NOT NULL,
  last_modified_by_replica_id UUID        NOT NULL,
  last_operation_id           TEXT        NOT NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ,
  CONSTRAINT media_assets_mime_type_nonempty CHECK (btrim(mime_type) <> ''),
  CONSTRAINT media_assets_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_assets_storage_key_nonempty CHECK (btrim(storage_key) <> ''),
  CONSTRAINT media_assets_last_operation_id_nonempty CHECK (btrim(last_operation_id) <> ''),
  CONSTRAINT media_assets_last_modified_replica_fk
    FOREIGN KEY (last_modified_by_replica_id)
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_updated_active
  ON content.media_assets(workspace_id, updated_at DESC, media_asset_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_sha256_active
  ON content.media_assets(workspace_id, sha256, media_asset_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_client_updated
  ON content.media_assets(workspace_id, client_updated_at DESC, media_asset_id);

COMMENT ON TABLE content.media_assets IS 'Workspace-scoped media file metadata registry. File bytes live outside Postgres in private object storage.';
COMMENT ON COLUMN content.media_assets.media_asset_id IS 'Client/server generated immutable media asset identity.';
COMMENT ON COLUMN content.media_assets.workspace_id IS 'Owning workspace for authorization, lifecycle, and future sync scoping.';
COMMENT ON COLUMN content.media_assets.mime_type IS 'Declared media MIME type validated by the backend API boundary.';
COMMENT ON COLUMN content.media_assets.size_bytes IS 'Declared media object size in bytes. File bytes are stored in private object storage, not Postgres.';
COMMENT ON COLUMN content.media_assets.sha256 IS 'Lowercase hex SHA-256 digest of the media object bytes.';
COMMENT ON COLUMN content.media_assets.storage_key IS 'Private object storage key for the media bytes.';
COMMENT ON COLUMN content.media_assets.source_url IS 'Optional provenance URL for imported media; the backend does not ingest external URLs in this table.';
COMMENT ON COLUMN content.media_assets.created_at IS 'Client-visible creation timestamp for the media asset metadata row.';
COMMENT ON COLUMN content.media_assets.client_updated_at IS 'Client LWW timestamp for the media asset metadata row.';
COMMENT ON COLUMN content.media_assets.last_modified_by_replica_id IS 'Immutable workspace replica that last produced the winning media asset metadata row.';
COMMENT ON COLUMN content.media_assets.last_operation_id IS 'Client operation id that produced the winning media asset metadata row.';
COMMENT ON COLUMN content.media_assets.updated_at IS 'Server timestamp for the latest accepted metadata mutation.';
COMMENT ON COLUMN content.media_assets.deleted_at IS 'Tombstone timestamp for future media asset sync support.';

ALTER TABLE content.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_assets_scoped_select_runtime ON content.media_assets;
DROP POLICY IF EXISTS media_assets_scoped_insert_runtime ON content.media_assets;
DROP POLICY IF EXISTS media_assets_scoped_update_runtime ON content.media_assets;
DROP POLICY IF EXISTS media_assets_scoped_delete_runtime ON content.media_assets;

CREATE POLICY media_assets_scoped_select_runtime
  ON content.media_assets
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_assets_scoped_insert_runtime
  ON content.media_assets
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_assets_scoped_update_runtime
  ON content.media_assets
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_assets_scoped_delete_runtime
  ON content.media_assets
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

DROP POLICY IF EXISTS media_assets_reporting_readonly_select ON content.media_assets;

CREATE POLICY media_assets_reporting_readonly_select
  ON content.media_assets
  FOR SELECT
  TO reporting_readonly
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON content.media_assets TO backend_app;
GRANT SELECT ON TABLE content.media_assets TO reporting_readonly;
