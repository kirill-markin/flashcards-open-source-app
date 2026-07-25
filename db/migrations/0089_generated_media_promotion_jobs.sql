CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_workspace_card_id ON content.cards(workspace_id, card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_replicas_workspace_replica_id ON sync.workspace_replicas(workspace_id, replica_id);
CREATE TABLE content.generated_media_promotion_jobs (
  job_id               UUID        PRIMARY KEY,
  operation_id         UUID        NOT NULL UNIQUE,
  workspace_id         UUID        NOT NULL,
  card_id              UUID        NOT NULL,
  target_side          TEXT        NOT NULL CHECK (target_side IN ('front', 'back')),
  alt_text             TEXT        NOT NULL,
  media_asset_id       UUID        NOT NULL,
  replica_id           UUID        NOT NULL,
  staging_storage_key  TEXT        NOT NULL,
  blob_storage_key     TEXT        NOT NULL,
  sha256               TEXT        NOT NULL,
  mime_type            TEXT        NOT NULL,
  size_bytes           BIGINT      NOT NULL CHECK (size_bytes > 0),
  state                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'applied', 'failed')),
  retry_count          INTEGER     NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_attempt_at      TIMESTAMPTZ DEFAULT statement_timestamp(),
  lease_token          UUID,
  lease_owner          TEXT,
  lease_expires_at     TIMESTAMPTZ,
  last_error_code      TEXT,
  last_error_message   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  applied_at           TIMESTAMPTZ,
  CONSTRAINT generated_media_promotion_jobs_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  CONSTRAINT generated_media_promotion_jobs_card_workspace_fk
    FOREIGN KEY (workspace_id, card_id) REFERENCES content.cards(workspace_id, card_id)
    ON DELETE CASCADE,
  CONSTRAINT generated_media_promotion_jobs_replica_workspace_fk
    FOREIGN KEY (workspace_id, replica_id) REFERENCES sync.workspace_replicas(workspace_id, replica_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT generated_media_promotion_jobs_alt_text_safe
    CHECK (
      alt_text = btrim(alt_text)
      AND char_length(alt_text) BETWEEN 1 AND 2000
      AND alt_text !~ '[[:cntrl:]]'
    ),
  CONSTRAINT generated_media_promotion_jobs_sha256_normalized
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT generated_media_promotion_jobs_mime_type_normalized
    CHECK (
      mime_type = lower(btrim(mime_type))
      AND mime_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
    ),
  CONSTRAINT generated_media_promotion_jobs_staging_key_deterministic
    CHECK (
      staging_storage_key =
        'media/uploads/workspaces/' || lower(workspace_id::text)
        || '/assets/' || lower(media_asset_id::text)
        || '/operations/' || encode(public.digest(operation_id::text, 'sha256'), 'hex')
    ),
  CONSTRAINT generated_media_promotion_jobs_blob_key_deterministic
    CHECK (
      blob_storage_key =
        'media/blobs/sha256/' || substring(sha256 from 1 for 2)
        || '/' || substring(sha256 from 3 for 2) || '/' || sha256
    ),
  CONSTRAINT generated_media_promotion_jobs_error_safe
    CHECK (
      (last_error_code IS NULL AND last_error_message IS NULL)
      OR (
        last_error_code IS NOT NULL AND last_error_message IS NOT NULL
        AND last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
        AND last_error_message = btrim(last_error_message)
        AND char_length(last_error_message) BETWEEN 1 AND 500
        AND last_error_message !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT generated_media_promotion_jobs_timestamps_ordered
    CHECK (
      updated_at >= created_at
      AND (next_attempt_at IS NULL OR next_attempt_at >= created_at)
      AND (lease_expires_at IS NULL OR lease_expires_at > updated_at)
      AND (applied_at IS NULL OR applied_at >= created_at)
    ),
  CONSTRAINT generated_media_promotion_jobs_state_shape
    CHECK (
      (
        state = 'pending'
        AND next_attempt_at IS NOT NULL
        AND lease_token IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND applied_at IS NULL
      )
      OR (
        state = 'leased'
        AND next_attempt_at IS NOT NULL
        AND lease_token IS NOT NULL
        AND lease_owner IS NOT NULL
        AND lease_owner = btrim(lease_owner)
        AND btrim(lease_owner) <> ''
        AND char_length(lease_owner) <= 200
        AND lease_owner !~ '[[:cntrl:]]'
        AND lease_expires_at IS NOT NULL
        AND applied_at IS NULL
      )
      OR (
        state = 'applied'
        AND next_attempt_at IS NULL
        AND lease_token IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND last_error_code IS NULL
        AND applied_at IS NOT NULL
      )
      OR (
        state = 'failed'
        AND next_attempt_at IS NULL
        AND lease_token IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND last_error_code IS NOT NULL
        AND applied_at IS NULL
      )
    )
);
CREATE INDEX idx_generated_media_promotion_jobs_due
  ON content.generated_media_promotion_jobs(next_attempt_at, created_at, job_id) WHERE state = 'pending';
CREATE INDEX idx_generated_media_promotion_jobs_reclaim
  ON content.generated_media_promotion_jobs(lease_expires_at, created_at, job_id) WHERE state = 'leased';
CREATE FUNCTION content.prevent_generated_media_promotion_job_payload_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF to_jsonb(NEW) - ARRAY[
    'state', 'retry_count', 'next_attempt_at', 'lease_token', 'lease_owner',
    'lease_expires_at', 'last_error_code', 'last_error_message', 'updated_at', 'applied_at'
  ] IS DISTINCT FROM to_jsonb(OLD) - ARRAY[
    'state', 'retry_count', 'next_attempt_at', 'lease_token', 'lease_owner',
    'lease_expires_at', 'last_error_code', 'last_error_message', 'updated_at', 'applied_at'
  ] THEN
    RAISE EXCEPTION 'Generated-media promotion job payload is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER generated_media_promotion_jobs_payload_immutable
  BEFORE UPDATE ON content.generated_media_promotion_jobs
  FOR EACH ROW
  EXECUTE FUNCTION content.prevent_generated_media_promotion_job_payload_update();
REVOKE ALL ON FUNCTION content.prevent_generated_media_promotion_job_payload_update() FROM PUBLIC;
CREATE FUNCTION content.claim_generated_media_promotion_jobs(
  p_lease_owner TEXT, p_lease_duration_ms INTEGER, p_limit INTEGER)
RETURNS SETOF content.generated_media_promotion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
  RETURN QUERY
  WITH claimable AS (
    SELECT jobs.job_id
    FROM content.generated_media_promotion_jobs AS jobs
    WHERE (
      jobs.state = 'pending'
      AND jobs.next_attempt_at <= statement_timestamp()
    ) OR (
      jobs.state = 'leased'
      AND jobs.lease_expires_at <= statement_timestamp()
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
    lease_token = gen_random_uuid(),
    lease_owner = p_lease_owner,
    lease_expires_at =
      statement_timestamp() + (p_lease_duration_ms * interval '1 millisecond'),
    updated_at = statement_timestamp()
  FROM claimable
  WHERE jobs.job_id = claimable.job_id
  RETURNING jobs.*;
END;
$$;
CREATE FUNCTION content.mark_generated_media_promotion_job_applied(
  p_job_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH transitioned AS (
    UPDATE content.generated_media_promotion_jobs
    SET
      state = 'applied',
      next_attempt_at = NULL,
      lease_token = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = statement_timestamp(),
      applied_at = statement_timestamp()
    WHERE job_id = p_job_id
      AND state = 'leased'
      AND lease_token = p_lease_token
      AND lease_expires_at > statement_timestamp()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM transitioned);
$$;
CREATE FUNCTION content.reschedule_generated_media_promotion_job(
  p_job_id UUID, p_lease_token UUID, p_next_attempt_at TIMESTAMPTZ,
  p_error_code TEXT, p_error_message TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH transitioned AS (
    UPDATE content.generated_media_promotion_jobs
    SET
      state = 'pending',
      retry_count = retry_count + 1,
      next_attempt_at = p_next_attempt_at,
      lease_token = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      last_error_message = p_error_message,
      updated_at = statement_timestamp()
    WHERE job_id = p_job_id
      AND state = 'leased'
      AND lease_token = p_lease_token
      AND lease_expires_at > statement_timestamp()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM transitioned);
$$;
CREATE FUNCTION content.fail_generated_media_promotion_job(
  p_job_id UUID, p_lease_token UUID, p_error_code TEXT, p_error_message TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH transitioned AS (
    UPDATE content.generated_media_promotion_jobs
    SET
      state = 'failed',
      next_attempt_at = NULL,
      lease_token = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      last_error_message = p_error_message,
      updated_at = statement_timestamp()
    WHERE job_id = p_job_id
      AND state = 'leased'
      AND lease_token = p_lease_token
      AND lease_expires_at > statement_timestamp()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM transitioned);
$$;
ALTER TABLE content.generated_media_promotion_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY generated_media_promotion_jobs_scoped_select_runtime
  ON content.generated_media_promotion_jobs FOR SELECT TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id));
CREATE POLICY generated_media_promotion_jobs_scoped_insert_runtime
  ON content.generated_media_promotion_jobs FOR INSERT TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id));
REVOKE ALL ON content.generated_media_promotion_jobs
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
GRANT SELECT (
  job_id, operation_id, workspace_id, card_id, target_side, alt_text,
  media_asset_id, replica_id, staging_storage_key, blob_storage_key,
  sha256, mime_type, size_bytes
) ON content.generated_media_promotion_jobs TO backend_app;
GRANT INSERT (
  job_id, operation_id, workspace_id, card_id, target_side, alt_text,
  media_asset_id, replica_id, staging_storage_key, blob_storage_key,
  sha256, mime_type, size_bytes
) ON content.generated_media_promotion_jobs TO backend_app;
REVOKE ALL ON FUNCTION content.claim_generated_media_promotion_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.mark_generated_media_promotion_job_applied(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.reschedule_generated_media_promotion_job(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content.fail_generated_media_promotion_job(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.claim_generated_media_promotion_jobs(TEXT, INTEGER, INTEGER) TO backend_app;
GRANT EXECUTE ON FUNCTION content.mark_generated_media_promotion_job_applied(UUID, UUID) TO backend_app;
GRANT EXECUTE ON FUNCTION content.reschedule_generated_media_promotion_job(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION content.fail_generated_media_promotion_job(UUID, UUID, TEXT, TEXT) TO backend_app;
