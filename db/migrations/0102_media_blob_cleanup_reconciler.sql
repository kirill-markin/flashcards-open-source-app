-- Current additive migration for globally reconciled permanent media-blob cleanup.
-- Schemas touched/read explicitly: content, catalog, pg_catalog.

ALTER TABLE content.media_blob_lifecycles
  ADD COLUMN cleanup_generation BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT media_blob_lifecycles_cleanup_generation_nonnegative
    CHECK (cleanup_generation >= 0);

CREATE TABLE content.media_blob_cleanup_attempts (
  cleanup_token UUID PRIMARY KEY,
  sha256 TEXT NOT NULL
    REFERENCES content.media_blob_lifecycles(sha256) ON DELETE RESTRICT,
  cleanup_generation BIGINT NOT NULL CHECK (cleanup_generation > 0),
  lease_token UUID NOT NULL,
  storage_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed'
    CHECK (
      state IN (
        'claimed',
        'authorized',
        'deleting',
        'retry_wait',
        'reconciliation_required',
        'blocked',
        'completed'
      )
    ),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  authorized_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT media_blob_cleanup_attempts_generation_unique
    UNIQUE (sha256, cleanup_generation),
  CONSTRAINT media_blob_cleanup_attempts_storage_key_deterministic
    CHECK (
      storage_key =
        'media/blobs/sha256/'
        || pg_catalog.substring(sha256, 1, 2)
        || '/'
        || pg_catalog.substring(sha256, 3, 2)
        || '/'
        || sha256
    ),
  CONSTRAINT media_blob_cleanup_attempts_state_shape
    CHECK (
      (
        state = 'claimed'
        AND authorized_at IS NULL
        AND completed_at IS NULL
      )
      OR (
        state = 'authorized'
        AND authorized_at IS NOT NULL
        AND completed_at IS NULL
        AND next_attempt_at IS NULL
      )
      OR (
        state = 'deleting'
        AND authorized_at IS NOT NULL
        AND completed_at IS NULL
        AND next_attempt_at IS NULL
      )
      OR (
        state = 'retry_wait'
        AND authorized_at IS NOT NULL
        AND completed_at IS NULL
        AND next_attempt_at IS NOT NULL
        AND failure_count > 0
      )
      OR (
        state = 'reconciliation_required'
        AND authorized_at IS NOT NULL
        AND completed_at IS NULL
        AND next_attempt_at IS NULL
        AND failure_count > 0
      )
      OR (
        state = 'blocked'
        AND completed_at IS NULL
        AND next_attempt_at IS NULL
      )
      OR (
        state = 'completed'
        AND authorized_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_at >= authorized_at
        AND next_attempt_at IS NULL
      )
    )
);

CREATE TABLE content.media_blob_cleanup_claims (
  claim_token UUID PRIMARY KEY,
  cleanup_token UUID NOT NULL
    REFERENCES content.media_blob_cleanup_attempts(cleanup_token)
    ON DELETE CASCADE,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp()
);

CREATE TABLE content.media_blob_cleanup_renewals (
  renewal_token UUID PRIMARY KEY,
  cleanup_token UUID NOT NULL
    REFERENCES content.media_blob_cleanup_attempts(cleanup_token)
    ON DELETE CASCADE,
  cleanup_generation BIGINT NOT NULL CHECK (cleanup_generation > 0),
  lease_token UUID NOT NULL,
  phase TEXT NOT NULL
    CHECK (phase IN ('head_object', 'delete_object', 'complete')),
  expected_lease_expires_at TIMESTAMPTZ NOT NULL,
  lease_duration_ms INTEGER NOT NULL
    CHECK (lease_duration_ms BETWEEN 1 AND 3600000),
  renewed_lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CHECK (renewed_lease_expires_at > expected_lease_expires_at)
);

CREATE TABLE content.media_blob_cleanup_failures (
  failure_token UUID PRIMARY KEY,
  cleanup_token UUID NOT NULL
    REFERENCES content.media_blob_cleanup_attempts(cleanup_token)
    ON DELETE CASCADE,
  cleanup_generation BIGINT NOT NULL CHECK (cleanup_generation > 0),
  lease_token UUID NOT NULL,
  disposition TEXT NOT NULL
    CHECK (disposition IN ('retry', 'terminal')),
  retry_delay_ms INTEGER NOT NULL
    CHECK (retry_delay_ms BETWEEN 0 AND 3600000),
  phase TEXT NOT NULL
    CHECK (
      phase IN (
        'authorize',
        'renew',
        'head_object',
        'delete_object',
        'complete'
      )
    ),
  next_attempt_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL CHECK (failure_count > 0),
  error_code TEXT NOT NULL CHECK (error_code <> ''),
  error_class TEXT NOT NULL CHECK (error_class <> ''),
  failed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  CONSTRAINT media_blob_cleanup_failures_disposition_shape
    CHECK (
      (
        disposition = 'retry'
        AND retry_delay_ms > 0
        AND next_attempt_at IS NOT NULL
      )
      OR (
        disposition = 'terminal'
        AND retry_delay_ms = 0
        AND next_attempt_at IS NULL
      )
    )
);

CREATE INDEX media_blob_cleanup_attempts_sha_history
  ON content.media_blob_cleanup_attempts(sha256, cleanup_generation DESC);

CREATE INDEX media_blob_cleanup_attempts_due_reclaim
  ON content.media_blob_cleanup_attempts(
    (COALESCE(next_attempt_at, lease_expires_at)),
    authorized_at,
    sha256
  )
  WHERE state IN ('authorized', 'retry_wait');

CREATE INDEX media_blob_cleanup_claims_attempt
  ON content.media_blob_cleanup_claims(cleanup_token, created_at DESC);

CREATE INDEX media_blob_cleanup_renewals_attempt
  ON content.media_blob_cleanup_renewals(cleanup_token, created_at DESC);

CREATE INDEX media_blob_cleanup_failures_attempt
  ON content.media_blob_cleanup_failures(cleanup_token, failed_at DESC);

CREATE INDEX generated_media_promotion_jobs_cleanup_reference
  ON content.generated_media_promotion_jobs(sha256, state)
  WHERE state IN ('pending', 'leased');

COMMENT ON TABLE content.media_blob_cleanup_attempts IS
  'Private durable claim, authorization, and completion history for exact-generation permanent media-blob cleanup reconciliation.';
COMMENT ON TABLE content.media_blob_cleanup_claims IS
  'Private caller-stable cleanup lease history used to resume one authorized deletion without opening writer admission.';
COMMENT ON TABLE content.media_blob_cleanup_renewals IS
  'Private caller-stable exact cleanup lease renewal history for deterministic commit-unknown replay.';
COMMENT ON TABLE content.media_blob_cleanup_failures IS
  'Private idempotent failure decisions for bounded retry scheduling and terminal cleanup reconciliation.';
COMMENT ON COLUMN content.media_blob_lifecycles.cleanup_generation IS
  'Monotonic fence incremented for every globally claimed cleanup attempt.';
COMMENT ON COLUMN content.media_blob_lifecycles.cleanup_lease_expires_at IS
  'Finite claimant lease expiry before authorization; infinity while an authorized deletion durably fences all writers.';

CREATE OR REPLACE FUNCTION content.terminalize_media_blob_writers_before_workspace_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  owner_user_id TEXT;
  affected_sha256s TEXT[];
  affected_sha256 TEXT;
  terminalized_at TIMESTAMPTZ;
BEGIN
  FOR owner_user_id IN
    SELECT owners.user_id
    FROM (
      SELECT memberships.user_id
      FROM org.workspace_memberships AS memberships
      WHERE memberships.workspace_id = OLD.workspace_id
      UNION
      SELECT snapshots.user_id
      FROM content.media_blob_writer_owner_snapshots AS snapshots
      WHERE snapshots.workspace_id = OLD.workspace_id
      UNION
      SELECT attempts.user_id
      FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.workspace_id = OLD.workspace_id
    ) AS owners
    ORDER BY owners.user_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        owner_user_id || ':' || OLD.workspace_id::TEXT,
        0::BIGINT
      )
    );
  END LOOP;

  PERFORM 1
  FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id
  ORDER BY sessions.media_upload_session_id
  FOR UPDATE;

  PERFORM 1
  FROM sync.workspace_sync_metadata AS metadata
  WHERE metadata.workspace_id = OLD.workspace_id
  FOR UPDATE;

  SELECT pg_catalog.array_agg(DISTINCT writers.sha256 ORDER BY writers.sha256)
  INTO affected_sha256s
  FROM (
    SELECT reservations.sha256
    FROM content.media_blob_writer_reservations AS reservations
    WHERE reservations.workspace_id = OLD.workspace_id
      AND reservations.writer_kind IN (
        'direct_ingestion',
        'multipart_completion'
      )
    UNION
    SELECT attempts.sha256
    FROM content.media_blob_writer_attempts AS attempts
    WHERE attempts.workspace_id = OLD.workspace_id
  ) AS writers;

  IF affected_sha256s IS NULL THEN
    RETURN OLD;
  END IF;

  FOREACH affected_sha256 IN ARRAY affected_sha256s
  LOOP
    PERFORM 1
    FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = affected_sha256
    FOR UPDATE;
  END LOOP;

  PERFORM 1
  FROM content.media_blob_writer_reservations AS reservations
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN (
      'direct_ingestion',
      'multipart_completion'
    )
  ORDER BY
    reservations.sha256,
    reservations.writer_kind,
    reservations.media_asset_id,
    reservations.operation_id
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blob_writer_owner_snapshots AS snapshots
  WHERE snapshots.workspace_id = OLD.workspace_id
  ORDER BY snapshots.reservation_token
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blob_writer_attempts AS attempts
  WHERE attempts.workspace_id = OLD.workspace_id
  ORDER BY
    attempts.writer_kind,
    attempts.media_asset_id,
    attempts.operation_id,
    attempts.attempt_token
  FOR UPDATE;

  PERFORM 1
  FROM content.media_assets AS assets
  WHERE assets.workspace_id = OLD.workspace_id
  ORDER BY assets.media_asset_id
  FOR UPDATE;

  PERFORM 1
  FROM content.media_blobs AS blobs
  WHERE blobs.sha256 = ANY(affected_sha256s)
  ORDER BY blobs.sha256
  FOR SHARE;

  DELETE FROM content.media_upload_sessions AS sessions
  WHERE sessions.workspace_id = OLD.workspace_id;

  DELETE FROM content.media_assets AS assets
  WHERE assets.workspace_id = OLD.workspace_id;

  UPDATE content.media_blob_writer_reservations AS reservations
  SET state = 'unreferenced'
  WHERE reservations.workspace_id = OLD.workspace_id
    AND reservations.writer_kind IN (
      'direct_ingestion',
      'multipart_completion'
    )
    AND reservations.state <> 'unreferenced';

  terminalized_at := pg_catalog.clock_timestamp();

  UPDATE content.media_blob_writer_attempts AS attempts
  SET
    state = 'cancelled',
    outcome = 'aborted',
    terminal_at = terminalized_at
  WHERE attempts.workspace_id = OLD.workspace_id
    AND attempts.state = 'leased';

  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_eligible_at = GREATEST(
      COALESCE(
        lifecycles.cleanup_eligible_at,
        '-infinity'::TIMESTAMPTZ
      ),
      terminalized_at + interval '1 hour'
    ),
    cleanup_lease_token = CASE
      WHEN lifecycles.cleanup_lease_expires_at =
        'infinity'::TIMESTAMPTZ
      THEN lifecycles.cleanup_lease_token
      ELSE NULL
    END,
    cleanup_lease_expires_at = CASE
      WHEN lifecycles.cleanup_lease_expires_at =
        'infinity'::TIMESTAMPTZ
      THEN lifecycles.cleanup_lease_expires_at
      ELSE NULL
    END,
    updated_at = terminalized_at
  WHERE lifecycles.sha256 = ANY(affected_sha256s)
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_assets AS assets
      INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
        AND assets.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM catalog.package_media_assets AS assets
      INNER JOIN content.media_blobs AS blobs
        ON blobs.media_blob_id = assets.media_blob_id
      WHERE blobs.sha256 = lifecycles.sha256
    )
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = lifecycles.sha256
        AND reservations.state NOT IN ('finalized', 'unreferenced')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.sha256 = lifecycles.sha256
        AND attempts.state = 'leased'
    );

  RETURN OLD;
END;
$$;

CREATE FUNCTION content.generated_media_promotion_cleanup_admission_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  lifecycle content.media_blob_lifecycles%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE jobs.job_id = NEW.job_id
      OR jobs.operation_id = NEW.operation_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = NEW.sha256
  FOR UPDATE;

  IF FOUND
    AND lifecycle.cleanup_lease_token IS NOT NULL
    AND lifecycle.cleanup_lease_expires_at = 'infinity'::TIMESTAMPTZ
  THEN
    RAISE EXCEPTION
      'Generated-media promotion enqueue conflicts with active cleanup deletion fence'
      USING
        ERRCODE = '55P03',
        CONSTRAINT = 'generated_media_promotion_cleanup_admission';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER generated_media_promotion_cleanup_admission
BEFORE INSERT ON content.generated_media_promotion_jobs
FOR EACH ROW
EXECUTE FUNCTION content.generated_media_promotion_cleanup_admission_internal();

CREATE FUNCTION content.media_blob_cleanup_blocked_internal(p_sha256 TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM content.media_assets AS media_assets
      INNER JOIN content.media_blobs AS media_blobs
        ON media_blobs.media_blob_id = media_assets.media_blob_id
      WHERE media_blobs.sha256 = p_sha256
        AND media_assets.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.package_media_assets AS package_media_assets
      INNER JOIN content.media_blobs AS media_blobs
        ON media_blobs.media_blob_id = package_media_assets.media_blob_id
      WHERE media_blobs.sha256 = p_sha256
    )
    OR EXISTS (
      SELECT 1
      FROM content.media_blob_writer_reservations AS reservations
      WHERE reservations.sha256 = p_sha256
        AND reservations.state IN ('active', 'ambiguous')
    )
    OR EXISTS (
      SELECT 1
      FROM content.media_blob_writer_attempts AS attempts
      WHERE attempts.sha256 = p_sha256
        AND (
          attempts.state = 'leased'
          OR attempts.reconciliation_state IN ('pending', 'leased')
        )
    )
    OR EXISTS (
      SELECT 1
      FROM content.generated_media_promotion_jobs AS jobs
      WHERE jobs.sha256 = p_sha256
        AND jobs.state IN ('pending', 'leased')
    );
$$;

CREATE FUNCTION content.claim_next_media_blob_cleanup(
  p_claim_token UUID,
  p_lease_duration_ms INTEGER
)
RETURNS TABLE (
  cleanup_token UUID,
  lease_token UUID,
  sha256 TEXT,
  storage_key TEXT,
  cleanup_generation BIGINT,
  lease_expires_at TIMESTAMPTZ,
  claim_status TEXT,
  failure_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing_claim content.media_blob_cleanup_claims%ROWTYPE;
  existing_attempt content.media_blob_cleanup_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  claim_time TIMESTAMPTZ;
BEGIN
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'p_claim_token is required' USING ERRCODE = '22023';
  END IF;
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
  THEN
    RAISE EXCEPTION 'p_lease_duration_ms must be between 1 and 3600000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'media-blob-cleanup:' || p_claim_token::TEXT,
      0::BIGINT
    )
  );

  SELECT claims.*
  INTO existing_claim
  FROM content.media_blob_cleanup_claims AS claims
  WHERE claims.claim_token = p_claim_token;

  IF FOUND THEN
    SELECT attempts.*
    INTO existing_attempt
    FROM content.media_blob_cleanup_attempts AS attempts
    WHERE attempts.cleanup_token = existing_claim.cleanup_token;

    SELECT lifecycles.*
    INTO lifecycle
    FROM content.media_blob_lifecycles AS lifecycles
    WHERE lifecycles.sha256 = existing_attempt.sha256;

    RETURN QUERY
    SELECT
      existing_attempt.cleanup_token,
      existing_claim.claim_token,
      existing_attempt.sha256,
      existing_attempt.storage_key,
      existing_attempt.cleanup_generation,
      existing_claim.lease_expires_at,
      CASE
        WHEN existing_attempt.state = 'completed' THEN 'completed'
        WHEN existing_attempt.state = 'blocked' THEN 'blocked'
        WHEN existing_attempt.state = 'retry_wait' THEN 'retry_wait'
        WHEN existing_attempt.state = 'reconciliation_required'
          THEN 'reconciliation_required'
        WHEN existing_attempt.state = 'deleting'
          THEN 'reconciliation_required'
        WHEN existing_attempt.lease_token = existing_claim.claim_token
          AND existing_attempt.lease_expires_at = existing_claim.lease_expires_at
          AND lifecycle.cleanup_lease_token = existing_claim.claim_token
          AND lifecycle.cleanup_generation = existing_attempt.cleanup_generation
          AND existing_attempt.lease_expires_at > pg_catalog.clock_timestamp()
          THEN 'claimed'
        ELSE 'stale'
      END,
      existing_attempt.failure_count;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO existing_attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  INNER JOIN content.media_blob_lifecycles AS lifecycles
    ON lifecycles.sha256 = attempts.sha256
    AND lifecycles.cleanup_generation = attempts.cleanup_generation
    AND lifecycles.cleanup_lease_token = attempts.lease_token
  WHERE (
      attempts.state = 'authorized'
      AND attempts.lease_expires_at <= pg_catalog.clock_timestamp()
    )
    OR (
      attempts.state = 'retry_wait'
      AND attempts.next_attempt_at <= pg_catalog.clock_timestamp()
    )
  ORDER BY
    COALESCE(attempts.next_attempt_at, attempts.lease_expires_at),
    attempts.authorized_at,
    attempts.sha256
  FOR UPDATE OF attempts, lifecycles SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    claim_time := pg_catalog.date_trunc(
      'milliseconds',
      pg_catalog.clock_timestamp()
    );
    UPDATE content.media_blob_cleanup_attempts AS attempts
    SET
      state = 'authorized',
      lease_token = p_claim_token,
      lease_expires_at =
        claim_time + (p_lease_duration_ms * interval '1 millisecond'),
      next_attempt_at = NULL
    WHERE attempts.cleanup_token = existing_attempt.cleanup_token
    RETURNING * INTO existing_attempt;

    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_lease_token = p_claim_token,
      cleanup_lease_expires_at = 'infinity'::TIMESTAMPTZ,
      updated_at = claim_time
    WHERE lifecycles.sha256 = existing_attempt.sha256
      AND lifecycles.cleanup_generation =
        existing_attempt.cleanup_generation;

    INSERT INTO content.media_blob_cleanup_claims (
      claim_token,
      cleanup_token,
      lease_expires_at
    )
    VALUES (
      p_claim_token,
      existing_attempt.cleanup_token,
      existing_attempt.lease_expires_at
    );

    RETURN QUERY
    SELECT
      existing_attempt.cleanup_token,
      p_claim_token,
      existing_attempt.sha256,
      existing_attempt.storage_key,
      existing_attempt.cleanup_generation,
      existing_attempt.lease_expires_at,
      'claimed'::TEXT,
      existing_attempt.failure_count;
    RETURN;
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.cleanup_eligible_at IS NOT NULL
    AND lifecycles.cleanup_eligible_at <= pg_catalog.clock_timestamp()
    AND (
      lifecycles.cleanup_lease_token IS NULL
      OR lifecycles.cleanup_lease_expires_at <= pg_catalog.clock_timestamp()
    )
    AND content.media_blob_cleanup_blocked_internal(lifecycles.sha256) IS false
  ORDER BY lifecycles.cleanup_eligible_at, lifecycles.sha256
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  claim_time := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_generation = lifecycles.cleanup_generation + 1,
    cleanup_lease_token = p_claim_token,
    cleanup_lease_expires_at =
      claim_time + (p_lease_duration_ms * interval '1 millisecond'),
    updated_at = claim_time
  WHERE lifecycles.sha256 = lifecycle.sha256
  RETURNING lifecycles.* INTO lifecycle;

  INSERT INTO content.media_blob_cleanup_attempts (
    cleanup_token,
    sha256,
    cleanup_generation,
    lease_token,
    storage_key,
    lease_expires_at
  )
  VALUES (
    p_claim_token,
    lifecycle.sha256,
    lifecycle.cleanup_generation,
    p_claim_token,
    lifecycle.storage_key,
    lifecycle.cleanup_lease_expires_at
  )
  RETURNING * INTO existing_attempt;

  INSERT INTO content.media_blob_cleanup_claims (
    claim_token,
    cleanup_token,
    lease_expires_at
  )
  VALUES (
    p_claim_token,
    existing_attempt.cleanup_token,
    existing_attempt.lease_expires_at
  );

  RETURN QUERY
  SELECT
    existing_attempt.cleanup_token,
    p_claim_token,
    existing_attempt.sha256,
    existing_attempt.storage_key,
    existing_attempt.cleanup_generation,
    existing_attempt.lease_expires_at,
    'claimed'::TEXT,
    existing_attempt.failure_count;
END;
$$;

CREATE FUNCTION content.authorize_media_blob_cleanup(
  p_cleanup_token UUID,
  p_cleanup_generation BIGINT,
  p_lease_token UUID
)
RETURNS TABLE (
  storage_key TEXT,
  authorization_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_cleanup_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  decision_time TIMESTAMPTZ;
BEGIN
  IF p_cleanup_token IS NULL OR p_cleanup_generation IS NULL
    OR p_lease_token IS NULL
    OR p_cleanup_generation < 1
  THEN
    RAISE EXCEPTION 'Exact cleanup token and positive generation are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token;
  IF NOT FOUND OR attempt.cleanup_generation IS DISTINCT FROM p_cleanup_generation
  THEN
    RETURN QUERY SELECT NULL::TEXT, 'stale'::TEXT;
    RETURN;
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = attempt.sha256
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT attempt.storage_key, 'stale'::TEXT;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, 'stale'::TEXT;
    RETURN;
  END IF;

  IF attempt.state = 'completed' THEN
    RETURN QUERY SELECT attempt.storage_key, 'completed'::TEXT;
    RETURN;
  ELSIF attempt.state = 'blocked' THEN
    RETURN QUERY SELECT attempt.storage_key, 'blocked'::TEXT;
    RETURN;
  END IF;

  decision_time := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  IF attempt.lease_token IS DISTINCT FROM p_lease_token
    OR attempt.lease_expires_at <= decision_time
    OR lifecycle.cleanup_lease_token IS DISTINCT FROM p_lease_token
    OR lifecycle.cleanup_generation IS DISTINCT FROM p_cleanup_generation
    OR lifecycle.storage_key IS DISTINCT FROM attempt.storage_key
  THEN
    RETURN QUERY SELECT attempt.storage_key, 'stale'::TEXT;
    RETURN;
  END IF;

  IF attempt.state IN ('authorized', 'deleting') THEN
    RETURN QUERY SELECT attempt.storage_key, 'authorized'::TEXT;
    RETURN;
  END IF;

  IF content.media_blob_cleanup_blocked_internal(attempt.sha256) THEN
    UPDATE content.media_blob_cleanup_attempts AS attempts
    SET state = 'blocked'
    WHERE attempts.cleanup_token = p_cleanup_token;
    UPDATE content.media_blob_lifecycles AS lifecycles
    SET
      cleanup_lease_token = NULL,
      cleanup_lease_expires_at = NULL,
      updated_at = decision_time
    WHERE lifecycles.sha256 = attempt.sha256
      AND lifecycles.cleanup_lease_token = p_lease_token
      AND lifecycles.cleanup_generation = p_cleanup_generation;
    RETURN QUERY SELECT attempt.storage_key, 'blocked'::TEXT;
    RETURN;
  END IF;

  UPDATE content.media_blob_cleanup_attempts AS attempts
  SET
    state = 'authorized',
    authorized_at = COALESCE(attempts.authorized_at, decision_time)
  WHERE attempts.cleanup_token = p_cleanup_token;

  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_lease_expires_at = 'infinity'::TIMESTAMPTZ,
    updated_at = decision_time
  WHERE lifecycles.sha256 = attempt.sha256
    AND lifecycles.cleanup_lease_token = p_lease_token
    AND lifecycles.cleanup_generation = p_cleanup_generation;

  RETURN QUERY SELECT attempt.storage_key, 'authorized'::TEXT;
END;
$$;

CREATE FUNCTION content.complete_media_blob_cleanup(
  p_cleanup_token UUID,
  p_cleanup_generation BIGINT,
  p_lease_token UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  attempt content.media_blob_cleanup_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  completion_time TIMESTAMPTZ;
BEGIN
  IF p_cleanup_token IS NULL OR p_cleanup_generation IS NULL
    OR p_lease_token IS NULL
    OR p_cleanup_generation < 1
  THEN
    RAISE EXCEPTION 'Exact cleanup token and positive generation are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token;
  IF NOT FOUND OR attempt.cleanup_generation IS DISTINCT FROM p_cleanup_generation
  THEN
    RETURN 'stale';
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = attempt.sha256
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;

  IF attempt.state = 'completed' THEN
    RETURN 'completed';
  END IF;

  completion_time := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  IF attempt.state NOT IN ('authorized', 'deleting')
    OR attempt.lease_token IS DISTINCT FROM p_lease_token
    OR attempt.lease_expires_at <= completion_time
    OR lifecycle.cleanup_lease_token IS DISTINCT FROM p_lease_token
    OR lifecycle.cleanup_generation IS DISTINCT FROM p_cleanup_generation
    OR lifecycle.cleanup_lease_expires_at IS DISTINCT FROM
      'infinity'::TIMESTAMPTZ
  THEN
    RETURN 'stale';
  END IF;

  UPDATE content.media_blob_cleanup_attempts AS attempts
  SET state = 'completed', completed_at = completion_time
  WHERE attempts.cleanup_token = p_cleanup_token;

  UPDATE content.media_blob_lifecycles AS lifecycles
  SET
    cleanup_eligible_at = NULL,
    cleanup_lease_token = NULL,
    cleanup_lease_expires_at = NULL,
    updated_at = completion_time
  WHERE lifecycles.sha256 = attempt.sha256
    AND lifecycles.cleanup_lease_token = p_lease_token
    AND lifecycles.cleanup_generation = p_cleanup_generation;

  RETURN 'completed';
END;
$$;

CREATE FUNCTION content.renew_media_blob_cleanup_lease(
  p_cleanup_token UUID,
  p_cleanup_generation BIGINT,
  p_lease_token UUID,
  p_renewal_token UUID,
  p_phase TEXT,
  p_expected_lease_expires_at TIMESTAMPTZ,
  p_lease_duration_ms INTEGER
)
RETURNS TABLE (
  lease_expires_at TIMESTAMPTZ,
  renewal_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  recorded_renewal content.media_blob_cleanup_renewals%ROWTYPE;
  attempt content.media_blob_cleanup_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  renewal_time TIMESTAMPTZ;
  renewed_lease_expires_at TIMESTAMPTZ;
BEGIN
  IF p_cleanup_token IS NULL OR p_cleanup_generation IS NULL
    OR p_lease_token IS NULL
    OR p_renewal_token IS NULL
    OR p_expected_lease_expires_at IS NULL
    OR p_cleanup_generation < 1
  THEN
    RAISE EXCEPTION 'Exact cleanup token and positive generation are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_phase NOT IN ('head_object', 'delete_object', 'complete') THEN
    RAISE EXCEPTION 'p_phase is not a cleanup lease renewal phase'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_duration_ms IS NULL OR p_lease_duration_ms NOT BETWEEN 1 AND 3600000
  THEN
    RAISE EXCEPTION 'p_lease_duration_ms must be between 1 and 3600000'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'media-blob-cleanup-renewal:' || p_renewal_token::TEXT,
      0::BIGINT
    )
  );

  SELECT renewals.*
  INTO recorded_renewal
  FROM content.media_blob_cleanup_renewals AS renewals
  WHERE renewals.renewal_token = p_renewal_token;

  IF FOUND THEN
    IF recorded_renewal.cleanup_token IS DISTINCT FROM p_cleanup_token
      OR recorded_renewal.cleanup_generation IS DISTINCT FROM
        p_cleanup_generation
      OR recorded_renewal.lease_token IS DISTINCT FROM p_lease_token
      OR recorded_renewal.phase IS DISTINCT FROM p_phase
      OR recorded_renewal.expected_lease_expires_at IS DISTINCT FROM
        p_expected_lease_expires_at
      OR recorded_renewal.lease_duration_ms IS DISTINCT FROM
        p_lease_duration_ms
    THEN
      RAISE EXCEPTION
        'p_renewal_token was reused with different cleanup renewal parameters'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token;
  IF NOT FOUND OR attempt.cleanup_generation IS DISTINCT FROM p_cleanup_generation
  THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = attempt.sha256
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;

  IF attempt.state = 'completed' THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'completed'::TEXT;
    RETURN;
  END IF;

  renewal_time := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  IF attempt.state NOT IN ('authorized', 'deleting')
    OR attempt.lease_token IS DISTINCT FROM p_lease_token
    OR attempt.lease_expires_at <= renewal_time
    OR lifecycle.cleanup_lease_token IS DISTINCT FROM p_lease_token
    OR lifecycle.cleanup_generation IS DISTINCT FROM p_cleanup_generation
    OR lifecycle.cleanup_lease_expires_at IS DISTINCT FROM
      'infinity'::TIMESTAMPTZ
  THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;
  IF attempt.state = 'deleting' AND p_phase = 'head_object' THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;

  IF recorded_renewal.renewal_token IS NOT NULL THEN
    IF attempt.lease_expires_at IS DISTINCT FROM
      recorded_renewal.renewed_lease_expires_at
    THEN
      RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY
    SELECT recorded_renewal.renewed_lease_expires_at, 'renewed'::TEXT;
    RETURN;
  END IF;

  IF attempt.lease_expires_at IS DISTINCT FROM p_expected_lease_expires_at THEN
    RETURN QUERY SELECT NULL::TIMESTAMPTZ, 'stale'::TEXT;
    RETURN;
  END IF;

  renewed_lease_expires_at := GREATEST(
    renewal_time + (p_lease_duration_ms * interval '1 millisecond'),
    p_expected_lease_expires_at + interval '1 millisecond'
  );

  INSERT INTO content.media_blob_cleanup_renewals (
    renewal_token,
    cleanup_token,
    cleanup_generation,
    lease_token,
    phase,
    expected_lease_expires_at,
    lease_duration_ms,
    renewed_lease_expires_at
  )
  VALUES (
    p_renewal_token,
    p_cleanup_token,
    p_cleanup_generation,
    p_lease_token,
    p_phase,
    p_expected_lease_expires_at,
    p_lease_duration_ms,
    renewed_lease_expires_at
  );

  UPDATE content.media_blob_cleanup_attempts AS attempts
  SET
    state = CASE
      WHEN p_phase = 'delete_object' THEN 'deleting'
      ELSE attempts.state
    END,
    lease_expires_at = renewed_lease_expires_at
  WHERE attempts.cleanup_token = p_cleanup_token;

  UPDATE content.media_blob_cleanup_claims AS claims
  SET lease_expires_at = renewed_lease_expires_at
  WHERE claims.claim_token = p_lease_token
    AND claims.cleanup_token = p_cleanup_token;

  RETURN QUERY SELECT renewed_lease_expires_at, 'renewed'::TEXT;
END;
$$;

CREATE FUNCTION content.record_media_blob_cleanup_failure(
  p_cleanup_token UUID,
  p_cleanup_generation BIGINT,
  p_lease_token UUID,
  p_failure_token UUID,
  p_disposition TEXT,
  p_retry_delay_ms INTEGER,
  p_phase TEXT,
  p_error_code TEXT,
  p_error_class TEXT
)
RETURNS TABLE (
  failure_status TEXT,
  next_attempt_at TIMESTAMPTZ,
  failure_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  recorded_failure content.media_blob_cleanup_failures%ROWTYPE;
  attempt content.media_blob_cleanup_attempts%ROWTYPE;
  lifecycle content.media_blob_lifecycles%ROWTYPE;
  failure_time TIMESTAMPTZ;
  retry_at TIMESTAMPTZ;
  recorded_failure_count INTEGER;
BEGIN
  IF p_cleanup_token IS NULL OR p_cleanup_generation IS NULL
    OR p_lease_token IS NULL OR p_failure_token IS NULL
    OR p_cleanup_generation < 1
  THEN
    RAISE EXCEPTION 'Exact cleanup, lease, failure token, and positive generation are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_disposition NOT IN ('retry', 'terminal') THEN
    RAISE EXCEPTION 'p_disposition must be retry or terminal'
      USING ERRCODE = '22023';
  END IF;
  IF p_phase NOT IN (
    'authorize',
    'renew',
    'head_object',
    'delete_object',
    'complete'
  ) THEN
    RAISE EXCEPTION 'p_phase is not a cleanup failure phase'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NULL OR p_error_code = ''
    OR p_error_class IS NULL OR p_error_class = ''
    OR pg_catalog.length(p_error_code) > 128
    OR pg_catalog.length(p_error_class) > 128
  THEN
    RAISE EXCEPTION 'Cleanup failure code and class must contain at most 128 characters'
      USING ERRCODE = '22023';
  END IF;
  IF (
      p_disposition = 'retry'
      AND (
        p_retry_delay_ms IS NULL
        OR p_retry_delay_ms NOT BETWEEN 1 AND 3600000
      )
    )
    OR (
      p_disposition = 'terminal'
      AND p_retry_delay_ms IS DISTINCT FROM 0
    )
  THEN
    RAISE EXCEPTION 'Retry failures require a bounded delay and terminal failures require zero delay'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'media-blob-cleanup-failure:' || p_failure_token::TEXT,
      0::BIGINT
    )
  );

  SELECT failures.*
  INTO recorded_failure
  FROM content.media_blob_cleanup_failures AS failures
  WHERE failures.failure_token = p_failure_token;

  IF FOUND THEN
    IF recorded_failure.cleanup_token IS DISTINCT FROM p_cleanup_token
      OR recorded_failure.cleanup_generation IS DISTINCT FROM
        p_cleanup_generation
      OR recorded_failure.lease_token IS DISTINCT FROM p_lease_token
      OR recorded_failure.disposition IS DISTINCT FROM p_disposition
      OR recorded_failure.retry_delay_ms IS DISTINCT FROM p_retry_delay_ms
      OR recorded_failure.phase IS DISTINCT FROM p_phase
      OR recorded_failure.error_code IS DISTINCT FROM p_error_code
      OR recorded_failure.error_class IS DISTINCT FROM p_error_class
    THEN
      RAISE EXCEPTION 'p_failure_token was reused with different cleanup failure parameters'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY
    SELECT
      CASE recorded_failure.disposition
        WHEN 'retry' THEN 'retry_scheduled'
        ELSE 'reconciliation_required'
      END,
      recorded_failure.next_attempt_at,
      recorded_failure.failure_count;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token;
  IF NOT FOUND OR attempt.cleanup_generation IS DISTINCT FROM p_cleanup_generation
  THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, 0;
    RETURN;
  END IF;

  SELECT lifecycles.*
  INTO lifecycle
  FROM content.media_blob_lifecycles AS lifecycles
  WHERE lifecycles.sha256 = attempt.sha256
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, attempt.failure_count;
    RETURN;
  END IF;

  SELECT attempts.*
  INTO attempt
  FROM content.media_blob_cleanup_attempts AS attempts
  WHERE attempts.cleanup_token = p_cleanup_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, 0;
    RETURN;
  END IF;

  IF attempt.state = 'completed' THEN
    RETURN QUERY
    SELECT 'completed'::TEXT, NULL::TIMESTAMPTZ, attempt.failure_count;
    RETURN;
  END IF;

  failure_time := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  IF attempt.state NOT IN ('authorized', 'deleting')
    OR attempt.lease_token IS DISTINCT FROM p_lease_token
    OR attempt.lease_expires_at <= failure_time
    OR lifecycle.cleanup_lease_token IS DISTINCT FROM p_lease_token
    OR lifecycle.cleanup_generation IS DISTINCT FROM p_cleanup_generation
    OR lifecycle.cleanup_lease_expires_at IS DISTINCT FROM
      'infinity'::TIMESTAMPTZ
  THEN
    RETURN QUERY
    SELECT 'stale'::TEXT, NULL::TIMESTAMPTZ, attempt.failure_count;
    RETURN;
  END IF;

  IF attempt.state = 'deleting' AND p_disposition = 'retry' THEN
    RAISE EXCEPTION
      'A deleting media-blob cleanup attempt cannot return to automatic retry'
      USING ERRCODE = '23514';
  END IF;

  recorded_failure_count := attempt.failure_count + 1;
  retry_at := CASE
    WHEN p_disposition = 'retry'
      THEN failure_time + (p_retry_delay_ms * interval '1 millisecond')
    ELSE NULL
  END;

  INSERT INTO content.media_blob_cleanup_failures (
    failure_token,
    cleanup_token,
    cleanup_generation,
    lease_token,
    disposition,
    retry_delay_ms,
    phase,
    next_attempt_at,
    failure_count,
    error_code,
    error_class,
    failed_at
  )
  VALUES (
    p_failure_token,
    p_cleanup_token,
    p_cleanup_generation,
    p_lease_token,
    p_disposition,
    p_retry_delay_ms,
    p_phase,
    retry_at,
    recorded_failure_count,
    p_error_code,
    p_error_class,
    failure_time
  );

  UPDATE content.media_blob_cleanup_attempts AS attempts
  SET
    state = CASE p_disposition
      WHEN 'retry' THEN 'retry_wait'
      ELSE 'reconciliation_required'
    END,
    lease_expires_at = failure_time,
    next_attempt_at = retry_at,
    failure_count = recorded_failure_count
  WHERE attempts.cleanup_token = p_cleanup_token;

  RETURN QUERY
  SELECT
    CASE p_disposition
      WHEN 'retry' THEN 'retry_scheduled'
      ELSE 'reconciliation_required'
    END,
    retry_at,
    recorded_failure_count;
END;
$$;

REVOKE ALL ON TABLE content.media_blob_cleanup_attempts
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON TABLE content.media_blob_cleanup_claims
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON TABLE content.media_blob_cleanup_renewals
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON TABLE content.media_blob_cleanup_failures
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.terminalize_media_blob_writers_before_workspace_delete()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION
  content.generated_media_promotion_cleanup_admission_internal()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.media_blob_cleanup_blocked_internal(TEXT)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.claim_media_blob_cleanup(TEXT, INTEGER)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.claim_next_media_blob_cleanup(UUID, INTEGER)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.authorize_media_blob_cleanup(UUID, BIGINT, UUID)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.complete_media_blob_cleanup(UUID, BIGINT, UUID)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.renew_media_blob_cleanup_lease(
  UUID,
  BIGINT,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  INTEGER
)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;
REVOKE ALL ON FUNCTION content.record_media_blob_cleanup_failure(
  UUID,
  BIGINT,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT
)
FROM PUBLIC, backend_app, auth_app, reporting_readonly;

GRANT EXECUTE ON FUNCTION content.claim_next_media_blob_cleanup(UUID, INTEGER)
TO backend_app;
GRANT EXECUTE ON FUNCTION content.authorize_media_blob_cleanup(UUID, BIGINT, UUID)
TO backend_app;
GRANT EXECUTE ON FUNCTION content.complete_media_blob_cleanup(UUID, BIGINT, UUID)
TO backend_app;
GRANT EXECUTE ON FUNCTION content.renew_media_blob_cleanup_lease(
  UUID,
  BIGINT,
  UUID,
  UUID,
  TEXT,
  TIMESTAMPTZ,
  INTEGER
)
TO backend_app;
GRANT EXECUTE ON FUNCTION content.record_media_blob_cleanup_failure(
  UUID,
  BIGINT,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT
)
TO backend_app;
