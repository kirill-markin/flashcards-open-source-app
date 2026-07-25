-- Migration status: Current / additive.
-- Introduces: exact-lease-fenced workspace scope initialization for the internal promotion worker.
-- Schemas touched/read explicitly: content, org, pg_catalog.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM content.generated_media_promotion_jobs) THEN
    RAISE EXCEPTION 'generated_media_promotion_jobs must be empty before adding enqueueing principals';
  END IF;
END
$$;
ALTER TABLE content.generated_media_promotion_jobs ADD COLUMN user_id TEXT NOT NULL;
COMMENT ON COLUMN content.generated_media_promotion_jobs.user_id IS
  'Immutable enqueueing principal used to authorize the deferred promotion transaction.';
GRANT SELECT (user_id), INSERT (user_id) ON content.generated_media_promotion_jobs TO backend_app;
CREATE FUNCTION content.apply_generated_media_promotion_job_scope(
  p_job_id UUID, p_lease_token UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  scoped_user_id TEXT;
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
  PERFORM pg_advisory_xact_lock(
    hashtextextended(scoped_user_id || ':' || scoped_workspace_id::TEXT, 0::BIGINT));
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
  PERFORM 1 FROM org.workspace_memberships AS memberships
  WHERE memberships.workspace_id = scoped_workspace_id
    AND memberships.user_id = scoped_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN 'access_revoked';
  END IF;
  PERFORM set_config('app.user_id', scoped_user_id, true);
  PERFORM set_config('app.workspace_id', scoped_workspace_id::TEXT, true);
  RETURN 'scoped';
END;
$$;
COMMENT ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) IS
  'Reports lease/access status and applies an active generated-media job enqueueing principal scope to the current transaction.';
REVOKE ALL ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.apply_generated_media_promotion_job_scope(UUID, UUID) TO backend_app;
