-- Current additive migration for multipart foreground-writer fencing.
-- Schemas touched/read explicitly: content, org, sync, security, pg_catalog, public.

CREATE FUNCTION content.begin_media_upload_session_abort_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_upload_session_id UUID,
  p_media_asset_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session content.media_upload_sessions%ROWTYPE;
  fenced_at TIMESTAMPTZ;
  fenced_attempt_count INTEGER;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
    OR pg_catalog.char_length(p_user_id) > 200
    OR p_user_id ~ '[[:cntrl:]]'
    OR p_workspace_id IS NULL
    OR p_media_upload_session_id IS NULL
    OR p_media_asset_id IS NULL
  THEN
    RETURN 'stale';
  END IF;

  IF security.current_user_id() IS DISTINCT FROM p_user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_workspace_id
  THEN
    RETURN 'access_denied';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id || ':' || p_workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || p_workspace_id::TEXT
        || ':'
        || p_media_asset_id::TEXT,
      4::BIGINT
    )
  );

  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN
    RETURN 'access_denied';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  ELSIF session.workspace_id IS DISTINCT FROM p_workspace_id THEN
    RETURN 'access_denied';
  ELSIF session.media_asset_id IS DISTINCT FROM p_media_asset_id THEN
    RETURN 'stale';
  END IF;

  PERFORM 1
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.media_upload_session_id = p_media_upload_session_id
  ORDER BY attempts.attempt_token
  FOR UPDATE;

  IF session.state = 'aborted' THEN
    RETURN 'already_aborted';
  ELSIF session.state = 'completed' THEN
    RETURN 'stale';
  END IF;

  fenced_at := pg_catalog.clock_timestamp();
  IF EXISTS (
    SELECT 1
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.writer_kind = 'multipart_completion'
      AND attempts.media_upload_session_id = p_media_upload_session_id
      AND attempts.state = 'leased'
      AND attempts.lease_expires_at > fenced_at
  ) THEN
    RETURN 'completion_in_progress';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.writer_kind = 'multipart_completion'
      AND attempts.media_upload_session_id = p_media_upload_session_id
      AND attempts.reconciliation_state IN ('pending', 'leased')
  ) THEN
    RETURN 'completion_pending';
  END IF;

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = 'expired',
    outcome = 'stale_attempt',
    terminal_at = fenced_at
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.media_upload_session_id = p_media_upload_session_id
    AND attempts.state = 'leased'
    AND attempts.lease_expires_at <= fenced_at
    AND attempts.reconciliation_state IS NULL;
  GET DIAGNOSTICS fenced_attempt_count = ROW_COUNT;

  IF session.state = 'aborting' THEN
    RETURN 'abort_required';
  ELSIF session.state = 'completing' THEN
    IF fenced_attempt_count = 0 THEN
      RETURN 'stale';
    END IF;
  ELSIF session.state <> 'active' THEN
    RETURN 'stale';
  END IF;

  UPDATE content.media_upload_sessions AS sessions
  SET state = 'aborting'
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
    AND sessions.workspace_id = p_workspace_id
    AND sessions.media_asset_id = p_media_asset_id
    AND sessions.state IN ('active', 'completing');
  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

  RETURN 'abort_required';
END;
$$;

CREATE FUNCTION
  content.handoff_media_upload_session_completion_attempt_after_access_revocation(
    p_attempt_token UUID,
    p_reservation_token UUID,
    p_payload content.multipart_media_blob_writer_attempt_payload
  )
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt_snapshot content.media_blob_writer_attempts%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  owner_snapshot content.media_blob_writer_owner_snapshots%ROWTYPE;
  creation_claim_expires_at TIMESTAMPTZ;
  identity_status TEXT;
  canonical_payload BOOLEAN;
  handed_off_at TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR p_reservation_token IS NULL
    OR content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    ) IS DISTINCT FROM true
  THEN
    RETURN 'stale_attempt';
  END IF;

  SELECT attempts.*
  INTO attempt_snapshot
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF NOT FOUND THEN
    RETURN 'stale_attempt';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      attempt_snapshot.user_id
        || ':'
        || attempt_snapshot.workspace_id::TEXT,
      0::BIGINT
    )
  );
  creation_claim_expires_at :=
    content.lock_upload_creation_claim_for_completion_internal(
      attempt_snapshot.workspace_id,
      attempt_snapshot.media_asset_id,
      attempt_snapshot.media_upload_session_id
    );

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id =
    attempt_snapshot.media_upload_session_id
  FOR UPDATE;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;

  IF attempt.attempt_token IS NULL
    OR attempt.user_id IS DISTINCT FROM attempt_snapshot.user_id
    OR attempt.workspace_id IS DISTINCT FROM attempt_snapshot.workspace_id
    OR attempt.media_asset_id IS DISTINCT FROM attempt_snapshot.media_asset_id
    OR attempt.media_upload_session_id IS DISTINCT FROM
      attempt_snapshot.media_upload_session_id
  THEN
    RETURN 'stale_attempt';
  END IF;

  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token
  FOR UPDATE;

  IF reservation.reservation_token IS NULL
    OR reservation.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR reservation.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR reservation.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR reservation.operation_id IS DISTINCT FROM
      p_payload.media_upload_session_id::TEXT
    OR reservation.sha256 IS DISTINCT FROM p_payload.sha256
  THEN
    RETURN 'writer_conflict';
  END IF;

  SELECT snapshots.*
  INTO owner_snapshot
  FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.reservation_token = p_reservation_token
  FOR UPDATE;

  IF owner_snapshot.reservation_token IS NULL
    OR owner_snapshot.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR owner_snapshot.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR owner_snapshot.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR owner_snapshot.operation_id IS DISTINCT FROM
      p_payload.media_upload_session_id::TEXT
    OR owner_snapshot.sha256 IS DISTINCT FROM p_payload.sha256
    OR owner_snapshot.user_id IS DISTINCT FROM p_payload.user_id
    OR owner_snapshot.replica_id IS DISTINCT FROM p_payload.replica_id
    OR owner_snapshot.session_last_operation_id IS DISTINCT FROM
      p_payload.last_operation_id
    OR owner_snapshot.session_expires_at IS DISTINCT FROM
      p_payload.session_expires_at
    OR owner_snapshot.session_source_url IS DISTINCT FROM p_payload.source_url
    OR owner_snapshot.session_asset_created_at IS DISTINCT FROM
      p_payload.asset_created_at
    OR owner_snapshot.session_client_updated_at IS DISTINCT FROM
      p_payload.client_updated_at
  THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF attempt.reconciliation_state IN ('pending', 'leased') THEN
    RETURN 'already_pending';
  ELSIF attempt.reconciliation_state = 'applied' THEN
    RETURN 'already_applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  ELSIF attempt.state <> 'leased' THEN
    RETURN COALESCE(attempt.outcome, 'stale_attempt');
  END IF;

  IF reservation.state NOT IN ('active', 'ambiguous', 'finalized') THEN
    RETURN 'writer_conflict';
  END IF;

  IF creation_claim_expires_at IS NOT NULL THEN
    RETURN 'stale_attempt';
  END IF;

  IF session.media_upload_session_id IS NULL
    OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256
    OR session.staging_storage_key IS DISTINCT FROM
      p_payload.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
    OR session.mime_type IS DISTINCT FROM p_payload.mime_type
    OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes
    OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes
    OR session.part_count IS DISTINCT FROM p_payload.part_count
    OR session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id
    OR session.source_url IS DISTINCT FROM p_payload.source_url
    OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at
    OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at
    OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN
    RETURN 'stale_attempt';
  END IF;

  IF session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id
  THEN
    RETURN 'ownership_mismatch';
  END IF;

  IF session.state = 'aborting' THEN
    RETURN 'aborting';
  ELSIF session.state = 'aborted' THEN
    RETURN 'aborted';
  ELSIF session.state <> 'completing' THEN
    RETURN 'stale_attempt';
  END IF;

  canonical_payload :=
    content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
      p_payload
    );
  handed_off_at := pg_catalog.clock_timestamp();
  IF canonical_payload THEN
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'expired',
      outcome = 'stale_attempt',
      terminal_at = handed_off_at,
      reconciliation_state = 'pending',
      reconciliation_retry_count = 0,
      reconciliation_next_attempt_at = handed_off_at,
      reconciliation_lease_token = NULL,
      reconciliation_lease_owner = NULL,
      reconciliation_lease_expires_at = NULL,
      reconciliation_last_error_code = NULL,
      reconciliation_last_error_message = NULL,
      reconciliation_handed_off_at = handed_off_at,
      reconciliation_updated_at = handed_off_at,
      reconciliation_applied_at = NULL
    WHERE attempts.attempt_token = p_attempt_token
      AND attempts.state = 'leased'
      AND attempts.reconciliation_state IS NULL;
  ELSE
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'expired',
      outcome = 'stale_attempt',
      terminal_at = handed_off_at,
      reconciliation_state = 'leased',
      reconciliation_retry_count = 0,
      reconciliation_next_attempt_at = handed_off_at,
      reconciliation_lease_token = public.gen_random_uuid(),
      reconciliation_lease_owner = 'legacy-invalid-payload',
      reconciliation_lease_expires_at =
        handed_off_at + interval '1 microsecond',
      reconciliation_last_error_code =
        'INVALID_RECONCILIATION_PAYLOAD',
      reconciliation_last_error_message =
        'Durable multipart completion payload is invalid.',
      reconciliation_handed_off_at = handed_off_at,
      reconciliation_updated_at = handed_off_at,
      reconciliation_applied_at = NULL
    WHERE attempts.attempt_token = p_attempt_token
      AND attempts.state = 'leased'
      AND attempts.reconciliation_state IS NULL;
  END IF;
  IF NOT FOUND THEN
    RETURN 'stale_attempt';
  END IF;

  RETURN 'handed_off';
END;
$$;

CREATE OR REPLACE FUNCTION
  content.claim_media_upload_session_completion_reconciliations(
    p_lease_owner TEXT,
    p_lease_duration_ms INTEGER,
    p_limit INTEGER
  )
RETURNS SETOF content.media_blob_writer_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claim_started_at TIMESTAMPTZ;
  invalid_candidate RECORD;
  invalid_attempt content.media_blob_writer_attempts%ROWTYPE;
  invalid_lease_token UUID;
  invalid_status TEXT;
  invalid_processed INTEGER := 0;
  quarantined_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner <> pg_catalog.btrim(p_lease_owner)
    OR p_lease_owner = ''
    OR pg_catalog.char_length(p_lease_owner) > 200
    OR p_lease_owner ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'p_lease_owner must be 1 to 200 trimmed characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_duration_ms IS NULL
    OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
  THEN
    RAISE EXCEPTION 'p_lease_duration_ms must be between 1 and 3600000'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  claim_started_at := pg_catalog.clock_timestamp();
  FOR invalid_candidate IN
    SELECT
      attempts.attempt_token,
      attempts.user_id,
      attempts.workspace_id,
      attempts.media_asset_id
    FROM content.media_blob_writer_attempts AS attempts
    WHERE (
      (
        attempts.reconciliation_state = 'pending'
        AND attempts.reconciliation_next_attempt_at <= claim_started_at
      )
      OR (
        attempts.reconciliation_state = 'leased'
        AND attempts.reconciliation_lease_expires_at <= claim_started_at
      )
    )
      AND content.multipart_completion_reconciliation_job_valid_internal(
        attempts
      ) IS DISTINCT FROM true
    ORDER BY
      CASE
        WHEN attempts.reconciliation_state = 'leased'
        THEN attempts.reconciliation_lease_expires_at
        ELSE attempts.reconciliation_next_attempt_at
      END,
      attempts.reconciliation_handed_off_at,
      attempts.attempt_token
    LIMIT p_limit
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        invalid_candidate.user_id
          || ':'
          || invalid_candidate.workspace_id::TEXT,
        0::BIGINT
      )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'multipart-asset:'
          || invalid_candidate.workspace_id::TEXT
          || ':'
          || invalid_candidate.media_asset_id::TEXT,
        4::BIGINT
      )
    );

    SELECT attempts.*
    INTO invalid_attempt
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.attempt_token = invalid_candidate.attempt_token
    FOR UPDATE;
    IF NOT FOUND
      OR (
        NOT (
          (
            invalid_attempt.reconciliation_state = 'pending'
            AND invalid_attempt.reconciliation_next_attempt_at <=
              claim_started_at
          )
          OR (
            invalid_attempt.reconciliation_state = 'leased'
            AND invalid_attempt.reconciliation_lease_expires_at <=
              claim_started_at
          )
        )
      )
      OR content.multipart_completion_reconciliation_job_valid_internal(
        invalid_attempt
      ) IS TRUE
    THEN
      CONTINUE;
    END IF;

    quarantined_at := pg_catalog.clock_timestamp();
    invalid_lease_token := public.gen_random_uuid();
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      reconciliation_state = 'leased',
      reconciliation_lease_token = invalid_lease_token,
      reconciliation_lease_owner = p_lease_owner,
      reconciliation_lease_expires_at =
        quarantined_at + (p_lease_duration_ms * interval '1 millisecond'),
      reconciliation_last_error_code =
        'INVALID_RECONCILIATION_PAYLOAD',
      reconciliation_last_error_message =
        'Durable multipart completion payload is invalid.',
      reconciliation_updated_at = quarantined_at
    WHERE attempts.attempt_token = invalid_attempt.attempt_token;

    invalid_status :=
      content.fail_media_upload_session_completion_reconciliation(
        invalid_attempt.attempt_token,
        invalid_lease_token,
        'INVALID_RECONCILIATION_PAYLOAD',
        'Durable multipart completion payload is invalid.',
        3600000
      );
    IF invalid_status NOT IN ('applied', 'failed') THEN
      quarantined_at := pg_catalog.clock_timestamp();
      UPDATE content.media_blob_writer_attempts AS attempts
      SET
        state = 'expired',
        outcome = 'stale_attempt',
        terminal_at = COALESCE(attempts.terminal_at, quarantined_at),
        reconciliation_state = 'failed',
        reconciliation_next_attempt_at = NULL,
        reconciliation_lease_token = NULL,
        reconciliation_lease_owner = NULL,
        reconciliation_lease_expires_at = NULL,
        reconciliation_last_error_code =
          'INVALID_RECONCILIATION_PAYLOAD',
        reconciliation_last_error_message =
          'Durable multipart completion payload is invalid.',
        reconciliation_updated_at = quarantined_at,
        reconciliation_applied_at = NULL,
        reconciliation_failure_event_id = public.gen_random_uuid(),
        reconciliation_failure_report_state = 'pending',
        reconciliation_failure_report_delivery_count = 0,
        reconciliation_failure_report_lease_token = NULL,
        reconciliation_failure_report_lease_owner = NULL,
        reconciliation_failure_report_lease_expires_at = NULL,
        reconciliation_failure_report_updated_at = quarantined_at,
        reconciliation_failure_reported_at = NULL
      WHERE attempts.attempt_token = invalid_attempt.attempt_token
        AND attempts.reconciliation_state = 'leased'
        AND attempts.reconciliation_lease_token = invalid_lease_token;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Invalid multipart reconciliation could not be terminalized. attempt_token=%',
          invalid_attempt.attempt_token
          USING ERRCODE = '40001';
      END IF;
    END IF;
    invalid_processed := invalid_processed + 1;
  END LOOP;

  claim_started_at := pg_catalog.clock_timestamp();
  RETURN QUERY
  WITH claimable AS (
    SELECT attempts.attempt_token
    FROM content.media_blob_writer_attempts AS attempts
    WHERE (
      (
        attempts.reconciliation_state = 'pending'
        AND attempts.reconciliation_next_attempt_at <= claim_started_at
      )
      OR (
        attempts.reconciliation_state = 'leased'
        AND attempts.reconciliation_lease_expires_at <= claim_started_at
      )
    )
      AND content.multipart_completion_reconciliation_job_valid_internal(
        attempts
      ) IS TRUE
    ORDER BY
      CASE
        WHEN attempts.reconciliation_state = 'leased'
        THEN attempts.reconciliation_lease_expires_at
        ELSE attempts.reconciliation_next_attempt_at
      END,
      attempts.reconciliation_handed_off_at,
      attempts.attempt_token
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit - invalid_processed
  )
  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    reconciliation_state = 'leased',
    reconciliation_lease_token = public.gen_random_uuid(),
    reconciliation_lease_owner = p_lease_owner,
    reconciliation_lease_expires_at =
      claim_started_at + (p_lease_duration_ms * interval '1 millisecond'),
    reconciliation_updated_at = claim_started_at
  FROM claimable
  WHERE attempts.attempt_token = claimable.attempt_token
  RETURNING attempts.*;
END;
$$;

CREATE OR REPLACE FUNCTION
  content.apply_media_upload_session_completion_reconciliation_scope(
    p_attempt_token UUID,
    p_lease_token UUID
  )
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt_snapshot content.media_blob_writer_attempts%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
BEGIN
  SELECT attempts.*
  INTO attempt_snapshot
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      attempt_snapshot.user_id
        || ':'
        || attempt_snapshot.workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || attempt_snapshot.workspace_id::TEXT
        || ':'
        || attempt_snapshot.media_asset_id::TEXT,
      4::BIGINT
    )
  );

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;
  IF attempt.reconciliation_state = 'applied' THEN
    RETURN 'applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  ELSIF attempt.reconciliation_state <> 'leased'
    OR attempt.reconciliation_lease_token IS DISTINCT FROM p_lease_token
    OR attempt.reconciliation_lease_expires_at <= pg_catalog.clock_timestamp()
  THEN
    RETURN 'lease_lost';
  END IF;

  PERFORM 1
  FROM org.workspace_memberships AS memberships
  WHERE memberships.workspace_id = attempt.workspace_id
    AND memberships.user_id = attempt.user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN 'access_revoked';
  END IF;

  PERFORM 1
  FROM sync.workspace_replicas AS replicas
  WHERE replicas.replica_id = attempt.replica_id
    AND replicas.workspace_id = attempt.workspace_id
    AND replicas.user_id = attempt.user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN 'replica_revoked';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = attempt.media_upload_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR session.workspace_id IS DISTINCT FROM attempt.workspace_id
    OR session.media_asset_id IS DISTINCT FROM attempt.media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM attempt.replica_id
    OR session.last_operation_id IS DISTINCT FROM attempt.last_operation_id
    OR session.media_blob_sha256 IS DISTINCT FROM attempt.sha256
    OR session.staging_storage_key IS DISTINCT FROM attempt.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM attempt.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM attempt.s3_upload_id
    OR session.mime_type IS DISTINCT FROM attempt.mime_type
    OR session.size_bytes IS DISTINCT FROM attempt.size_bytes
    OR session.part_size_bytes IS DISTINCT FROM attempt.part_size_bytes
    OR session.part_count IS DISTINCT FROM attempt.part_count
    OR session.source_url IS DISTINCT FROM attempt.source_url
    OR session.asset_created_at IS DISTINCT FROM attempt.asset_created_at
    OR session.client_updated_at IS DISTINCT FROM attempt.client_updated_at
    OR session.expires_at IS DISTINCT FROM attempt.session_expires_at
  THEN
    RETURN 'stale';
  END IF;

  IF session.state = 'aborting' THEN
    RETURN 'aborting';
  ELSIF session.state = 'aborted' THEN
    RETURN 'aborted';
  ELSIF session.state NOT IN ('completing', 'completed') THEN
    RETURN 'stale';
  END IF;

  PERFORM pg_catalog.set_config('app.user_id', attempt.user_id, true);
  PERFORM pg_catalog.set_config(
    'app.workspace_id',
    attempt.workspace_id::TEXT,
    true
  );
  RETURN 'scoped';
END;
$$;

CREATE OR REPLACE FUNCTION
  content.finish_media_upload_session_completion_reconciliation(
    p_attempt_token UUID,
    p_lease_token UUID,
    p_cleanup_delay_ms INTEGER
  )
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt_snapshot content.media_blob_writer_attempts%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  asset RECORD;
  terminalization_status TEXT;
  applied_at TIMESTAMPTZ;
BEGIN
  IF p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
  THEN
    RETURN 'stale';
  END IF;

  SELECT attempts.*
  INTO attempt_snapshot
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || attempt_snapshot.workspace_id::TEXT
        || ':'
        || attempt_snapshot.media_asset_id::TEXT,
      4::BIGINT
    )
  );

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  ELSIF attempt.reconciliation_state = 'applied' THEN
    RETURN 'already_applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  ELSIF attempt.reconciliation_state <> 'leased'
    OR attempt.reconciliation_lease_token IS DISTINCT FROM p_lease_token
    OR attempt.reconciliation_lease_expires_at <= pg_catalog.clock_timestamp()
  THEN
    RETURN 'lease_lost';
  END IF;

  IF security.current_user_id() IS DISTINCT FROM attempt.user_id
    OR security.current_workspace_id() IS DISTINCT FROM attempt.workspace_id
    OR NOT EXISTS (
      SELECT 1
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = attempt.workspace_id
        AND memberships.user_id = attempt.user_id
    )
  THEN
    RETURN 'access_revoked';
  END IF;

  SELECT *
  INTO asset
  FROM content.classify_media_upload_session_completion_asset_internal(
    attempt.workspace_id,
    attempt.media_asset_id,
    attempt.sha256,
    attempt.blob_storage_key,
    attempt.mime_type,
    attempt.size_bytes,
    attempt.normalization_version,
    attempt.source_url,
    attempt.asset_created_at,
    attempt.client_updated_at,
    attempt.replica_id,
    attempt.last_operation_id
  );
  IF asset.asset_status = 'peer_conflict' THEN
    RETURN 'peer_conflict';
  ELSIF asset.asset_status <> 'exact' THEN
    RETURN 'stale';
  END IF;

  terminalization_status :=
    content.terminalize_media_blob_writer_failure(
      attempt.reservation_token,
      attempt.sha256,
      attempt.blob_storage_key,
      attempt.mime_type,
      attempt.size_bytes,
      attempt.normalization_version,
      'multipart_completion',
      attempt.workspace_id,
      attempt.media_asset_id,
      attempt.operation_id,
      p_cleanup_delay_ms
    );
  IF terminalization_status <> 'referenced' THEN
    RETURN 'stale';
  END IF;

  applied_at := pg_catalog.clock_timestamp();
  UPDATE content.media_upload_sessions AS sessions
  SET
    state = 'completed',
    completed_at = COALESCE(sessions.completed_at, applied_at),
    aborted_at = NULL
  WHERE sessions.media_upload_session_id = attempt.media_upload_session_id
    AND sessions.state IN ('completing', 'completed');
  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = 'applied',
    outcome = 'live_applied',
    terminal_at = applied_at,
    reconciliation_state = 'applied',
    reconciliation_next_attempt_at = NULL,
    reconciliation_lease_token = NULL,
    reconciliation_lease_owner = NULL,
    reconciliation_lease_expires_at = NULL,
    reconciliation_last_error_code = NULL,
    reconciliation_last_error_message = NULL,
    reconciliation_updated_at = applied_at,
    reconciliation_applied_at = applied_at
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_state = 'leased'
    AND attempts.reconciliation_lease_token = p_lease_token;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  RETURN 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION
  content.fail_media_upload_session_completion_reconciliation(
    p_attempt_token UUID,
    p_lease_token UUID,
    p_error_code TEXT,
    p_error_message TEXT,
    p_cleanup_delay_ms INTEGER
  )
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt_snapshot content.media_blob_writer_attempts%ROWTYPE;
  attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
  asset RECORD;
  terminalization_status TEXT;
  failed_at TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR p_lease_token IS NULL
    OR p_cleanup_delay_ms IS NULL
    OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000
    OR content.multipart_completion_reconciliation_error_valid_internal(
      p_error_code,
      p_error_message
    ) IS DISTINCT FROM true
  THEN
    RETURN 'stale';
  END IF;

  SELECT attempts.*
  INTO attempt_snapshot
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      attempt_snapshot.user_id
        || ':'
        || attempt_snapshot.workspace_id::TEXT,
      0::BIGINT
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'multipart-asset:'
        || attempt_snapshot.workspace_id::TEXT
        || ':'
        || attempt_snapshot.media_asset_id::TEXT,
      4::BIGINT
    )
  );

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;
  IF attempt.reconciliation_state = 'applied' THEN
    RETURN 'applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  ELSIF attempt.reconciliation_state <> 'leased'
    OR attempt.reconciliation_lease_token IS DISTINCT FROM p_lease_token
    OR attempt.reconciliation_lease_expires_at <= pg_catalog.clock_timestamp()
  THEN
    RETURN 'lease_lost';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = attempt.media_upload_session_id
  FOR UPDATE;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = attempt.sha256
  FOR UPDATE;

  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = attempt.reservation_token
  FOR UPDATE;

  IF session.media_upload_session_id IS NULL
    OR lifecycle.sha256 IS NULL
    OR reservation.reservation_token IS NULL
    OR session.workspace_id IS DISTINCT FROM attempt.workspace_id
    OR session.media_asset_id IS DISTINCT FROM attempt.media_asset_id
    OR session.media_blob_sha256 IS DISTINCT FROM attempt.sha256
    OR session.staging_storage_key IS DISTINCT FROM attempt.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM attempt.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM attempt.s3_upload_id
    OR reservation.writer_kind IS DISTINCT FROM 'multipart_completion'
    OR reservation.workspace_id IS DISTINCT FROM attempt.workspace_id
    OR reservation.media_asset_id IS DISTINCT FROM attempt.media_asset_id
    OR reservation.operation_id IS DISTINCT FROM attempt.operation_id
    OR reservation.sha256 IS DISTINCT FROM attempt.sha256
    OR lifecycle.storage_key IS DISTINCT FROM attempt.blob_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM attempt.mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM attempt.size_bytes
    OR lifecycle.normalization_version IS DISTINCT FROM
      attempt.normalization_version
  THEN
    RETURN 'stale';
  END IF;

  SELECT *
  INTO asset
  FROM content.classify_media_upload_session_completion_asset_internal(
    attempt.workspace_id,
    attempt.media_asset_id,
    attempt.sha256,
    attempt.blob_storage_key,
    attempt.mime_type,
    attempt.size_bytes,
    attempt.normalization_version,
    attempt.source_url,
    attempt.asset_created_at,
    attempt.client_updated_at,
    attempt.replica_id,
    attempt.last_operation_id
  );

  terminalization_status :=
    content.terminalize_media_blob_writer_failure(
      attempt.reservation_token,
      attempt.sha256,
      attempt.blob_storage_key,
      attempt.mime_type,
      attempt.size_bytes,
      attempt.normalization_version,
      'multipart_completion',
      attempt.workspace_id,
      attempt.media_asset_id,
      attempt.operation_id,
      p_cleanup_delay_ms
    );
  failed_at := pg_catalog.clock_timestamp();

  IF asset.asset_status = 'exact'
    OR terminalization_status = 'referenced'
  THEN
    IF terminalization_status <> 'referenced' THEN
      RETURN 'stale';
    END IF;
    UPDATE content.media_upload_sessions AS sessions
    SET
      state = 'completed',
      completed_at = COALESCE(sessions.completed_at, failed_at),
      aborted_at = NULL
    WHERE sessions.media_upload_session_id = attempt.media_upload_session_id;
    UPDATE content.media_blob_writer_attempts AS attempts
    SET
      state = 'referenced',
      outcome = 'referenced',
      terminal_at = failed_at,
      reconciliation_state = 'applied',
      reconciliation_next_attempt_at = NULL,
      reconciliation_lease_token = NULL,
      reconciliation_lease_owner = NULL,
      reconciliation_lease_expires_at = NULL,
      reconciliation_last_error_code = NULL,
      reconciliation_last_error_message = NULL,
      reconciliation_updated_at = failed_at,
      reconciliation_applied_at = failed_at
    WHERE attempts.attempt_token = p_attempt_token
      AND attempts.reconciliation_state = 'leased'
      AND attempts.reconciliation_lease_token = p_lease_token;
    RETURN 'applied';
  END IF;

  IF terminalization_status <> 'unreferenced' THEN
    RETURN 'stale';
  END IF;

  UPDATE content.media_upload_sessions AS sessions
  SET
    state = 'aborted',
    completed_at = NULL,
    aborted_at = COALESCE(sessions.aborted_at, failed_at)
  WHERE sessions.media_upload_session_id = attempt.media_upload_session_id;

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = CASE
      WHEN asset.asset_status = 'peer_conflict' THEN 'peer_conflict'
      ELSE 'unreferenced'
    END,
    outcome = CASE
      WHEN asset.asset_status = 'peer_conflict' THEN 'peer_conflict'
      ELSE 'unreferenced'
    END,
    terminal_at = failed_at,
    reconciliation_state = 'failed',
    reconciliation_next_attempt_at = NULL,
    reconciliation_lease_token = NULL,
    reconciliation_lease_owner = NULL,
    reconciliation_lease_expires_at = NULL,
    reconciliation_last_error_code = p_error_code,
    reconciliation_last_error_message = p_error_message,
    reconciliation_updated_at = failed_at,
    reconciliation_applied_at = NULL,
    reconciliation_failure_event_id = public.gen_random_uuid(),
    reconciliation_failure_report_state = 'pending',
    reconciliation_failure_report_delivery_count = 0,
    reconciliation_failure_report_lease_token = NULL,
    reconciliation_failure_report_lease_owner = NULL,
    reconciliation_failure_report_lease_expires_at = NULL,
    reconciliation_failure_report_updated_at = failed_at,
    reconciliation_failure_reported_at = NULL
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_state = 'leased'
    AND attempts.reconciliation_lease_token = p_lease_token;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;

  RETURN 'failed';
END;
$$;

COMMENT ON FUNCTION content.begin_media_upload_session_abort_with_owner(
  TEXT,
  UUID,
  UUID,
  UUID
) IS
  'Admits an exact multipart abort only after fencing expired foreground completion and rejecting live or durably handed-off completion.';
COMMENT ON FUNCTION
  content.handoff_media_upload_session_completion_attempt_after_access_revocation(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  ) IS
  'Service-authorized exact multipart completion handoff using immutable ownership evidence after membership or replica access changes.';

REVOKE ALL ON FUNCTION content.begin_media_upload_session_abort_with_owner(
  TEXT,
  UUID,
  UUID,
  UUID
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.handoff_media_upload_session_completion_attempt_after_access_revocation(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.begin_media_upload_session_abort_with_owner(
  TEXT,
  UUID,
  UUID,
  UUID
) TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.handoff_media_upload_session_completion_attempt_after_access_revocation(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  TO backend_app;
