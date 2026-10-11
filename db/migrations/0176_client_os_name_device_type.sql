-- Migration status: Current / additive.
-- Introduces: os_name and device_type on sync.installations, support.feedback_prompt_events and
--   support.feedback_submissions, client_os_name and client_device_type on ai.chat_runs, and a
--   six-argument sync.claim_installation that stores the two installation facts while claiming.
-- Current guidance: these are the operating system family and the device class a native client
--   reports about itself, with the value domains of
--   db/migrations/0175_analytics_os_name_device_type.sql, whose lists live in
--   apps/backend/src/productAnalytics/catalog.ts. platform keeps naming the client build. NULL means
--   the request reported nothing, which is what the web client and every client released before
--   these fields always send. On sync.installations a claim that reports nothing keeps the stored
--   value rather than clearing it.
-- Current guidance: the four-argument sync.claim_installation from
--   db/migrations/0168_sync_claim_installation_concurrent_insert.sql stays unchanged, because the
--   backend deployed before this migration keeps calling it until the new one replaces it. Neither
--   overload declares DEFAULT arguments, so a call resolves to exactly one of them by its argument
--   count.
-- Schemas touched/read explicitly: sync, support, ai, security.
-- See also: db/migrations/0035_sync_installations_and_workspace_replicas.sql,
--   db/migrations/0052_in_app_feedback.sql, db/migrations/0136_ai_chat_run_client_platform.sql,
--   db/migrations/0141_sync_installation_automation_marker.sql,
--   db/migrations/0153_reporting_readonly_ai_chat_content.sql, docs/sync-identity-model.md,
--   docs/analytics-db-access.md.

-- Each ALTER below takes ACCESS EXCLUSIVE on its table and holds it until commit: it waits behind
-- every transaction holding a lock on that table, and every new statement on the table queues behind
-- the ALTER. The runner (apps/backend/src/database/migrationRunner.ts) sets no lock_timeout, so each
-- wait would otherwise be unbounded. 30s limits each table's lock wait separately, not the whole file;
-- past it the ALTER fails 55P03, the release fails, and a rerun retries the file. Every sync request
-- claims its sync.installations row inside its own transaction, so that table is altered last: sync
-- traffic queues behind at most its one bounded wait plus the fast statements after it. That order
-- also matches a feedback insert, which locks its support table and then sync.installations through
-- the installation_id foreign key.
SET LOCAL lock_timeout = '30s';

-- The support tables and sync.installations are small, so their constraints are added validated.
ALTER TABLE support.feedback_prompt_events
  ADD COLUMN os_name TEXT
    CONSTRAINT feedback_prompt_events_os_name_valid CHECK (
      os_name IS NULL
      OR os_name IN ('ios', 'ipados', 'macos', 'android')
    ),
  ADD COLUMN device_type TEXT
    CONSTRAINT feedback_prompt_events_device_type_valid CHECK (
      device_type IS NULL
      OR device_type IN ('phone', 'tablet', 'desktop', 'tv')
    );

COMMENT ON COLUMN support.feedback_prompt_events.os_name IS
  'Operating system family the client reported with the event, with the meaning of '
  'sync.installations.os_name. NULL means the client reported none.';

COMMENT ON COLUMN support.feedback_prompt_events.device_type IS
  'Device class the client reported with the event, with the meaning of '
  'sync.installations.device_type. NULL means the client reported none.';

ALTER TABLE support.feedback_submissions
  ADD COLUMN os_name TEXT
    CONSTRAINT feedback_submissions_os_name_valid CHECK (
      os_name IS NULL
      OR os_name IN ('ios', 'ipados', 'macos', 'android')
    ),
  ADD COLUMN device_type TEXT
    CONSTRAINT feedback_submissions_device_type_valid CHECK (
      device_type IS NULL
      OR device_type IN ('phone', 'tablet', 'desktop', 'tv')
    );

COMMENT ON COLUMN support.feedback_submissions.os_name IS
  'Operating system family the client reported with the submission, with the meaning of '
  'sync.installations.os_name. NULL means the client reported none.';

COMMENT ON COLUMN support.feedback_submissions.device_type IS
  'Device class the client reported with the submission, with the meaning of '
  'sync.installations.device_type. NULL means the client reported none.';

ALTER TABLE ai.chat_runs
  ADD COLUMN client_os_name TEXT,
  ADD COLUMN client_device_type TEXT;

-- Added NOT VALID for the reason 0175 gives: validating would hold the ACCESS EXCLUSIVE lock of this
-- ALTER TABLE across a whole-table scan only to confirm what the columns added empty just above
-- cannot violate. NOT VALID still enforces both rules on every future insert and update.
ALTER TABLE ai.chat_runs
  ADD CONSTRAINT chat_runs_client_os_name_valid CHECK (
    client_os_name IS NULL
    OR client_os_name IN ('ios', 'ipados', 'macos', 'android')
  ) NOT VALID,
  ADD CONSTRAINT chat_runs_client_device_type_valid CHECK (
    client_device_type IS NULL
    OR client_device_type IN ('phone', 'tablet', 'desktop', 'tv')
  ) NOT VALID;

COMMENT ON COLUMN ai.chat_runs.client_os_name IS
  'Operating system family the request that started this run named in its X-Client-Os-Name header, '
  'with the meaning of sync.installations.os_name. NULL means that request named none.';

COMMENT ON COLUMN ai.chat_runs.client_device_type IS
  'Device class the request that started this run named in its X-Client-Device-Type header, with the '
  'meaning of sync.installations.device_type. NULL means that request named none.';

-- 0153 granted ai.chat_runs to reporting as an explicit column list, so a column added after it
-- stays unreadable to reporting until its own migration names it. The support and sync tables are
-- granted whole, which already covers their new columns.
GRANT SELECT (client_os_name, client_device_type) ON TABLE ai.chat_runs TO reporting_readonly;

ALTER TABLE sync.installations
  ADD COLUMN os_name TEXT
    CONSTRAINT installations_os_name_valid CHECK (
      os_name IS NULL
      OR os_name IN ('ios', 'ipados', 'macos', 'android')
    ),
  ADD COLUMN device_type TEXT
    CONSTRAINT installations_device_type_valid CHECK (
      device_type IS NULL
      OR device_type IN ('phone', 'tablet', 'desktop', 'tv')
    );

COMMENT ON COLUMN sync.installations.os_name IS
  'Latest operating system family the installation reported on a sync request: ios, ipados, macos '
  'or android. A request that reports none keeps the stored value. NULL means it never reported one; '
  'the web client reports none.';

COMMENT ON COLUMN sync.installations.device_type IS
  'Latest device class the installation reported on a sync request: phone, tablet, desktop or tv. A '
  'request that reports none keeps the stored value. NULL means it never reported one; the web '
  'client reports none.';

-- 0168's definition, with the two installation facts added. The insert writes them as reported. The
-- claim keeps a stored value when the request reports none, so neither an older client nor the guest
-- upgrade merge, which carries no report of its own, ever erases one. The platform mismatch branch
-- writes nothing, as before.
CREATE FUNCTION sync.claim_installation(
  target_installation_id UUID,
  expected_platform TEXT,
  target_user_id TEXT,
  next_app_version TEXT,
  next_os_name TEXT,
  next_device_type TEXT
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
      os_name,
      device_type,
      last_seen_at
    )
    VALUES (
      target_installation_id,
      target_user_id,
      expected_platform,
      next_app_version,
      next_os_name,
      next_device_type,
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
    os_name = COALESCE(next_os_name, installations.os_name),
    device_type = COALESCE(next_device_type, installations.device_type),
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
    target_user_id,
    existing_installation.is_automation;
END;
$$;

REVOKE ALL ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO backend_app;
GRANT EXECUTE ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

COMMENT ON FUNCTION sync.claim_installation(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Claims one global installation for the current request-scoped user when the stored platform '
  'matches the incoming platform, stores the reported operating system family and device class '
  'without clearing a stored one when the request reports none, and returns the installation''s '
  'stored automation marker so the caller can apply its own declaration on top of it without '
  'un-declaring an earlier one.';
