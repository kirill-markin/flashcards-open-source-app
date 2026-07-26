-- Migration status: Current / additive.
-- Introduces: canonical normalization adoption and exact generated-writer lifecycle transitions.
-- Schemas touched/read explicitly: content, catalog, security, pg_catalog, public.

DROP FUNCTION content.reserve_media_blob_writer(
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT
);

CREATE FUNCTION content.reserve_media_blob_writer(
  p_sha256 TEXT,
  p_storage_key TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT,
  p_writer_kind TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_operation_id TEXT
)
RETURNS TABLE (
  reservation_token UUID,
  reservation_state TEXT,
  reservation_status TEXT,
  normalization_version TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  reservation content.media_blob_writer_reservations%ROWTYPE;
BEGIN
  IF security.current_workspace_access_allowed(p_workspace_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Permanent media blob writer requires the active workspace scope'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO content.media_blob_lifecycles (
    sha256, storage_key, mime_type, size_bytes, normalization_version
  )
  VALUES (
    p_sha256, p_storage_key, p_mime_type, p_size_bytes, p_normalization_version
  )
  ON CONFLICT DO NOTHING;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = p_sha256
  FOR UPDATE;

  IF NOT FOUND
    OR lifecycle.storage_key IS DISTINCT FROM p_storage_key
    OR lifecycle.mime_type IS DISTINCT FROM p_mime_type
    OR lifecycle.size_bytes IS DISTINCT FROM p_size_bytes
  THEN
    RAISE EXCEPTION 'Permanent media blob immutable metadata conflicts with its content hash'
      USING ERRCODE = '23514';
  END IF;

  IF lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at > clock_timestamp()
  THEN
    RETURN QUERY
    SELECT NULL::UUID, NULL::TEXT, 'cleanup_claimed'::TEXT, lifecycle.normalization_version;
    RETURN;
  END IF;

  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_eligible_at = NULL,
    cleanup_lease_token = NULL,
    cleanup_lease_expires_at = NULL,
    updated_at = clock_timestamp()
  WHERE lifecycles.sha256 = p_sha256;

  INSERT INTO content.media_blob_writer_reservations (
    sha256, writer_kind, workspace_id, media_asset_id, operation_id
  )
  VALUES (
    p_sha256, p_writer_kind, p_workspace_id, p_media_asset_id, p_operation_id
  )
  ON CONFLICT (writer_kind, workspace_id, media_asset_id, operation_id) DO NOTHING;

  SELECT reservations.*
  INTO reservation
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.writer_kind = p_writer_kind
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND OR reservation.sha256 IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'Permanent media blob writer identity conflicts with a different content hash'
      USING ERRCODE = '23514';
  END IF;

  IF reservation.state = 'unreferenced' THEN
    UPDATE content.media_blob_writer_reservations AS reservations
    SET
      reservation_token = public.gen_random_uuid(),
      state = 'active',
      ambiguous_at = NULL
    WHERE reservations.reservation_token = reservation.reservation_token
    RETURNING reservations.* INTO reservation;
  END IF;

  RETURN QUERY
  SELECT
    reservation.reservation_token,
    reservation.state,
    'reserved'::TEXT,
    lifecycle.normalization_version;
END;
$$;

CREATE FUNCTION content.media_blob_writer_exact_match(
  p_reservation_token UUID,
  p_sha256 TEXT,
  p_storage_key TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT,
  p_writer_kind TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_operation_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM content.media_blob_lifecycles AS lifecycles
  INNER JOIN content.media_blob_writer_reservations AS reservations
    ON reservations.sha256 = lifecycles.sha256
  WHERE reservations.reservation_token = p_reservation_token
    AND reservations.sha256 = p_sha256
    AND reservations.writer_kind = p_writer_kind
    AND reservations.workspace_id = p_workspace_id
    AND reservations.media_asset_id = p_media_asset_id
    AND reservations.operation_id = p_operation_id
    AND lifecycles.storage_key = p_storage_key
    AND lifecycles.mime_type = p_mime_type
    AND lifecycles.size_bytes = p_size_bytes
    AND lifecycles.normalization_version = p_normalization_version
  FOR UPDATE OF lifecycles, reservations;

  RETURN FOUND;
END;
$$;

CREATE FUNCTION content.terminalize_media_blob_writer_failure(
  p_reservation_token UUID,
  p_sha256 TEXT,
  p_storage_key TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT,
  p_writer_kind TEXT,
  p_workspace_id UUID,
  p_media_asset_id UUID,
  p_operation_id TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  reservation_state TEXT;
  exact_reference_exists BOOLEAN;
  any_reference_exists BOOLEAN;
  terminalized_at TIMESTAMPTZ;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000'
      USING ERRCODE = '22023';
  END IF;

  IF content.media_blob_writer_exact_match(
    p_reservation_token, p_sha256, p_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, p_writer_kind, p_workspace_id, p_media_asset_id,
    p_operation_id
  ) IS DISTINCT FROM true THEN
    RETURN 'stale';
  END IF;

  SELECT reservations.state
  INTO reservation_state
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.reservation_token = p_reservation_token;

  IF reservation_state = 'finalized' THEN
    RETURN 'referenced';
  ELSIF reservation_state = 'unreferenced' THEN
    RETURN 'unreferenced';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM content.media_assets AS media_assets
    INNER JOIN content.media_blobs AS media_blobs
      ON media_blobs.media_blob_id = media_assets.media_blob_id
    WHERE media_assets.workspace_id = p_workspace_id
      AND media_assets.media_asset_id = p_media_asset_id
      AND media_assets.deleted_at IS NULL
      AND media_blobs.sha256 = p_sha256
  )
  INTO exact_reference_exists;

  IF exact_reference_exists THEN
    UPDATE content.media_blob_writer_reservations AS reservations
    SET state = 'finalized'
    WHERE reservations.reservation_token = p_reservation_token;

    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_eligible_at = NULL,
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = clock_timestamp()
    WHERE lifecycles.sha256 = p_sha256;

    RETURN 'referenced';
  END IF;

  UPDATE content.media_blob_writer_reservations AS reservations
  SET state = 'unreferenced'
  WHERE reservations.reservation_token = p_reservation_token;

  SELECT EXISTS (
    SELECT 1
    FROM content.media_assets AS media_assets
    INNER JOIN content.media_blobs AS media_blobs
      ON media_blobs.media_blob_id = media_assets.media_blob_id
    WHERE media_blobs.sha256 = p_sha256
      AND media_assets.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM catalog.package_media_assets AS package_media_assets
    INNER JOIN content.media_blobs AS media_blobs
      ON media_blobs.media_blob_id = package_media_assets.media_blob_id
    WHERE media_blobs.sha256 = p_sha256
  )
  INTO any_reference_exists;

  IF NOT any_reference_exists
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = p_sha256
        AND reservations.state NOT IN ('finalized', 'unreferenced')
    )
  THEN
    terminalized_at := clock_timestamp();
    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_eligible_at = GREATEST(
        COALESCE(lifecycles.cleanup_eligible_at, '-infinity'::TIMESTAMPTZ),
        terminalized_at + (p_cleanup_delay_ms * interval '1 millisecond')
      ),
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = terminalized_at
    WHERE lifecycles.sha256 = p_sha256;
  END IF;

  RETURN 'unreferenced';
END;
$$;

CREATE FUNCTION content.generated_media_promotion_blob_writer_lease_matches(
  p_job_id UUID,
  p_lease_token UUID,
  p_operation_id UUID,
  p_user_id TEXT,
  p_workspace_id UUID,
  p_card_id UUID,
  p_target_side TEXT,
  p_alt_text TEXT,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_staging_storage_key TEXT,
  p_blob_storage_key TEXT,
  p_sha256 TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id
    AND jobs.state = 'leased'
    AND jobs.lease_token = p_lease_token
    AND jobs.lease_expires_at > clock_timestamp()
    AND jobs.operation_id = p_operation_id
    AND jobs.user_id = p_user_id
    AND jobs.workspace_id = p_workspace_id
    AND jobs.card_id = p_card_id
    AND jobs.target_side = p_target_side
    AND jobs.alt_text = p_alt_text
    AND jobs.media_asset_id = p_media_asset_id
    AND jobs.replica_id = p_replica_id
    AND jobs.staging_storage_key = p_staging_storage_key
    AND jobs.blob_storage_key = p_blob_storage_key
    AND jobs.sha256 = p_sha256
    AND jobs.mime_type = p_mime_type
    AND jobs.size_bytes = p_size_bytes
  FOR UPDATE;

  RETURN FOUND;
END;
$$;

CREATE FUNCTION content.mark_generated_media_promotion_blob_writer_ambiguous(
  p_job_id UUID,
  p_lease_token UUID,
  p_reservation_token UUID,
  p_operation_id UUID,
  p_user_id TEXT,
  p_workspace_id UUID,
  p_card_id UUID,
  p_target_side TEXT,
  p_alt_text TEXT,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_staging_storage_key TEXT,
  p_blob_storage_key TEXT,
  p_sha256 TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF content.media_blob_writer_exact_match(
    p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, 'generated_promotion', p_workspace_id, p_media_asset_id,
    p_operation_id::TEXT
  ) IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF content.generated_media_promotion_blob_writer_lease_matches(
    p_job_id, p_lease_token, p_operation_id, p_user_id, p_workspace_id, p_card_id,
    p_target_side, p_alt_text, p_media_asset_id, p_replica_id, p_staging_storage_key,
    p_blob_storage_key, p_sha256, p_mime_type, p_size_bytes
  ) IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  UPDATE content.media_blob_writer_reservations AS reservations
  SET
    state = 'ambiguous',
    ambiguous_at = COALESCE(reservations.ambiguous_at, statement_timestamp())
  WHERE reservations.reservation_token = p_reservation_token
    AND reservations.state IN ('active', 'ambiguous');

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE content.generated_media_promotion_jobs AS jobs
  SET
    last_error_code = 'DATABASE_COMMIT_OUTCOME_UNKNOWN',
    last_error_message = 'PostgreSQL commit outcome requires durable writer reconciliation.',
    updated_at = statement_timestamp()
  WHERE jobs.job_id = p_job_id;

  RETURN true;
END;
$$;

CREATE FUNCTION content.fail_generated_media_promotion_job_with_blob_writer(
  p_job_id UUID,
  p_lease_token UUID,
  p_reservation_token UUID,
  p_operation_id UUID,
  p_user_id TEXT,
  p_workspace_id UUID,
  p_card_id UUID,
  p_target_side TEXT,
  p_alt_text TEXT,
  p_media_asset_id UUID,
  p_replica_id UUID,
  p_staging_storage_key TEXT,
  p_blob_storage_key TEXT,
  p_sha256 TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_normalization_version TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  terminalization_status TEXT;
BEGIN
  IF content.media_blob_writer_exact_match(
    p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, 'generated_promotion', p_workspace_id, p_media_asset_id,
    p_operation_id::TEXT
  ) IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  IF content.generated_media_promotion_blob_writer_lease_matches(
    p_job_id, p_lease_token, p_operation_id, p_user_id, p_workspace_id, p_card_id,
    p_target_side, p_alt_text, p_media_asset_id, p_replica_id, p_staging_storage_key,
    p_blob_storage_key, p_sha256, p_mime_type, p_size_bytes
  ) IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  terminalization_status := content.terminalize_media_blob_writer_failure(
    p_reservation_token, p_sha256, p_blob_storage_key, p_mime_type, p_size_bytes,
    p_normalization_version, 'generated_promotion', p_workspace_id, p_media_asset_id,
    p_operation_id::TEXT, p_cleanup_delay_ms
  );
  IF terminalization_status = 'stale' THEN
    RETURN false;
  END IF;

  UPDATE content.generated_media_promotion_jobs AS jobs
  SET
    state = 'failed',
    next_attempt_at = NULL,
    lease_token = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = p_error_code,
    last_error_message = p_error_message,
    updated_at = statement_timestamp()
  WHERE jobs.job_id = p_job_id;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION content.terminalize_media_blob_writer_failure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT, INTEGER
) IS
  'Terminalizes one exact permanent-blob writer identity without depending on current workspace access.';
COMMENT ON FUNCTION content.mark_generated_media_promotion_blob_writer_ambiguous(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT
) IS
  'Marks one exact generated-media job lease and its exact blob reservation as commit-ambiguous.';
COMMENT ON FUNCTION content.fail_generated_media_promotion_job_with_blob_writer(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) IS
  'Atomically fails one exact active generated-media job lease and terminalizes its exact blob reservation.';

REVOKE ALL ON FUNCTION content.reserve_media_blob_writer(
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.media_blob_writer_exact_match(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.generated_media_promotion_blob_writer_lease_matches(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.terminalize_media_blob_writer_failure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.mark_generated_media_promotion_blob_writer_ambiguous(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.fail_generated_media_promotion_job_with_blob_writer(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION content.reserve_media_blob_writer(
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.terminalize_media_blob_writer_failure(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID, UUID, TEXT, INTEGER
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.mark_generated_media_promotion_blob_writer_ambiguous(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT
) TO backend_app;
GRANT EXECUTE ON FUNCTION content.fail_generated_media_promotion_job_with_blob_writer(
  UUID, UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT,
  TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO backend_app;
