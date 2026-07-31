-- Migration status: Current / additive.
-- Introduces: lifecycle-marker promotion protocol fencing and parser-safe failed
-- generated-image placeholder settlement after workspace access revocation.
-- Schemas touched/read explicitly: content, org, sync, pg_catalog.

DROP FUNCTION IF EXISTS content.generated_media_promotion_protocol_v2_active();

DROP FUNCTION IF EXISTS content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
);

ALTER TABLE content.generated_media_promotion_jobs
  ADD COLUMN IF NOT EXISTS protocol_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN content.generated_media_promotion_jobs.protocol_version IS
  'Immutable promotion protocol: 1 is legacy append-on-success; 2 owns pending/ready/failed card markers.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraints
    WHERE constraints.conrelid = 'content.generated_media_promotion_jobs'::regclass
      AND constraints.conname = 'generated_media_promotion_jobs_protocol_version'
  ) THEN
    ALTER TABLE content.generated_media_promotion_jobs
      ADD CONSTRAINT generated_media_promotion_jobs_protocol_version
      CHECK (protocol_version IN (1, 2));
  END IF;
END;
$$;

GRANT SELECT (protocol_version), INSERT (protocol_version)
  ON content.generated_media_promotion_jobs TO backend_app;

CREATE OR REPLACE FUNCTION content.claim_generated_media_promotion_jobs(
  p_lease_owner TEXT,
  p_lease_duration_ms INTEGER,
  p_limit INTEGER,
  p_max_protocol_version INTEGER
)
RETURNS SETOF content.generated_media_promotion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_lease_owner IS NULL OR btrim(p_lease_owner) = ''
    OR p_lease_owner IS DISTINCT FROM btrim(p_lease_owner)
    OR char_length(p_lease_owner) > 200
    OR p_lease_owner ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'p_lease_owner must be 1 to 200 trimmed characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000 THEN
    RAISE EXCEPTION 'p_lease_duration_ms must be between 1 and 3600000'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF p_max_protocol_version IS NULL OR p_max_protocol_version NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'p_max_protocol_version must be between 1 and 2'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT jobs.job_id
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.protocol_version <= p_max_protocol_version
      AND (
        (
          jobs.state = 'pending'
          AND jobs.next_attempt_at <= statement_timestamp()
        )
        OR (
          jobs.state = 'leased'
          AND jobs.lease_expires_at <= statement_timestamp()
        )
      )
    ORDER BY
      CASE WHEN jobs.state = 'leased' THEN jobs.lease_expires_at
        ELSE jobs.next_attempt_at END,
      jobs.created_at,
      jobs.job_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE content.generated_media_promotion_jobs AS jobs
  SET
    state = 'leased',
    lease_token = public.gen_random_uuid(),
    lease_owner = p_lease_owner,
    lease_expires_at =
      statement_timestamp() + (p_lease_duration_ms * interval '1 millisecond'),
    updated_at = statement_timestamp()
  FROM claimable
  WHERE jobs.job_id = claimable.job_id
  RETURNING jobs.*;
END;
$$;

COMMENT ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER, INTEGER
) IS
  'Claims generated-media jobs up to an explicit worker protocol version; current workers pass 2.';

REVOKE ALL ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER, INTEGER
) TO backend_app;

CREATE OR REPLACE FUNCTION content.claim_generated_media_promotion_jobs(
  p_lease_owner TEXT,
  p_lease_duration_ms INTEGER,
  p_limit INTEGER
)
RETURNS SETOF content.generated_media_promotion_jobs
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT *
  FROM content.claim_generated_media_promotion_jobs(
    p_lease_owner,
    p_lease_duration_ms,
    p_limit,
    1
  );
$$;

COMMENT ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER
) IS
  'Compatibility claim boundary for deployed protocol-v1 workers; lifecycle-marker jobs are excluded.';

REVOKE ALL ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.claim_generated_media_promotion_jobs(
  TEXT, INTEGER, INTEGER
) TO backend_app;

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
BEGIN
  SELECT jobs.*
  INTO job_snapshot
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      job_snapshot.user_id || ':' || job_snapshot.workspace_id::TEXT,
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
      AND memberships.user_id = job.user_id
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

CREATE OR REPLACE FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
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
  lock_status TEXT;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000'
      USING ERRCODE = '22023';
  END IF;

  SELECT locks.revocation_status
  INTO lock_status
  FROM content.lock_generated_media_promotion_job_after_access_revocation(
    p_job_id,
    p_lease_token,
    p_operation_id,
    p_user_id,
    p_workspace_id,
    p_card_id,
    p_target_side,
    p_alt_text,
    p_media_asset_id,
    p_replica_id,
    p_staging_storage_key,
    p_blob_storage_key,
    p_sha256,
    p_mime_type,
    p_size_bytes
  ) AS locks;

  IF lock_status = 'access_revoked' THEN
    RETURN 'stale';
  END IF;
  RETURN COALESCE(lock_status, 'stale');
END;
$$;

COMMENT ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) IS
  'Compatibility fence for workers deployed before parser-safe access-revocation settlement; active access and applied jobs remain observable, while revoked jobs wait for a current worker.';

REVOKE ALL ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, INTEGER
) TO backend_app;

CREATE OR REPLACE FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
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
  p_expected_card_text TEXT,
  p_failed_card_text TEXT,
  p_error_code TEXT,
  p_cleanup_delay_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  lock_status TEXT;
  locked_card_text TEXT;
  job content.generated_media_promotion_jobs%ROWTYPE;
  card content.cards%ROWTYPE;
  reservation_found BOOLEAN;
  reservation_token UUID;
  reservation_sha256 TEXT;
  reservation_state TEXT;
  lifecycle_storage_key TEXT;
  lifecycle_mime_type TEXT;
  lifecycle_size_bytes BIGINT;
  lifecycle_normalization_version TEXT;
  terminalization_status TEXT;
  pending_destination TEXT;
  failed_destination TEXT;
  expected_index INTEGER;
  failed_index INTEGER;
  expected_length INTEGER;
  failed_length INTEGER;
  transition_count INTEGER := 0;
  generated_client_updated_at TIMESTAMPTZ;
BEGIN
  IF p_cleanup_delay_ms IS NULL OR p_cleanup_delay_ms NOT BETWEEN 1 AND 604800000 THEN
    RAISE EXCEPTION 'p_cleanup_delay_ms must be between 1 and 604800000'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NULL
    OR p_error_code NOT IN (
      'WORKSPACE_ACCESS_REVOKED',
      'GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT'
    )
  THEN
    RAISE EXCEPTION 'p_error_code is not an allowed access-revocation settlement outcome'
      USING ERRCODE = '22023';
  END IF;

  SELECT locks.revocation_status, locks.card_text
  INTO lock_status, locked_card_text
  FROM content.lock_generated_media_promotion_job_after_access_revocation(
    p_job_id,
    p_lease_token,
    p_operation_id,
    p_user_id,
    p_workspace_id,
    p_card_id,
    p_target_side,
    p_alt_text,
    p_media_asset_id,
    p_replica_id,
    p_staging_storage_key,
    p_blob_storage_key,
    p_sha256,
    p_mime_type,
    p_size_bytes
  ) AS locks;

  IF lock_status IS DISTINCT FROM 'access_revoked' THEN
    RETURN COALESCE(lock_status, 'stale');
  END IF;

  IF locked_card_text IS DISTINCT FROM p_expected_card_text THEN
    RETURN 'stale';
  END IF;
  IF p_error_code = 'GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT'
    AND p_failed_card_text IS DISTINCT FROM p_expected_card_text
  THEN
    RETURN 'stale';
  END IF;

  SELECT jobs.*
  INTO job
  FROM content.generated_media_promotion_jobs AS jobs
  WHERE jobs.job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

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
    AND reservations.workspace_id = job.workspace_id
    AND reservations.media_asset_id = job.media_asset_id
    AND reservations.operation_id = job.operation_id::TEXT
  FOR UPDATE OF lifecycles, reservations;
  reservation_found := FOUND;

  IF reservation_found AND (
    reservation_sha256 IS DISTINCT FROM job.sha256
    OR reservation_state NOT IN ('active', 'ambiguous', 'finalized', 'unreferenced')
    OR lifecycle_storage_key IS DISTINCT FROM job.blob_storage_key
    OR lifecycle_mime_type IS DISTINCT FROM job.mime_type
    OR lifecycle_size_bytes IS DISTINCT FROM job.size_bytes
    OR lifecycle_normalization_version NOT IN ('passthrough-v1', 'image-jpeg-card-v1')
  ) THEN
    RETURN 'stale';
  END IF;

  SELECT cards.*
  INTO card
  FROM content.cards AS cards
  WHERE cards.workspace_id = job.workspace_id
    AND cards.card_id = job.card_id
  FOR UPDATE;

  IF FOUND THEN
    IF p_expected_card_text IS NULL OR p_failed_card_text IS NULL THEN
      RETURN 'stale';
    END IF;

    IF p_failed_card_text IS DISTINCT FROM p_expected_card_text THEN
      pending_destination :=
        'fcasset:' || lower(job.media_asset_id::TEXT) || '?state=pending';
      failed_destination :=
        'fcasset:' || lower(job.media_asset_id::TEXT) || '?state=failed';
      expected_index := 1;
      failed_index := 1;
      expected_length := char_length(p_expected_card_text);
      failed_length := char_length(p_failed_card_text);

      WHILE expected_index <= expected_length OR failed_index <= failed_length LOOP
        IF substring(
          p_expected_card_text FROM expected_index FOR char_length(pending_destination)
        ) = pending_destination
          AND substring(
            p_failed_card_text FROM failed_index FOR char_length(failed_destination)
          ) = failed_destination
        THEN
          expected_index := expected_index + char_length(pending_destination);
          failed_index := failed_index + char_length(failed_destination);
          transition_count := transition_count + 1;
        ELSIF expected_index <= expected_length
          AND failed_index <= failed_length
          AND substring(p_expected_card_text FROM expected_index FOR 1)
            = substring(p_failed_card_text FROM failed_index FOR 1)
        THEN
          expected_index := expected_index + 1;
          failed_index := failed_index + 1;
        ELSE
          RETURN 'stale';
        END IF;
      END LOOP;

      IF transition_count = 0 THEN
        RETURN 'stale';
      END IF;
    END IF;
  ELSIF p_expected_card_text IS NOT NULL OR p_failed_card_text IS NOT NULL THEN
    RETURN 'stale';
  END IF;

  IF reservation_found THEN
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
      RAISE EXCEPTION
        'Generated-media writer terminalization failed after access revocation. job_id=% status=%',
        job.job_id,
        terminalization_status
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF card.card_id IS NOT NULL
    AND p_failed_card_text IS DISTINCT FROM p_expected_card_text
  THEN
    generated_client_updated_at := GREATEST(
      statement_timestamp(),
      card.client_updated_at + interval '1 millisecond'
    );

    IF job.target_side = 'front' THEN
      UPDATE content.cards AS cards
      SET
        front_text = p_failed_card_text,
        client_updated_at = generated_client_updated_at,
        last_modified_by_replica_id = job.replica_id,
        last_operation_id = job.operation_id::TEXT,
        updated_at = statement_timestamp()
      WHERE cards.workspace_id = job.workspace_id
        AND cards.card_id = job.card_id;
    ELSIF job.target_side = 'back' THEN
      UPDATE content.cards AS cards
      SET
        back_text = p_failed_card_text,
        client_updated_at = generated_client_updated_at,
        last_modified_by_replica_id = job.replica_id,
        last_operation_id = job.operation_id::TEXT,
        updated_at = statement_timestamp()
      WHERE cards.workspace_id = job.workspace_id
        AND cards.card_id = job.card_id;
    ELSE
      RAISE EXCEPTION 'Generated-media job target side is invalid. job_id=%', job.job_id
        USING ERRCODE = '22023';
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Locked generated-media card disappeared. job_id=%', job.job_id
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO sync.hot_changes (
      workspace_id,
      entity_type,
      entity_id,
      action,
      replica_id,
      operation_id,
      client_updated_at
    )
    VALUES (
      job.workspace_id,
      'card',
      job.card_id::TEXT,
      'upsert',
      job.replica_id,
      job.operation_id::TEXT,
      generated_client_updated_at
    );
  END IF;

  UPDATE content.generated_media_promotion_jobs AS jobs
  SET
    state = 'failed',
    next_attempt_at = NULL,
    lease_token = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = p_error_code,
    last_error_message = CASE p_error_code
      WHEN 'WORKSPACE_ACCESS_REVOKED' THEN
        'Workspace access was revoked before generated-media promotion completed.'
      WHEN 'GENERATED_IMAGE_MARKDOWN_COMPLEXITY_CONFLICT' THEN
        'Generated image settlement could not inspect the '
          || job.target_side
          || ' side because its Markdown exceeds parser complexity limits. Card text was preserved.'
    END,
    updated_at = statement_timestamp()
  WHERE jobs.job_id = job.job_id;

  RETURN 'failed';
END;
$$;

COMMENT ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) IS
  'Atomically validates a parser-computed pending-to-failed transition or exact no-change parser-conflict settlement, terminalizes the exact generated writer, preserves card tombstones, emits hot sync state only for text changes, and fails the current job lease after workspace access revocation.';

REVOKE ALL ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.fail_generated_media_promotion_job_after_access_revocation(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, UUID, TEXT, TEXT,
  TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO backend_app;

CREATE OR REPLACE FUNCTION content.generated_media_promotion_protocol_v2_active()
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT TRUE;
$$;

COMMENT ON FUNCTION content.generated_media_promotion_protocol_v2_active() IS
  'Migration-completion marker that activates admission for protocol-v2 lifecycle-marker jobs.';

REVOKE ALL ON FUNCTION content.generated_media_promotion_protocol_v2_active()
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.generated_media_promotion_protocol_v2_active()
  TO backend_app;
