-- Migration status: Current / clean rewrite.
-- Introduces: backend-internal deduplicated media blobs referenced by logical media assets.
-- Schemas touched/read explicitly: content, org, sync, security.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content.media_assets LIMIT 1) THEN
    RAISE EXCEPTION 'content.media_assets contains existing rows; migration 0082 cannot rewrite media asset storage columns into content.media_blobs without moving object-storage bytes. Clear or explicitly migrate media rows before applying this migration.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS content.media_blobs (
  media_blob_id UUID        PRIMARY KEY,
  sha256        TEXT        NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type     TEXT        NOT NULL CHECK (btrim(mime_type) <> ''),
  size_bytes    BIGINT      NOT NULL CHECK (size_bytes >= 0),
  storage_key   TEXT        NOT NULL UNIQUE CHECK (btrim(storage_key) <> ''),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE content.media_blobs IS 'Backend-internal deduplicated media object metadata. Logical workspace media assets reference these rows.';
COMMENT ON COLUMN content.media_blobs.media_blob_id IS 'Server-generated immutable identity for one deduplicated media blob.';
COMMENT ON COLUMN content.media_blobs.sha256 IS 'Lowercase hex SHA-256 digest of the final normalized blob bytes.';
COMMENT ON COLUMN content.media_blobs.mime_type IS 'Canonical MIME type for the final normalized blob bytes.';
COMMENT ON COLUMN content.media_blobs.size_bytes IS 'Final normalized blob size in bytes. File bytes are stored in private object storage, not Postgres.';
COMMENT ON COLUMN content.media_blobs.storage_key IS 'Private content-addressed object storage key for the blob bytes.';
COMMENT ON COLUMN content.media_blobs.created_at IS 'Server timestamp when this blob metadata row was created.';
COMMENT ON COLUMN content.media_blobs.updated_at IS 'Server timestamp when this blob metadata row was last updated.';

DROP INDEX IF EXISTS content.idx_media_assets_workspace_sha256_active;

ALTER TABLE content.media_assets
  ADD COLUMN IF NOT EXISTS media_blob_id UUID;

ALTER TABLE content.media_assets
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS size_bytes,
  DROP COLUMN IF EXISTS sha256,
  DROP COLUMN IF EXISTS storage_key;

ALTER TABLE content.media_assets
  ALTER COLUMN media_blob_id SET NOT NULL;

ALTER TABLE content.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_media_blob_fk,
  ADD CONSTRAINT media_assets_media_blob_fk
    FOREIGN KEY (media_blob_id)
    REFERENCES content.media_blobs(media_blob_id)
    ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_media_assets_media_blob
  ON content.media_assets(media_blob_id);

COMMENT ON TABLE content.media_assets IS 'Workspace-scoped logical media asset registry. Storage metadata lives in content.media_blobs.';
COMMENT ON COLUMN content.media_assets.media_asset_id IS 'Client/server generated immutable logical media asset identity.';
COMMENT ON COLUMN content.media_assets.workspace_id IS 'Owning workspace for authorization, lifecycle, and sync scoping.';
COMMENT ON COLUMN content.media_assets.media_blob_id IS 'Deduplicated media blob referenced by this logical workspace media asset.';
COMMENT ON COLUMN content.media_assets.source_url IS 'Optional provenance URL for imported media; the backend does not ingest external URLs in this table.';
COMMENT ON COLUMN content.media_assets.created_at IS 'Client-visible creation timestamp for the logical media asset metadata row.';
COMMENT ON COLUMN content.media_assets.client_updated_at IS 'Client LWW timestamp for the logical media asset metadata row.';
COMMENT ON COLUMN content.media_assets.last_modified_by_replica_id IS 'Immutable workspace replica that last produced the winning media asset metadata row.';
COMMENT ON COLUMN content.media_assets.last_operation_id IS 'Client operation id that produced the winning media asset metadata row.';
COMMENT ON COLUMN content.media_assets.updated_at IS 'Server timestamp for the latest accepted logical media asset metadata mutation.';
COMMENT ON COLUMN content.media_assets.deleted_at IS 'Tombstone timestamp for logical media asset sync support.';

GRANT SELECT, INSERT, UPDATE ON content.media_blobs TO backend_app;
