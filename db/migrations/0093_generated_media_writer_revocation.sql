-- Migration status: Current / additive.
-- Introduces: exact generated-writer resolution and terminalization after workspace access revocation.
-- Schemas touched/read explicitly: content, org, pg_catalog.

CREATE FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
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
  p_size_bytes BIGINT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  job_snapshot content.generated_media_promotion_jobs%ROWTYPE;
  job content.generated_media_promotion_jobs%ROWTYPE;
  reservation_found BOOLEAN;
  reservation_token UUID;
  reservation_sha256 TEXT;
  reservation_state TEXT;
  lifecycle_storage_key TEXT;
  lifecycle_mime_type TEXT;
  lifecycle_size_bytes BIGINT;
  lifecycle_normalization_version TEXT;
  terminalization_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000'
      USING ERRCODE = '22023';
  END IF;

  SELECT jobs.*
  INTO job_snapshot
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id;

  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      job_snapshot.user_id || ':' || job_snapshot.workspace_id::TEXT,
      0::BIGINT
    )
  );

  SELECT
    reservations.reservation_token,
    reservations.sha256,
    reservations.state,
    lifecycles.storage_key,
    lifecycles.mime_type,
    lifecycles.size_bytes,
    lifecycles.normalization_version
  INTO
    reservation_token,
    reservation_sha256,
    reservation_state,
    lifecycle_storage_key,
    lifecycle_mime_type,
    lifecycle_size_bytes,
    lifecycle_normalization_version
  FROM content.media_blob_writer_reservations AS reservations
  INNER JOIN content.media_blob_lifecycles AS lifecycles
    ON lifecycles.sha256 = reservations.sha256
  WHERE reservations.writer_kind = 'generated_promotion'
    AND reservations.workspace_id = job_snapshot.workspace_id
    AND reservations.media_asset_id = job_snapshot.media_asset_id
    AND reservations.operation_id = job_snapshot.operation_id::TEXT
  FOR UPDATE OF lifecycles, reservations;
  reservation_found := FOUND;

  SELECT jobs.*
  INTO job
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND
    OR job.operation_id IS DISTINCT FROM p_operation_id
    OR job.user_id IS DISTINCT FROM p_user_id
    OR job.workspace_id IS DISTINCT FROM p_workspace_id
    OR job.card_id IS DISTINCT FROM p_card_id
    OR job.target_side IS DISTINCT FROM p_target_side
    OR job.alt_text IS DISTINCT FROM p_alt_text
    OR job.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR job.replica_id IS DISTINCT FROM p_replica_id
    OR job.staging_storage_key IS DISTINCT FROM p_staging_storage_key
    OR job.blob_storage_key IS DISTINCT FROM p_blob_storage_key
    OR job.sha256 IS DISTINCT FROM p_sha256
    OR job.mime_type IS DISTINCT FROM p_mime_type
    OR job.size_bytes IS DISTINCT FROM p_size_bytes
  THEN
    RETURN 'stale';
  END IF;

  IF job.state = 'applied' THEN
    RETURN 'applied';
  END IF;

  IF job.state IS DISTINCT FROM 'leased'
    OR job.lease_token IS DISTINCT FROM p_lease_token
    OR job.lease_expires_at <= clock_timestamp()
  THEN
    RETURN 'stale';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = job.workspace_id
      AND memberships.user_id = job.user_id
  ) THEN
    RETURN 'access_active';
  END IF;

  IF reservation_found THEN
    IF reservation_sha256 IS DISTINCT FROM job.sha256
      OR reservation_state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
      OR lifecycle_storage_key IS DISTINCT FROM job.blob_storage_key
      OR lifecycle_mime_type IS DISTINCT FROM job.mime_type
      OR lifecycle_size_bytes IS DISTINCT FROM job.size_bytes
      OR lifecycle_normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
    THEN
      RETURN 'stale';
    END IF;

    terminalization_status := content.terminalize_media_blob_writer_failure(
      reservation_token,
      reservation_sha256,
      lifecycle_storage_key,
      lifecycle_mime_type,
      lifecycle_size_bytes,
      lifecycle_normalization_version,
      'generated_promotion',
      job.workspace_id,
      job.media_asset_id,
      job.operation_id::TEXT,
      p_cleanup_delay_ms
    );

    IF terminalization_status NOT IN ('referenced', 'unreferenced') THEN
      RETURN 'stale';
    END IF;
  END IF;

  UPDATE content.generated_media_promotion_jobs AS jobs
  SET
    state = 'failed',
    next_attempt_at = NULL,
    lease_token = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = 'WORKSPACE_ACCESS_REVOKED',
    last_error_message =
      'Workspace access was revoked before generated-media promotion completed.',
    updated_at = statement_timestamp()
  WHERE jobs.job_id = job.job_id;

  RETURN 'failed';
END;
$$;

COMMENT ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) IS
  'Atomically resolves and terminalizes one exact generated writer before failing its current job lease after workspace access revocation.';

REVOKE ALL ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) TO backend_app;
