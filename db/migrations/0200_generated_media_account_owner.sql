-- Schemas touched/read explicitly: auth, content, org, sync, pg_catalog.
-- Durable payload identity stays literal; only mutable authorization follows its live owner.
CREATE OR REPLACE FUNCTION content.apply_generated_media_promotion_job_scope(
  p_job_id UUID, p_lease_token UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  scoped_user_id TEXT;
  canonical_user_id TEXT;
  scoped_workspace_id UUID;
BEGIN
  SELECT jobs.user_id, jobs.workspace_id
  INTO scoped_user_id, scoped_workspace_id
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id
    AND jobs.state = 'leased'
    AND jobs.lease_token = p_lease_token
    AND jobs.lease_expires_at > statement_timestamp();
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;
  canonical_user_id := auth.canonical_account_id(scoped_user_id);
  PERFORM auth.assert_account_write_scope(canonical_user_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended(canonical_user_id || ':' || scoped_workspace_id::TEXT, 0::BIGINT));
  PERFORM 1
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id
    AND jobs.user_id = scoped_user_id
    AND jobs.workspace_id = scoped_workspace_id
    AND jobs.state = 'leased'
    AND jobs.lease_token = p_lease_token
    AND jobs.lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RETURN 'lease_lost';
  END IF;
  IF auth.canonical_account_id(scoped_user_id) IS DISTINCT FROM canonical_user_id THEN
    RAISE EXCEPTION 'Generated-media account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  PERFORM auth.assert_account_write_scope(canonical_user_id);
  PERFORM 1 FROM org.workspace_memberships AS memberships
  WHERE memberships.workspace_id = scoped_workspace_id
    AND memberships.user_id = canonical_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN 'access_revoked';
  END IF;
  PERFORM set_config('app.user_id', canonical_user_id, true);
  PERFORM set_config('app.workspace_id', scoped_workspace_id::TEXT, true);
  RETURN 'scoped';
END;
$$;
COMMENT ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) IS
  'Reports exact lease/access status and applies the enqueueing principal canonical account scope.';
REVOKE ALL ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) TO backend_app;

CREATE OR REPLACE FUNCTION content.lock_generated_media_promotion_job_after_access_revocation(
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
RETURNS TABLE(revocation_status TEXT, card_text TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  job_snapshot content.generated_media_promotion_jobs%ROWTYPE;
  job content.generated_media_promotion_jobs%ROWTYPE;
  locked_card_text TEXT;
  canonical_user_id TEXT;
BEGIN
  SELECT jobs.*
  INTO job_snapshot
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id;

  IF NOT FOUND
    OR job_snapshot.operation_id IS DISTINCT FROM p_operation_id
    OR job_snapshot.user_id IS DISTINCT FROM p_user_id
    OR job_snapshot.workspace_id IS DISTINCT FROM p_workspace_id
    OR job_snapshot.card_id IS DISTINCT FROM p_card_id
    OR job_snapshot.target_side IS DISTINCT FROM p_target_side
    OR job_snapshot.alt_text IS DISTINCT FROM p_alt_text
    OR job_snapshot.media_asset_id IS DISTINCT FROM p_media_asset_id
    OR job_snapshot.replica_id IS DISTINCT FROM p_replica_id
    OR job_snapshot.staging_storage_key IS DISTINCT FROM p_staging_storage_key
    OR job_snapshot.blob_storage_key IS DISTINCT FROM p_blob_storage_key
    OR job_snapshot.sha256 IS DISTINCT FROM p_sha256
    OR job_snapshot.mime_type IS DISTINCT FROM p_mime_type
    OR job_snapshot.size_bytes IS DISTINCT FROM p_size_bytes
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF job_snapshot.state IS DISTINCT FROM 'applied' AND (
    job_snapshot.state IS DISTINCT FROM 'leased'
    OR job_snapshot.lease_token IS DISTINCT FROM p_lease_token
    OR job_snapshot.lease_expires_at <= clock_timestamp()
  ) THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  canonical_user_id := auth.canonical_account_id(job_snapshot.user_id);
  PERFORM auth.assert_account_write_scope(canonical_user_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      canonical_user_id || ':' || job_snapshot.workspace_id::TEXT,
      0::BIGINT
    )
  );

  INSERT INTO sync.workspace_sync_metadata (
    workspace_id,
    min_available_hot_change_id,
    updated_at
  )
  VALUES (job_snapshot.workspace_id, 0, statement_timestamp())
  ON CONFLICT (workspace_id) DO NOTHING;

  PERFORM 1
  FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = job_snapshot.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM 1
  FROM content.media_blob_writer_reservations AS reservations
  INNER JOIN content.media_blob_lifecycles AS lifecycles
    ON lifecycles.sha256 = reservations.sha256
  WHERE reservations.writer_kind = 'generated_promotion'
    AND reservations.workspace_id = job_snapshot.workspace_id
    AND reservations.media_asset_id = job_snapshot.media_asset_id
    AND reservations.operation_id = job_snapshot.operation_id::TEXT
  FOR UPDATE OF lifecycles, reservations;

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
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF auth.canonical_account_id(job.user_id) IS DISTINCT FROM canonical_user_id THEN
    RAISE EXCEPTION 'Generated-media account scope changed; reload and retry'
      USING ERRCODE = 'P0A01';
  END IF;
  PERFORM auth.assert_account_write_scope(canonical_user_id);

  IF job.state = 'applied' THEN
    RETURN QUERY SELECT 'applied'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF job.state IS DISTINCT FROM 'leased'
    OR job.lease_token IS DISTINCT FROM p_lease_token
    OR job.lease_expires_at <= clock_timestamp()
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM org.workspace_memberships AS memberships
    WHERE memberships.workspace_id = job.workspace_id
      AND memberships.user_id = canonical_user_id
  ) THEN
    RETURN QUERY SELECT 'access_active'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF job.target_side NOT IN ('front', 'back') THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT CASE job.target_side
    WHEN 'front' THEN cards.front_text
    WHEN 'back' THEN cards.back_text
  END
  INTO locked_card_text
  FROM content.cards AS cards
  WHERE cards.workspace_id = job.workspace_id
    AND cards.card_id = job.card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    locked_card_text := NULL;
  END IF;

  RETURN QUERY SELECT 'access_revoked'::TEXT, locked_card_text;
END;
$$;

COMMENT ON FUNCTION content.lock_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT
) IS
  'Locks one exact leased generated-media job, its writer state, sync metadata, and tombstone-inclusive card row, then returns the requested card side only after confirming workspace access is revoked.';

REVOKE ALL ON FUNCTION content.lock_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.lock_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT
) TO backend_app;

