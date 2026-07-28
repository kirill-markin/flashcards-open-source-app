-- Current additive migration for multipart abort ownership and completed-attempt replay.
-- Schemas touched/read explicitly: content, org, security, sync, pg_catalog.

CREATE INDEX media_blob_writer_attempts_multipart_session_history
  ON content.media_blob_writer_attempts (
    media_upload_session_id,
    state,
    terminal_at,
    created_at,
    attempt_token
  )
  WHERE writer_kind = 'multipart_completion';

CREATE FUNCTION content.multipart_media_blob_writer_terminal_replay_status_internal(
  p_attempt content.media_blob_writer_attempts,
  p_payload content.multipart_media_blob_writer_attempt_payload
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN (p_attempt).attempt_token IS NULL THEN 'stale_attempt'
    WHEN (p_attempt).user_id IS DISTINCT FROM p_payload.user_id
      OR (p_attempt).replica_id IS DISTINCT FROM p_payload.replica_id
    THEN 'ownership_mismatch'
    WHEN (p_attempt).writer_kind IS DISTINCT FROM 'multipart_completion'
      OR (p_attempt).workspace_id IS DISTINCT FROM p_payload.workspace_id
      OR (p_attempt).media_asset_id IS DISTINCT FROM p_payload.media_asset_id
      OR (p_attempt).operation_id IS DISTINCT FROM p_payload.media_upload_session_id::TEXT
      OR (p_attempt).media_upload_session_id IS DISTINCT FROM p_payload.media_upload_session_id
      OR (p_attempt).sha256 IS DISTINCT FROM p_payload.sha256
      OR (p_attempt).blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key
      OR (p_attempt).mime_type IS DISTINCT FROM p_payload.mime_type
      OR (p_attempt).size_bytes IS DISTINCT FROM p_payload.size_bytes
      OR (p_attempt).requested_normalization_version IS DISTINCT FROM p_payload.normalization_version
      OR (p_attempt).staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key
      OR (p_attempt).s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
      OR (p_attempt).part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes
      OR (p_attempt).part_count IS DISTINCT FROM p_payload.part_count
      OR (p_attempt).session_expires_at IS DISTINCT FROM p_payload.session_expires_at
      OR (p_attempt).completed_parts_fingerprint IS DISTINCT FROM p_payload.completed_parts_fingerprint
    THEN 'stale_attempt'
    ELSE 'ready'
  END;
$$;

CREATE OR REPLACE FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
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
  terminal_attempt content.media_blob_writer_attempts%ROWTYPE;
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
  IF p_attempt_token IS NULL
    OR p_lease_duration_ms IS NULL
    OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(p_payload) IS DISTINCT FROM true
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.state <> 'leased';

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id()
    THEN
      RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    fence_status := content.multipart_media_blob_writer_terminal_replay_status_internal(
      existing_attempt,
      p_payload
    );
    IF fence_status <> 'ready' THEN
      RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_payload.user_id || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_payload.workspace_id
      AND memberships.user_id = p_payload.user_id
  ) THEN
    RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = p_payload.user_id
  ) THEN
    RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id
  FOR UPDATE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attempt:' || p_attempt_token::TEXT, 3::BIGINT)
  );

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM security.current_workspace_id()
    THEN
      RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    IF existing_attempt.state <> 'leased' THEN
      fence_status := content.multipart_media_blob_writer_terminal_replay_status_internal(
        existing_attempt,
        p_payload
      );
      IF fence_status <> 'ready' THEN
        RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
        RETURN;
      END IF;

      RETURN QUERY
      SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    apply_payload := p_payload;
    apply_payload.normalization_version := existing_attempt.normalization_version;
    fence_status := content.multipart_media_blob_writer_attempt_identity_status_internal(
      existing_attempt,
      existing_attempt.reservation_token,
      apply_payload
    );
    IF existing_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version
    THEN
      fence_status := 'stale_attempt';
    END IF;
    IF fence_status <> 'ready' THEN
      RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    fence_status := content.fence_media_upload_session_completion_attempt_apply_with_owner(
      p_attempt_token,
      existing_attempt.reservation_token,
      apply_payload,
      3600000
    );
    IF fence_status = 'ready' THEN
      leased_until := pg_catalog.clock_timestamp()
        + (p_lease_duration_ms * interval '1 millisecond');
      UPDATE content.media_blob_writer_attempts AS attempts
      SET lease_expires_at = leased_until
      WHERE attempts.attempt_token = p_attempt_token
        AND attempts.state = 'leased'
        AND attempts.lease_expires_at > pg_catalog.clock_timestamp();
      IF NOT FOUND THEN
        fence_status := 'stale_attempt';
      ELSE
        fence_status := 'replayed';
      END IF;
    END IF;

    IF fence_status = 'replayed' THEN
      RETURN QUERY
      SELECT
        fence_status,
        existing_attempt.reservation_token,
        existing_attempt.normalization_version,
        leased_until;
    ELSE
      RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    END IF;
    RETURN;
  END IF;

  INSERT INTO sync.workspace_sync_metadata (
    workspace_id,
    min_available_hot_change_id,
    updated_at
  )
  VALUES (p_payload.workspace_id, 0, pg_catalog.statement_timestamp())
  ON CONFLICT (workspace_id) DO NOTHING;

  PERFORM 1
  FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = p_payload.workspace_id
  FOR UPDATE;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_payload.sha256
  FOR UPDATE;

  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = 'multipart_completion'
    AND reservations.workspace_id = p_payload.workspace_id
    AND reservations.media_asset_id = p_payload.media_asset_id
    AND reservations.operation_id = p_payload.media_upload_session_id::TEXT
  FOR UPDATE;

  IF FOUND THEN
    SELECT snapshots.*
    INTO owner_snapshot
    FROM content.media_blob_writer_owner_snapshots AS snapshots
    WHERE snapshots.reservation_token = reservation.reservation_token
    FOR UPDATE;
  END IF;

  SELECT attempts.*
  INTO peer_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.workspace_id = p_payload.workspace_id
    AND attempts.media_asset_id = p_payload.media_asset_id
    AND attempts.operation_id = p_payload.media_upload_session_id::TEXT
    AND attempts.state = 'leased'
  FOR UPDATE;

  SELECT attempts.*
  INTO terminal_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.media_upload_session_id = p_payload.media_upload_session_id
    AND attempts.state IN ('applied', 'referenced')
  ORDER BY
    attempts.created_at,
    attempts.terminal_at,
    attempts.attempt_token
  LIMIT 1
  FOR UPDATE;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
    OR NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_payload.workspace_id
        AND memberships.user_id = p_payload.user_id
    )
  THEN
    RETURN QUERY SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_payload.replica_id
      AND replicas.workspace_id = p_payload.workspace_id
      AND replicas.user_id = p_payload.user_id
  ) THEN
    RETURN QUERY SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.media_upload_session_id IS NULL
    OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256
    OR session.staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
    OR session.mime_type IS DISTINCT FROM p_payload.mime_type
    OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes
    OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes
    OR session.part_count IS DISTINCT FROM p_payload.part_count
    OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id THEN
    RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.state <> 'completed'
    AND (
      session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id
      OR session.source_url IS DISTINCT FROM p_payload.source_url
      OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at
      OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at
    )
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.state = 'aborting' THEN
    RETURN QUERY SELECT 'aborting'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  ELSIF session.state = 'aborted' THEN
    RETURN QUERY SELECT 'aborted'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  ELSIF session.state = 'active'
    AND session.expires_at <= pg_catalog.clock_timestamp()
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  ELSIF session.state NOT IN ('active', 'completing', 'completed') THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF lifecycle.sha256 IS NOT NULL
    AND (
      lifecycle.storage_key IS DISTINCT FROM p_payload.blob_storage_key
      OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type
      OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes
    )
  THEN
    RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN
    RETURN QUERY
    SELECT
      'cleanup_claimed'::TEXT,
      NULL::UUID,
      lifecycle.normalization_version,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF reservation.reservation_token IS NOT NULL
    AND (
      reservation.sha256 IS DISTINCT FROM p_payload.sha256
      OR owner_snapshot.reservation_token IS NULL
    )
  THEN
    RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF owner_snapshot.reservation_token IS NOT NULL
    AND (
      owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id
      OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id
    )
  THEN
    RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.state <> 'completed'
    AND owner_snapshot.reservation_token IS NOT NULL
    AND (
      owner_snapshot.session_last_operation_id IS DISTINCT FROM p_payload.last_operation_id
      OR owner_snapshot.session_expires_at IS DISTINCT FROM p_payload.session_expires_at
      OR owner_snapshot.session_source_url IS DISTINCT FROM p_payload.source_url
      OR owner_snapshot.session_asset_created_at IS DISTINCT FROM p_payload.asset_created_at
      OR owner_snapshot.session_client_updated_at IS DISTINCT FROM p_payload.client_updated_at
    )
  THEN
    RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.state = 'completed' THEN
    IF reservation.reservation_token IS NULL
      OR reservation.state <> 'finalized'
      OR terminal_attempt.attempt_token IS NULL
    THEN
      RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    fence_status := content.multipart_media_blob_writer_terminal_replay_status_internal(
      terminal_attempt,
      p_payload
    );
    IF fence_status <> 'ready' THEN
      RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    IF terminal_attempt.reservation_token IS DISTINCT FROM reservation.reservation_token
      OR terminal_attempt.normalization_version IS DISTINCT FROM lifecycle.normalization_version
    THEN
      RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT terminal_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF owner_snapshot.reservation_token IS NOT NULL
    AND owner_snapshot.session_expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN
    RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF peer_attempt.attempt_token IS NOT NULL THEN
    apply_payload := p_payload;
    apply_payload.normalization_version := peer_attempt.normalization_version;
    fence_status := content.multipart_media_blob_writer_attempt_identity_status_internal(
      peer_attempt,
      peer_attempt.reservation_token,
      apply_payload
    );
    IF fence_status <> 'ready'
      OR peer_attempt.requested_normalization_version IS DISTINCT FROM p_payload.normalization_version
    THEN
      RETURN QUERY
      SELECT
        CASE WHEN fence_status = 'ready' THEN 'stale_attempt' ELSE fence_status END,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    ELSIF peer_attempt.reservation_token IS DISTINCT FROM reservation.reservation_token
      OR peer_attempt.normalization_version IS DISTINCT FROM lifecycle.normalization_version
      OR reservation.state NOT IN ('active', 'ambiguous', 'finalized')
    THEN
      RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    ELSIF peer_attempt.lease_expires_at > pg_catalog.clock_timestamp() THEN
      RETURN QUERY
      SELECT 'busy'::TEXT, NULL::UUID, NULL::TEXT, peer_attempt.lease_expires_at;
      RETURN;
    END IF;

    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'expired',
      outcome = 'stale_attempt',
      terminal_at = pg_catalog.clock_timestamp()
    WHERE attempts.attempt_token = peer_attempt.attempt_token
      AND attempts.state = 'leased';
    takeover := true;
  END IF;

  SELECT *
  INTO reservation_result
  FROM content.reserve_owned_media_blob_writer_internal(
    p_payload.user_id,
    p_payload.replica_id,
    p_payload.sha256,
    p_payload.blob_storage_key,
    p_payload.mime_type,
    p_payload.size_bytes,
    p_payload.normalization_version,
    'multipart_completion',
    p_payload.workspace_id,
    p_payload.media_asset_id,
    p_payload.media_upload_session_id::TEXT,
    p_payload.last_operation_id,
    p_payload.session_expires_at,
    p_payload.source_url,
    p_payload.asset_created_at,
    p_payload.client_updated_at
  );

  IF reservation_result.reservation_status = 'cleanup_claimed' THEN
    RETURN QUERY
    SELECT
      'cleanup_claimed'::TEXT,
      NULL::UUID,
      reservation_result.normalization_version,
      NULL::TIMESTAMPTZ;
    RETURN;
  ELSIF reservation_result.reservation_status = 'ownership_mismatch' THEN
    RETURN QUERY SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  ELSIF reservation_result.reservation_status <> 'reserved'
    OR reservation_result.reservation_token IS NULL
  THEN
    RETURN QUERY SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF session.state = 'active' THEN
    UPDATE content.media_upload_sessions AS sessions
    SET state = 'completing'
    WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id
      AND sessions.state = 'active';
  END IF;

  leased_until := pg_catalog.clock_timestamp()
    + (p_lease_duration_ms * interval '1 millisecond');
  INSERT INTO content.media_blob_writer_attempts (
    attempt_token,
    reservation_token,
    writer_kind,
    user_id,
    workspace_id,
    media_asset_id,
    operation_id,
    last_operation_id,
    replica_id,
    sha256,
    blob_storage_key,
    mime_type,
    size_bytes,
    requested_normalization_version,
    normalization_version,
    source_url,
    asset_created_at,
    client_updated_at,
    media_upload_session_id,
    staging_storage_key,
    s3_upload_id,
    part_size_bytes,
    part_count,
    session_expires_at,
    completed_parts_fingerprint,
    state,
    lease_expires_at
  )
  VALUES (
    p_attempt_token,
    reservation_result.reservation_token,
    'multipart_completion',
    p_payload.user_id,
    p_payload.workspace_id,
    p_payload.media_asset_id,
    p_payload.media_upload_session_id::TEXT,
    p_payload.last_operation_id,
    p_payload.replica_id,
    p_payload.sha256,
    p_payload.blob_storage_key,
    p_payload.mime_type,
    p_payload.size_bytes,
    p_payload.normalization_version,
    reservation_result.normalization_version,
    p_payload.source_url,
    p_payload.asset_created_at,
    p_payload.client_updated_at,
    p_payload.media_upload_session_id,
    p_payload.staging_storage_key,
    p_payload.s3_upload_id,
    p_payload.part_size_bytes,
    p_payload.part_count,
    p_payload.session_expires_at,
    p_payload.completed_parts_fingerprint,
    'leased',
    leased_until
  );

  apply_payload := p_payload;
  apply_payload.normalization_version := reservation_result.normalization_version;
  fence_status := content.fence_media_upload_session_completion_attempt_apply_with_owner(
    p_attempt_token,
    reservation_result.reservation_token,
    apply_payload,
    3600000
  );
  IF fence_status = 'ready' THEN
    fence_status := CASE WHEN takeover THEN 'expired_takeover' ELSE 'acquired' END;
  END IF;

  IF fence_status IN ('acquired', 'expired_takeover') THEN
    RETURN QUERY
    SELECT
      fence_status,
      reservation_result.reservation_token,
      reservation_result.normalization_version,
      leased_until;
  ELSE
    RETURN QUERY SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

CREATE FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_upload_session_id UUID,
  p_media_asset_id UUID,
  p_last_modified_by_replica_id UUID,
  p_last_operation_id TEXT,
  p_sha256 TEXT,
  p_storage_key TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_expires_at TIMESTAMPTZ,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  selected_attempt content.media_blob_writer_attempts%ROWTYPE;
  current_attempt content.media_blob_writer_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  reference RECORD;
  session_found BOOLEAN;
  access_present BOOLEAN;
  replica_matches BOOLEAN;
  abort_proven BOOLEAN;
  expiry_proven BOOLEAN;
  exact_reference_found BOOLEAN;
  terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
    OR p_user_id IS NULL
    OR p_workspace_id IS NULL
    OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL
    OR p_last_modified_by_replica_id IS NULL
    OR p_last_operation_id IS NULL
    OR p_sha256 IS NULL
    OR p_storage_key IS NULL
    OR p_mime_type IS NULL
    OR p_size_bytes IS NULL
    OR p_expires_at IS NULL
  THEN
    RETURN 'stale';
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id || ':' || p_workspace_id::TEXT, 0::BIGINT)
  );

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;
  session_found := FOUND;

  IF session_found
    AND (
      session.workspace_id IS DISTINCT FROM p_workspace_id
      OR session.media_asset_id IS DISTINCT FROM p_media_asset_id
      OR session.last_modified_by_replica_id IS DISTINCT FROM p_last_modified_by_replica_id
      OR session.last_operation_id IS DISTINCT FROM p_last_operation_id
      OR session.media_blob_sha256 IS DISTINCT FROM p_sha256
      OR session.blob_storage_key IS DISTINCT FROM p_storage_key
      OR session.mime_type IS DISTINCT FROM p_mime_type
      OR session.size_bytes IS DISTINCT FROM p_size_bytes
      OR session.expires_at IS DISTINCT FROM p_expires_at
    )
  THEN
    RETURN 'stale';
  END IF;

  SELECT attempts.*
  INTO selected_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.media_upload_session_id = p_media_upload_session_id
  ORDER BY
    (attempts.state = 'leased') DESC,
    attempts.terminal_at DESC NULLS LAST,
    attempts.created_at DESC,
    attempts.attempt_token DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN content.close_media_upload_session_blob_writer(
      p_user_id,
      p_workspace_id,
      p_media_upload_session_id,
      p_media_asset_id,
      p_last_modified_by_replica_id,
      p_last_operation_id,
      p_sha256,
      p_storage_key,
      p_mime_type,
      p_size_bytes,
      p_expires_at,
      p_cleanup_delay_ms
    );
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = selected_attempt.sha256
  FOR UPDATE;

  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = selected_attempt.reservation_token
  FOR UPDATE;

  IF FOUND THEN
    SELECT snapshots.*
    INTO owner_snapshot
    FROM content.media_blob_writer_owner_snapshots AS snapshots
    WHERE snapshots.reservation_token = reservation.reservation_token
    FOR UPDATE;
  END IF;

  SELECT attempts.*
  INTO current_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = selected_attempt.attempt_token
  FOR UPDATE;

  SELECT
    assets.workspace_id,
    blobs.sha256,
    blobs.storage_key,
    blobs.mime_type,
    blobs.size_bytes,
    blobs.normalization_version
  INTO reference
  FROM content.media_assets AS assets
  INNER JOIN content.media_blobs AS blobs
    ON blobs.media_blob_id = assets.media_blob_id
  WHERE assets.media_asset_id = p_media_asset_id
    AND assets.deleted_at IS NULL
  FOR UPDATE OF assets, blobs;

  SELECT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  )
  INTO access_present;

  SELECT EXISTS (
    SELECT 1
    FROM sync.workspace_replicas AS replicas
    WHERE replicas.replica_id = p_last_modified_by_replica_id
      AND replicas.workspace_id = p_workspace_id
      AND replicas.user_id = p_user_id
  )
  INTO replica_matches;

  IF current_attempt.attempt_token IS NULL
    OR current_attempt.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR current_attempt.media_upload_session_id IS DISTINCT FROM p_media_upload_session_id
    OR current_attempt.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR current_attempt.workspace_id IS DISTINCT FROM p_workspace_id
    OR current_attempt.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR current_attempt.sha256 IS DISTINCT FROM p_sha256
    OR current_attempt.blob_storage_key IS DISTINCT FROM p_storage_key
    OR current_attempt.mime_type IS DISTINCT FROM p_mime_type
    OR current_attempt.size_bytes IS DISTINCT FROM p_size_bytes
    OR current_attempt.session_expires_at IS DISTINCT FROM p_expires_at
  THEN
    RETURN 'stale_attempt';
  END IF;

  IF current_attempt.user_id IS DISTINCT FROM p_user_id
    OR owner_snapshot.user_id IS DISTINCT FROM p_user_id
  THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF current_attempt.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_last_modified_by_replica_id
  THEN
    RETURN CASE WHEN access_present THEN 'replica_mismatch' ELSE 'access_denied' END;
  END IF;

  IF current_attempt.last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM p_last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM p_expires_at
  THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF lifecycle.sha256 IS NULL
    OR reservation.reservation_token IS NULL
    OR owner_snapshot.reservation_token IS NULL
    OR reservation.reservation_token IS DISTINCT FROM current_attempt.reservation_token
    OR reservation.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR reservation.workspace_id IS DISTINCT FROM p_workspace_id
    OR reservation.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR reservation.operation_id IS DISTINCT FROM p_media_upload_session_id::TEXT
    OR reservation.sha256 IS DISTINCT FROM p_sha256
    OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM current_attempt.normalization_version
  THEN
    RETURN 'writer_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM content.media_blob_writer_attempts AS successors
    WHERE successors.writer_kind = 'multipart_completion'
      AND successors.media_upload_session_id = p_media_upload_session_id
      AND successors.state = 'leased'
      AND successors.attempt_token <> current_attempt.attempt_token
  ) THEN
    RETURN 'stale_attempt';
  END IF;

  exact_reference_found :=
    reference.workspace_id IS NOT NULL
    AND reference.workspace_id IS NOT DISTINCT FROM p_workspace_id
    AND reference.sha256 IS NOT DISTINCT FROM p_sha256
    AND reference.storage_key IS NOT DISTINCT FROM p_storage_key
    AND reference.mime_type IS NOT DISTINCT FROM p_mime_type
    AND reference.size_bytes IS NOT DISTINCT FROM p_size_bytes
    AND reference.normalization_version IS NOT DISTINCT FROM current_attempt.normalization_version;

  IF exact_reference_found AND current_attempt.state <> 'leased' THEN
    UPDATE content.media_blob_writer_reservations AS reservations
    SET state = 'finalized'
    WHERE reservations.reservation_token = reservation.reservation_token;

    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_eligible_at = NULL,
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
    WHERE lifecycles.sha256 = current_attempt.sha256;

    IF current_attempt.state NOT IN ('applied', 'referenced') THEN
      UPDATE content.media_blob_writer_attempts AS attempts
      SET
        state = 'referenced',
        outcome = 'referenced',
        terminal_at = pg_catalog.clock_timestamp()
      WHERE attempts.attempt_token = current_attempt.attempt_token;
    END IF;

    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'completed',
        completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()),
        aborted_at = NULL
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;

    RETURN CASE
      WHEN current_attempt.state IN ('applied', 'referenced') THEN current_attempt.outcome
      ELSE 'referenced'
    END;
  END IF;

  IF current_attempt.state IN ('applied', 'referenced') THEN
    IF reservation.state IS DISTINCT FROM 'finalized' THEN
      RETURN 'writer_conflict';
    END IF;
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'completed',
        completed_at = COALESCE(sessions.completed_at, current_attempt.terminal_at, pg_catalog.clock_timestamp()),
        aborted_at = NULL
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    RETURN current_attempt.outcome;
  ELSIF current_attempt.state = 'peer_conflict' THEN
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'aborted',
        completed_at = NULL,
        aborted_at = COALESCE(sessions.aborted_at, current_attempt.terminal_at, pg_catalog.clock_timestamp())
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    RETURN 'peer_conflict';
  ELSIF current_attempt.state = 'cancelled' THEN
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'aborted',
        completed_at = NULL,
        aborted_at = COALESCE(sessions.aborted_at, current_attempt.terminal_at, pg_catalog.clock_timestamp())
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    RETURN current_attempt.outcome;
  END IF;

  abort_proven := session_found AND session.state IN ('aborting', 'aborted');
  expiry_proven := COALESCE(session.expires_at, owner_snapshot.session_expires_at)
    <= pg_catalog.clock_timestamp();

  IF current_attempt.state = 'unreferenced' THEN
    IF NOT abort_proven AND NOT expiry_proven THEN
      RETURN CASE WHEN access_present THEN 'access_active' ELSE 'access_denied' END;
    END IF;
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'aborted',
        completed_at = NULL,
        aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp())
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    RETURN 'already_closed';
  END IF;

  IF current_attempt.state = 'leased'
    AND current_attempt.lease_expires_at > pg_catalog.clock_timestamp()
    AND NOT abort_proven
  THEN
    RETURN CASE
      WHEN access_present AND p_expires_at > pg_catalog.clock_timestamp() THEN 'access_active'
      ELSE 'busy'
    END;
  END IF;

  IF NOT abort_proven AND NOT expiry_proven THEN
    RETURN CASE WHEN access_present THEN 'access_active' ELSE 'access_denied' END;
  END IF;

  IF replica_matches IS DISTINCT FROM true AND access_present THEN
    RETURN 'replica_mismatch';
  END IF;

  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > pg_catalog.clock_timestamp()
  THEN
    RETURN 'cleanup_claimed';
  END IF;

  terminalization_status := content.terminalize_media_blob_writer_failure(
    reservation.reservation_token,
    current_attempt.sha256,
    current_attempt.blob_storage_key,
    current_attempt.mime_type,
    current_attempt.size_bytes,
    current_attempt.normalization_version,
    'multipart_completion',
    current_attempt.workspace_id,
    current_attempt.media_asset_id,
    current_attempt.operation_id,
    p_cleanup_delay_ms
  );

  IF terminalization_status = 'referenced' THEN
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'completed',
        completed_at = COALESCE(sessions.completed_at, pg_catalog.clock_timestamp()),
        aborted_at = NULL
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    IF current_attempt.state = 'leased' THEN
      UPDATE content.media_blob_writer_attempts AS attempts
      SET
        state = 'referenced',
        outcome = 'referenced',
        terminal_at = pg_catalog.clock_timestamp()
      WHERE attempts.attempt_token = current_attempt.attempt_token
        AND attempts.state = 'leased';
    END IF;
    RETURN 'referenced';
  ELSIF terminalization_status <> 'unreferenced' THEN
    RETURN 'stale';
  END IF;

  IF session_found THEN
    UPDATE content.media_upload_sessions AS sessions
    SET
      state = 'aborted',
      completed_at = NULL,
      aborted_at = COALESCE(sessions.aborted_at, pg_catalog.clock_timestamp())
    WHERE sessions.media_upload_session_id = p_media_upload_session_id;
  END IF;

  IF current_attempt.state = 'leased' THEN
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'cancelled',
      outcome = 'aborted',
      terminal_at = pg_catalog.clock_timestamp()
    WHERE attempts.attempt_token = current_attempt.attempt_token
      AND attempts.state = 'leased';
  END IF;

  RETURN 'aborted';
END;
$$;

COMMENT ON FUNCTION content.multipart_media_blob_writer_terminal_replay_status_internal(
  content.media_blob_writer_attempts,
  content.multipart_media_blob_writer_attempt_payload
) IS
  'Compares completed multipart replay against immutable writer identity and the durable parts fingerprint.';
COMMENT ON FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER
) IS
  'Closes the database-selected current multipart attempt and reservation with the session, or uses the legacy closure only when no attempt exists.';

REVOKE ALL ON FUNCTION content.multipart_media_blob_writer_terminal_replay_status_internal(
  content.media_blob_writer_attempts,
  content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  UUID,
  INTEGER,
  content.multipart_media_blob_writer_attempt_payload
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.begin_media_upload_session_completion_attempt_with_owner(
  UUID,
  INTEGER,
  content.multipart_media_blob_writer_attempt_payload
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
  TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, INTEGER
) TO backend_app;
