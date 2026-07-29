-- Current additive migration for durable multipart completion handoff and reconciliation.
-- Schemas touched/read explicitly: content, org, security, sync, pg_catalog, public.

CREATE FUNCTION content.media_asset_last_operation_id_valid_internal(
  p_last_operation_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    p_last_operation_id IS NOT NULL
    AND pg_catalog.char_length(p_last_operation_id) BETWEEN 1 AND 1024
    AND p_last_operation_id COLLATE "C" ~
      '^([!-~]|[!-~][ -~]*[!-~])$';
$$;

ALTER TABLE content.media_assets
  ADD CONSTRAINT media_assets_last_operation_id_canonical
  CHECK (
    pg_catalog.char_length(last_operation_id) BETWEEN 1 AND 1024
    AND last_operation_id COLLATE "C" ~
      '^([!-~]|[!-~][ -~]*[!-~])$'
  ) NOT VALID;

ALTER TABLE content.media_blob_writer_attempts
  ADD COLUMN reconciliation_state TEXT,
  ADD COLUMN reconciliation_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN reconciliation_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_lease_token UUID,
  ADD COLUMN reconciliation_lease_owner TEXT,
  ADD COLUMN reconciliation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_last_error_code TEXT,
  ADD COLUMN reconciliation_last_error_message TEXT,
  ADD COLUMN reconciliation_handed_off_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_updated_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_applied_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_failure_event_id UUID,
  ADD COLUMN reconciliation_failure_report_state TEXT,
  ADD COLUMN reconciliation_failure_report_delivery_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN reconciliation_failure_report_lease_token UUID,
  ADD COLUMN reconciliation_failure_report_lease_owner TEXT,
  ADD COLUMN reconciliation_failure_report_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_failure_report_updated_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_failure_reported_at TIMESTAMPTZ,
  ADD CONSTRAINT media_blob_writer_attempts_reconciliation_state
    CHECK (
      reconciliation_state IS NULL
      OR reconciliation_state IN ('pending', 'leased', 'applied', 'failed')
    ),
  ADD CONSTRAINT media_blob_writer_attempts_reconciliation_retry_count
    CHECK (reconciliation_retry_count >= 0),
  ADD CONSTRAINT media_blob_writer_attempts_failure_report_state
    CHECK (
      reconciliation_failure_report_state IS NULL
      OR reconciliation_failure_report_state IN ('pending', 'leased', 'reported')
    ),
  ADD CONSTRAINT media_blob_writer_attempts_failure_report_delivery_count
    CHECK (reconciliation_failure_report_delivery_count >= 0),
  ADD CONSTRAINT media_blob_writer_attempts_failure_event_unique
    UNIQUE (reconciliation_failure_event_id),
  ADD CONSTRAINT media_blob_writer_attempts_reconciliation_error_safe
    CHECK (
      (
        reconciliation_last_error_code IS NULL
        AND reconciliation_last_error_message IS NULL
      )
      OR (
        reconciliation_last_error_code IS NOT NULL
        AND reconciliation_last_error_message IS NOT NULL
        AND reconciliation_last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
        AND reconciliation_last_error_message =
          pg_catalog.btrim(reconciliation_last_error_message)
        AND pg_catalog.char_length(reconciliation_last_error_message)
          BETWEEN 1 AND 500
        AND reconciliation_last_error_message !~ '[[:cntrl:]]'
      )
    ),
  ADD CONSTRAINT media_blob_writer_attempts_reconciliation_shape
    CHECK (
      (
        reconciliation_state IS NULL
        AND reconciliation_retry_count = 0
        AND reconciliation_next_attempt_at IS NULL
        AND reconciliation_lease_token IS NULL
        AND reconciliation_lease_owner IS NULL
        AND reconciliation_lease_expires_at IS NULL
        AND reconciliation_last_error_code IS NULL
        AND reconciliation_last_error_message IS NULL
        AND reconciliation_handed_off_at IS NULL
        AND reconciliation_updated_at IS NULL
        AND reconciliation_applied_at IS NULL
      )
      OR (
        writer_kind = 'multipart_completion'
        AND reconciliation_handed_off_at IS NOT NULL
        AND reconciliation_updated_at IS NOT NULL
        AND reconciliation_updated_at >= reconciliation_handed_off_at
        AND (
          (
            reconciliation_state = 'pending'
            AND state = 'expired'
            AND outcome = 'stale_attempt'
            AND terminal_at IS NOT NULL
            AND reconciliation_next_attempt_at IS NOT NULL
            AND reconciliation_next_attempt_at >= reconciliation_handed_off_at
            AND reconciliation_lease_token IS NULL
            AND reconciliation_lease_owner IS NULL
            AND reconciliation_lease_expires_at IS NULL
            AND reconciliation_applied_at IS NULL
          )
          OR (
            reconciliation_state = 'leased'
            AND state = 'expired'
            AND outcome = 'stale_attempt'
            AND terminal_at IS NOT NULL
            AND reconciliation_next_attempt_at IS NOT NULL
            AND reconciliation_lease_token IS NOT NULL
            AND reconciliation_lease_owner IS NOT NULL
            AND reconciliation_lease_owner =
              pg_catalog.btrim(reconciliation_lease_owner)
            AND reconciliation_lease_owner <> ''
            AND pg_catalog.char_length(reconciliation_lease_owner) <= 200
            AND reconciliation_lease_owner !~ '[[:cntrl:]]'
            AND reconciliation_lease_expires_at IS NOT NULL
            AND reconciliation_lease_expires_at > reconciliation_updated_at
            AND reconciliation_applied_at IS NULL
          )
          OR (
            reconciliation_state = 'applied'
            AND state IN ('applied', 'referenced')
            AND outcome IN ('live_applied', 'already_applied', 'referenced')
            AND terminal_at IS NOT NULL
            AND reconciliation_next_attempt_at IS NULL
            AND reconciliation_lease_token IS NULL
            AND reconciliation_lease_owner IS NULL
            AND reconciliation_lease_expires_at IS NULL
            AND reconciliation_last_error_code IS NULL
            AND reconciliation_last_error_message IS NULL
            AND reconciliation_applied_at IS NOT NULL
            AND reconciliation_applied_at >= reconciliation_handed_off_at
          )
          OR (
            reconciliation_state = 'failed'
            AND state IN (
              'peer_conflict',
              'unreferenced',
              'cancelled',
              'expired'
            )
            AND outcome IN (
              'peer_conflict',
              'unreferenced',
              'already_closed',
              'aborted',
              'stale_attempt'
            )
            AND terminal_at IS NOT NULL
            AND reconciliation_next_attempt_at IS NULL
            AND reconciliation_lease_token IS NULL
            AND reconciliation_lease_owner IS NULL
            AND reconciliation_lease_expires_at IS NULL
            AND reconciliation_last_error_code IS NOT NULL
            AND reconciliation_last_error_message IS NOT NULL
            AND reconciliation_applied_at IS NULL
          )
        )
      )
    ),
  ADD CONSTRAINT media_blob_writer_attempts_failure_report_shape
    CHECK (
      (
        reconciliation_state IS DISTINCT FROM 'failed'
        AND reconciliation_failure_event_id IS NULL
        AND reconciliation_failure_report_state IS NULL
        AND reconciliation_failure_report_delivery_count = 0
        AND reconciliation_failure_report_lease_token IS NULL
        AND reconciliation_failure_report_lease_owner IS NULL
        AND reconciliation_failure_report_lease_expires_at IS NULL
        AND reconciliation_failure_report_updated_at IS NULL
        AND reconciliation_failure_reported_at IS NULL
      )
      OR (
        reconciliation_state IN ('failed', 'applied')
        AND reconciliation_failure_event_id IS NOT NULL
        AND reconciliation_failure_report_state IS NOT NULL
        AND reconciliation_failure_report_updated_at IS NOT NULL
        AND reconciliation_failure_report_updated_at >=
          reconciliation_handed_off_at
        AND (
          (
            reconciliation_state = 'failed'
            AND reconciliation_failure_report_state = 'pending'
            AND reconciliation_failure_report_lease_token IS NULL
            AND reconciliation_failure_report_lease_owner IS NULL
            AND reconciliation_failure_report_lease_expires_at IS NULL
            AND reconciliation_failure_reported_at IS NULL
          )
          OR (
            reconciliation_state = 'failed'
            AND reconciliation_failure_report_state = 'leased'
            AND reconciliation_failure_report_delivery_count > 0
            AND reconciliation_failure_report_lease_token IS NOT NULL
            AND reconciliation_failure_report_lease_owner IS NOT NULL
            AND reconciliation_failure_report_lease_owner =
              pg_catalog.btrim(reconciliation_failure_report_lease_owner)
            AND reconciliation_failure_report_lease_owner <> ''
            AND pg_catalog.char_length(
              reconciliation_failure_report_lease_owner
            ) <= 200
            AND reconciliation_failure_report_lease_owner !~ '[[:cntrl:]]'
            AND reconciliation_failure_report_lease_expires_at IS NOT NULL
            AND reconciliation_failure_report_lease_expires_at >
              reconciliation_failure_report_updated_at
            AND reconciliation_failure_reported_at IS NULL
          )
          OR (
            reconciliation_failure_report_state = 'reported'
            AND reconciliation_failure_report_delivery_count > 0
            AND reconciliation_failure_report_lease_token IS NULL
            AND reconciliation_failure_report_lease_owner IS NULL
            AND reconciliation_failure_report_lease_expires_at IS NULL
            AND reconciliation_failure_reported_at IS NOT NULL
            AND reconciliation_failure_reported_at =
              reconciliation_failure_report_updated_at
          )
        )
      )
    ),
  ADD CONSTRAINT
    media_blob_writer_attempts_reconciliation_last_operation_safe
    CHECK (
      reconciliation_state IS NULL
      OR reconciliation_state IN ('applied', 'failed')
      OR (
        content.media_asset_last_operation_id_valid_internal(
          last_operation_id
        )
      )
      OR (
        reconciliation_state = 'leased'
        AND reconciliation_last_error_code =
          'INVALID_RECONCILIATION_PAYLOAD'
        AND reconciliation_last_error_message =
          'Durable multipart completion payload is invalid.'
      )
    ) NOT VALID;

CREATE INDEX media_blob_writer_attempts_reconciliation_due
  ON content.media_blob_writer_attempts (
    reconciliation_next_attempt_at,
    reconciliation_handed_off_at,
    attempt_token
  )
  WHERE reconciliation_state = 'pending';

CREATE INDEX media_blob_writer_attempts_reconciliation_reclaim
  ON content.media_blob_writer_attempts (
    reconciliation_lease_expires_at,
    reconciliation_handed_off_at,
    attempt_token
  )
  WHERE reconciliation_state = 'leased';

CREATE INDEX media_blob_writer_attempts_failure_report_claim
  ON content.media_blob_writer_attempts (
    reconciliation_failure_report_state,
    reconciliation_failure_report_lease_expires_at,
    reconciliation_failure_report_updated_at,
    reconciliation_failure_event_id
  )
  WHERE reconciliation_failure_report_state IN ('pending', 'leased');

COMMENT ON COLUMN content.media_blob_writer_attempts.reconciliation_state IS
  'Durable multipart completion recovery lifecycle. NULL means the request retained responsibility and no worker handoff occurred.';
COMMENT ON COLUMN content.media_blob_writer_attempts.reconciliation_lease_token IS
  'Exact worker fencing token for one claimed durable multipart completion.';
COMMENT ON COLUMN content.media_blob_writer_attempts.reconciliation_handed_off_at IS
  'Timestamp when an HTTP request atomically expired its attempt lease while preserving the reservation for scheduled recovery.';
COMMENT ON COLUMN content.media_blob_writer_attempts.reconciliation_failure_event_id IS
  'Stable at-least-once terminal-failure telemetry identity. It is distinct from fencing tokens so duplicate deliveries are identifiable without exposing secrets.';
COMMENT ON COLUMN content.media_blob_writer_attempts.reconciliation_failure_report_state IS
  'Durable terminal-failure telemetry outbox state, independently claimable after reconciliation terminalizes.';

CREATE FUNCTION content.multipart_completion_reconciliation_error_valid_internal(
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    p_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    AND p_error_message = pg_catalog.btrim(p_error_message)
    AND pg_catalog.char_length(p_error_message) BETWEEN 1 AND 500
    AND p_error_message !~ '[[:cntrl:]]';
$$;

CREATE OR REPLACE FUNCTION
  content.multipart_media_blob_writer_attempt_payload_valid_internal(
    p_payload content.multipart_media_blob_writer_attempt_payload
  )
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    p_payload.user_id IS NOT NULL
    AND p_payload.user_id = pg_catalog.btrim(p_payload.user_id)
    AND p_payload.user_id <> ''
    AND p_payload.workspace_id IS NOT NULL
    AND p_payload.media_upload_session_id IS NOT NULL
    AND p_payload.media_asset_id IS NOT NULL
    AND p_payload.replica_id IS NOT NULL
    AND p_payload.last_operation_id IS NOT NULL
    AND p_payload.last_operation_id =
      pg_catalog.btrim(p_payload.last_operation_id)
    AND pg_catalog.char_length(p_payload.last_operation_id)
      BETWEEN 1 AND 1024
    AND p_payload.sha256 ~ '^[0-9a-f]{64}$'
    AND p_payload.staging_storage_key =
      'media/uploads/workspaces/'
      || pg_catalog.lower(p_payload.workspace_id::TEXT)
      || '/assets/'
      || pg_catalog.lower(p_payload.media_asset_id::TEXT)
      || '/sessions/'
      || pg_catalog.lower(p_payload.media_upload_session_id::TEXT)
    AND p_payload.blob_storage_key =
      'media/blobs/sha256/'
      || pg_catalog.substring(p_payload.sha256, 1, 2)
      || '/'
      || pg_catalog.substring(p_payload.sha256, 3, 2)
      || '/'
      || p_payload.sha256
    AND p_payload.s3_upload_id IS NOT NULL
    AND p_payload.s3_upload_id = pg_catalog.btrim(p_payload.s3_upload_id)
    AND p_payload.s3_upload_id <> ''
    AND p_payload.mime_type =
      pg_catalog.lower(pg_catalog.btrim(p_payload.mime_type))
    AND p_payload.mime_type ~
      '^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$'
    AND p_payload.size_bytes > 0
    AND p_payload.part_size_bytes > 0
    AND p_payload.part_count BETWEEN 1 AND 10000
    AND p_payload.asset_created_at IS NOT NULL
    AND p_payload.client_updated_at IS NOT NULL
    AND p_payload.session_expires_at IS NOT NULL
    AND p_payload.normalization_version IN (
      'passthrough-v1',
      'image-jpeg-card-v1'
    )
    AND p_payload.completed_parts_fingerprint ~ '^[0-9a-f]{64}$';
$$;

CREATE FUNCTION
  content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
    p_payload content.multipart_media_blob_writer_attempt_payload
  )
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    content.multipart_media_blob_writer_attempt_payload_valid_internal(
      p_payload
    )
    AND p_payload.user_id !~ '[[:cntrl:]]'
    AND content.media_asset_last_operation_id_valid_internal(
      p_payload.last_operation_id
    )
    AND p_payload.s3_upload_id !~ '[[:cntrl:]]'
    AND p_payload.size_bytes <= 9007199254740991
    AND p_payload.part_size_bytes <= 9007199254740991;
$$;

CREATE OR REPLACE FUNCTION
  content.multipart_media_blob_writer_terminal_replay_status_internal(
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
      OR (p_attempt).operation_id IS DISTINCT FROM
        p_payload.media_upload_session_id::TEXT
      OR (p_attempt).media_upload_session_id IS DISTINCT FROM
        p_payload.media_upload_session_id
      OR (p_attempt).sha256 IS DISTINCT FROM p_payload.sha256
      OR (p_attempt).blob_storage_key IS DISTINCT FROM
        p_payload.blob_storage_key
      OR (p_attempt).mime_type IS DISTINCT FROM p_payload.mime_type
      OR (p_attempt).size_bytes IS DISTINCT FROM p_payload.size_bytes
      OR (p_attempt).requested_normalization_version IS DISTINCT FROM
        p_payload.normalization_version
      OR (p_attempt).staging_storage_key IS DISTINCT FROM
        p_payload.staging_storage_key
      OR (p_attempt).s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
      OR (p_attempt).part_size_bytes IS DISTINCT FROM
        p_payload.part_size_bytes
      OR (p_attempt).part_count IS DISTINCT FROM p_payload.part_count
      OR (p_attempt).session_expires_at IS DISTINCT FROM
        p_payload.session_expires_at
      OR (p_attempt).completed_parts_fingerprint IS DISTINCT FROM
        p_payload.completed_parts_fingerprint
    THEN 'stale_attempt'
    ELSE 'ready'
  END;
$$;

CREATE FUNCTION
  content.multipart_completion_reconciliation_job_valid_internal(
    p_attempt content.media_blob_writer_attempts
  )
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
  SELECT
    (p_attempt).writer_kind = 'multipart_completion'
    AND (p_attempt).state = 'expired'
    AND (p_attempt).outcome = 'stale_attempt'
    AND (p_attempt).reconciliation_state IN ('pending', 'leased')
    AND (p_attempt).reconciliation_retry_count BETWEEN 0 AND 2147483647
    AND content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
      ROW(
        (p_attempt).user_id,
        (p_attempt).workspace_id,
        (p_attempt).media_upload_session_id,
        (p_attempt).media_asset_id,
        (p_attempt).replica_id,
        (p_attempt).last_operation_id,
        (p_attempt).sha256,
        (p_attempt).staging_storage_key,
        (p_attempt).blob_storage_key,
        (p_attempt).s3_upload_id,
        (p_attempt).mime_type,
        (p_attempt).size_bytes,
        (p_attempt).part_size_bytes,
        (p_attempt).part_count,
        (p_attempt).source_url,
        (p_attempt).asset_created_at,
        (p_attempt).client_updated_at,
        (p_attempt).session_expires_at,
        (p_attempt).normalization_version,
        (p_attempt).completed_parts_fingerprint
      )::content.multipart_media_blob_writer_attempt_payload
    );
$$;

CREATE FUNCTION content.handoff_media_upload_session_completion_attempt(
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
  attempt content.media_blob_writer_attempts%ROWTYPE;
  session content.media_upload_sessions%ROWTYPE;
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

  IF security.current_user_id() IS DISTINCT FROM p_payload.user_id
    OR security.current_workspace_id() IS DISTINCT FROM p_payload.workspace_id
  THEN
    RETURN 'access_denied';
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
    RETURN 'access_denied';
  END IF;

  SELECT sessions.*
  INTO session
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_payload.media_upload_session_id
  FOR UPDATE;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  FOR UPDATE;

  identity_status :=
    content.multipart_media_blob_writer_attempt_identity_status_internal(
      attempt,
      p_reservation_token,
      p_payload
    );
  IF identity_status <> 'ready' THEN
    RETURN identity_status;
  END IF;

  IF attempt.reconciliation_state IN ('pending', 'leased') THEN
    RETURN 'already_pending';
  ELSIF attempt.reconciliation_state = 'applied' THEN
    RETURN 'already_applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  END IF;

  IF attempt.state <> 'leased' THEN
    RETURN COALESCE(attempt.outcome, 'stale_attempt');
  END IF;

  IF session.media_upload_session_id IS NULL
    OR session.workspace_id IS DISTINCT FROM p_payload.workspace_id
    OR session.media_asset_id IS DISTINCT FROM p_payload.media_asset_id
    OR session.last_modified_by_replica_id IS DISTINCT FROM p_payload.replica_id
    OR session.last_operation_id IS DISTINCT FROM p_payload.last_operation_id
    OR session.media_blob_sha256 IS DISTINCT FROM p_payload.sha256
    OR session.staging_storage_key IS DISTINCT FROM p_payload.staging_storage_key
    OR session.blob_storage_key IS DISTINCT FROM p_payload.blob_storage_key
    OR session.s3_upload_id IS DISTINCT FROM p_payload.s3_upload_id
    OR session.mime_type IS DISTINCT FROM p_payload.mime_type
    OR session.size_bytes IS DISTINCT FROM p_payload.size_bytes
    OR session.part_size_bytes IS DISTINCT FROM p_payload.part_size_bytes
    OR session.part_count IS DISTINCT FROM p_payload.part_count
    OR session.source_url IS DISTINCT FROM p_payload.source_url
    OR session.asset_created_at IS DISTINCT FROM p_payload.asset_created_at
    OR session.client_updated_at IS DISTINCT FROM p_payload.client_updated_at
    OR session.expires_at IS DISTINCT FROM p_payload.session_expires_at
  THEN
    RETURN 'stale_attempt';
  END IF;

  IF session.state = 'aborting' THEN
    RETURN 'aborting';
  ELSIF session.state = 'aborted' THEN
    RETURN 'aborted';
  ELSIF session.state <> 'completing' THEN
    RETURN 'stale_attempt';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM content.media_blob_writer_reservations AS reservations
    WHERE reservations.reservation_token = p_reservation_token
      AND reservations.writer_kind = 'multipart_completion'
      AND reservations.workspace_id = p_payload.workspace_id
      AND reservations.media_asset_id = p_payload.media_asset_id
      AND reservations.operation_id =
        p_payload.media_upload_session_id::TEXT
      AND reservations.sha256 = p_payload.sha256
      AND reservations.state IN ('active', 'ambiguous', 'finalized')
    FOR UPDATE
  ) THEN
    RETURN 'writer_conflict';
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

CREATE OR REPLACE FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
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
  reconciled_at TIMESTAMPTZ;
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
    reconciled_at := pg_catalog.clock_timestamp();

    IF current_attempt.reconciliation_failure_report_state = 'leased'
      AND current_attempt.reconciliation_failure_report_lease_expires_at >
        reconciled_at
    THEN
      RETURN 'cleanup_claimed';
    END IF;

    UPDATE content.media_blob_writer_reservations AS reservations
    SET state = 'finalized'
    WHERE reservations.reservation_token = reservation.reservation_token;

    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_eligible_at = NULL,
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = reconciled_at
    WHERE lifecycles.sha256 = current_attempt.sha256;

    IF current_attempt.state NOT IN ('applied', 'referenced') THEN
      IF current_attempt.reconciliation_state IS NULL THEN
        UPDATE content.media_blob_writer_attempts AS attempts
        SET
          state = 'referenced',
          outcome = 'referenced',
          terminal_at = reconciled_at
        WHERE attempts.attempt_token = current_attempt.attempt_token;
      ELSIF
        current_attempt.reconciliation_failure_report_state = 'reported'
      THEN
        UPDATE content.media_blob_writer_attempts AS attempts
        SET
          state = 'referenced',
          outcome = 'referenced',
          terminal_at = reconciled_at,
          reconciliation_state = 'applied',
          reconciliation_next_attempt_at = NULL,
          reconciliation_lease_token = NULL,
          reconciliation_lease_owner = NULL,
          reconciliation_lease_expires_at = NULL,
          reconciliation_last_error_code = NULL,
          reconciliation_last_error_message = NULL,
          reconciliation_updated_at = reconciled_at,
          reconciliation_applied_at = reconciled_at
        WHERE attempts.attempt_token = current_attempt.attempt_token;
      ELSE
        UPDATE content.media_blob_writer_attempts AS attempts
        SET
          state = 'referenced',
          outcome = 'referenced',
          terminal_at = reconciled_at,
          reconciliation_state = 'applied',
          reconciliation_next_attempt_at = NULL,
          reconciliation_lease_token = NULL,
          reconciliation_lease_owner = NULL,
          reconciliation_lease_expires_at = NULL,
          reconciliation_last_error_code = NULL,
          reconciliation_last_error_message = NULL,
          reconciliation_updated_at = reconciled_at,
          reconciliation_applied_at = reconciled_at,
          reconciliation_failure_event_id = NULL,
          reconciliation_failure_report_state = NULL,
          reconciliation_failure_report_delivery_count = 0,
          reconciliation_failure_report_lease_token = NULL,
          reconciliation_failure_report_lease_owner = NULL,
          reconciliation_failure_report_lease_expires_at = NULL,
          reconciliation_failure_report_updated_at = NULL,
          reconciliation_failure_reported_at = NULL
        WHERE attempts.attempt_token = current_attempt.attempt_token;
      END IF;
    END IF;

    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'completed',
        completed_at = COALESCE(sessions.completed_at, reconciled_at),
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
        completed_at = COALESCE(
          sessions.completed_at,
          current_attempt.terminal_at,
          pg_catalog.clock_timestamp()
        ),
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
        aborted_at = COALESCE(
          sessions.aborted_at,
          current_attempt.terminal_at,
          pg_catalog.clock_timestamp()
        )
      WHERE sessions.media_upload_session_id = p_media_upload_session_id;
    END IF;
    RETURN 'peer_conflict';
  ELSIF current_attempt.state = 'cancelled' THEN
    IF session_found THEN
      UPDATE content.media_upload_sessions AS sessions
      SET
        state = 'aborted',
        completed_at = NULL,
        aborted_at = COALESCE(
          sessions.aborted_at,
          current_attempt.terminal_at,
          pg_catalog.clock_timestamp()
        )
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

COMMENT ON FUNCTION content.close_media_upload_session_current_blob_writer_with_owner(
  TEXT,
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  BIGINT,
  TIMESTAMPTZ,
  INTEGER
) IS
  'Closes the current multipart attempt and resolves exact-reference recovery after any active failure-report delivery finishes.';

CREATE FUNCTION content.renew_media_upload_session_completion_reconciliation(
  p_attempt_token UUID,
  p_lease_token UUID,
  p_lease_duration_ms INTEGER
)
RETURNS TABLE (
  renewal_status TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_writer_attempts%ROWTYPE;
  renewed_at TIMESTAMPTZ;
  renewed_until TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR p_lease_token IS NULL
    OR p_lease_duration_ms IS NULL
    OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
  THEN
    RETURN QUERY SELECT 'lease_lost'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  renewed_at := pg_catalog.clock_timestamp();
  renewed_until :=
    renewed_at + (p_lease_duration_ms * interval '1 millisecond');
  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    reconciliation_lease_expires_at = renewed_until,
    reconciliation_updated_at = renewed_at
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_state = 'leased'
    AND attempts.reconciliation_lease_token = p_lease_token
    AND attempts.reconciliation_lease_expires_at > renewed_at;
  IF FOUND THEN
    RETURN QUERY SELECT 'renewed'::TEXT, renewed_until;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF attempt.reconciliation_state = 'applied' THEN
    RETURN QUERY SELECT 'applied'::TEXT, NULL::TIMESTAMPTZ;
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN QUERY SELECT 'failed'::TEXT, NULL::TIMESTAMPTZ;
  ELSE
    RETURN QUERY SELECT 'lease_lost'::TEXT, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

CREATE FUNCTION content.reschedule_media_upload_session_completion_reconciliation(
  p_attempt_token UUID,
  p_lease_token UUID,
  p_next_attempt_at TIMESTAMPTZ,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_writer_attempts%ROWTYPE;
  rescheduled_at TIMESTAMPTZ;
BEGIN
  IF p_attempt_token IS NULL
    OR p_lease_token IS NULL
    OR p_next_attempt_at IS NULL
    OR content.multipart_completion_reconciliation_error_valid_internal(
      p_error_code,
      p_error_message
    ) IS DISTINCT FROM true
  THEN
    RETURN 'stale';
  END IF;

  rescheduled_at := pg_catalog.clock_timestamp();
  IF p_next_attempt_at < rescheduled_at THEN
    RETURN 'stale';
  END IF;

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    reconciliation_state = 'pending',
    reconciliation_retry_count = attempts.reconciliation_retry_count + 1,
    reconciliation_next_attempt_at = p_next_attempt_at,
    reconciliation_lease_token = NULL,
    reconciliation_lease_owner = NULL,
    reconciliation_lease_expires_at = NULL,
    reconciliation_last_error_code = p_error_code,
    reconciliation_last_error_message = p_error_message,
    reconciliation_updated_at = rescheduled_at
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_state = 'leased'
    AND attempts.reconciliation_lease_token = p_lease_token
    AND attempts.reconciliation_lease_expires_at > rescheduled_at;
  IF FOUND THEN
    RETURN 'rescheduled';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token;
  IF attempt.reconciliation_state = 'applied' THEN
    RETURN 'applied';
  ELSIF attempt.reconciliation_state = 'failed' THEN
    RETURN 'failed';
  END IF;
  RETURN 'lease_lost';
END;
$$;

CREATE FUNCTION content.apply_media_upload_session_completion_reconciliation_scope(
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
      attempt_snapshot.user_id || ':' || attempt_snapshot.workspace_id::TEXT,
      0::BIGINT
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

CREATE FUNCTION content.finish_media_upload_session_completion_reconciliation(
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

CREATE FUNCTION content.fail_media_upload_session_completion_reconciliation(
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
      attempt_snapshot.user_id || ':' || attempt_snapshot.workspace_id::TEXT,
      0::BIGINT
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
    OR lifecycle.normalization_version IS DISTINCT FROM attempt.normalization_version
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

CREATE FUNCTION content.claim_media_upload_session_completion_reconciliations(
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
      attempts.workspace_id
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

CREATE FUNCTION content.get_media_upload_session_completion_reconciliation_outcome(
  p_attempt_token UUID
)
RETURNS TABLE (
  reconciliation_status TEXT,
  reconciliation_error_code TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    CASE attempts.reconciliation_state
      WHEN 'applied' THEN 'applied'
      WHEN 'failed' THEN 'failed'
      WHEN 'pending' THEN 'active'
      WHEN 'leased' THEN 'active'
      ELSE 'missing'
    END,
    CASE
      WHEN attempts.reconciliation_state = 'failed'
      THEN attempts.reconciliation_last_error_code
      ELSE NULL
    END
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
  UNION ALL
  SELECT 'missing'::TEXT, NULL::TEXT
  WHERE NOT EXISTS (
    SELECT 1
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.attempt_token = p_attempt_token
  )
  LIMIT 1;
$$;

CREATE FUNCTION content.claim_media_upload_session_completion_failure_reports(
  p_lease_owner TEXT,
  p_lease_duration_ms INTEGER,
  p_limit INTEGER
)
RETURNS TABLE (
  failure_event_id UUID,
  attempt_token UUID,
  workspace_id UUID,
  reconciliation_retry_count INTEGER,
  reconciliation_last_error_code TEXT,
  failure_report_delivery_count INTEGER,
  failure_report_lease_token UUID,
  failure_report_lease_owner TEXT,
  failure_report_lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  claimed_at TIMESTAMPTZ;
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

  claimed_at := pg_catalog.clock_timestamp();
  RETURN QUERY
  WITH claimable AS (
    SELECT attempts.attempt_token
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.reconciliation_state = 'failed'
      AND (
        attempts.reconciliation_failure_report_state = 'pending'
        OR (
          attempts.reconciliation_failure_report_state = 'leased'
          AND attempts.reconciliation_failure_report_lease_expires_at <=
            claimed_at
        )
      )
    ORDER BY
      CASE
        WHEN attempts.reconciliation_failure_report_state = 'leased'
        THEN attempts.reconciliation_failure_report_lease_expires_at
        ELSE attempts.reconciliation_failure_report_updated_at
      END,
      attempts.reconciliation_failure_event_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    reconciliation_failure_report_state = 'leased',
    reconciliation_failure_report_delivery_count =
      attempts.reconciliation_failure_report_delivery_count + 1,
    reconciliation_failure_report_lease_token = public.gen_random_uuid(),
    reconciliation_failure_report_lease_owner = p_lease_owner,
    reconciliation_failure_report_lease_expires_at =
      claimed_at + (p_lease_duration_ms * interval '1 millisecond'),
    reconciliation_failure_report_updated_at = claimed_at
  FROM claimable
  WHERE attempts.attempt_token = claimable.attempt_token
  RETURNING
    attempts.reconciliation_failure_event_id,
    attempts.attempt_token,
    attempts.workspace_id,
    attempts.reconciliation_retry_count,
    attempts.reconciliation_last_error_code,
    attempts.reconciliation_failure_report_delivery_count,
    attempts.reconciliation_failure_report_lease_token,
    attempts.reconciliation_failure_report_lease_owner,
    attempts.reconciliation_failure_report_lease_expires_at;
END;
$$;

CREATE FUNCTION content.finish_media_upload_session_completion_failure_report(
  p_failure_event_id UUID,
  p_attempt_token UUID,
  p_lease_token UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_writer_attempts%ROWTYPE;
  reported_at TIMESTAMPTZ;
BEGIN
  IF p_failure_event_id IS NULL
    OR p_attempt_token IS NULL
    OR p_lease_token IS NULL
  THEN
    RETURN 'lease_lost';
  END IF;

  reported_at := pg_catalog.clock_timestamp();
  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    reconciliation_failure_report_state = 'reported',
    reconciliation_failure_report_lease_token = NULL,
    reconciliation_failure_report_lease_owner = NULL,
    reconciliation_failure_report_lease_expires_at = NULL,
    reconciliation_failure_report_updated_at = reported_at,
    reconciliation_failure_reported_at = reported_at
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_failure_event_id = p_failure_event_id
    AND attempts.reconciliation_failure_report_state = 'leased'
    AND attempts.reconciliation_failure_report_lease_token = p_lease_token
    AND attempts.reconciliation_failure_report_lease_expires_at > reported_at;
  IF FOUND THEN
    RETURN 'reported';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_failure_event_id = p_failure_event_id;
  IF attempt.reconciliation_failure_report_state = 'reported' THEN
    RETURN 'already_reported';
  END IF;
  RETURN 'lease_lost';
END;
$$;

CREATE FUNCTION
  content.lock_media_upload_session_completion_failure_report_delivery(
    p_failure_event_id UUID,
    p_attempt_token UUID,
    p_lease_token UUID
  )
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_writer_attempts%ROWTYPE;
  locked_at TIMESTAMPTZ;
BEGIN
  IF p_failure_event_id IS NULL
    OR p_attempt_token IS NULL
    OR p_lease_token IS NULL
  THEN
    RETURN 'lease_lost';
  END IF;

  locked_at := pg_catalog.clock_timestamp();
  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.attempt_token = p_attempt_token
    AND attempts.reconciliation_failure_event_id = p_failure_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;
  IF attempt.reconciliation_failure_report_state = 'reported' THEN
    RETURN 'already_reported';
  END IF;
  IF attempt.reconciliation_state = 'failed'
    AND attempt.reconciliation_failure_report_state = 'leased'
    AND attempt.reconciliation_failure_report_lease_token = p_lease_token
    AND attempt.reconciliation_failure_report_lease_expires_at > locked_at
  THEN
    RETURN 'ready';
  END IF;
  RETURN 'lease_lost';
END;
$$;

COMMENT ON FUNCTION
  content.lock_media_upload_session_completion_failure_report_delivery(
    UUID,
    UUID,
    UUID
  ) IS
  'Authorizes one failure-report emission while retaining its row lock through acknowledgement in the caller transaction.';

CREATE FUNCTION content.check_media_upload_session_completion_pending_with_owner(
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
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
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
  IF NOT EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = p_workspace_id
      AND memberships.user_id = p_user_id
  ) THEN
    RETURN 'access_denied';
  END IF;

  PERFORM 1
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.media_upload_session_id = p_media_upload_session_id
    AND sessions.workspace_id = p_workspace_id
    AND sessions.media_asset_id = p_media_asset_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'session_not_found';
  END IF;

  PERFORM 1
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.media_upload_session_id = p_media_upload_session_id
    AND attempts.workspace_id = p_workspace_id
    AND attempts.media_asset_id = p_media_asset_id
    AND attempts.reconciliation_state IN ('pending', 'leased')
  ORDER BY attempts.attempt_token
  FOR UPDATE;
  RETURN CASE WHEN FOUND THEN 'pending' ELSE 'not_pending' END;
END;
$$;

CREATE FUNCTION content.check_media_asset_completion_pending_with_owner(
  p_user_id TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_user_id IS NULL
    OR p_user_id <> pg_catalog.btrim(p_user_id)
    OR p_user_id = ''
    OR p_workspace_id IS NULL
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
      'multipart-asset:' || p_workspace_id::TEXT || ':' || p_media_asset_id::TEXT,
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

  PERFORM 1
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = p_workspace_id
    AND sessions.media_asset_id = p_media_asset_id
  ORDER BY sessions.media_upload_session_id
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.writer_kind = 'multipart_completion'
    AND attempts.workspace_id = p_workspace_id
    AND attempts.media_asset_id = p_media_asset_id
    AND (
      attempts.state = 'leased'
      OR attempts.reconciliation_state IN ('pending', 'leased')
    )
  ORDER BY attempts.attempt_token
  FOR UPDATE;
  RETURN CASE WHEN FOUND THEN 'pending' ELSE 'not_pending' END;
END;
$$;

CREATE FUNCTION content.fail_multipart_completion_reconciliations_before_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  failed_at TIMESTAMPTZ;
BEGIN
  failed_at := pg_catalog.clock_timestamp();
  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = 'cancelled',
    outcome = 'aborted',
    terminal_at = failed_at,
    reconciliation_state = 'failed',
    reconciliation_next_attempt_at = NULL,
    reconciliation_lease_token = NULL,
    reconciliation_lease_owner = NULL,
    reconciliation_lease_expires_at = NULL,
    reconciliation_last_error_code = 'WORKSPACE_DELETED',
    reconciliation_last_error_message =
      'Workspace was deleted before multipart completion reconciliation finished.',
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
  WHERE attempts.workspace_id = OLD.workspace_id
    AND attempts.reconciliation_state IN ('pending', 'leased');
  RETURN OLD;
END;
$$;

CREATE TRIGGER zz_fail_multipart_completion_reconciliations_before_workspace_delete
  BEFORE DELETE ON org.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION
    content.fail_multipart_completion_reconciliations_before_workspace_delete();

REVOKE ALL ON TABLE content.media_blob_writer_attempts
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.multipart_completion_reconciliation_error_valid_internal(TEXT, TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.media_asset_last_operation_id_valid_internal(TEXT)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.multipart_completion_reconciliation_job_valid_internal(
    content.media_blob_writer_attempts
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.multipart_media_blob_writer_attempt_payload_valid_internal(
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.multipart_media_blob_writer_attempt_payload_canonical_valid_internal(
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.close_media_upload_session_current_blob_writer_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    BIGINT,
    TIMESTAMPTZ,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.handoff_media_upload_session_completion_attempt(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.claim_media_upload_session_completion_reconciliations(
    TEXT,
    INTEGER,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.renew_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.reschedule_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    TIMESTAMPTZ,
    TEXT,
    TEXT
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.apply_media_upload_session_completion_reconciliation_scope(UUID, UUID)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.finish_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.fail_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    TEXT,
    TEXT,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.get_media_upload_session_completion_reconciliation_outcome(UUID)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.claim_media_upload_session_completion_failure_reports(
    TEXT,
    INTEGER,
    INTEGER
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.finish_media_upload_session_completion_failure_report(
    UUID,
    UUID,
    UUID
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.lock_media_upload_session_completion_failure_report_delivery(
    UUID,
    UUID,
    UUID
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.check_media_upload_session_completion_pending_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID
  )
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.check_media_asset_completion_pending_with_owner(TEXT, UUID, UUID)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.fail_multipart_completion_reconciliations_before_workspace_delete()
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION
  content.close_media_upload_session_current_blob_writer_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    BIGINT,
    TIMESTAMPTZ,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.handoff_media_upload_session_completion_attempt(
    UUID,
    UUID,
    content.multipart_media_blob_writer_attempt_payload
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.claim_media_upload_session_completion_reconciliations(
    TEXT,
    INTEGER,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.renew_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.reschedule_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    TIMESTAMPTZ,
    TEXT,
    TEXT
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.apply_media_upload_session_completion_reconciliation_scope(UUID, UUID)
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.finish_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.fail_media_upload_session_completion_reconciliation(
    UUID,
    UUID,
    TEXT,
    TEXT,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.get_media_upload_session_completion_reconciliation_outcome(UUID)
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.claim_media_upload_session_completion_failure_reports(
    TEXT,
    INTEGER,
    INTEGER
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.finish_media_upload_session_completion_failure_report(
    UUID,
    UUID,
    UUID
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.lock_media_upload_session_completion_failure_report_delivery(
    UUID,
    UUID,
    UUID
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.check_media_upload_session_completion_pending_with_owner(
    TEXT,
    UUID,
    UUID,
    UUID
  )
  TO backend_app;
GRANT EXECUTE ON FUNCTION
  content.check_media_asset_completion_pending_with_owner(TEXT, UUID, UUID)
  TO backend_app;
