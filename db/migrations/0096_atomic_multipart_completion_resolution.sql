-- Current additive migration for atomic multipart completion apply and recovery fencing.
-- Schemas touched/read explicitly: content, org, security, sync, pg_catalog.
CREATE OR REPLACE FUNCTION content.fence_media_blob_reference(p_media_blob_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  media_blob content.media_blobs%ROWTYPE; lifecycle content.media_blob_lifecycles%ROWTYPE;
BEGIN
  SELECT blobs.* INTO media_blob FROM content.media_blobs AS blobs WHERE blobs.media_blob_id = p_media_blob_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media blob reference targets a missing media blob'
    USING ERRCODE = '23503'; END IF;
  INSERT INTO content.media_blob_lifecycles
    (sha256, storage_key, mime_type, size_bytes, normalization_version, created_at, updated_at)
  VALUES (media_blob.sha256, media_blob.storage_key, media_blob.mime_type, media_blob.size_bytes,
    media_blob.normalization_version, media_blob.created_at, media_blob.updated_at)
  ON CONFLICT (sha256) DO NOTHING;
  SELECT lifecycles.* INTO lifecycle FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = media_blob.sha256 FOR UPDATE;
  SELECT blobs.* INTO media_blob FROM content.media_blobs AS blobs WHERE blobs.media_blob_id = p_media_blob_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media blob reference targets a missing media blob'
    USING ERRCODE = '23503'; END IF;
  IF lifecycle.sha256 IS DISTINCT FROM media_blob.sha256
    OR lifecycle.storage_key IS DISTINCT FROM media_blob.storage_key
    OR lifecycle.mime_type IS DISTINCT FROM media_blob.mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM media_blob.size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM media_blob.normalization_version
  THEN RAISE EXCEPTION 'Media blob reference conflicts with immutable lifecycle metadata' USING ERRCODE = '23514'; END IF;
  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > clock_timestamp()
  THEN RAISE EXCEPTION 'Media blob reference conflicts with an active cleanup claim' USING ERRCODE = '55P03'; END IF;
  UPDATE content.media_blob_lifecycles AS lifecycles SET cleanup_eligible_at = NULL,
    cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = media_blob.sha256;
END;
$$;
CREATE OR REPLACE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  owner_user_id TEXT; affected_sha256s TEXT[]; affected_sha256 TEXT; terminalized_at TIMESTAMPTZ;
BEGIN
  FOR owner_user_id IN
    SELECT user_ids.user_id FROM (
      SELECT memberships.user_id FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = OLD.workspace_id
      UNION SELECT snapshots.user_id FROM content.media_blob_writer_owner_snapshots AS snapshots
      WHERE snapshots.workspace_id = OLD.workspace_id
    ) AS user_ids ORDER BY user_ids.user_id
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended(
    owner_user_id || ':' || OLD.workspace_id::TEXT, 0::BIGINT)); END LOOP;
  SELECT array_agg(DISTINCT reservations.sha256 ORDER BY reservations.sha256) INTO affected_sha256s
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion');
  IF affected_sha256s IS NULL THEN RETURN OLD; END IF;
  PERFORM 1 FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id ORDER BY sessions.media_upload_session_id FOR UPDATE;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata WHERE metadata.workspace_id = OLD.workspace_id FOR UPDATE;
  FOREACH affected_sha256 IN ARRAY affected_sha256s LOOP
    PERFORM 1 FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = affected_sha256 FOR UPDATE; END LOOP;
  PERFORM 1 FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion')
  ORDER BY reservations.sha256, reservations.writer_kind, reservations.media_asset_id,
    reservations.operation_id FOR UPDATE;
  PERFORM 1 FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.workspace_id = OLD.workspace_id ORDER BY snapshots.reservation_token FOR UPDATE;
  DELETE FROM content.media_upload_sessions AS sessions WHERE sessions.workspace_id = OLD.workspace_id;
  DELETE FROM content.media_assets AS assets WHERE assets.workspace_id = OLD.workspace_id;
  UPDATE content.media_blob_writer_reservations AS reservations SET state = 'unreferenced'
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN ('direct_ingestion', 'multipart_completion')
    AND reservations.state <> 'unreferenced';
  terminalized_at := clock_timestamp();
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET cleanup_eligible_at = GREATEST(COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ),
      terminalized_at + interval '1 hour'),
    cleanup_lease_token = NULL, cleanup_lease_expires_at = NULL, updated_at = terminalized_at
  WHERE lifecycles.sha256 = ANY(affected_sha256s)
    AND NOT EXISTS (
      SELECT 1 FROM content.media_assets AS assets INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256 AND assets.deleted_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM catalog.package_media_assets AS assets INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256)
    AND NOT EXISTS (
      SELECT 1 FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = lifecycles.sha256 AND reservations.state NOT IN ('finalized', 'unreferenced'));
  RETURN OLD;
END;
$$;
CREATE FUNCTION content.classify_media_upload_session_completion_asset_internal(
  p_workspace_id UUID, p_media_asset_id UUID, p_sha256 TEXT,
  p_blob_storage_key TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_normalization_version TEXT, p_source_url TEXT,
  p_asset_created_at TIMESTAMPTZ, p_client_updated_at TIMESTAMPTZ,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT
)
RETURNS TABLE (asset_status TEXT, writer_referenced BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  asset RECORD;
  immutable_match BOOLEAN;
  incoming_wins BOOLEAN;
BEGIN
  SELECT
    assets.workspace_id, assets.source_url, assets.created_at,
    assets.client_updated_at, assets.last_modified_by_replica_id,
    assets.last_operation_id, assets.deleted_at, blobs.sha256,
    blobs.storage_key, blobs.mime_type, blobs.size_bytes,
    blobs.normalization_version
  INTO asset
  FROM content.media_assets AS assets
  INNER JOIN content.media_blobs AS blobs
    ON blobs.media_blob_id = assets.media_blob_id
  WHERE assets.media_asset_id = p_media_asset_id
  FOR UPDATE OF assets, blobs;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'absent'::TEXT, false;
    RETURN;
  END IF;
  immutable_match :=
    asset.workspace_id IS NOT DISTINCT FROM p_workspace_id
    AND asset.sha256 IS NOT DISTINCT FROM p_sha256
    AND asset.storage_key IS NOT DISTINCT FROM p_blob_storage_key
    AND asset.mime_type IS NOT DISTINCT FROM p_mime_type
    AND asset.size_bytes IS NOT DISTINCT FROM p_size_bytes
    AND asset.normalization_version IS NOT DISTINCT FROM p_normalization_version;
  writer_referenced :=
    asset.deleted_at IS NULL
    AND asset.workspace_id IS NOT DISTINCT FROM p_workspace_id
    AND asset.sha256 IS NOT DISTINCT FROM p_sha256;
  IF immutable_match
    AND asset.deleted_at IS NULL
    AND asset.source_url IS NOT DISTINCT FROM p_source_url
    AND asset.created_at IS NOT DISTINCT FROM p_asset_created_at
    AND asset.client_updated_at IS NOT DISTINCT FROM p_client_updated_at
    AND asset.last_modified_by_replica_id IS NOT DISTINCT FROM p_last_modified_by_replica_id
    AND asset.last_operation_id IS NOT DISTINCT FROM p_last_operation_id
  THEN
    RETURN QUERY SELECT 'exact'::TEXT, writer_referenced;
    RETURN;
  END IF;
  incoming_wins :=
    asset.client_updated_at < p_client_updated_at
    OR (
      asset.client_updated_at = p_client_updated_at
      AND asset.last_modified_by_replica_id::TEXT COLLATE "C"
        < p_last_modified_by_replica_id::TEXT COLLATE "C"
    )
    OR (
      asset.client_updated_at = p_client_updated_at
      AND asset.last_modified_by_replica_id = p_last_modified_by_replica_id
      AND asset.last_operation_id COLLATE "C" < p_last_operation_id COLLATE "C"
    );
  IF immutable_match AND incoming_wins THEN
    RETURN QUERY SELECT 'ready'::TEXT, writer_referenced;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'peer_conflict'::TEXT, writer_referenced;
END;
$$;
CREATE FUNCTION content.fence_media_upload_session_completion_apply_with_owner(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT, p_sha256 TEXT, p_staging_storage_key TEXT,
  p_blob_storage_key TEXT, p_s3_upload_id TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_part_size_bytes BIGINT, p_part_count INTEGER, p_source_url TEXT, p_asset_created_at TIMESTAMPTZ,
  p_client_updated_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ, p_reservation_token UUID, p_normalization_version TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  asset RECORD;
  terminalization_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM btrim(p_user_id) OR p_user_id = ''
    OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL OR p_last_modified_by_replica_id IS NULL
    OR p_last_operation_id IS NULL OR p_sha256 IS NULL
    OR p_staging_storage_key IS NULL OR p_blob_storage_key IS NULL
    OR p_s3_upload_id IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL
    OR p_part_size_bytes IS NULL OR p_part_count IS NULL
    OR p_asset_created_at IS NULL OR p_client_updated_at IS NULL
    OR p_expires_at IS NULL OR p_reservation_token IS NULL
    OR p_normalization_version IS NULL OR p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN RETURN 'access_denied'; END IF;
  SELECT sessions.* INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;
  IF NOT FOUND OR session.workspace_id IS DISTINCT FROM p_workspace_id
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
  THEN RETURN 'stale'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_denied'; END IF;
  IF session.state NOT IN ('completing', 'completed', 'aborting', 'aborted') THEN
    RETURN 'stale';
  END IF;
  INSERT INTO sync.workspace_sync_metadata (
    workspace_id, min_available_hot_change_id, updated_at
  ) VALUES (p_workspace_id, 0, statement_timestamp())
  ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT reservations.* INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT snapshots.* INTO owner_snapshot
  FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.reservation_token = p_reservation_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT * INTO asset
  FROM content.classify_media_upload_session_completion_asset_internal(
    p_workspace_id, p_media_asset_id, p_sha256, p_blob_storage_key, p_mime_type,
    p_size_bytes, p_normalization_version, p_source_url, p_asset_created_at,
    p_client_updated_at, p_last_modified_by_replica_id, p_last_operation_id);
  IF reservation.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR reservation.workspace_id IS DISTINCT FROM p_workspace_id
    OR reservation.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR reservation.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR (
      reservation.state NOT IN ('active', 'ambiguous', 'finalized')
      AND NOT (
        session.state IN ('aborting', 'aborted')
        AND reservation.state = 'unreferenced'
      )
    )
    OR lifecycle.storage_key IS DISTINCT FROM p_blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM p_normalization_version
    OR (reservation.state <> 'unreferenced' AND lifecycle.cleanup_eligible_at IS NOT NULL)
    OR lifecycle.cleanup_lease_token IS NOT NULL
    OR lifecycle.cleanup_lease_expires_at IS NOT NULL
    OR owner_snapshot.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR owner_snapshot.workspace_id IS DISTINCT FROM p_workspace_id
    OR owner_snapshot.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR owner_snapshot.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR owner_snapshot.sha256 IS DISTINCT FROM p_sha256
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
    OR owner_snapshot.session_source_url IS DISTINCT FROM p_source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_client_updated_at
    OR (reservation.state = 'finalized' AND asset.writer_referenced IS DISTINCT FROM true)
    OR (reservation.state = 'unreferenced' AND asset.writer_referenced IS DISTINCT FROM false)
  THEN RETURN 'stale'; END IF;
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
    OR NOT EXISTS (
      SELECT 1 FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_workspace_id
        AND memberships.user_id = p_user_id
    )
  THEN RETURN 'access_denied'; END IF;
  IF session.state = 'aborting' THEN RETURN 'aborting';
  ELSIF session.state = 'aborted' THEN RETURN 'aborted';
  END IF;
  IF asset.asset_status = 'exact' THEN
    terminalization_status := content.terminalize_media_blob_writer_failure(
      p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
      p_size_bytes, p_normalization_version, 'multipart_completion',
      p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
      p_cleanup_delay_ms);
    IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'completed', completed_at = COALESCE(sessions.completed_at, clock_timestamp()),
      aborted_at = NULL
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'already_applied';
  END IF;
  IF asset.asset_status = 'peer_conflict' THEN
    terminalization_status := content.terminalize_media_blob_writer_failure(
      p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
      p_size_bytes, p_normalization_version, 'multipart_completion',
      p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
      p_cleanup_delay_ms);
    IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'peer_conflict';
  END IF;
  IF session.state = 'completed' THEN RETURN 'stale'; END IF;
  RETURN 'ready';
END;
$$;
CREATE FUNCTION content.resolve_media_upload_session_completion_failure_with_owner(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT, p_sha256 TEXT, p_staging_storage_key TEXT,
  p_blob_storage_key TEXT, p_s3_upload_id TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_part_size_bytes BIGINT, p_part_count INTEGER, p_source_url TEXT, p_asset_created_at TIMESTAMPTZ,
  p_client_updated_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ, p_reservation_token UUID, p_normalization_version TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  asset RECORD;
  terminalization_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM btrim(p_user_id) OR p_user_id = ''
    OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL OR p_last_modified_by_replica_id IS NULL
    OR p_last_operation_id IS NULL OR p_sha256 IS NULL
    OR p_staging_storage_key IS NULL OR p_blob_storage_key IS NULL
    OR p_s3_upload_id IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL
    OR p_part_size_bytes IS NULL OR p_part_count IS NULL
    OR p_asset_created_at IS NULL OR p_client_updated_at IS NULL
    OR p_expires_at IS NULL OR p_reservation_token IS NULL
    OR p_normalization_version IS NULL OR p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN RETURN 'access_denied'; END IF;
  SELECT sessions.* INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;
  IF NOT FOUND OR session.workspace_id IS DISTINCT FROM p_workspace_id
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
  THEN RETURN 'stale'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_denied'; END IF;
  INSERT INTO sync.workspace_sync_metadata (
    workspace_id, min_available_hot_change_id, updated_at
  ) VALUES (p_workspace_id, 0, statement_timestamp())
  ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT reservations.* INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT snapshots.* INTO owner_snapshot
  FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.reservation_token = p_reservation_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT * INTO asset
  FROM content.classify_media_upload_session_completion_asset_internal(
    p_workspace_id, p_media_asset_id, p_sha256, p_blob_storage_key, p_mime_type,
    p_size_bytes, p_normalization_version, p_source_url, p_asset_created_at,
    p_client_updated_at, p_last_modified_by_replica_id, p_last_operation_id);
  IF reservation.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR reservation.workspace_id IS DISTINCT FROM p_workspace_id
    OR reservation.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR reservation.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR reservation.state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
    OR lifecycle.storage_key IS DISTINCT FROM p_blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM p_normalization_version
    OR (reservation.state <> 'unreferenced' AND lifecycle.cleanup_eligible_at IS NOT NULL)
    OR lifecycle.cleanup_lease_token IS NOT NULL
    OR lifecycle.cleanup_lease_expires_at IS NOT NULL
    OR owner_snapshot.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR owner_snapshot.workspace_id IS DISTINCT FROM p_workspace_id
    OR owner_snapshot.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR owner_snapshot.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR owner_snapshot.sha256 IS DISTINCT FROM p_sha256
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
    OR owner_snapshot.session_source_url IS DISTINCT FROM p_source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_client_updated_at
    OR (reservation.state = 'finalized' AND asset.writer_referenced IS DISTINCT FROM true)
    OR (reservation.state = 'unreferenced' AND asset.writer_referenced IS DISTINCT FROM false)
  THEN RETURN 'stale'; END IF;
  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
    OR NOT EXISTS (
      SELECT 1 FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_workspace_id
        AND memberships.user_id = p_user_id
    )
  THEN RETURN 'access_denied'; END IF;
  IF asset.asset_status = 'peer_conflict' THEN
    terminalization_status := content.terminalize_media_blob_writer_failure(
      p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
      p_size_bytes, p_normalization_version, 'multipart_completion',
      p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
      p_cleanup_delay_ms);
    IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'peer_conflict';
  END IF;
  IF asset.asset_status = 'exact' THEN
    terminalization_status := content.terminalize_media_blob_writer_failure(
      p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
      p_size_bytes, p_normalization_version, 'multipart_completion',
      p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
      p_cleanup_delay_ms);
    IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'completed', completed_at = COALESCE(sessions.completed_at, clock_timestamp()),
      aborted_at = NULL
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'referenced';
  END IF;
  IF session.state = 'completed' THEN RETURN 'stale'; END IF;
  terminalization_status := content.terminalize_media_blob_writer_failure(
    p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
    p_size_bytes, p_normalization_version, 'multipart_completion',
    p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
    p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  IF session.state IN ('aborting', 'aborted') THEN
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'already_closed';
  END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'active', completed_at = NULL, aborted_at = NULL
  WHERE sessions.media_upload_session_id = p_media_upload_session_id;
  IF terminalization_status = 'referenced' THEN RETURN 'referenced'; END IF;
  RETURN 'unreferenced_restored';
END;
$$;
CREATE FUNCTION content.resolve_media_upload_session_completion_after_access_revocation(
  p_user_id TEXT, p_workspace_id UUID, p_media_upload_session_id UUID, p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID, p_last_operation_id TEXT, p_sha256 TEXT, p_staging_storage_key TEXT,
  p_blob_storage_key TEXT, p_s3_upload_id TEXT, p_mime_type TEXT, p_size_bytes BIGINT,
  p_part_size_bytes BIGINT, p_part_count INTEGER, p_source_url TEXT, p_asset_created_at TIMESTAMPTZ,
  p_client_updated_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  lifecycle_found BOOLEAN;
  reservation_found BOOLEAN;
  asset RECORD;
  terminalization_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM btrim(p_user_id) OR p_user_id = ''
    OR p_workspace_id IS NULL OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL OR p_last_modified_by_replica_id IS NULL
    OR p_last_operation_id IS NULL OR p_sha256 IS NULL
    OR p_staging_storage_key IS NULL OR p_blob_storage_key IS NULL
    OR p_s3_upload_id IS NULL OR p_mime_type IS NULL OR p_size_bytes IS NULL
    OR p_part_size_bytes IS NULL OR p_part_count IS NULL
    OR p_asset_created_at IS NULL OR p_client_updated_at IS NULL
    OR p_expires_at IS NULL OR p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN RETURN 'stale'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT));
  SELECT sessions.* INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;
  IF NOT FOUND OR session.workspace_id IS DISTINCT FROM p_workspace_id
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
  THEN RETURN 'stale'; END IF;
  INSERT INTO sync.workspace_sync_metadata (
    workspace_id, min_available_hot_change_id, updated_at
  ) VALUES (p_workspace_id, 0, statement_timestamp())
  ON CONFLICT (workspace_id) DO NOTHING;
  PERFORM 1 FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT lifecycles.* INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256 FOR UPDATE;
  lifecycle_found := FOUND;
  SELECT reservations.* INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion'
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_media_upload_session_id::TEXT
  FOR UPDATE;
  reservation_found := FOUND;
  IF reservation_found THEN
    SELECT snapshots.* INTO owner_snapshot
    FROM content.media_blob_writer_owner_snapshots AS snapshots
    WHERE snapshots.reservation_token = reservation.reservation_token FOR UPDATE;
    IF NOT FOUND THEN RETURN 'stale'; END IF;
  ELSE
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
  END IF;
  SELECT * INTO asset
  FROM content.classify_media_upload_session_completion_asset_internal(
    p_workspace_id, p_media_asset_id, p_sha256, p_blob_storage_key, p_mime_type,
    p_size_bytes, lifecycle.normalization_version, p_source_url,
    p_asset_created_at, p_client_updated_at, p_last_modified_by_replica_id,
    p_last_operation_id);
  IF lifecycle_found AND (
    lifecycle.storage_key IS DISTINCT FROM p_blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
    OR lifecycle.cleanup_lease_token IS NOT NULL
    OR lifecycle.cleanup_lease_expires_at IS NOT NULL
  ) THEN RETURN 'stale'; END IF;
  IF reservation_found AND (
    NOT lifecycle_found OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR reservation.state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
    OR (reservation.state <> 'unreferenced' AND lifecycle.cleanup_eligible_at IS NOT NULL)
    OR owner_snapshot.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR owner_snapshot.workspace_id IS DISTINCT FROM p_workspace_id
    OR owner_snapshot.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR owner_snapshot.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR owner_snapshot.sha256 IS DISTINCT FROM p_sha256
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
    OR owner_snapshot.session_source_url IS DISTINCT FROM p_source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_client_updated_at
    OR (reservation.state = 'finalized' AND asset.writer_referenced IS DISTINCT FROM true)
    OR (reservation.state = 'unreferenced' AND asset.writer_referenced IS DISTINCT FROM false)
  ) THEN RETURN 'stale'; END IF;
  IF NOT reservation_found THEN
    PERFORM 1 FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_last_modified_by_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = p_user_id
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN RETURN 'stale'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN RETURN 'access_active'; END IF;
  IF asset.asset_status = 'peer_conflict' THEN
    IF reservation_found THEN
      terminalization_status := content.terminalize_media_blob_writer_failure(
        reservation.reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
        p_size_bytes, lifecycle.normalization_version, 'multipart_completion',
        p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
        p_cleanup_delay_ms);
      IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
    END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'peer_conflict';
  END IF;
  IF asset.asset_status = 'exact' THEN
    IF reservation_found THEN
      terminalization_status := content.terminalize_media_blob_writer_failure(
        reservation.reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
        p_size_bytes, lifecycle.normalization_version, 'multipart_completion',
        p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
        p_cleanup_delay_ms);
      IF terminalization_status <> 'referenced' THEN RETURN 'stale'; END IF;
    END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'completed', completed_at = COALESCE(sessions.completed_at, clock_timestamp()),
      aborted_at = NULL
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'referenced';
  END IF;
  IF reservation_found AND reservation.state = 'unreferenced'
    AND session.state = 'aborted'
  THEN RETURN 'unreferenced_closed'; END IF;
  IF session.state IN ('completed', 'aborted') THEN RETURN 'already_closed'; END IF;
  IF NOT reservation_found THEN
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'aborted', completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    RETURN 'absent_closed';
  END IF;
  terminalization_status := content.terminalize_media_blob_writer_failure(
    reservation.reservation_token, p_sha256, p_blob_storage_key, p_mime_type,
    p_size_bytes, lifecycle.normalization_version, 'multipart_completion',
    p_workspace_id, p_media_asset_id, p_media_upload_session_id::TEXT,
    p_cleanup_delay_ms);
  IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN RETURN 'stale'; END IF;
  UPDATE content.media_upload_sessions AS sessions
  SET state = 'aborted', completed_at = NULL,
    aborted_at = COALESCE(sessions.aborted_at, clock_timestamp())
  WHERE sessions.media_upload_session_id = p_media_upload_session_id;
  IF terminalization_status = 'referenced' THEN RETURN 'referenced'; END IF;
  RETURN 'unreferenced_closed';
END;
$$;
COMMENT ON FUNCTION content.fence_media_upload_session_completion_apply_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER)
IS 'Fences one exact active owner-bound multipart writer before final media-asset application.';
COMMENT ON FUNCTION content.resolve_media_upload_session_completion_failure_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER) IS 'Atomically terminalizes one exact active multipart writer and restores or closes its session after definite failure.';
COMMENT ON FUNCTION content.resolve_media_upload_session_completion_after_access_revocation(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER) IS 'Resolves one exact historical-owner multipart completion only while workspace membership is absent.';
REVOKE ALL ON FUNCTION content.classify_media_upload_session_completion_asset_internal(
  UUID,UUID,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.fence_media_upload_session_completion_apply_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_media_upload_session_completion_failure_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.resolve_media_upload_session_completion_after_access_revocation(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION content.fence_media_upload_session_completion_apply_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_media_upload_session_completion_failure_with_owner(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.resolve_media_upload_session_completion_after_access_revocation(
  TEXT,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,INTEGER) TO backend_app;
