-- Current additive migration for absolute-target direct writer leases.
-- Schemas touched/read explicitly: content, org, security, sync, pg_catalog.

CREATE FUNCTION
content.begin_direct_media_blob_writer_attempt_at_lease_target_with_owner(
  p_attempt_token UUID,
  p_lease_expires_at TIMESTAMPTZ,
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
  admitted_at TIMESTAMPTZ;
  leased_until TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR content.direct_media_blob_writer_attempt_requested_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
    OR content.direct_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.state <> 'leased';

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM
        security.current_workspace_id()
    THEN
      RETURN QUERY
      SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    apply_payload := p_payload;
    apply_payload.normalization_version := existing_attempt.normalization_version;
    fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(
      existing_attempt,
      existing_attempt.reservation_token,
      apply_payload
    );
    IF existing_attempt.requested_normalization_version IS DISTINCT FROM
      p_payload.normalization_version
    THEN
      fence_status := 'stale_attempt';
    END IF;
    IF fence_status <> 'ready' THEN
      RETURN QUERY
      SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
    SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'direct:' || p_payload.workspace_id::TEXT || ':'
        || p_payload.media_asset_id::TEXT || ':' || p_payload.operation_id,
      2::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'attempt:' || p_attempt_token::TEXT,
      3::BIGINT
    )
  );

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;

  IF FOUND THEN
    IF existing_attempt.user_id IS DISTINCT FROM security.current_user_id()
      OR existing_attempt.workspace_id IS DISTINCT FROM
        security.current_workspace_id()
    THEN
      RETURN QUERY
      SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    apply_payload := p_payload;
    apply_payload.normalization_version := existing_attempt.normalization_version;
    fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(
      existing_attempt,
      existing_attempt.reservation_token,
      apply_payload
    );
    IF existing_attempt.requested_normalization_version IS DISTINCT FROM
      p_payload.normalization_version
    THEN
      fence_status := 'stale_attempt';
    END IF;
    IF fence_status <> 'ready' THEN
      RETURN QUERY
      SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF existing_attempt.state <> 'leased' THEN
      RETURN QUERY
      SELECT existing_attempt.outcome, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    admitted_at := pg_catalog.clock_timestamp();
    IF p_lease_expires_at IS NULL
      OR p_lease_expires_at <= admitted_at
      OR p_lease_expires_at > admitted_at + interval '3600000 milliseconds'
    THEN
      RETURN;
    END IF;

    fence_status := content.fence_direct_media_blob_writer_attempt_apply_with_owner(
      p_attempt_token,
      existing_attempt.reservation_token,
      apply_payload,
      3600000
    );
    IF fence_status = 'ready' THEN
      admitted_at := pg_catalog.clock_timestamp();
      IF p_lease_expires_at IS NULL
        OR p_lease_expires_at <= admitted_at
        OR p_lease_expires_at > admitted_at + interval '3600000 milliseconds'
      THEN
        RETURN;
      END IF;
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
      RETURN QUERY
      SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
  WHERE reservations.writer_kind = 'direct_ingestion'
    AND reservations.workspace_id = p_payload.workspace_id
    AND reservations.media_asset_id = p_payload.media_asset_id
    AND reservations.operation_id = p_payload.operation_id
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
  WHERE attempts.writer_kind = 'direct_ingestion'
    AND attempts.workspace_id = p_payload.workspace_id
    AND attempts.media_asset_id = p_payload.media_asset_id
    AND attempts.operation_id = p_payload.operation_id
    AND attempts.state = 'leased'
  FOR UPDATE;

  admitted_at := pg_catalog.clock_timestamp();
  IF p_lease_expires_at IS NULL
    OR p_lease_expires_at <= admitted_at
    OR p_lease_expires_at > admitted_at + interval '3600000 milliseconds'
  THEN
    RETURN;
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
    OR NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = p_payload.workspace_id
        AND memberships.user_id = p_payload.user_id
    )
  THEN
    RETURN QUERY
    SELECT 'access_denied'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
    SELECT 'replica_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF lifecycle.sha256 IS NOT NULL
    AND (
      lifecycle.storage_key IS DISTINCT FROM p_payload.storage_key
      OR lifecycle.mime_type IS DISTINCT FROM p_payload.mime_type
      OR lifecycle.size_bytes IS DISTINCT FROM p_payload.size_bytes
    )
  THEN
    RETURN QUERY
    SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
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
    RETURN QUERY
    SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF owner_snapshot.reservation_token IS NOT NULL
    AND (
      owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id
      OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id
    )
  THEN
    RETURN QUERY
    SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  BEGIN
    IF peer_attempt.attempt_token IS NOT NULL THEN
      apply_payload := p_payload;
      apply_payload.normalization_version := peer_attempt.normalization_version;
      fence_status := content.direct_media_blob_writer_attempt_identity_status_internal(
        peer_attempt,
        peer_attempt.reservation_token,
        apply_payload
      );
      IF fence_status <> 'ready'
        OR peer_attempt.requested_normalization_version IS DISTINCT FROM
          p_payload.normalization_version
      THEN
        RETURN QUERY
        SELECT
          CASE WHEN fence_status = 'ready' THEN 'stale_attempt' ELSE fence_status END,
          NULL::UUID,
          NULL::TEXT,
          NULL::TIMESTAMPTZ;
        RETURN;
      ELSIF peer_attempt.reservation_token IS DISTINCT FROM
          reservation.reservation_token
        OR peer_attempt.normalization_version IS DISTINCT FROM
          lifecycle.normalization_version
        OR reservation.state NOT IN ('active', 'ambiguous', 'finalized')
      THEN
        RETURN QUERY
        SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
        RETURN;
      ELSIF peer_attempt.lease_expires_at > pg_catalog.clock_timestamp() THEN
        RETURN QUERY
        SELECT
          'busy'::TEXT,
          NULL::UUID,
          NULL::TEXT,
          peer_attempt.lease_expires_at;
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
      p_payload.storage_key,
      p_payload.mime_type,
      p_payload.size_bytes,
      p_payload.normalization_version,
      'direct_ingestion',
      p_payload.workspace_id,
      p_payload.media_asset_id,
      p_payload.operation_id,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL
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
      RETURN QUERY
      SELECT 'ownership_mismatch'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    ELSIF reservation_result.reservation_status <> 'reserved'
      OR reservation_result.reservation_token IS NULL
    THEN
      RETURN QUERY
      SELECT 'writer_conflict'::TEXT, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    admitted_at := pg_catalog.clock_timestamp();
    IF p_lease_expires_at IS NULL
      OR p_lease_expires_at <= admitted_at
      OR p_lease_expires_at > admitted_at + interval '3600000 milliseconds'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0132',
        MESSAGE = 'Direct writer absolute lease target expired during admission';
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
      state,
      lease_expires_at
    )
    VALUES (
      p_attempt_token,
      reservation_result.reservation_token,
      'direct_ingestion',
      p_payload.user_id,
      p_payload.workspace_id,
      p_payload.media_asset_id,
      p_payload.operation_id,
      p_payload.replica_id,
      p_payload.sha256,
      p_payload.storage_key,
      p_payload.mime_type,
      p_payload.size_bytes,
      p_payload.normalization_version,
      reservation_result.normalization_version,
      p_payload.source_url,
      p_payload.asset_created_at,
      p_payload.client_updated_at,
      'leased',
      leased_until
    );

    apply_payload := p_payload;
    apply_payload.normalization_version := reservation_result.normalization_version;
    fence_status := content.fence_direct_media_blob_writer_attempt_apply_with_owner(
      p_attempt_token,
      reservation_result.reservation_token,
      apply_payload,
      3600000
    );

    admitted_at := pg_catalog.clock_timestamp();
    IF p_lease_expires_at IS NULL
      OR p_lease_expires_at <= admitted_at
      OR p_lease_expires_at > admitted_at + interval '3600000 milliseconds'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0132',
        MESSAGE = 'Direct writer absolute lease target expired during admission';
    END IF;

    IF fence_status = 'ready' THEN
      fence_status := CASE WHEN takeover THEN 'expired_takeover' ELSE 'acquired' END;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0132' THEN
      RETURN;
  END;

  IF fence_status IN ('acquired', 'expired_takeover') THEN
    RETURN QUERY
    SELECT
      fence_status,
      reservation_result.reservation_token,
      reservation_result.normalization_version,
      leased_until;
  ELSE
    RETURN QUERY
    SELECT fence_status, NULL::UUID, NULL::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

COMMENT ON FUNCTION
  content.begin_direct_media_blob_writer_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.direct_media_blob_writer_attempt_payload
  ) IS
  'Leases one exact direct writer attempt until the caller-supplied absolute deadline, admitting the call only while that deadline is still ahead of a database clock read taken after its blocking locks.';

REVOKE ALL ON FUNCTION
  content.begin_direct_media_blob_writer_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.direct_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION
  content.begin_direct_media_blob_writer_attempt_at_lease_target_with_owner(
    UUID,
    TIMESTAMPTZ,
    content.direct_media_blob_writer_attempt_payload
  )
  TO backend_app;
