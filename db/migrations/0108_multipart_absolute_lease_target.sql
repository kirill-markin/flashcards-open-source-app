-- Current additive migration for absolute-target multipart completion leases.
-- Schemas touched/read explicitly: content, org, sync, security, pg_catalog.

CREATE FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_0108_internal(
  p_attempt_token UUID,
  p_lease_expires_at TIMESTAMPTZ,
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
    OR p_lease_expires_at IS NULL
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
    AND attempts.state <> 'leased'
  FOR UPDATE;

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
      leased_until := p_lease_expires_at;
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

  IF content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
    p_payload
  ) IS DISTINCT FROM true
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
    AND (
      attempts.state = 'leased'
      OR attempts.reconciliation_state IN ('pending', 'leased')
    )
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
    ELSIF peer_attempt.reconciliation_state IN ('pending', 'leased') THEN
      RETURN QUERY
      SELECT
        'busy'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        peer_attempt.reconciliation_lease_expires_at;
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

  leased_until := p_lease_expires_at;
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

CREATE FUNCTION
content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
  p_attempt_token UUID,
  p_lease_expires_at TIMESTAMPTZ,
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
  locked_at TIMESTAMPTZ;
  creation_claim_expires_at TIMESTAMPTZ;
  existing_attempt content.media_blob_writer_attempts%ROWTYPE;
  fence_status TEXT;
BEGIN
  IF p_attempt_token IS NULL
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT
      'stale'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  locked_at := pg_catalog.clock_timestamp();
  IF p_lease_expires_at IS NULL
    OR p_lease_expires_at <= locked_at
    OR p_lease_expires_at > locked_at + interval '3600000 milliseconds'
  THEN
    RETURN;
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN QUERY
    SELECT
      'access_denied'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.state <> 'leased'
    AND attempts.reconciliation_state IS DISTINCT FROM 'pending'
    AND attempts.reconciliation_state IS DISTINCT FROM 'leased'
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM
        security.current_workspace_id()
    THEN
      RETURN QUERY
      SELECT
        'access_denied'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    fence_status :=
      content.multipart_media_blob_writer_terminal_replay_status_internal(
        existing_attempt,
        p_payload
      );
    IF fence_status <> 'ready' THEN
      RETURN QUERY
      SELECT
        fence_status,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    RETURN QUERY
    SELECT
      existing_attempt.outcome,
      NULL::UUID,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_payload.user_id || ':' || p_payload.workspace_id::TEXT,
      0::BIGINT
    )
  );
  creation_claim_expires_at :=
    content.lock_upload_creation_claim_for_completion_internal(
      p_payload.workspace_id,
      p_payload.media_asset_id,
      p_payload.media_upload_session_id
  );
  IF creation_claim_expires_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_payload.workspace_id
        AND memberships.user_id = p_payload.user_id
    ) THEN
      RETURN QUERY
      SELECT
        'access_denied'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM sync.workspace_replicas AS replicas
      WHERE replicas.replica_id = p_payload.replica_id
        AND replicas.workspace_id = p_payload.workspace_id
        AND replicas.user_id = p_payload.user_id
    ) THEN
      RETURN QUERY
      SELECT
        'replica_mismatch'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    RETURN QUERY
    SELECT
      'busy'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      creation_claim_expires_at;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM
    content.begin_media_upload_session_completion_attempt_at_lease_target_0108_internal(
      p_attempt_token,
      p_lease_expires_at,
      p_payload
    );
END;
$$;

COMMENT ON FUNCTION
  content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.multipart_media_blob_writer_attempt_payload
  ) IS
  'Leases one exact multipart completion attempt until the caller-supplied absolute deadline, admitting the call only while that deadline is still ahead of a single database clock read.';

REVOKE ALL ON FUNCTION
  content.begin_media_upload_session_completion_attempt_at_lease_target_0108_internal(
    UUID,
    TIMESTAMPTZ,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION
  content.begin_media_upload_session_completion_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.multipart_media_blob_writer_attempt_payload
  )
  TO backend_app;
