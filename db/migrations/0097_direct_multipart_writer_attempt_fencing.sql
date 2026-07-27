-- Current additive migration for durable direct and multipart writer-attempt leases.
-- Schemas touched/read explicitly: content, org, security, sync, catalog, pg_catalog.
CREATE TYPE content.direct_media_blob_writer_attempt_payload AS (
  user_id TEXT,
  workspace_id UUID,
  media_asset_id UUID,
  operation_id TEXT,
  replica_id UUID,
  sha256 TEXT,
  storage_key TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  normalization_version TEXT,
  source_url TEXT,
  asset_created_at TIMESTAMPTZ,
  client_updated_at TIMESTAMPTZ
);
CREATE TYPE content.multipart_media_blob_writer_attempt_payload AS (
  user_id TEXT,
  workspace_id UUID,
  media_upload_session_id UUID,
  media_asset_id UUID,
  replica_id UUID,
  last_operation_id TEXT,
  sha256 TEXT,
  staging_storage_key TEXT,
  blob_storage_key TEXT,
  s3_upload_id TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  part_size_bytes BIGINT,
  part_count INTEGER,
  source_url TEXT,
  asset_created_at TIMESTAMPTZ,
  client_updated_at TIMESTAMPTZ,
  session_expires_at TIMESTAMPTZ,
  normalization_version TEXT,
  completed_parts_fingerprint TEXT
);
CREATE TABLE content.media_blob_writer_attempts (
  attempt_token UUID PRIMARY KEY,
  reservation_token UUID NOT NULL,
  writer_kind TEXT NOT NULL CHECK (writer_kind IN ('direct_ingestion', 'multipart_completion')),
  user_id TEXT NOT NULL CHECK (user_id = pg_catalog.btrim(user_id) AND user_id <> ''),
  workspace_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  operation_id TEXT NOT NULL,
  last_operation_id TEXT,
  replica_id UUID NOT NULL,
  sha256 TEXT NOT NULL,
  blob_storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  requested_normalization_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  source_url TEXT,
  asset_created_at TIMESTAMPTZ NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  media_upload_session_id UUID,
  staging_storage_key TEXT,
  s3_upload_id TEXT,
  part_size_bytes BIGINT,
  part_count INTEGER,
  session_expires_at TIMESTAMPTZ,
  completed_parts_fingerprint TEXT,
  state TEXT NOT NULL CHECK ( state IN ('leased', 'applied', 'peer_conflict', 'referenced', 'unreferenced', 'cancelled', 'expired')
  ),
  outcome TEXT CHECK ( outcome IS NULL OR outcome IN ( 'already_applied', 'peer_conflict', 'live_applied', 'referenced', 'unreferenced', 'unreferenced_restored', 'already_closed', 'aborted', 'stale_attempt' )
  ),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  terminal_at TIMESTAMPTZ,
  CONSTRAINT media_blob_writer_attempts_operation_safe CHECK ( operation_id = pg_catalog.btrim(operation_id) AND pg_catalog.char_length(operation_id) BETWEEN 1 AND 1024
    AND (last_operation_id IS NULL OR (last_operation_id = pg_catalog.btrim(last_operation_id) AND pg_catalog.char_length(last_operation_id) BETWEEN 1 AND 1024))
  ),
  CONSTRAINT media_blob_writer_attempts_sha256_normalized CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_blob_writer_attempts_storage_key_deterministic CHECK ( blob_storage_key = 'media/blobs/sha256/' || pg_catalog.substring(sha256, 1, 2) || '/' || pg_catalog.substring(sha256, 3, 2) || '/' || sha256
  ),
  CONSTRAINT media_blob_writer_attempts_mime_type_normalized CHECK ( mime_type = pg_catalog.lower(pg_catalog.btrim(mime_type)) AND mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'
  ),
  CONSTRAINT media_blob_writer_attempts_normalization_supported CHECK ( requested_normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1') AND normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1')
  ),
  CONSTRAINT media_blob_writer_attempts_state_shape CHECK ( (state = 'leased' AND outcome IS NULL AND terminal_at IS NULL) OR (state = 'applied' AND outcome IN ('already_applied', 'live_applied') AND terminal_at IS NOT NULL) OR (state = 'peer_conflict' AND outcome = 'peer_conflict' AND terminal_at IS NOT NULL) OR (state = 'referenced' AND outcome = 'referenced' AND terminal_at IS NOT NULL) OR (state = 'unreferenced' AND outcome IN ('unreferenced', 'unreferenced_restored') AND terminal_at IS NOT NULL) OR (state = 'cancelled' AND outcome IN ('already_closed', 'aborted') AND terminal_at IS NOT NULL) OR (state = 'expired' AND outcome = 'stale_attempt' AND terminal_at IS NOT NULL)
  ),
  CONSTRAINT media_blob_writer_attempts_kind_shape CHECK ( ( writer_kind = 'direct_ingestion' AND last_operation_id IS NULL AND media_upload_session_id IS NULL AND staging_storage_key IS NULL AND s3_upload_id IS NULL AND part_size_bytes IS NULL AND part_count IS NULL AND session_expires_at IS NULL AND completed_parts_fingerprint IS NULL ) OR ( writer_kind = 'multipart_completion' AND last_operation_id IS NOT NULL AND media_upload_session_id IS NOT NULL AND operation_id = media_upload_session_id::TEXT AND staging_storage_key IS NOT NULL AND s3_upload_id IS NOT NULL AND part_size_bytes > 0 AND part_count BETWEEN 1 AND 10000 AND session_expires_at IS NOT NULL AND completed_parts_fingerprint ~ '^[0-9a-f]{64}$' )
  )
);
CREATE UNIQUE INDEX media_blob_writer_attempts_one_live_writer
  ON content.media_blob_writer_attempts(writer_kind, workspace_id, media_asset_id, operation_id)
  WHERE state = 'leased';
CREATE INDEX media_blob_writer_attempts_workspace_history
  ON content.media_blob_writer_attempts(workspace_id, writer_kind, media_asset_id, operation_id, created_at);
CREATE INDEX media_blob_writer_attempts_sha256_history
  ON content.media_blob_writer_attempts(sha256, state, attempt_token);
COMMENT ON TABLE content.media_blob_writer_attempts IS
  'Private durable attempt leases and terminal replay history for direct and multipart permanent-blob writers.';
COMMENT ON COLUMN content.media_blob_writer_attempts.reservation_token IS
  'Immutable reservation-token snapshot. It intentionally has no cascading foreign key so attempt history survives logical reservation-token rotation.';
COMMENT ON COLUMN content.media_blob_writer_attempts.completed_parts_fingerprint IS
  'Lowercase SHA-256 of the canonical ordered multipart completion parts payload.';
CREATE FUNCTION content.direct_media_blob_writer_attempt_payload_valid_internal(
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p_payload.user_id IS NOT NULL AND p_payload.user_id = pg_catalog.btrim(p_payload.user_id) AND p_payload.user_id <> '' AND p_payload.workspace_id IS NOT NULL AND p_payload.media_asset_id IS NOT NULL AND p_payload.operation_id IS NOT NULL AND p_payload.operation_id = pg_catalog.btrim(p_payload.operation_id) AND pg_catalog.char_length(p_payload.operation_id) BETWEEN 1 AND 1024 AND p_payload.replica_id IS NOT NULL AND p_payload.sha256 ~ '^[0-9a-f]{64}$' AND p_payload.storage_key = 'media/blobs/sha256/' || pg_catalog.substring(p_payload.sha256, 1, 2) || '/' || pg_catalog.substring(p_payload.sha256, 3, 2) || '/' || p_payload.sha256 AND p_payload.mime_type = pg_catalog.lower(pg_catalog.btrim(p_payload.mime_type)) AND p_payload.mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$' AND p_payload.size_bytes >= 0 AND p_payload.normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1') AND p_payload.asset_created_at IS NOT NULL AND p_payload.client_updated_at IS NOT NULL;
$$;
CREATE FUNCTION content.multipart_media_blob_writer_attempt_payload_valid_internal(
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT p_payload.user_id IS NOT NULL AND p_payload.user_id = pg_catalog.btrim(p_payload.user_id) AND p_payload.user_id <> '' AND p_payload.workspace_id IS NOT NULL AND p_payload.media_upload_session_id IS NOT NULL AND p_payload.media_asset_id IS NOT NULL AND p_payload.replica_id IS NOT NULL AND p_payload.last_operation_id IS NOT NULL AND p_payload.last_operation_id = pg_catalog.btrim(p_payload.last_operation_id) AND pg_catalog.char_length(p_payload.last_operation_id) BETWEEN 1 AND 1024 AND p_payload.sha256 ~ '^[0-9a-f]{64}$' AND p_payload.staging_storage_key = 'media/uploads/workspaces/' || pg_catalog.lower(p_payload.workspace_id::TEXT) || '/assets/' || pg_catalog.lower(p_payload.media_asset_id::TEXT) || '/sessions/' || pg_catalog.lower(p_payload.media_upload_session_id::TEXT) AND p_payload.blob_storage_key = 'media/blobs/sha256/' || pg_catalog.substring(p_payload.sha256, 1, 2) || '/' || pg_catalog.substring(p_payload.sha256, 3, 2) || '/' || p_payload.sha256 AND p_payload.s3_upload_id IS NOT NULL AND p_payload.s3_upload_id = pg_catalog.btrim(p_payload.s3_upload_id) AND p_payload.s3_upload_id <> '' AND p_payload.mime_type = pg_catalog.lower(pg_catalog.btrim(p_payload.mime_type)) AND p_payload.mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$' AND p_payload.size_bytes > 0 AND p_payload.part_size_bytes > 0 AND p_payload.part_count BETWEEN 1 AND 10000 AND p_payload.asset_created_at IS NOT NULL AND p_payload.client_updated_at IS NOT NULL AND p_payload.session_expires_at IS NOT NULL AND p_payload.normalization_version IN ('passthrough-v1', 'image-jpeg-card-v1') AND p_payload.completed_parts_fingerprint ~ '^[0-9a-f]{64}$';
$$;
CREATE FUNCTION content.direct_media_blob_writer_attempt_identity_status_internal(
  p_attempt content.media_blob_writer_attempts, p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN (p_attempt).attempt_token IS NULL THEN 'stale_attempt' WHEN (p_attempt).user_id IS DISTINCT FROM p_payload.user_id OR (p_attempt).replica_id IS DISTINCT FROM p_payload.replica_id THEN 'ownership_mismatch' WHEN (p_attempt).reservation_token IS DISTINCT FROM p_reservation_token THEN 'writer_conflict' WHEN (p_attempt).writer_kind IS DISTINCT FROM 'direct_ingestion' OR (p_attempt).workspace_id IS DISTINCT FROM p_payload.workspace_id OR (p_attempt).media_asset_id IS DISTINCT FROM p_payload.media_asset_id OR (p_attempt).operation_id IS DISTINCT FROM p_payload.operation_id OR (p_attempt).sha256 IS DISTINCT FROM p_payload.sha256 OR (p_attempt).blob_storage_key IS DISTINCT FROM p_payload.storage_key OR (p_attempt).mime_type IS DISTINCT FROM p_payload.mime_type OR (p_attempt).size_bytes IS DISTINCT FROM p_payload.size_bytes OR (p_attempt).normalization_version IS DISTINCT FROM p_payload.normalization_version OR (p_attempt).source_url IS DISTINCT FROM p_payload.source_url OR (p_attempt).asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR (p_attempt).client_updated_at IS DISTINCT FROM p_payload.client_updated_at THEN 'stale_attempt' ELSE 'ready' END;
$$;
CREATE FUNCTION content.multipart_media_blob_writer_attempt_identity_status_internal(
  p_attempt content.media_blob_writer_attempts, p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload)
RETURNS TEXT LANGUAGE SQL IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN (p_attempt).attempt_token IS NULL THEN 'stale_attempt' WHEN (p_attempt).user_id IS DISTINCT FROM p_payload.user_id OR (p_attempt).replica_id IS DISTINCT FROM p_payload.replica_id THEN 'ownership_mismatch' WHEN (p_attempt).reservation_token IS DISTINCT FROM p_reservation_token THEN 'writer_conflict' WHEN (p_attempt).writer_kind IS DISTINCT FROM 'multipart_completion' OR (p_attempt).workspace_id IS DISTINCT FROM p_payload.workspace_id OR (p_attempt).media_asset_id IS DISTINCT FROM p_payload.media_asset_id OR (p_attempt).operation_id IS DISTINCT FROM p_payload.media_upload_session_id::TEXT OR (p_attempt).last_operation_id IS DISTINCT FROM p_payload.last_operation_id OR (p_attempt).sha256 IS DISTINCT FROM p_payload.sha256 OR (p_attempt).blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key OR (p_attempt).mime_type IS DISTINCT FROM p_payload.mime_type OR (p_attempt).size_bytes IS DISTINCT FROM p_payload.size_bytes OR (p_attempt).normalization_version IS DISTINCT FROM p_payload.normalization_version OR (p_attempt).source_url IS DISTINCT FROM p_payload.source_url OR (p_attempt).asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR (p_attempt).client_updated_at IS DISTINCT FROM p_payload.client_updated_at OR (p_attempt).media_upload_session_id IS DISTINCT FROM p_payload.media_upload_session_id OR (p_attempt).staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key OR (p_attempt).s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id OR (p_attempt).part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes OR (p_attempt).part_count IS DISTINCT FROM p_payload.part_count OR (p_attempt).session_expires_at IS DISTINCT FROM p_payload.session_expires_at OR (p_attempt).completed_parts_fingerprint IS DISTINCT FROM p_payload.completed_parts_fingerprint THEN 'stale_attempt' ELSE 'ready' END;
$$;
CREATE FUNCTION content.lock_direct_media_blob_writer_attempt_revoked_internal(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  validation_status TEXT,
  scope_matches BOOLEAN,
  access_present BOOLEAN,
  replica_matches BOOLEAN,
  asset_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  asset RECORD;
  identity_status TEXT;
BEGIN
  IF p_attempt_token IS NULL OR p_reservation_token IS NULL OR content.direct_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true
  THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, false, false, false, NULL::TEXT; RETURN;
  END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT; RETURN;
  END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token AND attempts.state <> 'leased';
  IF FOUND THEN IF attempt.user_id IS DISTINCT FROM security.current_user_id() OR attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT; RETURN; END IF; identity_status := content.direct_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload); IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT; RETURN; END IF; RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT; RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( p_payload.user_id || ':' || p_payload.workspace_id::TEXT, 0::BIGINT));
  scope_matches := security.current_user_id() IS NOT DISTINCT FROM p_payload.user_id AND security.current_workspace_id() IS NOT DISTINCT FROM p_payload.workspace_id;
  SELECT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id) INTO access_present;
  SELECT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id) INTO replica_matches;
  IF scope_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT; RETURN;
  ELSIF replica_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT CASE WHEN access_present THEN 'replica_mismatch' ELSE 'access_denied' END, true, access_present, false, NULL::TEXT; RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( 'direct:' || p_payload.workspace_id::TEXT || ':' || p_payload.media_asset_id::TEXT || ':' || p_payload.operation_id, 2::BIGINT));
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token;
  identity_status := content.direct_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload);
  IF access_present IS DISTINCT FROM true AND identity_status <> 'ready' THEN RETURN QUERY SELECT 'access_denied'::TEXT, true, false, replica_matches, NULL::TEXT; RETURN; END IF;
  IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT; RETURN; END IF;
  IF attempt.state <> 'leased' THEN RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM org.workspaces AS workspaces WHERE workspaces.workspace_id = p_payload.workspace_id)
  THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, false, false, false, NULL::TEXT; RETURN; END IF;
  IF access_present THEN INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES (p_payload.workspace_id, 0, pg_catalog.statement_timestamp()) ON CONFLICT (workspace_id) DO NOTHING; END IF;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_payload.workspace_id FOR UPDATE;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_payload.sha256 FOR UPDATE;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'direct_ingestion' AND reservations.workspace_id = p_payload.workspace_id AND reservations.media_asset_id = p_payload.media_asset_id AND reservations.operation_id = p_payload.operation_id FOR UPDATE;
  IF FOUND THEN SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token FOR UPDATE;
  identity_status := content.direct_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload);
  IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT; RETURN; END IF;
  IF attempt.state <> 'leased' THEN RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT; RETURN;
  END IF;
  IF reservation.reservation_token IS DISTINCT FROM p_reservation_token OR reservation.sha256 IS DISTINCT FROM p_payload.sha256 OR reservation.state NOT IN ('active', 'ambiguous', 'finalized') OR lifecycle.sha256 IS DISTINCT FROM p_payload.sha256 OR lifecycle.storage_key IS DISTINCT FROM p_payload.storage_key OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes OR lifecycle.normalization_version IS DISTINCT FROM p_payload.normalization_version
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, false, false, false, NULL::TEXT; RETURN;
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, false, false, false, NULL::TEXT; RETURN;
  END IF;
  IF owner_snapshot.reservation_token IS NULL OR owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id
  THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, false, false, false, NULL::TEXT; RETURN;
  END IF;
  SELECT * INTO asset FROM content.classify_media_upload_session_completion_asset_internal( p_payload.workspace_id, p_payload.media_asset_id, p_payload.sha256, p_payload.storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, p_payload.source_url, p_payload.asset_created_at, p_payload.client_updated_at, p_payload.replica_id, p_payload.operation_id);
  scope_matches := security.current_user_id() IS NOT DISTINCT FROM p_payload.user_id AND security.current_workspace_id() IS NOT DISTINCT FROM p_payload.workspace_id;
  SELECT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id
  ) INTO access_present;
  SELECT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id
  ) INTO replica_matches;
  IF scope_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT; RETURN;
  ELSIF replica_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT CASE WHEN access_present THEN 'replica_mismatch' ELSE 'access_denied' END, true, access_present, false, NULL::TEXT; RETURN;
  ELSIF EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS successor WHERE successor.writer_kind = 'direct_ingestion' AND successor.workspace_id = p_payload.workspace_id AND successor.media_asset_id = p_payload.media_asset_id AND successor.operation_id = p_payload.operation_id AND successor.state = 'leased' AND successor.attempt_token <> p_attempt_token) THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, true, access_present, true, NULL::TEXT; RETURN; END IF;
  RETURN QUERY SELECT 'ready'::TEXT, scope_matches, access_present, replica_matches, asset.asset_status;
END;
$$;
CREATE FUNCTION content.lock_multipart_media_blob_writer_attempt_revoked_internal(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  validation_status TEXT,
  scope_matches BOOLEAN,
  access_present BOOLEAN,
  replica_matches BOOLEAN,
  asset_status TEXT,
  session_state TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  asset RECORD;
  identity_status TEXT;
BEGIN
  IF p_attempt_token IS NULL OR p_reservation_token IS NULL OR content.multipart_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true
  THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token AND attempts.state <> 'leased';
  IF FOUND THEN IF attempt.user_id IS DISTINCT FROM security.current_user_id() OR attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF; identity_status := content.multipart_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload); IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF; RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( p_payload.user_id || ':' || p_payload.workspace_id::TEXT, 0::BIGINT));
  scope_matches := security.current_user_id() IS NOT DISTINCT FROM p_payload.user_id AND security.current_workspace_id() IS NOT DISTINCT FROM p_payload.workspace_id;
  SELECT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id) INTO access_present;
  SELECT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id) INTO replica_matches;
  IF scope_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF replica_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT CASE WHEN access_present THEN 'replica_mismatch' ELSE 'access_denied' END, true, access_present, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id FOR UPDATE;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token;
  identity_status := content.multipart_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload);
  IF access_present IS DISTINCT FROM true AND identity_status <> 'ready' THEN RETURN QUERY SELECT 'access_denied'::TEXT, true, false, replica_matches, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  IF attempt.state <> 'leased' THEN RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM org.workspaces AS workspaces WHERE workspaces.workspace_id = p_payload.workspace_id)
  THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  IF access_present THEN INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at) VALUES (p_payload.workspace_id, 0, pg_catalog.statement_timestamp()) ON CONFLICT (workspace_id) DO NOTHING; END IF;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_payload.workspace_id FOR UPDATE;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_payload.sha256 FOR UPDATE;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion' AND reservations.workspace_id = p_payload.workspace_id AND reservations.media_asset_id = p_payload.media_asset_id AND reservations.operation_id = p_payload.media_upload_session_id::TEXT FOR UPDATE;
  IF FOUND THEN SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token FOR UPDATE;
  identity_status := content.multipart_media_blob_writer_attempt_identity_status_internal(attempt, p_reservation_token, p_payload);
  IF identity_status <> 'ready' THEN RETURN QUERY SELECT identity_status, false, false, false, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  IF attempt.state <> 'leased' THEN RETURN QUERY SELECT attempt.outcome, true, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF reservation.reservation_token IS DISTINCT FROM p_reservation_token OR reservation.sha256 IS DISTINCT FROM p_payload.sha256 OR reservation.state NOT IN ('active', 'ambiguous', 'finalized') OR lifecycle.sha256 IS DISTINCT FROM p_payload.sha256 OR lifecycle.storage_key IS DISTINCT FROM p_payload.blob_storage_key OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes OR lifecycle.normalization_version IS DISTINCT FROM p_payload.normalization_version
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF owner_snapshot.reservation_token IS NULL OR owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_payload.last_operation_id OR owner_snapshot.session_expires_at IS DISTINCT FROM p_payload.session_expires_at OR owner_snapshot.session_source_url IS DISTINCT FROM p_payload.source_url OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_payload.client_updated_at
  THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF session.media_upload_session_id IS NULL OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id OR session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id OR session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256 OR session.staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id OR session.mime_type IS DISTINCT FROM p_payload.mime_type OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes OR session.part_count IS DISTINCT FROM p_payload.part_count OR session.source_url IS DISTINCT FROM p_payload.source_url OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN RETURN QUERY SELECT 'stale'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  SELECT * INTO asset FROM content.classify_media_upload_session_completion_asset_internal( p_payload.workspace_id, p_payload.media_asset_id, p_payload.sha256, p_payload.blob_storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, p_payload.source_url, p_payload.asset_created_at, p_payload.client_updated_at, p_payload.replica_id, p_payload.last_operation_id);
  scope_matches := security.current_user_id() IS NOT DISTINCT FROM p_payload.user_id AND security.current_workspace_id() IS NOT DISTINCT FROM p_payload.workspace_id;
  SELECT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id
  ) INTO access_present;
  SELECT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id
  ) INTO replica_matches;
  IF scope_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT 'access_denied'::TEXT, false, false, false, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF replica_matches IS DISTINCT FROM true THEN RETURN QUERY SELECT CASE WHEN access_present THEN 'replica_mismatch' ELSE 'access_denied' END, true, access_present, false, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS successor WHERE successor.writer_kind = 'multipart_completion' AND successor.media_upload_session_id = p_payload.media_upload_session_id AND successor.state = 'leased' AND successor.attempt_token <> p_attempt_token) THEN RETURN QUERY SELECT 'stale_attempt'::TEXT, true, access_present, true, NULL::TEXT, NULL::TEXT; RETURN; END IF;
  RETURN QUERY SELECT 'ready'::TEXT, scope_matches, access_present, replica_matches, asset.asset_status, session.state;
END;
$$;
CREATE FUNCTION content.lock_direct_media_blob_writer_attempt_internal(
  p_attempt_token UUID, p_reservation_token UUID, p_payload content.direct_media_blob_writer_attempt_payload)
RETURNS TABLE (validation_status TEXT, scope_matches BOOLEAN, access_present BOOLEAN, replica_matches BOOLEAN, asset_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE attempt content.media_blob_writer_attempts%ROWTYPE; locked RECORD; identity_status TEXT;
BEGIN
  IF p_attempt_token IS NULL OR p_reservation_token IS NULL OR content.direct_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true THEN RETURN QUERY SELECT 'stale_attempt'::TEXT,false,false,false,NULL::TEXT; RETURN; END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id THEN RETURN QUERY SELECT 'access_denied'::TEXT,false,false,false,NULL::TEXT; RETURN; END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=p_attempt_token AND attempts.state<>'leased';
  IF FOUND THEN identity_status:=content.direct_media_blob_writer_attempt_identity_status_internal(attempt,p_reservation_token,p_payload); IF attempt.user_id IS DISTINCT FROM security.current_user_id() OR attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN identity_status:='access_denied'; END IF; RETURN QUERY SELECT CASE WHEN identity_status='ready' THEN attempt.outcome ELSE identity_status END,true,false,false,NULL::TEXT; RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_payload.user_id||':'||p_payload.workspace_id::TEXT,0::BIGINT));
  IF NOT EXISTS (SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id=p_payload.workspace_id AND memberships.user_id=p_payload.user_id) THEN RETURN QUERY SELECT 'access_denied'::TEXT,true,false,false,NULL::TEXT; RETURN;
  ELSIF NOT EXISTS (SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id=p_payload.replica_id AND replicas.workspace_id=p_payload.workspace_id AND replicas.user_id=p_payload.user_id) THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT,true,true,false,NULL::TEXT; RETURN; END IF;
  SELECT * INTO locked FROM content.lock_direct_media_blob_writer_attempt_revoked_internal(p_attempt_token,p_reservation_token,p_payload);
  IF locked.validation_status='ready' AND EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=p_attempt_token AND attempts.state='leased' AND attempts.lease_expires_at<=pg_catalog.clock_timestamp()) THEN locked.validation_status:='stale_attempt'; END IF;
  RETURN QUERY SELECT locked.validation_status,locked.scope_matches,locked.access_present,locked.replica_matches,locked.asset_status;
END;
$$;
CREATE FUNCTION content.lock_multipart_media_blob_writer_attempt_internal(
  p_attempt_token UUID, p_reservation_token UUID, p_payload content.multipart_media_blob_writer_attempt_payload)
RETURNS TABLE (validation_status TEXT, scope_matches BOOLEAN, access_present BOOLEAN, replica_matches BOOLEAN, asset_status TEXT, session_state TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE attempt content.media_blob_writer_attempts%ROWTYPE; locked RECORD; identity_status TEXT;
BEGIN
  IF p_attempt_token IS NULL OR p_reservation_token IS NULL OR content.multipart_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true THEN RETURN QUERY SELECT 'stale_attempt'::TEXT,false,false,false,NULL::TEXT,NULL::TEXT; RETURN; END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id THEN RETURN QUERY SELECT 'access_denied'::TEXT,false,false,false,NULL::TEXT,NULL::TEXT; RETURN; END IF;
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=p_attempt_token AND attempts.state<>'leased';
  IF FOUND THEN identity_status:=content.multipart_media_blob_writer_attempt_identity_status_internal(attempt,p_reservation_token,p_payload); IF attempt.user_id IS DISTINCT FROM security.current_user_id() OR attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN identity_status:='access_denied'; END IF; RETURN QUERY SELECT CASE WHEN identity_status='ready' THEN attempt.outcome ELSE identity_status END,true,false,false,NULL::TEXT,NULL::TEXT; RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_payload.user_id||':'||p_payload.workspace_id::TEXT,0::BIGINT));
  IF NOT EXISTS (SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id=p_payload.workspace_id AND memberships.user_id=p_payload.user_id) THEN RETURN QUERY SELECT 'access_denied'::TEXT,true,false,false,NULL::TEXT,NULL::TEXT; RETURN;
  ELSIF NOT EXISTS (SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id=p_payload.replica_id AND replicas.workspace_id=p_payload.workspace_id AND replicas.user_id=p_payload.user_id) THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT,true,true,false,NULL::TEXT,NULL::TEXT; RETURN; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_revoked_internal(p_attempt_token,p_reservation_token,p_payload);
  IF locked.validation_status='ready' AND EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=p_attempt_token AND attempts.state='leased' AND attempts.lease_expires_at<=pg_catalog.clock_timestamp()) THEN locked.validation_status:='stale_attempt'; END IF;
  RETURN QUERY SELECT locked.validation_status,locked.scope_matches,locked.access_present,locked.replica_matches,locked.asset_status,locked.session_state;
END;
$$;
CREATE FUNCTION content.terminalize_media_blob_writer_attempt_internal(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_writer_attempts%ROWTYPE;
BEGIN
  SELECT attempts.* INTO attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token AND attempts.reservation_token = p_reservation_token AND attempts.state = 'leased';
  IF NOT FOUND THEN RETURN 'stale_attempt'; END IF;
  RETURN content.terminalize_media_blob_writer_failure( p_reservation_token, attempt.sha256, attempt.blob_storage_key, attempt.mime_type, attempt.size_bytes, attempt.normalization_version, attempt.writer_kind, attempt.workspace_id, attempt.media_asset_id, attempt.operation_id, p_cleanup_delay_ms);
END;
$$;
CREATE FUNCTION content.fence_direct_media_blob_writer_attempt_apply_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  locked RECORD;
  terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_direct_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  IF locked.asset_status = 'exact' THEN terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms); IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'applied', outcome = 'already_applied', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'already_applied';
  ELSIF locked.asset_status = 'peer_conflict' THEN terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms); IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  END IF;
  RETURN 'ready';
END;
$$;
CREATE FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(
  p_attempt_token UUID,
  p_lease_duration_ms INTEGER,
  p_payload content.direct_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  attempt_status TEXT,
  reservation_token UUID,
  normalization_version TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing_attempt content.media_blob_writer_attempts%ROWTYPE;
  peer_attempt content.media_blob_writer_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  reservation_result RECORD;
  apply_payload content.direct_media_blob_writer_attempt_payload;
  fence_status TEXT;
  takeover BOOLEAN := false;
  leased_until TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL OR p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000 OR content.direct_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true
  THEN RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  SELECT attempts.* INTO existing_attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state <> 'leased';
  IF FOUND THEN IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id() OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; apply_payload := p_payload; apply_payload.normalization_version := existing_attempt.normalization_version; fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(existing_attempt, existing_attempt.reservation_token, apply_payload); IF existing_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN fence_status := 'stale_attempt'; END IF; IF fence_status <> 'ready' THEN RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; RETURN QUERY SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( p_payload.user_id || ':' || p_payload.workspace_id::TEXT, 0::BIGINT));
  IF NOT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF NOT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( 'direct:' || p_payload.workspace_id::TEXT || ':' || p_payload.media_asset_id::TEXT || ':' || p_payload.operation_id, 2::BIGINT));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( 'attempt:' || p_attempt_token::TEXT, 3::BIGINT));
  SELECT attempts.* INTO existing_attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token;
  IF FOUND THEN IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id() OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; apply_payload := p_payload; apply_payload.normalization_version := existing_attempt.normalization_version; fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(existing_attempt, existing_attempt.reservation_token, apply_payload); IF existing_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN fence_status := 'stale_attempt'; END IF; IF fence_status <> 'ready' THEN RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; IF existing_attempt.state <> 'leased' THEN RETURN QUERY SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; fence_status := content.fence_direct_media_blob_writer_attempt_apply_with_owner( p_attempt_token, existing_attempt.reservation_token, apply_payload, 3600000); IF fence_status = 'ready' THEN leased_until := pg_catalog.clock_timestamp() + (p_lease_duration_ms * interval '1 millisecond'); UPDATE content.media_blob_writer_attempts AS attempts SET lease_expires_at = leased_until WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased' AND attempts.lease_expires_at > pg_catalog.clock_timestamp(); IF NOT FOUND THEN fence_status := 'stale_attempt'; ELSE fence_status := 'replayed'; END IF; END IF; IF fence_status = 'replayed' THEN RETURN QUERY SELECT fence_status, existing_attempt.reservation_token, existing_attempt.normalization_version, leased_until; ELSE RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; END IF; RETURN;
  END IF;
  INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
  VALUES (p_payload.workspace_id, 0, pg_catalog.statement_timestamp()) ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_payload.workspace_id FOR UPDATE;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_payload.sha256 FOR UPDATE;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'direct_ingestion' AND reservations.workspace_id = p_payload.workspace_id AND reservations.media_asset_id = p_payload.media_asset_id AND reservations.operation_id = p_payload.operation_id FOR UPDATE;
  IF FOUND THEN SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  END IF;
  SELECT attempts.* INTO peer_attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'direct_ingestion' AND attempts.workspace_id = p_payload.workspace_id AND attempts.media_asset_id = p_payload.media_asset_id AND attempts.operation_id = p_payload.operation_id AND attempts.state = 'leased' FOR UPDATE;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id OR NOT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF NOT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id
  ) THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF lifecycle.sha256 IS NOT NULL AND ( lifecycle.storage_key IS DISTINCT FROM p_payload.storage_key OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, NULL::UUID, lifecycle.normalization_version, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF reservation.reservation_token IS NOT NULL AND ( reservation.sha256 IS DISTINCT FROM p_payload.sha256 OR owner_snapshot.reservation_token IS NULL
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF owner_snapshot.reservation_token IS NOT NULL AND ( owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id
  ) THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF peer_attempt.attempt_token IS NOT NULL THEN apply_payload := p_payload; apply_payload.normalization_version := peer_attempt.normalization_version; fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(peer_attempt, peer_attempt.reservation_token, apply_payload); IF fence_status <> 'ready' OR peer_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN RETURN QUERY SELECT CASE WHEN fence_status = 'ready' THEN 'stale_attempt' ELSE fence_status END, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; ELSIF peer_attempt.reservation_token IS DISTINCT FROM reservation.reservation_token OR peer_attempt.normalization_version IS DISTINCT FROM lifecycle.normalization_version OR reservation.state NOT IN ('active', 'ambiguous', 'finalized') THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; ELSIF peer_attempt.lease_expires_at > pg_catalog.clock_timestamp() THEN RETURN QUERY SELECT 'busy'::TEXT, NULL::UUID, NULL::TEXT, peer_attempt.lease_expires_at; RETURN; END IF; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'expired', outcome = 'stale_attempt', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = peer_attempt.attempt_token AND attempts.state = 'leased'; takeover := true; END IF;
  SELECT * INTO reservation_result FROM content.reserve_owned_media_blob_writer_internal( p_payload.user_id, p_payload.replica_id, p_payload.sha256, p_payload.storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, 'direct_ingestion', p_payload.workspace_id, p_payload.media_asset_id, p_payload.operation_id, NULL, NULL, NULL, NULL, NULL);
  IF reservation_result.reservation_status = 'cleanup_claimed' THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, NULL::UUID, reservation_result.normalization_version, NULL::TIMESTAMPTZ; RETURN;
  ELSIF reservation_result.reservation_status = 'ownership_mismatch' THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  ELSIF reservation_result.reservation_status <> 'reserved' OR reservation_result.reservation_token IS NULL
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  leased_until := pg_catalog.clock_timestamp() + (p_lease_duration_ms * interval '1 millisecond');
  INSERT INTO content.media_blob_writer_attempts ( attempt_token, reservation_token, writer_kind, user_id, workspace_id, media_asset_id, operation_id, replica_id, sha256, blob_storage_key, mime_type, size_bytes, requested_normalization_version, normalization_version, source_url, asset_created_at, client_updated_at, state, lease_expires_at
  ) VALUES ( p_attempt_token, reservation_result.reservation_token, 'direct_ingestion', p_payload.user_id, p_payload.workspace_id, p_payload.media_asset_id, p_payload.operation_id, p_payload.replica_id, p_payload.sha256, p_payload.storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, reservation_result.normalization_version, p_payload.source_url, p_payload.asset_created_at, p_payload.client_updated_at, 'leased', leased_until
  );
  apply_payload := p_payload;
  apply_payload.normalization_version := reservation_result.normalization_version;
  fence_status := content.fence_direct_media_blob_writer_attempt_apply_with_owner( p_attempt_token, reservation_result.reservation_token, apply_payload, 3600000);
  IF fence_status = 'ready' THEN fence_status := CASE WHEN takeover THEN 'expired_takeover' ELSE 'acquired' END;
  END IF;
  IF fence_status IN ('acquired', 'expired_takeover') THEN RETURN QUERY SELECT fence_status, reservation_result.reservation_token, reservation_result.normalization_version, leased_until; ELSE RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; END IF;
END;
$$;
CREATE FUNCTION content.finish_direct_media_blob_writer_attempt_apply_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_direct_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  IF locked.asset_status <> 'exact' THEN RETURN 'stale'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'applied', outcome = 'live_applied', terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN 'live_applied';
END;
$$;
CREATE FUNCTION content.resolve_direct_media_blob_writer_attempt_failure_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_direct_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF locked.asset_status = 'peer_conflict' THEN UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  END IF;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = terminalization_status, outcome = terminalization_status, terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN terminalization_status;
END;
$$;
CREATE FUNCTION content.resolve_direct_media_blob_writer_attempt_after_access_revocation(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.direct_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_direct_media_blob_writer_attempt_revoked_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.access_present IS DISTINCT FROM false THEN RETURN 'access_active'; END IF;
  IF EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased' AND attempts.lease_expires_at > pg_catalog.clock_timestamp()) THEN RETURN 'busy'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF locked.asset_status = 'peer_conflict' THEN UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  END IF;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = terminalization_status, outcome = terminalization_status, terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN terminalization_status;
END;
$$;
CREATE FUNCTION content.fence_media_upload_session_completion_attempt_apply_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  IF locked.session_state = 'aborting' THEN RETURN 'aborting';
  ELSIF locked.session_state = 'aborted' THEN RETURN 'aborted';
  END IF;
  IF locked.asset_status = 'exact' THEN terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms); IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF; UPDATE content.media_upload_sessions AS sessions SET state = 'completed', completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()), aborted_at = NULL WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'applied', outcome = 'already_applied', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'already_applied';
  ELSIF locked.asset_status = 'peer_conflict' THEN terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms); IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF; UPDATE content.media_upload_sessions AS sessions SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp()) WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  END IF;
  IF locked.session_state = 'completed' THEN RETURN 'stale'; END IF;
  RETURN 'ready';
END;
$$;
CREATE FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  p_attempt_token UUID,
  p_lease_duration_ms INTEGER,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TABLE (
  attempt_status TEXT,
  reservation_token UUID,
  normalization_version TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing_attempt content.media_blob_writer_attempts%ROWTYPE;
  peer_attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  reservation_result RECORD;
  apply_payload content.multipart_media_blob_writer_attempt_payload;
  fence_status TEXT;
  takeover BOOLEAN := false;
  leased_until TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL OR p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000 OR content.multipart_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true
  THEN RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  SELECT attempts.* INTO existing_attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state <> 'leased';
  IF FOUND THEN IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id() OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; apply_payload := p_payload; apply_payload.normalization_version := existing_attempt.normalization_version; fence_status := content.multipart_media_blob_writer_attempt_identity_status_internal(existing_attempt, existing_attempt.reservation_token, apply_payload); IF existing_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN fence_status := 'stale_attempt'; END IF; IF fence_status <> 'ready' THEN RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; RETURN QUERY SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( p_payload.user_id || ':' || p_payload.workspace_id::TEXT, 0::BIGINT));
  IF NOT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF NOT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( 'attempt:' || p_attempt_token::TEXT, 3::BIGINT));
  SELECT attempts.* INTO existing_attempt FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token;
  IF FOUND THEN IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id() OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id() THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; apply_payload := p_payload; apply_payload.normalization_version := existing_attempt.normalization_version; fence_status := content.multipart_media_blob_writer_attempt_identity_status_internal(existing_attempt, existing_attempt.reservation_token, apply_payload); IF existing_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN fence_status := 'stale_attempt'; END IF; IF fence_status <> 'ready' THEN RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; IF existing_attempt.state <> 'leased' THEN RETURN QUERY SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; END IF; fence_status := content.fence_media_upload_session_completion_attempt_apply_with_owner( p_attempt_token, existing_attempt.reservation_token, apply_payload, 3600000); IF fence_status = 'ready' THEN leased_until := pg_catalog.clock_timestamp() + (p_lease_duration_ms * interval '1 millisecond'); UPDATE content.media_blob_writer_attempts AS attempts SET lease_expires_at = leased_until WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased' AND attempts.lease_expires_at > pg_catalog.clock_timestamp(); IF NOT FOUND THEN fence_status := 'stale_attempt'; ELSE fence_status := 'replayed'; END IF; END IF; IF fence_status = 'replayed' THEN RETURN QUERY SELECT fence_status, existing_attempt.reservation_token, existing_attempt.normalization_version, leased_until; ELSE RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; END IF; RETURN;
  END IF;
  INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
  VALUES (p_payload.workspace_id, 0, pg_catalog.statement_timestamp()) ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_payload.workspace_id FOR UPDATE;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_payload.sha256 FOR UPDATE;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion' AND reservations.workspace_id = p_payload.workspace_id AND reservations.media_asset_id = p_payload.media_asset_id AND reservations.operation_id = p_payload.media_upload_session_id::TEXT FOR UPDATE;
  IF FOUND THEN SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  END IF;
  SELECT attempts.* INTO peer_attempt FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion' AND attempts.workspace_id = p_payload.workspace_id AND attempts.media_asset_id = p_payload.media_asset_id AND attempts.operation_id = p_payload.media_upload_session_id::TEXT AND attempts.state = 'leased' FOR UPDATE;
  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id OR NOT EXISTS ( SELECT 1 FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = p_payload.workspace_id AND memberships.user_id = p_payload.user_id)
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF NOT EXISTS ( SELECT 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_payload.replica_id AND replicas.workspace_id = p_payload.workspace_id AND replicas.user_id = p_payload.user_id
  ) THEN RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF session.media_upload_session_id IS NULL OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id OR session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id OR session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256 OR session.staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id OR session.mime_type IS DISTINCT FROM p_payload.mime_type OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes OR session.part_count IS DISTINCT FROM p_payload.part_count OR session.source_url IS DISTINCT FROM p_payload.source_url OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF session.state = 'aborting' THEN RETURN QUERY SELECT 'aborting'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  ELSIF session.state = 'aborted' THEN RETURN QUERY SELECT 'aborted'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  ELSIF session.state = 'active' AND session.expires_at <= pg_catalog.clock_timestamp() THEN RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  ELSIF session.state NOT IN ('active', 'completing', 'completed') THEN RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF lifecycle.sha256 IS NOT NULL AND ( lifecycle.storage_key IS DISTINCT FROM p_payload.blob_storage_key OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, NULL::UUID, lifecycle.normalization_version, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF reservation.reservation_token IS NOT NULL AND ( reservation.sha256 IS DISTINCT FROM p_payload.sha256 OR owner_snapshot.reservation_token IS NULL
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF owner_snapshot.reservation_token IS NOT NULL AND ( owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_payload.last_operation_id OR owner_snapshot.session_expires_at IS DISTINCT FROM p_payload.session_expires_at OR owner_snapshot.session_source_url IS DISTINCT FROM p_payload.source_url OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_payload.asset_created_at OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_payload.client_updated_at
  ) THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF session.state = 'completed' AND (reservation.reservation_token IS NULL OR reservation.state <> 'finalized')
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF peer_attempt.attempt_token IS NOT NULL THEN apply_payload := p_payload; apply_payload.normalization_version := peer_attempt.normalization_version; fence_status := content.multipart_media_blob_writer_attempt_identity_status_internal(peer_attempt, peer_attempt.reservation_token, apply_payload); IF fence_status <> 'ready' OR peer_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version THEN RETURN QUERY SELECT CASE WHEN fence_status = 'ready' THEN 'stale_attempt' ELSE fence_status END, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; ELSIF peer_attempt.reservation_token IS DISTINCT FROM reservation.reservation_token OR peer_attempt.normalization_version IS DISTINCT FROM lifecycle.normalization_version OR reservation.state NOT IN ('active', 'ambiguous', 'finalized') THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN; ELSIF peer_attempt.lease_expires_at > pg_catalog.clock_timestamp() THEN RETURN QUERY SELECT 'busy'::TEXT, NULL::UUID, NULL::TEXT, peer_attempt.lease_expires_at; RETURN; END IF; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'expired', outcome = 'stale_attempt', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = peer_attempt.attempt_token AND attempts.state = 'leased'; takeover := true; END IF;
  SELECT * INTO reservation_result FROM content.reserve_owned_media_blob_writer_internal( p_payload.user_id, p_payload.replica_id, p_payload.sha256, p_payload.blob_storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, 'multipart_completion', p_payload.workspace_id, p_payload.media_asset_id, p_payload.media_upload_session_id::TEXT, p_payload.last_operation_id, p_payload.session_expires_at, p_payload.source_url, p_payload.asset_created_at, p_payload.client_updated_at);
  IF reservation_result.reservation_status = 'cleanup_claimed' THEN RETURN QUERY SELECT 'cleanup_claimed'::TEXT, NULL::UUID, reservation_result.normalization_version, NULL::TIMESTAMPTZ; RETURN;
  ELSIF reservation_result.reservation_status = 'ownership_mismatch' THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  ELSIF reservation_result.reservation_status <> 'reserved' OR reservation_result.reservation_token IS NULL
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF session.state = 'active' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'completing' WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id AND sessions.state = 'active';
  END IF;
  leased_until := pg_catalog.clock_timestamp() + (p_lease_duration_ms * interval '1 millisecond');
  INSERT INTO content.media_blob_writer_attempts ( attempt_token, reservation_token, writer_kind, user_id, workspace_id, media_asset_id, operation_id, last_operation_id, replica_id, sha256, blob_storage_key, mime_type, size_bytes, requested_normalization_version, normalization_version, source_url, asset_created_at, client_updated_at, media_upload_session_id, staging_storage_key, s3_upload_id, part_size_bytes, part_count, session_expires_at, completed_parts_fingerprint, state, lease_expires_at
  ) VALUES ( p_attempt_token, reservation_result.reservation_token, 'multipart_completion', p_payload.user_id, p_payload.workspace_id, p_payload.media_asset_id, p_payload.media_upload_session_id::TEXT, p_payload.last_operation_id, p_payload.replica_id, p_payload.sha256, p_payload.blob_storage_key, p_payload.mime_type, p_payload.size_bytes, p_payload.normalization_version, reservation_result.normalization_version, p_payload.source_url, p_payload.asset_created_at, p_payload.client_updated_at, p_payload.media_upload_session_id, p_payload.staging_storage_key, p_payload.s3_upload_id, p_payload.part_size_bytes, p_payload.part_count, p_payload.session_expires_at, p_payload.completed_parts_fingerprint, 'leased', leased_until
  );
  apply_payload := p_payload;
  apply_payload.normalization_version := reservation_result.normalization_version;
  fence_status := content.fence_media_upload_session_completion_attempt_apply_with_owner( p_attempt_token, reservation_result.reservation_token, apply_payload, 3600000);
  IF fence_status = 'ready' THEN fence_status := CASE WHEN takeover THEN 'expired_takeover' ELSE 'acquired' END;
  END IF;
  IF fence_status IN ('acquired', 'expired_takeover') THEN RETURN QUERY SELECT fence_status, reservation_result.reservation_token, reservation_result.normalization_version, leased_until; ELSE RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ; END IF;
END;
$$;
CREATE FUNCTION content.finish_media_upload_session_completion_attempt_apply_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  IF locked.session_state = 'aborting' THEN RETURN 'aborting';
  ELSIF locked.session_state = 'aborted' THEN RETURN 'aborted';
  ELSIF locked.session_state <> 'completing' OR locked.asset_status <> 'exact' THEN RETURN 'stale';
  END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'completed', completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()), aborted_at = NULL
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'applied', outcome = 'live_applied', terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN 'live_applied';
END;
$$;
CREATE FUNCTION content.resolve_media_upload_session_completion_attempt_failure_with_owner(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.scope_matches IS DISTINCT FROM true OR locked.access_present IS DISTINCT FROM true
  THEN RETURN 'access_denied'; END IF;
  IF locked.replica_matches IS DISTINCT FROM true THEN RETURN 'replica_mismatch'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF locked.asset_status = 'peer_conflict' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp()) WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  ELSIF locked.asset_status = 'exact' OR terminalization_status = 'referenced' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'completed', completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()), aborted_at = NULL WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'referenced', outcome = 'referenced', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'referenced';
  ELSIF locked.session_state IN ('aborting', 'aborted') THEN UPDATE content.media_upload_sessions AS sessions SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp()) WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'cancelled', outcome = 'already_closed', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'already_closed';
  END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'active', completed_at = NULL, aborted_at = NULL
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'unreferenced', outcome = 'unreferenced_restored', terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN 'unreferenced_restored';
END;
$$;
CREATE FUNCTION content.resolve_media_upload_session_completion_attempt_after_access_revocation(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_revoked_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.access_present IS DISTINCT FROM false THEN RETURN 'access_active'; END IF;
  IF EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased' AND attempts.lease_expires_at > pg_catalog.clock_timestamp()) THEN RETURN 'busy'; END IF;
  IF locked.session_state = 'aborting' THEN RETURN 'aborting'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF locked.asset_status = 'peer_conflict' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp()) WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'peer_conflict', outcome = 'peer_conflict', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'peer_conflict';
  ELSIF locked.asset_status = 'exact' OR terminalization_status = 'referenced' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'completed', completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()), aborted_at = NULL WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'referenced', outcome = 'referenced', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'referenced';
  END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp())
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'unreferenced', outcome = 'unreferenced', terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN 'unreferenced';
END;
$$;
CREATE FUNCTION content.close_media_upload_session_blob_writer_attempts(
  p_attempt_token UUID,
  p_reservation_token UUID,
  p_payload content.multipart_media_blob_writer_attempt_payload,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE locked RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  SELECT * INTO locked FROM content.lock_multipart_media_blob_writer_attempt_revoked_internal( p_attempt_token, p_reservation_token, p_payload);
  IF locked.validation_status <> 'ready' THEN RETURN locked.validation_status; END IF;
  IF locked.session_state NOT IN ('aborting', 'aborted') AND EXISTS (SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.attempt_token=p_attempt_token AND attempts.state='leased' AND attempts.lease_expires_at>pg_catalog.clock_timestamp())
  THEN RETURN CASE WHEN locked.access_present IS DISTINCT FROM false AND p_payload.session_expires_at > pg_catalog.clock_timestamp() THEN 'access_active' ELSE 'busy' END; END IF;
  terminalization_status := content.terminalize_media_blob_writer_attempt_internal( p_attempt_token, p_reservation_token, p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF locked.asset_status = 'exact' OR terminalization_status = 'referenced' THEN UPDATE content.media_upload_sessions AS sessions SET state = 'completed', completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()), aborted_at = NULL WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id; UPDATE content.media_blob_writer_attempts AS attempts SET state = 'referenced', outcome = 'referenced', terminal_at = pg_catalog.clock_timestamp() WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased'; RETURN 'referenced';
  END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'aborted', completed_at = NULL, aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp())
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id;
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'cancelled', outcome = 'aborted', terminal_at = pg_catalog.clock_timestamp()
  WHERE attempts.attempt_token = p_attempt_token AND attempts.state = 'leased';
  RETURN 'aborted';
END;
$$;
CREATE OR REPLACE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  owner_user_id TEXT;
  affected_sha256s TEXT[];
  affected_sha256 TEXT;
  terminalized_at TIMESTAMPTZ;
BEGIN
  FOR owner_user_id IN SELECT owners.user_id FROM ( SELECT memberships.user_id FROM org.workspace_memberships AS memberships WHERE memberships.workspace_id = OLD.workspace_id UNION SELECT snapshots.user_id FROM content.media_blob_writer_owner_snapshots AS snapshots WHERE snapshots.workspace_id = OLD.workspace_id UNION SELECT attempts.user_id FROM content.media_blob_writer_attempts AS attempts WHERE attempts.workspace_id = OLD.workspace_id ) AS owners ORDER BY owners.user_id
  LOOP PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended( owner_user_id || ':' || OLD.workspace_id::TEXT, 0::BIGINT));
  END LOOP;
  PERFORM 1 FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id
  ORDER BY sessions.media_upload_session_id FOR UPDATE;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = OLD.workspace_id FOR UPDATE;
  SELECT pg_catalog.array_agg(DISTINCT writers.sha256 ORDER BY writers.sha256)
  INTO affected_sha256s FROM ( SELECT reservations.sha256 FROM content.media_blob_writer_reservations AS reservations WHERE reservations.workspace_id = OLD.workspace_id AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion') UNION SELECT attempts.sha256 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.workspace_id = OLD.workspace_id
  ) AS writers;
  IF affected_sha256s IS NULL THEN RETURN OLD; END IF;
  FOREACH affected_sha256 IN ARRAY affected_sha256s LOOP PERFORM 1 FROM content.media_blob_lifecycles AS lifecycles WHERE lifecycles.sha256 = affected_sha256 FOR UPDATE;
  END LOOP;
  PERFORM 1 FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion')
  ORDER BY reservations.sha256, reservations.writer_kind, reservations.media_asset_id, reservations.operation_id FOR UPDATE;
  PERFORM 1 FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.workspace_id = OLD.workspace_id
  ORDER BY snapshots.reservation_token FOR UPDATE;
  PERFORM 1 FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.workspace_id = OLD.workspace_id
  ORDER BY attempts.writer_kind, attempts.media_asset_id, attempts.operation_id, attempts.attempt_token FOR UPDATE;
  PERFORM 1 FROM content.media_assets AS assets
  WHERE assets.workspace_id = OLD.workspace_id ORDER BY assets.media_asset_id FOR UPDATE;
  PERFORM 1 FROM content.media_blobs AS blobs
  WHERE blobs.sha256 = ANY(affected_sha256s) ORDER BY blobs.sha256 FOR SHARE;
  DELETE FROM content.media_upload_sessions AS sessions WHERE sessions.workspace_id = OLD.workspace_id;
  DELETE FROM content.media_assets AS assets WHERE assets.workspace_id = OLD.workspace_id;
  UPDATE content.media_blob_writer_reservations AS reservations SET state = 'unreferenced'
  WHERE reservations.workspace_id = OLD.workspace_id AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion') AND reservations.state <> 'unreferenced';
  terminalized_at := pg_catalog.clock_timestamp();
  UPDATE content.media_blob_writer_attempts AS attempts
  SET state = 'cancelled', outcome = 'aborted', terminal_at = terminalized_at
  WHERE attempts.workspace_id = OLD.workspace_id AND attempts.state = 'leased';
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = GREATEST( COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ), terminalized_at + interval '1 hour'), cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = terminalized_at
  WHERE lifecycles.sha256 = ANY(affected_sha256s) AND NOT EXISTS ( SELECT 1 FROM content.media_assets AS assets INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id WHERE blobs.sha256 = lifecycles.sha256 AND assets.deleted_at IS NULL) AND NOT EXISTS ( SELECT 1 FROM catalog.package_media_assets AS assets INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id WHERE blobs.sha256 = lifecycles.sha256) AND NOT EXISTS ( SELECT 1 FROM content.media_blob_writer_reservations AS reservations WHERE reservations.sha256 = lifecycles.sha256 AND reservations.state NOT IN ('finalized', 'unreferenced')) AND NOT EXISTS ( SELECT 1 FROM content.media_blob_writer_attempts AS attempts WHERE attempts.sha256 = lifecycles.sha256 AND attempts.state = 'leased');
  RETURN OLD;
END;
$$;
REVOKE ALL ON TABLE content.media_blob_writer_attempts FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.direct_media_blob_writer_attempt_payload_valid_internal(content.direct_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.multipart_media_blob_writer_attempt_payload_valid_internal(content.multipart_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.direct_media_blob_writer_attempt_identity_status_internal(content.media_blob_writer_attempts, UUID, content.direct_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.multipart_media_blob_writer_attempt_identity_status_internal(content.media_blob_writer_attempts, UUID, content.multipart_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.lock_direct_media_blob_writer_attempt_revoked_internal(UUID, UUID, content.direct_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.lock_multipart_media_blob_writer_attempt_revoked_internal(UUID, UUID, content.multipart_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.lock_direct_media_blob_writer_attempt_internal(UUID, UUID, content.direct_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.lock_multipart_media_blob_writer_attempt_internal(UUID, UUID, content.multipart_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.terminalize_media_blob_writer_attempt_internal(UUID, UUID, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(UUID, INTEGER, content.direct_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_direct_media_blob_writer_attempt_apply_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.finish_direct_media_blob_writer_attempt_apply_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_direct_media_blob_writer_attempt_failure_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_direct_media_blob_writer_attempt_after_access_revocation(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_media_upload_session_completion_attempt_apply_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.finish_media_upload_session_completion_attempt_apply_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_media_upload_session_completion_attempt_failure_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_media_upload_session_completion_attempt_after_access_revocation(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.close_media_upload_session_blob_writer_attempts(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.terminalize_media_blob_writers_before_workspace_delete() FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION content.begin_direct_media_blob_writer_attempt_with_owner(UUID, INTEGER, content.direct_media_blob_writer_attempt_payload) TO backend_app;
GRANT EXECUTE ON FUNCTION content.fence_direct_media_blob_writer_attempt_apply_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.finish_direct_media_blob_writer_attempt_apply_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_direct_media_blob_writer_attempt_failure_with_owner(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_direct_media_blob_writer_attempt_after_access_revocation(UUID, UUID, content.direct_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(UUID, INTEGER, content.multipart_media_blob_writer_attempt_payload) TO backend_app;
GRANT EXECUTE ON FUNCTION content.fence_media_upload_session_completion_attempt_apply_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.finish_media_upload_session_completion_attempt_apply_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_media_upload_session_completion_attempt_failure_with_owner(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_media_upload_session_completion_attempt_after_access_revocation(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.close_media_upload_session_blob_writer_attempts(UUID, UUID, content.multipart_media_blob_writer_attempt_payload, INTEGER) TO backend_app;
