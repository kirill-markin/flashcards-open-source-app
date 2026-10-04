-- Migration status: Current / canonical.
-- Replaces or corrects: the not-found branch of sync.claim_installation from
-- db/migrations/0141_sync_installation_automation_marker.sql, which failed the later of two
-- concurrent first claims of one installation with a unique violation on installations_pkey.
-- Current guidance: under READ COMMITTED, concurrent first claims of one installation no longer fail
-- with a unique violation. The one whose insert lands reports `inserted`; every other one that finds
-- the row it lost to continues exactly as if it had found it first.
-- Schemas touched/read explicitly: sync, security.
-- See also: db/migrations/0035_sync_installations_and_workspace_replicas.sql,
-- db/migrations/0039_sync_installation_claim.sql, docs/sync-identity-model.md.

-- With no row to lock, SELECT ... FOR UPDATE blocks nothing, so two transactions claiming an
-- installation that does not exist yet both reach the insert. ON CONFLICT DO NOTHING makes the later
-- insert wait for the earlier transaction to end: if it committed, the insert skips the row instead of
-- raising 23505; if it rolled back, the insert goes ahead. A call that skipped re-reads the row under
-- FOR UPDATE and continues through the same platform check and claim as a call that found it first.
-- Under READ COMMITTED that re-read takes a new snapshot and sees the committed row. Under REPEATABLE
-- READ or SERIALIZABLE, PostgreSQL rejects the conflicting insert itself with a serialization failure
-- (40001), because the row it would skip is invisible to the transaction's snapshot.
--
-- The conflict target names the constraint rather than the column because a column name there
-- resolves like any other column reference, and `installation_id` is also an output column of this
-- function, which PL/pgSQL reports as ambiguous.
--
-- CREATE OR REPLACE with the argument types and RETURNS TABLE column list of 0141 keeps the
-- function's OID, so its owner, its grants and its comment carry over unchanged. LANGUAGE, SECURITY
-- DEFINER and SET search_path do not carry over and are restated.
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
    )
    ON CONFLICT ON CONSTRAINT installations_pkey DO NOTHING;

    IF FOUND THEN
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

    SELECT *
    INTO existing_installation
    FROM sync.installations
    WHERE installations.installation_id = target_installation_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sync.claim_installation installation % conflicted on insert but was deleted before it could be locked',
        target_installation_id
        USING ERRCODE = 'P0001';
    END IF;
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
