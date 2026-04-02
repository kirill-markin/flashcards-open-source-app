-- Migration status: Current / canonical.
-- Introduces: a narrow installation-claim primitive for controlled ownership handoff across accounts.
-- Current guidance: runtime RLS on sync.installations stays strict; account handoff uses this audited SECURITY DEFINER function instead of broad UPDATE access.
-- See also: db/migrations/0035_sync_installations_and_workspace_replicas.sql, docs/sync-identity-model.md.

CREATE OR REPLACE FUNCTION sync.claim_installation(
  target_installation_id UUID,
  expected_platform TEXT,
  target_user_id TEXT,
  next_app_version TEXT
)
RETURNS TABLE (
  claim_status TEXT,
  installation_id UUID,
  platform TEXT,
  previous_user_id TEXT,
  current_user_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_installation sync.installations%ROWTYPE;
  next_claim_status TEXT;
BEGIN
  IF target_user_id IS DISTINCT FROM security.current_user_id() THEN
    RAISE EXCEPTION 'sync.claim_installation target_user_id must match security.current_user_id()'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO existing_installation
  FROM sync.installations
  WHERE installations.installation_id = target_installation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO sync.installations (
      installation_id,
      user_id,
      platform,
      app_version,
      last_seen_at
    )
    VALUES (
      target_installation_id,
      target_user_id,
      expected_platform,
      next_app_version,
      now()
    );

    RETURN QUERY
    SELECT
      'inserted'::TEXT,
      target_installation_id,
      expected_platform,
      NULL::TEXT,
      target_user_id;
    RETURN;
  END IF;

  IF existing_installation.platform <> expected_platform THEN
    RETURN QUERY
    SELECT
      'platform_mismatch'::TEXT,
      existing_installation.installation_id,
      existing_installation.platform,
      existing_installation.user_id,
      existing_installation.user_id;
    RETURN;
  END IF;

  UPDATE sync.installations
  SET
    user_id = target_user_id,
    app_version = next_app_version,
    last_seen_at = now()
  WHERE installations.installation_id = target_installation_id;

  next_claim_status := CASE
    WHEN existing_installation.user_id = target_user_id THEN 'refreshed'
    ELSE 'reassigned'
  END;

  RETURN QUERY
  SELECT
    next_claim_status,
    existing_installation.installation_id,
    existing_installation.platform,
    existing_installation.user_id,
    target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) TO auth_app;

COMMENT ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) IS
  'Claims one global installation for the current request-scoped user when the stored platform matches the incoming platform.';
