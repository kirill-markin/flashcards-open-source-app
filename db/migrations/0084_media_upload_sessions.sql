-- Migration status: Current.
-- Introduces: backend-owned S3 multipart media upload session state.
-- Schemas touched/read explicitly: content, org, sync, security.

CREATE TABLE IF NOT EXISTS content.media_upload_sessions (
  media_upload_session_id UUID        PRIMARY KEY,
  workspace_id             UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  media_asset_id           UUID        NOT NULL,
  media_blob_sha256        TEXT        NOT NULL CHECK (media_blob_sha256 ~ '^[0-9a-f]{64}$'),
  staging_storage_key      TEXT        NOT NULL CHECK (btrim(staging_storage_key) <> ''),
  blob_storage_key         TEXT        NOT NULL CHECK (btrim(blob_storage_key) <> ''),
  s3_upload_id             TEXT        NOT NULL CHECK (btrim(s3_upload_id) <> ''),
  mime_type                TEXT        NOT NULL CHECK (btrim(mime_type) <> ''),
  size_bytes               BIGINT      NOT NULL CHECK (size_bytes > 0),
  part_size_bytes          BIGINT      NOT NULL CHECK (part_size_bytes > 0),
  part_count               INTEGER     NOT NULL CHECK (part_count > 0 AND part_count <= 10000),
  state                    TEXT        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'completing', 'completed', 'aborting', 'aborted')),
  source_url               TEXT,
  asset_created_at         TIMESTAMPTZ NOT NULL,
  client_updated_at        TIMESTAMPTZ NOT NULL,
  last_modified_by_replica_id UUID     NOT NULL,
  last_operation_id        TEXT        NOT NULL CHECK (btrim(last_operation_id) <> ''),
  expires_at               TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ,
  aborted_at               TIMESTAMPTZ,
  CONSTRAINT media_upload_sessions_replica_fk
    FOREIGN KEY (last_modified_by_replica_id)
    REFERENCES sync.workspace_replicas(replica_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT media_upload_sessions_blob_storage_key_matches_blob_sha
    CHECK (blob_storage_key = 'media/blobs/sha256/' || substring(media_blob_sha256 from 1 for 2) || '/' || substring(media_blob_sha256 from 3 for 2) || '/' || media_blob_sha256),
  CONSTRAINT media_upload_sessions_staging_storage_key_scoped
    CHECK (staging_storage_key = 'media/uploads/workspaces/' || lower(workspace_id::text) || '/assets/' || lower(media_asset_id::text) || '/sessions/' || lower(media_upload_session_id::text)),
  CONSTRAINT media_upload_sessions_state_timestamps
    CHECK (
      (state = 'active' AND completed_at IS NULL AND aborted_at IS NULL)
      OR (state = 'completing' AND completed_at IS NULL AND aborted_at IS NULL)
      OR (state = 'completed' AND completed_at IS NOT NULL AND aborted_at IS NULL)
      OR (state = 'aborting' AND completed_at IS NULL AND aborted_at IS NULL)
      OR (state = 'aborted' AND completed_at IS NULL AND aborted_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_workspace_active
  ON content.media_upload_sessions(workspace_id, expires_at, media_upload_session_id)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_workspace_asset
  ON content.media_upload_sessions(workspace_id, media_asset_id, created_at DESC);

COMMENT ON TABLE content.media_upload_sessions IS 'Backend-owned S3 multipart upload state for media blobs before a logical media asset is registered.';
COMMENT ON COLUMN content.media_upload_sessions.media_upload_session_id IS 'Backend-generated upload session id exposed to clients instead of S3 object keys or upload ids.';
COMMENT ON COLUMN content.media_upload_sessions.workspace_id IS 'Owning workspace for authorization and RLS scoping.';
COMMENT ON COLUMN content.media_upload_sessions.media_asset_id IS 'Logical media asset id that will reference the uploaded blob after completion.';
COMMENT ON COLUMN content.media_upload_sessions.media_blob_sha256 IS 'Declared lowercase hex SHA-256 digest of the final normalized blob bytes.';
COMMENT ON COLUMN content.media_upload_sessions.staging_storage_key IS 'Private session-scoped object storage key that receives unvalidated multipart bytes.';
COMMENT ON COLUMN content.media_upload_sessions.blob_storage_key IS 'Private content-addressed object storage key for the validated target blob.';
COMMENT ON COLUMN content.media_upload_sessions.s3_upload_id IS 'Private S3 multipart upload id required for part signing, completion, and abort.';
COMMENT ON COLUMN content.media_upload_sessions.mime_type IS 'Canonical MIME type for the final normalized blob bytes.';
COMMENT ON COLUMN content.media_upload_sessions.size_bytes IS 'Final normalized blob size in bytes.';
COMMENT ON COLUMN content.media_upload_sessions.part_size_bytes IS 'Requested multipart part size in bytes.';
COMMENT ON COLUMN content.media_upload_sessions.part_count IS 'Expected number of S3 upload parts.';
COMMENT ON COLUMN content.media_upload_sessions.state IS 'Upload session lifecycle: active, completing, completed, aborting, or aborted.';
COMMENT ON COLUMN content.media_upload_sessions.source_url IS 'Optional provenance URL for imported media.';
COMMENT ON COLUMN content.media_upload_sessions.asset_created_at IS 'Client-visible creation timestamp for the logical media asset metadata row.';
COMMENT ON COLUMN content.media_upload_sessions.client_updated_at IS 'Client LWW timestamp for the logical media asset metadata row.';
COMMENT ON COLUMN content.media_upload_sessions.last_modified_by_replica_id IS 'Workspace replica that produced this upload session metadata.';
COMMENT ON COLUMN content.media_upload_sessions.last_operation_id IS 'Client operation id for the logical media asset metadata row.';
COMMENT ON COLUMN content.media_upload_sessions.expires_at IS 'Time after which the backend no longer signs parts or accepts completion for this session.';
COMMENT ON COLUMN content.media_upload_sessions.created_at IS 'Server timestamp when this upload session was created.';
COMMENT ON COLUMN content.media_upload_sessions.completed_at IS 'Server timestamp when the session successfully registered its logical media asset.';
COMMENT ON COLUMN content.media_upload_sessions.aborted_at IS 'Server timestamp when the session was explicitly aborted.';

ALTER TABLE content.media_upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_upload_sessions_scoped_select_runtime ON content.media_upload_sessions;
DROP POLICY IF EXISTS media_upload_sessions_scoped_insert_runtime ON content.media_upload_sessions;
DROP POLICY IF EXISTS media_upload_sessions_scoped_update_runtime ON content.media_upload_sessions;
DROP POLICY IF EXISTS media_upload_sessions_scoped_delete_runtime ON content.media_upload_sessions;

CREATE POLICY media_upload_sessions_scoped_select_runtime
  ON content.media_upload_sessions
  FOR SELECT
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_upload_sessions_scoped_insert_runtime
  ON content.media_upload_sessions
  FOR INSERT
  TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_upload_sessions_scoped_update_runtime
  ON content.media_upload_sessions
  FOR UPDATE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id))
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));

CREATE POLICY media_upload_sessions_scoped_delete_runtime
  ON content.media_upload_sessions
  FOR DELETE
  TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON content.media_upload_sessions TO backend_app;
