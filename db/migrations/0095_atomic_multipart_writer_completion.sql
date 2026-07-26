-- Current additive migration for no-writer multipart closure and atomic owner-bound completion start.
CREATE OR REPLACE FUNCTION content.close_media_upload_session_blob_writer(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT, p_sha256 TEXT,
  p_storage_key TEXT, p_mime_type TEXT, p_size_bytes BIGINT, p_expires_at TIMESTAMPTZ,
  p_cleanup_delay_ms INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE; lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  session_found BOOLEAN; lifecycle_found BOOLEAN; reservation_found BOOLEAN;
  reference RECORD; reference_found BOOLEAN; abort_proven BOOLEAN; expiry_proven BOOLEAN;
  terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
    OR p_user_id IS NULL OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL OR p_last_modified_by_replica_id IS NULL
    OR p_last_operation_id IS NULL OR p_sha256 IS NULL OR p_storage_key IS NULL
    OR p_mime_type IS NULL OR p_size_bytes IS NULL OR p_expires_at IS NULL
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id FOR UPDATE;
  session_found := FOUND;
  IF session_found AND (
    session.workspace_id IS DISTINCT FROM p_workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR session.last_operation_id IS DISTINCT FROM p_last_operation_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_sha256
    OR session.blob_storage_key IS DISTINCT FROM p_storage_key
    OR session.mime_type IS DISTINCT FROM p_mime_type
    OR session.size_bytes IS DISTINCT FROM p_size_bytes
    OR session.expires_at IS DISTINCT FROM p_expires_at
  ) THEN RETURN 'stale'; END IF;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  lifecycle_found := FOUND;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion'
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_media_upload_session_id::TEXT FOR UPDATE;
  reservation_found := FOUND;
  IF NOT reservation_found THEN
    PERFORM 1 FROM content.media_blob_writer_reservations AS conflicts
    WHERE conflicts.writer_kind = 'multipart_completion'
      AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ORDER BY conflicts.reservation_token FOR UPDATE;
    IF FOUND THEN RETURN 'stale'; END IF;
    PERFORM 1 FROM content.media_blob_writer_owner_snapshots AS conflicts
    WHERE conflicts.writer_kind = 'multipart_completion'
      AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ORDER BY conflicts.reservation_token FOR UPDATE;
    IF FOUND THEN RETURN 'stale'; END IF;
    IF NOT session_found THEN RETURN 'absent'; END IF;
    IF session.state = 'aborted' THEN RETURN 'already_closed'; END IF;
    IF session.state = 'completed'
      OR (session.state IS DISTINCT FROM 'aborting' AND session.expires_at > clock_timestamp())
    THEN RETURN 'stale'; END IF;
    PERFORM 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_last_modified_by_replica_id
      AND replicas.workspace_id = p_workspace_id AND replicas.user_id = p_user_id
    FOR KEY SHARE;
    IF NOT FOUND THEN RETURN 'stale'; END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL, aborted_at = clock_timestamp()
    WHERE sessions.media_upload_session_id = p_media_upload_session_id
      AND sessions.state IN ('active', 'completing', 'aborting');
    IF NOT FOUND THEN RETURN 'stale'; END IF;
    RETURN 'no_writer_closed';
  END IF;
  IF NOT lifecycle_found THEN RETURN 'stale'; END IF;
  SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  IF NOT FOUND
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
    OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
    OR reservation.state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
  THEN RETURN 'stale'; END IF;
  IF session_found AND (
    owner_snapshot.session_source_url IS DISTINCT FROM session.source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM session.asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM session.client_updated_at
  ) THEN RETURN 'stale'; END IF;
  IF NOT session_found AND reservation.state = 'unreferenced' THEN RETURN 'already_closed'; END IF;
  IF session_found AND session.state IN ('completed', 'aborted') THEN RETURN 'already_closed'; END IF;
  abort_proven := session_found AND session.state = 'aborting';
  expiry_proven := owner_snapshot.session_expires_at <= clock_timestamp();
  IF NOT abort_proven AND NOT expiry_proven AND EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_active'; END IF;
  SELECT assets.workspace_id, assets.source_url, assets.created_at, assets.client_updated_at,
    assets.last_modified_by_replica_id, assets.last_operation_id, blobs.sha256,
    blobs.storage_key, blobs.mime_type, blobs.size_bytes, blobs.normalization_version
  INTO reference FROM content.media_assets AS assets
  INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
  WHERE assets.media_asset_id = p_media_asset_id AND assets.deleted_at IS NULL;
  reference_found := FOUND;
  IF reference_found AND (
    reference.workspace_id IS DISTINCT FROM p_workspace_id
    OR reference.source_url IS DISTINCT FROM owner_snapshot.session_source_url
    OR reference.created_at IS DISTINCT FROM owner_snapshot.session_asset_created_at
    OR reference.client_updated_at IS DISTINCT FROM owner_snapshot.session_client_updated_at
    OR reference.last_modified_by_replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR reference.last_operation_id IS DISTINCT FROM p_last_operation_id
    OR reference.sha256 IS DISTINCT FROM p_sha256
    OR reference.storage_key IS DISTINCT FROM p_storage_key
    OR reference.mime_type IS DISTINCT FROM p_mime_type
    OR reference.size_bytes IS DISTINCT FROM p_size_bytes
    OR reference.normalization_version IS DISTINCT FROM lifecycle.normalization_version
  ) THEN RETURN 'stale'; END IF;
  IF reference_found THEN
    IF reservation.state = 'unreferenced' THEN RETURN 'stale'; END IF;
    terminalization_status := content.terminalize_media_blob_writer_failure(
      reservation.reservation_token, p_sha256, p_storage_key, p_mime_type, p_size_bytes,
      lifecycle.normalization_version, 'multipart_completion', p_workspace_id,
      p_media_asset_id, p_media_upload_session_id::TEXT, p_cleanup_delay_ms);
    IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
    IF session_found THEN UPDATE content.media_upload_sessions
      SET state = 'completed', completed_at = clock_timestamp(), aborted_at = NULL
      WHERE media_upload_session_id = p_media_upload_session_id; END IF;
    RETURN 'referenced';
  END IF;
  IF NOT abort_proven AND NOT expiry_proven THEN RETURN 'stale'; END IF;
  IF reservation.state = 'finalized' THEN RETURN 'stale'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_failure(
    reservation.reservation_token, p_sha256, p_storage_key, p_mime_type, p_size_bytes,
    lifecycle.normalization_version, 'multipart_completion', p_workspace_id,
    p_media_asset_id, p_media_upload_session_id::TEXT, p_cleanup_delay_ms);
  IF terminalization_status <> 'unreferenced' THEN RETURN 'stale'; END IF;
  IF session_found THEN UPDATE content.media_upload_sessions
    SET state = 'aborted', completed_at = NULL, aborted_at = clock_timestamp()
    WHERE media_upload_session_id = p_media_upload_session_id; END IF;
  RETURN 'unreferenced';
END;
$$;

CREATE FUNCTION content.begin_media_upload_session_completion_with_owner(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID,
  p_media_asset_id UUID, p_last_modified_by_replica_id UUID, p_last_operation_id TEXT,
  p_sha256 TEXT, p_staging_storage_key TEXT, p_blob_storage_key TEXT, p_s3_upload_id TEXT,
  p_mime_type TEXT, p_size_bytes BIGINT, p_part_size_bytes BIGINT, p_part_count INTEGER,
  p_source_url TEXT, p_asset_created_at TIMESTAMPTZ, p_client_updated_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ, p_normalization_version TEXT)
RETURNS TABLE (completion_status TEXT, reservation_token UUID, reservation_state TEXT,
  normalization_version TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE; lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  lifecycle_found BOOLEAN; reservation_found BOOLEAN; owner_snapshot_found BOOLEAN;
  reservation_result RECORD; reference RECORD;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM btrim(p_user_id) OR p_user_id = ''
    OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL OR p_media_asset_id IS NULL
    OR p_last_modified_by_replica_id IS NULL OR p_last_operation_id IS NULL OR p_sha256 IS NULL
    OR p_staging_storage_key IS NULL OR p_blob_storage_key IS NULL OR p_s3_upload_id IS NULL
    OR p_mime_type IS NULL OR p_size_bytes IS NULL OR p_part_size_bytes IS NULL
    OR p_part_count IS NULL OR p_asset_created_at IS NULL OR p_client_updated_at IS NULL
    OR p_expires_at IS NULL OR p_normalization_version IS NULL
  THEN RAISE EXCEPTION 'Atomic multipart completion identity is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  PERFORM 1 FROM org.workspace_memberships AS memberships
  WHERE memberships.workspace_id = p_workspace_id AND memberships.user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'session_not_found'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF session.workspace_id IS DISTINCT FROM p_workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR session.last_operation_id IS DISTINCT FROM p_last_operation_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_sha256
    OR session.staging_storage_key IS DISTINCT FROM p_staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM p_blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM p_s3_upload_id
    OR session.mime_type IS DISTINCT FROM p_mime_type
    OR session.size_bytes IS DISTINCT FROM p_size_bytes
    OR session.part_size_bytes IS DISTINCT FROM p_part_size_bytes
    OR session.part_count IS DISTINCT FROM p_part_count
    OR session.source_url IS DISTINCT FROM p_source_url
    OR session.asset_created_at IS DISTINCT FROM p_asset_created_at
    OR session.client_updated_at IS DISTINCT FROM p_client_updated_at
    OR session.expires_at IS DISTINCT FROM p_expires_at
  THEN RETURN QUERY SELECT 'payload_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  PERFORM 1 FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = p_last_modified_by_replica_id
    AND replicas.workspace_id = p_workspace_id AND replicas.user_id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF session.state = 'aborting' THEN
    RETURN QUERY SELECT 'aborting'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF session.state = 'aborted' THEN
    RETURN QUERY SELECT 'aborted'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF session.state NOT IN ('active', 'completing', 'completed') THEN
    RETURN QUERY SELECT 'state_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  ELSIF session.state = 'active' AND session.expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT 'expired'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  lifecycle_found := FOUND;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion'
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_media_upload_session_id::TEXT FOR UPDATE;
  reservation_found := FOUND;
  IF reservation_found THEN
    SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots
    WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
    owner_snapshot_found := FOUND;
  ELSE
    owner_snapshot_found := false;
    PERFORM 1 FROM content.media_blob_writer_reservations AS conflicts
    WHERE conflicts.writer_kind = 'multipart_completion'
      AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ORDER BY conflicts.reservation_token FOR UPDATE;
    IF FOUND THEN
      RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
    END IF;
    PERFORM 1 FROM content.media_blob_writer_owner_snapshots AS conflicts
    WHERE conflicts.writer_kind = 'multipart_completion'
      AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ORDER BY conflicts.reservation_token FOR UPDATE;
    IF FOUND THEN
      RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
    END IF;
  END IF;
  IF reservation_found AND NOT owner_snapshot_found THEN
    RETURN QUERY SELECT 'legacy_unbound'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF reservation_found AND (
    NOT lifecycle_found OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR lifecycle.storage_key IS DISTINCT FROM p_blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF owner_snapshot_found AND (
    owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
    OR owner_snapshot.session_source_url IS DISTINCT FROM p_source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_client_updated_at
  ) THEN RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF lifecycle_found AND (
    lifecycle.storage_key IS DISTINCT FROM p_blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
  ) THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  IF session.state = 'completed' THEN
    IF NOT reservation_found OR reservation.state IS DISTINCT FROM 'finalized' THEN
      RETURN QUERY SELECT 'completed_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
    END IF;
    SELECT assets.workspace_id, assets.source_url, assets.created_at, assets.client_updated_at,
      assets.last_modified_by_replica_id, assets.last_operation_id, blobs.sha256,
      blobs.storage_key, blobs.mime_type, blobs.size_bytes, blobs.normalization_version
    INTO reference FROM content.media_assets AS assets
    INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
    WHERE assets.media_asset_id = p_media_asset_id AND assets.deleted_at IS NULL
    FOR KEY SHARE OF assets, blobs;
    IF NOT FOUND OR reference.workspace_id IS DISTINCT FROM p_workspace_id
      OR reference.source_url IS DISTINCT FROM p_source_url
      OR reference.created_at IS DISTINCT FROM p_asset_created_at
      OR reference.client_updated_at IS DISTINCT FROM p_client_updated_at
      OR reference.last_modified_by_replica_id IS DISTINCT FROM p_last_modified_by_replica_id
      OR reference.last_operation_id IS DISTINCT FROM p_last_operation_id
      OR reference.sha256 IS DISTINCT FROM p_sha256
      OR reference.storage_key IS DISTINCT FROM p_blob_storage_key
      OR reference.mime_type IS DISTINCT FROM p_mime_type
      OR reference.size_bytes IS DISTINCT FROM p_size_bytes
      OR reference.normalization_version IS DISTINCT FROM lifecycle.normalization_version
    THEN RETURN QUERY SELECT 'completed_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
    END IF;
    RETURN QUERY SELECT 'already_completed'::TEXT, reservation.reservation_token,
      reservation.state, lifecycle.normalization_version; RETURN;
  END IF;
  IF session.state = 'completing' THEN
    IF NOT reservation_found OR reservation.state NOT IN ('active', 'ambiguous', 'finalized') THEN
      RETURN QUERY SELECT 'legacy_unbound'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
    END IF;
    RETURN QUERY SELECT 'replayed'::TEXT, reservation.reservation_token,
      reservation.state, lifecycle.normalization_version; RETURN;
  END IF;
  SELECT * INTO reservation_result FROM content.reserve_owned_media_blob_writer_internal(
    p_user_id, p_last_modified_by_replica_id, p_sha256, p_blob_storage_key,
    p_mime_type, p_size_bytes, p_normalization_version, 'multipart_completion',
    p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
    p_last_operation_id, p_expires_at, p_source_url, p_asset_created_at, p_client_updated_at);
  IF reservation_result.reservation_status = 'cleanup_claimed' THEN
    RETURN QUERY SELECT 'cleanup_claimed'::TEXT, NULL::UUID, NULL::TEXT,
      reservation_result.normalization_version; RETURN;
  END IF;
  IF reservation_result.reservation_status <> 'reserved'
    OR reservation_result.reservation_token IS NULL
    OR reservation_result.reservation_state NOT IN ('active', 'ambiguous', 'finalized')
  THEN RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT; RETURN;
  END IF;
  UPDATE content.media_upload_sessions AS sessions SET state = 'completing'
  WHERE sessions.media_upload_session_id = p_media_upload_session_id AND sessions.state = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Atomic multipart completion lost the locked active session'
    USING ERRCODE = '40001'; END IF;
  RETURN QUERY SELECT 'started'::TEXT, reservation_result.reservation_token,
    reservation_result.reservation_state, reservation_result.normalization_version;
END;
$$;

COMMENT ON FUNCTION content.close_media_upload_session_blob_writer(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER) IS
  'Closes one exact multipart writer or atomically aborts an exact aborting/expired session proven to have no writer.';
COMMENT ON FUNCTION content.begin_media_upload_session_completion_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT,
  BIGINT, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
  'Atomically starts or replays one exact owner-bound multipart completion without object-storage or final media-asset mutation.';
REVOKE ALL ON TABLE content.media_blob_lifecycles, content.media_blob_writer_reservations,
  content.media_blob_writer_owner_snapshots FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.close_media_upload_session_blob_writer(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_media_upload_session_completion_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT,
  BIGINT, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION content.close_media_upload_session_blob_writer(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.begin_media_upload_session_completion_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT,
  BIGINT, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO backend_app;
