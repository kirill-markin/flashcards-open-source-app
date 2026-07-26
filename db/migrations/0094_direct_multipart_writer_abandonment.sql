-- Current additive migration for immutable direct/multipart writer ownership and exact abandonment.
ALTER TABLE content.media_blob_writer_reservations ADD CONSTRAINT media_blob_writer_reservations_owner_reference_unique UNIQUE (reservation_token, writer_kind, workspace_id, media_asset_id, operation_id, sha256);
CREATE TABLE content.media_blob_writer_owner_snapshots (
  reservation_token UUID PRIMARY KEY, writer_kind TEXT NOT NULL
    CHECK (writer_kind IN ('direct_ingestion', 'multipart_completion')),
  workspace_id UUID NOT NULL, media_asset_id UUID NOT NULL, operation_id TEXT NOT NULL,
  sha256 TEXT NOT NULL, user_id TEXT NOT NULL
    CHECK (user_id = btrim(user_id) AND user_id <> ''), replica_id UUID NOT NULL,
  session_last_operation_id TEXT, session_expires_at TIMESTAMPTZ,
  session_source_url TEXT, session_asset_created_at TIMESTAMPTZ, session_client_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT media_blob_writer_owner_snapshots_reservation_fk FOREIGN KEY
    (reservation_token, writer_kind, workspace_id, media_asset_id, operation_id, sha256)
    REFERENCES content.media_blob_writer_reservations (reservation_token, writer_kind, workspace_id, media_asset_id, operation_id, sha256)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT media_blob_writer_owner_snapshots_shape CHECK (
    (writer_kind = 'direct_ingestion' AND session_last_operation_id IS NULL AND session_expires_at IS NULL
      AND session_source_url IS NULL AND session_asset_created_at IS NULL AND session_client_updated_at IS NULL)
    OR (writer_kind = 'multipart_completion' AND session_last_operation_id IS NOT NULL AND session_expires_at IS NOT NULL
      AND session_asset_created_at IS NOT NULL AND session_client_updated_at IS NOT NULL)
  )
);
COMMENT ON TABLE content.media_blob_writer_owner_snapshots IS 'Non-cascading immutable historical user, replica, workspace, and multipart payload evidence for exact writer recovery.';
CREATE FUNCTION content.reserve_owned_media_blob_writer_internal(
  p_user_id TEXT, p_replica_id UUID, p_sha256 TEXT, p_storage_key TEXT,
  p_mime_type TEXT, p_size_bytes BIGINT, p_normalization_version TEXT,
  p_writer_kind TEXT, p_workspace_id UUID, p_media_asset_id UUID, p_operation_id TEXT,
  p_session_last_operation_id TEXT, p_session_expires_at TIMESTAMPTZ,
  p_session_source_url TEXT, p_session_asset_created_at TIMESTAMPTZ,
  p_session_client_updated_at TIMESTAMPTZ)
RETURNS TABLE (reservation_token UUID, reservation_state TEXT, reservation_status TEXT, normalization_version TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE; reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE; inserted_count INTEGER;
BEGIN
  IF p_writer_kind NOT IN ('direct_ingestion', 'multipart_completion')
    OR p_user_id IS NULL OR p_user_id <> btrim(p_user_id) OR p_user_id = ''
    OR p_replica_id IS NULL OR p_workspace_id IS NULL OR p_media_asset_id IS NULL
    OR p_operation_id IS NULL OR p_operation_id <> btrim(p_operation_id) OR char_length(p_operation_id) NOT BETWEEN 1 AND 1024
    OR p_sha256 IS NULL OR p_storage_key IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL
    OR p_normalization_version IS NULL THEN
    RAISE EXCEPTION 'Owned media blob writer identity is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO content.media_blob_lifecycles (sha256, storage_key, mime_type, size_bytes, normalization_version)
  VALUES (p_sha256, p_storage_key, p_mime_type, p_size_bytes, p_normalization_version) ON CONFLICT DO NOTHING;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  IF NOT FOUND
    OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes THEN
    RAISE EXCEPTION 'Permanent media blob immutable metadata conflicts with its content hash'
      USING ERRCODE = '23514';
  END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'cleanup_claimed'::TEXT, lifecycle.normalization_version;
    RETURN;
  END IF;
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = NULL, cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = p_sha256;
  INSERT INTO content.media_blob_writer_reservations (sha256, writer_kind, workspace_id, media_asset_id, operation_id)
  VALUES (p_sha256, p_writer_kind, p_workspace_id, p_media_asset_id, p_operation_id)
  ON CONFLICT (writer_kind, workspace_id, media_asset_id, operation_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = p_writer_kind
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR reservation.sha256 IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'Permanent media blob writer identity conflicts with a different content hash'
      USING ERRCODE = '23514';
  END IF;
  IF inserted_count = 1 THEN
    INSERT INTO content.media_blob_writer_owner_snapshots (
      reservation_token, writer_kind, workspace_id, media_asset_id, operation_id,
      sha256, user_id, replica_id, session_last_operation_id, session_expires_at,
      session_source_url, session_asset_created_at, session_client_updated_at) VALUES (
      reservation.reservation_token, p_writer_kind, p_workspace_id, p_media_asset_id,
      p_operation_id, p_sha256, p_user_id, p_replica_id, p_session_last_operation_id,
      p_session_expires_at, p_session_source_url, p_session_asset_created_at,
      p_session_client_updated_at);
  ELSE
    SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots
    WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'ownership_unbound'::TEXT, lifecycle.normalization_version;
      RETURN;
    END IF;
    IF owner_snapshot.user_id IS DISTINCT FROM p_user_id OR owner_snapshot.replica_id IS DISTINCT FROM p_replica_id
      OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_session_last_operation_id
      OR owner_snapshot.session_expires_at IS DISTINCT FROM p_session_expires_at
      OR owner_snapshot.session_source_url IS DISTINCT FROM p_session_source_url
      OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_session_asset_created_at
      OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_session_client_updated_at THEN
      RETURN QUERY SELECT NULL::UUID, NULL::TEXT, 'ownership_mismatch'::TEXT, lifecycle.normalization_version;
      RETURN;
    END IF;
  END IF;
  IF reservation.state = 'unreferenced' THEN
    UPDATE content.media_blob_writer_reservations AS reservations
    SET reservation_token = public.gen_random_uuid(), state = 'active', ambiguous_at = NULL
    WHERE reservations.reservation_token = reservation.reservation_token
    RETURNING reservations.* INTO reservation;
  END IF;
  RETURN QUERY SELECT reservation.reservation_token, reservation.state, 'reserved'::TEXT, lifecycle.normalization_version;
END;
$$;
CREATE FUNCTION content.reserve_direct_media_blob_writer_with_owner(
  p_user_id TEXT, p_workspace_id UUID, p_media_asset_id UUID, p_operation_id TEXT,
  p_replica_id UUID, p_sha256 TEXT, p_storage_key TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_normalization_version TEXT)
RETURNS TABLE (reservation_token UUID, reservation_state TEXT, reservation_status TEXT, normalization_version TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owned direct writer requires the active historical user workspace scope'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM sync.workspace_replicas AS replicas WHERE replicas.replica_id = p_replica_id
    AND replicas.workspace_id = p_workspace_id
    AND replicas.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned direct writer replica does not belong to the active user and workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM content.reserve_owned_media_blob_writer_internal(
    p_user_id, p_replica_id, p_sha256, p_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, 'direct_ingestion', p_workspace_id, p_media_asset_id, p_operation_id, NULL, NULL, NULL, NULL, NULL);
END;
$$;
CREATE FUNCTION content.reserve_media_upload_session_blob_writer_with_owner(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_normalization_version TEXT)
RETURNS TABLE (reservation_token UUID, reservation_state TEXT, reservation_status TEXT, normalization_version TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owned multipart writer requires the active historical user workspace scope'
      USING ERRCODE = '42501';
  END IF;
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
    AND sessions.workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND OR session.state IS DISTINCT FROM 'completing' THEN
    RAISE EXCEPTION 'Owned multipart writer requires the exact completing upload session'
      USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = session.last_modified_by_replica_id
    AND replicas.workspace_id = p_workspace_id
    AND replicas.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned multipart writer replica does not belong to the active user and workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM content.reserve_owned_media_blob_writer_internal(
    p_user_id, session.last_modified_by_replica_id, session.media_blob_sha256,
    session.blob_storage_key, session.mime_type, session.size_bytes,
    p_normalization_version, 'multipart_completion', p_workspace_id,
    session.media_asset_id, p_media_upload_session_id::TEXT,
    session.last_operation_id, session.expires_at, session.source_url,
    session.asset_created_at, session.client_updated_at
  );
END;
$$;
CREATE FUNCTION content.resolve_direct_media_blob_writer_after_access_revocation(
  p_user_id TEXT, p_workspace_id UUID, p_media_asset_id UUID, p_operation_id TEXT,
  p_replica_id UUID, p_sha256 TEXT, p_storage_key TEXT, p_mime_type TEXT,
  p_size_bytes BIGINT, p_cleanup_delay_ms INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE; reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  reference RECORD; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 OR p_user_id IS NULL
    OR p_workspace_id IS NULL OR p_media_asset_id IS NULL OR p_operation_id IS NULL
    OR p_replica_id IS NULL OR p_sha256 IS NULL OR p_storage_key IS NULL
    OR p_mime_type IS NULL OR p_size_bytes IS NULL
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS conflicts
      WHERE conflicts.writer_kind = 'direct_ingestion'
        AND conflicts.workspace_id = p_workspace_id
        AND conflicts.media_asset_id = p_media_asset_id
        AND conflicts.operation_id = p_operation_id
    ) THEN RETURN 'stale'; END IF;
    RETURN 'absent';
  END IF;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'direct_ingestion'
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS conflicts
      WHERE conflicts.workspace_id = p_workspace_id
        AND conflicts.media_asset_id = p_media_asset_id
        AND (conflicts.writer_kind = 'direct_ingestion'
          OR conflicts.operation_id = p_operation_id)
    ) THEN RETURN 'stale'; END IF;
    RETURN 'absent';
  END IF;
  SELECT snapshots.* INTO owner_snapshot FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
  IF NOT FOUND
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_replica_id
    OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
    OR reservation.state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
  THEN RETURN 'stale'; END IF;
  IF EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_active'; END IF;
  SELECT assets.workspace_id, assets.last_modified_by_replica_id,
    assets.last_operation_id, blobs.sha256, blobs.storage_key, blobs.mime_type,
    blobs.size_bytes, blobs.normalization_version
  INTO reference FROM content.media_assets AS assets
  INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
  WHERE assets.media_asset_id = p_media_asset_id AND assets.deleted_at IS NULL;
  IF FOUND AND (
    reference.workspace_id IS DISTINCT FROM p_workspace_id
    OR reference.last_modified_by_replica_id IS DISTINCT FROM p_replica_id
    OR reference.last_operation_id IS DISTINCT FROM p_operation_id
    OR reference.sha256 IS DISTINCT FROM p_sha256
    OR reference.storage_key IS DISTINCT FROM p_storage_key
    OR reference.mime_type IS DISTINCT FROM p_mime_type
    OR reference.size_bytes IS DISTINCT FROM p_size_bytes
    OR reference.normalization_version IS DISTINCT FROM lifecycle.normalization_version
  ) THEN RETURN 'stale'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_failure(
    reservation.reservation_token, p_sha256, p_storage_key, p_mime_type,
    p_size_bytes, lifecycle.normalization_version, 'direct_ingestion',
    p_workspace_id, p_media_asset_id, p_operation_id, p_cleanup_delay_ms);
  IF terminalization_status IN ('referenced', 'unreferenced') THEN RETURN terminalization_status; END IF;
  RETURN 'stale';
END;
$$;
CREATE FUNCTION content.close_media_upload_session_blob_writer(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT,
  p_sha256 TEXT, p_storage_key TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_expires_at TIMESTAMPTZ, p_cleanup_delay_ms INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE; lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE; owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  session_found BOOLEAN; reference RECORD; reference_found BOOLEAN;
  abort_proven BOOLEAN; expiry_proven BOOLEAN; terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 OR p_user_id IS NULL
    OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL OR p_media_asset_id IS NULL
    OR p_last_modified_by_replica_id IS NULL OR p_last_operation_id IS NULL OR p_sha256 IS NULL
    OR p_storage_key IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL OR p_expires_at IS NULL
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  SELECT sessions.* INTO session FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;
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
  IF NOT FOUND THEN
    IF session_found OR EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS conflicts
      WHERE conflicts.writer_kind = 'multipart_completion'
        AND conflicts.workspace_id = p_workspace_id
        AND conflicts.media_asset_id = p_media_asset_id
        AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ) THEN RETURN 'stale'; END IF;
    RETURN 'absent';
  END IF;
  SELECT reservations.* INTO reservation FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion'
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_media_upload_session_id::TEXT FOR UPDATE;
  IF NOT FOUND THEN
    IF session_found OR EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS conflicts
      WHERE conflicts.workspace_id = p_workspace_id
        AND conflicts.media_asset_id = p_media_asset_id
        AND conflicts.operation_id = p_media_upload_session_id::TEXT
    ) THEN RETURN 'stale'; END IF;
    RETURN 'absent';
  END IF;
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
  IF NOT session_found AND reservation.state = 'unreferenced' THEN
    RETURN 'already_closed'; END IF;
  IF session_found AND session.state IN ('completed', 'aborted') THEN
    RETURN 'already_closed'; END IF;
  abort_proven := session_found AND session.state = 'aborting';
  expiry_proven := owner_snapshot.session_expires_at <= clock_timestamp();
  IF NOT abort_proven AND NOT expiry_proven AND EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_active'; END IF;
  SELECT assets.workspace_id, assets.source_url, assets.created_at,
    assets.client_updated_at, assets.last_modified_by_replica_id,
    assets.last_operation_id, blobs.sha256, blobs.storage_key, blobs.mime_type,
    blobs.size_bytes, blobs.normalization_version
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
      reservation.reservation_token, p_sha256, p_storage_key, p_mime_type,
      p_size_bytes, lifecycle.normalization_version, 'multipart_completion',
      p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
      p_cleanup_delay_ms);
    IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
    IF session_found THEN UPDATE content.media_upload_sessions
      SET state = 'completed', completed_at = clock_timestamp(), aborted_at = NULL
      WHERE media_upload_session_id = p_media_upload_session_id; END IF;
    RETURN 'referenced';
  END IF;
  IF NOT abort_proven AND NOT expiry_proven THEN RETURN 'stale'; END IF;
  IF reservation.state = 'finalized' THEN RETURN 'stale'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_failure(
    reservation.reservation_token, p_sha256, p_storage_key, p_mime_type,
    p_size_bytes, lifecycle.normalization_version, 'multipart_completion',
    p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
    p_cleanup_delay_ms);
  IF terminalization_status <> 'unreferenced' THEN RETURN 'stale'; END IF;
  IF session_found THEN UPDATE content.media_upload_sessions
    SET state = 'aborted', completed_at = NULL, aborted_at = clock_timestamp()
    WHERE media_upload_session_id = p_media_upload_session_id; END IF;
  RETURN 'unreferenced';
END;
$$;
CREATE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  owner_user_id TEXT; affected_sha256s TEXT[]; affected_sha256 TEXT; terminalized_at TIMESTAMPTZ;
BEGIN
  FOR owner_user_id IN
    SELECT user_ids.user_id
    FROM (
      SELECT memberships.user_id FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = OLD.workspace_id
      UNION
      SELECT snapshots.user_id FROM content.media_blob_writer_owner_snapshots AS snapshots
      WHERE snapshots.workspace_id = OLD.workspace_id
    ) AS user_ids
    ORDER BY user_ids.user_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(owner_user_id || ':' || OLD.workspace_id::TEXT, 0::BIGINT));
  END LOOP;
  SELECT array_agg(DISTINCT reservations.sha256 ORDER BY reservations.sha256)
  INTO affected_sha256s FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion');
  IF affected_sha256s IS NULL THEN RETURN OLD; END IF;
  PERFORM 1 FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id
  ORDER BY sessions.media_upload_session_id FOR UPDATE;
  DELETE FROM content.media_upload_sessions AS sessions WHERE sessions.workspace_id = OLD.workspace_id;
  DELETE FROM content.media_assets AS assets WHERE assets.workspace_id = OLD.workspace_id;
  FOREACH affected_sha256 IN ARRAY affected_sha256s LOOP
    PERFORM 1 FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = affected_sha256 FOR UPDATE;
  END LOOP;
  PERFORM 1 FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion')
  ORDER BY reservations.sha256, reservations.writer_kind,
    reservations.media_asset_id, reservations.operation_id
  FOR UPDATE;
  PERFORM 1 FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.workspace_id = OLD.workspace_id ORDER BY snapshots.reservation_token FOR UPDATE;
  UPDATE content.media_blob_writer_reservations AS reservations
  SET state = 'unreferenced'
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion')
    AND reservations.state <> 'unreferenced';
  terminalized_at := clock_timestamp();
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = GREATEST(
      COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ),
      terminalized_at + interval '1 hour'
    ),
    cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL,
    updated_at = terminalized_at
  WHERE lifecycles.sha256 = ANY(affected_sha256s)
    AND NOT EXISTS (
      SELECT 1 FROM content.media_assets AS assets
      INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256 AND assets.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM catalog.package_media_assets AS assets
      INNER JOIN content.media_blobs AS blobs ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
    )
    AND NOT EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = lifecycles.sha256
        AND reservations.state NOT IN ('finalized', 'unreferenced')
    );
  RETURN OLD;
END;
$$;
CREATE TRIGGER media_blob_writers_before_workspace_delete BEFORE DELETE ON org.workspaces FOR EACH ROW EXECUTE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete();
REVOKE ALL ON TABLE content.media_blob_lifecycles, content.media_blob_writer_reservations, content.media_blob_writer_owner_snapshots FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.reserve_owned_media_blob_writer_internal(TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.reserve_direct_media_blob_writer_with_owner(TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.reserve_media_upload_session_blob_writer_with_owner(TEXT, UUID, UUID, TEXT) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_direct_media_blob_writer_after_access_revocation(TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.close_media_upload_session_blob_writer(TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.terminalize_media_blob_writers_before_workspace_delete() FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION content.reserve_direct_media_blob_writer_with_owner(TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION content.reserve_media_upload_session_blob_writer_with_owner(TEXT, UUID, UUID, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_direct_media_blob_writer_after_access_revocation(TEXT, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.close_media_upload_session_blob_writer(TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER) TO backend_app;
