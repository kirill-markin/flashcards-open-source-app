-- Migration status: Current / canonical.
-- Introduces: the automation marker a client declares about its own installation, and the claim
-- primitive reading that marker back so the request that claims an installation learns what it
-- already declared.
-- Current guidance: the marker is set by a client declaration and never cleared, and both the
-- server-derived product analytics producers and the client ingest refuse to report anything a
-- marked installation does.
-- Schemas touched/read explicitly: sync.
-- See also: db/migrations/0035_sync_installations_and_workspace_replicas.sql,
-- db/migrations/0039_sync_installation_claim.sql, docs/sync-identity-model.md,
-- docs/analytics-audience.md.

ALTER TABLE sync.installations
  ADD COLUMN is_automation BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sync.installations.is_automation IS
  'The installation declared itself to be running under automation, so nothing it does is product '
  'analytics. Only a client declaration sets it, and nothing clears it: an installation that ran '
  'automation once never becomes a person afterwards. FALSE is both "declared nothing" and "predates '
  'the contract", which is what every already released client reports.';

-- The claim now hands the stored marker back to its caller.
--
-- Without it the caller knows only what this one request said about itself, and a client that
-- declares automation when it registers and says nothing on its next sync push would have that
-- request treated as a person's: the stored column stays TRUE, but the facts the same request
-- collects are attributed from its own body. Returning the marker lets the caller apply
-- `stored OR declared` from a row it already read under FOR UPDATE, with no extra statement and no
-- write on a request that declares nothing.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list, so the function is dropped first.
-- Dropping it drops its grants and its comment with it, and all of them are recreated below.
-- scripts/deploy/migrate.sh applies each file with psql --single-transaction, so the drop and the
-- create commit together and no caller ever observes the gap between them: every other session
-- reads the catalog under its own snapshot and sees either the old function or the new one, never
-- neither. Nothing blocks a concurrent claim, because executing a function takes no lock on it, so
-- the same two statements split across separate transactions would instead fail calls in flight
-- with `cache lookup failed for function`; they have to stay in one transaction. The
-- already deployed backend then keeps working against the new signature because it selects an
-- explicit column list from this function rather than SELECT *.
DROP FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION sync.claim_installation(
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
  current_user_id TEXT,
  is_automation BOOLEAN
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
      target_user_id,
      -- An installation seen for the first time has declared nothing yet. This request's own
      -- declaration, if it made one, is the caller's to apply on top.
      FALSE;
    RETURN;
  END IF;

  IF existing_installation.platform <> expected_platform THEN
    RETURN QUERY
    SELECT
      'platform_mismatch'::TEXT,
      existing_installation.installation_id,
      existing_installation.platform,
      existing_installation.user_id,
      existing_installation.user_id,
      existing_installation.is_automation;
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

  -- Read before the update above and unchanged by it: this statement never writes the marker, which
  -- is what keeps setting it a client declaration rather than a side effect of claiming a row.
  RETURN QUERY
  SELECT
    next_claim_status,
    existing_installation.installation_id,
    existing_installation.platform,
    existing_installation.user_id,
    target_user_id,
    existing_installation.is_automation;
END;
$$;

REVOKE ALL ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) TO auth_app;

COMMENT ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT) IS
  'Claims one global installation for the current request-scoped user when the stored platform '
  'matches the incoming platform, and returns the installation''s stored automation marker so the '
  'caller can apply its own declaration on top of it without un-declaring an earlier one.';
