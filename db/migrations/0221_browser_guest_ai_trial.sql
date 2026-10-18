-- Schemas touched/read explicitly: ai, auth, org, pg_catalog.
ALTER TABLE ai.chat_runs ADD COLUMN browser_guest_ai_trial BOOLEAN NOT NULL DEFAULT false;

-- No foreign key: erasure and conversion retain shared consumption.
CREATE TABLE ai.browser_guest_trial_reservations (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 200),
  user_id TEXT NOT NULL CHECK (btrim(user_id) <> ''),
  feature TEXT NOT NULL CHECK (feature IN ('chat', 'dictation', 'images')),
  units INTEGER NOT NULL CHECK (units > 0),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  budget_day DATE NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'provider_started', 'released_no_call'))
);
CREATE INDEX ON ai.browser_guest_trial_reservations(user_id, feature) WHERE state <> 'released_no_call';
CREATE INDEX ON ai.browser_guest_trial_reservations(budget_day, feature) WHERE state <> 'released_no_call';
ALTER TABLE ai.browser_guest_trial_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai.browser_guest_trial_reservations FROM PUBLIC, backend_app, auth_app, reporting_readonly;

-- The database owns these numbers; the response publishes this same policy.
CREATE FUNCTION ai.browser_guest_trial_policy()
RETURNS TABLE(feature TEXT, lifetime_limit INTEGER, shared_daily_limit INTEGER, max_recording_seconds INTEGER)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT policy.*, 120 FROM (VALUES ('chat'::TEXT, 5, 100), ('dictation'::TEXT, 1800, 18000),
    ('images'::TEXT, 5, 100)) AS policy(feature, lifetime_limit, shared_daily_limit);
$$;
REVOKE ALL ON FUNCTION ai.browser_guest_trial_policy() FROM PUBLIC, backend_app, auth_app, reporting_readonly;

CREATE FUNCTION ai.assert_browser_guest_trial_eligible(authenticated_session_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE owner_id TEXT := current_setting('app.user_id');
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Browser guest allowances require READ COMMITTED' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_account_write_scope(owner_id);
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('auth.account:' || owner_id, 2::BIGINT)) THEN
    RAISE EXCEPTION 'Guest identity lifecycle is changing; retry with fresh authorization' USING ERRCODE = 'P0A01';
  END IF;
  PERFORM auth.assert_account_live(owner_id);
  -- A merged guest has no retirement/deletion tombstone; its missing profile/session is terminal.
  PERFORM 1 FROM org.user_settings WHERE user_id = owner_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Browser guest owner changed; retry with fresh authorization' USING ERRCODE = 'P0A01';
  END IF;
  -- Forget can revoke without taking the account lifecycle lock.
  PERFORM 1 FROM auth.guest_sessions WHERE session_id = authenticated_session_id AND user_id = owner_id
    AND revoked_at IS NULL AND purpose = 'browser_product' AND platform = 'web' FOR SHARE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.user_identities
    WHERE user_id = owner_id AND provider_type = 'cognito') THEN
    RAISE EXCEPTION 'Browser guest session is no longer active and unbound; retry with fresh authorization'
      USING ERRCODE = 'P0A01';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION ai.assert_browser_guest_trial_eligible(UUID) FROM PUBLIC, backend_app, auth_app, reporting_readonly;

CREATE FUNCTION ai.read_browser_guest_trial(authenticated_session_id UUID)
RETURNS TABLE(feature TEXT, lifetime_limit INTEGER, lifetime_remaining INTEGER, shared_daily_limit INTEGER,
  shared_remaining INTEGER, resets_at TIMESTAMPTZ, max_recording_seconds INTEGER)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM ai.assert_browser_guest_trial_eligible(authenticated_session_id);
  RETURN QUERY
  WITH day AS (SELECT (clock_timestamp() AT TIME ZONE 'UTC')::DATE AS value)
  SELECT policy.feature, policy.lifetime_limit,
    greatest(0::BIGINT, policy.lifetime_limit - COALESCE(sum(ledger.units) FILTER (
      WHERE ledger.user_id = current_setting('app.user_id')), 0))::INTEGER,
    policy.shared_daily_limit,
    greatest(0::BIGINT, policy.shared_daily_limit - COALESCE(sum(ledger.units) FILTER (
      WHERE ledger.budget_day = day.value), 0))::INTEGER,
    (day.value + 1)::TIMESTAMP AT TIME ZONE 'UTC', policy.max_recording_seconds
  FROM ai.browser_guest_trial_policy() AS policy CROSS JOIN day
  LEFT JOIN ai.browser_guest_trial_reservations AS ledger ON ledger.feature = policy.feature
    AND ledger.state <> 'released_no_call'
    AND (ledger.user_id = current_setting('app.user_id') OR ledger.budget_day = day.value)
  GROUP BY policy.feature, policy.lifetime_limit, policy.shared_daily_limit, policy.max_recording_seconds, day.value;
END;
$$;
REVOKE ALL ON FUNCTION ai.read_browser_guest_trial(UUID) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.read_browser_guest_trial(UUID) TO backend_app;

CREATE FUNCTION ai.reserve_browser_guest_trial(authenticated_session_id UUID,
  operation TEXT, requested_feature TEXT, requested_units INTEGER, payload TEXT)
RETURNS TABLE(outcome TEXT, reservation_state TEXT, quota_scope TEXT, resets_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE owner_id TEXT := current_setting('app.user_id'); receipt ai.browser_guest_trial_reservations%ROWTYPE;
  policy RECORD; budget RECORD; today DATE;
BEGIN
  PERFORM ai.assert_browser_guest_trial_eligible(authenticated_session_id);
  SELECT * INTO policy FROM ai.browser_guest_trial_policy() WHERE feature = requested_feature;
  IF NOT FOUND OR operation IS NULL OR length(operation) NOT BETWEEN 1 AND 200 OR payload IS NULL
    OR payload !~ '^[0-9a-f]{64}$' OR requested_units IS NULL OR requested_units < 1
    OR (requested_feature <> 'dictation' AND requested_units <> 1)
    OR (requested_feature = 'dictation' AND requested_units > policy.max_recording_seconds) THEN
    RAISE EXCEPTION 'Invalid browser guest reservation identity, feature, payload or units' USING ERRCODE = '23514';
  END IF;
  -- Account writer fences precede this one fleet-wide ledger lock, including identity rewrites.
  -- READ COMMITTED gives the reads below a fresh snapshot after waiting for a previous reservation.
  PERFORM pg_advisory_xact_lock(hashtextextended('ai.browser_guest_trial', 0::BIGINT));
  SELECT * INTO receipt FROM ai.browser_guest_trial_reservations WHERE operation_id = operation;
  IF FOUND THEN
    IF ROW(receipt.user_id, receipt.feature, receipt.units, receipt.payload_sha256)
      IS DISTINCT FROM ROW(owner_id, requested_feature, requested_units, payload) THEN
      RETURN QUERY SELECT 'conflict'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
    ELSE
      RETURN QUERY SELECT 'duplicate'::TEXT, receipt.state, NULL::TEXT, NULL::TIMESTAMPTZ;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO STRICT budget FROM ai.read_browser_guest_trial(authenticated_session_id) WHERE feature = requested_feature;
  IF budget.lifetime_remaining < requested_units THEN
    RETURN QUERY SELECT 'quota'::TEXT, NULL::TEXT, 'guest'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;
  IF budget.shared_remaining < requested_units THEN
    RETURN QUERY SELECT 'quota'::TEXT, NULL::TEXT, 'shared'::TEXT, budget.resets_at;
    RETURN;
  END IF;
  today := (budget.resets_at AT TIME ZONE 'UTC')::DATE - 1;
  INSERT INTO ai.browser_guest_trial_reservations(operation_id, user_id, feature, units, payload_sha256, budget_day)
  VALUES (operation, owner_id, requested_feature, requested_units, payload, today);
  RETURN QUERY SELECT 'reserved'::TEXT, 'reserved'::TEXT, NULL::TEXT, NULL::TIMESTAMPTZ;
END;
$$;
REVOKE ALL ON FUNCTION ai.reserve_browser_guest_trial(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.reserve_browser_guest_trial(UUID, TEXT, TEXT, INTEGER, TEXT) TO backend_app;

-- Mark before calling the provider. Any subsequent uncertainty remains charged; it is never released.
CREATE FUNCTION ai.start_browser_guest_trial_provider(authenticated_session_id UUID,
  operation TEXT, requested_feature TEXT, requested_units INTEGER, payload TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM ai.assert_browser_guest_trial_eligible(authenticated_session_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('ai.browser_guest_trial', 0::BIGINT));
  UPDATE ai.browser_guest_trial_reservations SET state = 'provider_started'
    WHERE operation_id = operation AND user_id = current_setting('app.user_id')
      AND feature = requested_feature AND units = requested_units AND payload_sha256 = payload AND state = 'reserved';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ai.start_browser_guest_trial_provider(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.start_browser_guest_trial_provider(UUID, TEXT, TEXT, INTEGER, TEXT) TO backend_app;

CREATE FUNCTION ai.release_browser_guest_trial_no_call(operation TEXT, requested_feature TEXT, requested_units INTEGER, payload TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.assert_account_write_scope(current_setting('app.user_id'));
  PERFORM pg_advisory_xact_lock(hashtextextended('ai.browser_guest_trial', 0::BIGINT));
  UPDATE ai.browser_guest_trial_reservations SET state = 'released_no_call'
    WHERE operation_id = operation AND user_id = current_setting('app.user_id')
      AND feature = requested_feature AND units = requested_units AND payload_sha256 = payload AND state = 'reserved';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ai.release_browser_guest_trial_no_call(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.release_browser_guest_trial_no_call(TEXT, TEXT, INTEGER, TEXT) TO backend_app;

CREATE FUNCTION ai.transfer_browser_guest_trial(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ai.browser_guest_trial', 0::BIGINT));
  UPDATE ai.browser_guest_trial_reservations SET user_id = target_user_id WHERE user_id = source_user_id;
END;
$$;
REVOKE ALL ON FUNCTION ai.transfer_browser_guest_trial(TEXT, TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.transfer_browser_guest_trial(TEXT, TEXT) TO backend_app;

CREATE FUNCTION ai.anonymize_browser_guest_trial(person_user_ids TEXT[], anonymous_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ai.browser_guest_trial', 0::BIGINT));
  UPDATE ai.browser_guest_trial_reservations SET user_id = anonymous_user_id,
    operation_id = gen_random_uuid()::TEXT, payload_sha256 = repeat('0', 64)
    WHERE user_id = ANY(person_user_ids);
END;
$$;
REVOKE ALL ON FUNCTION ai.anonymize_browser_guest_trial(TEXT[], TEXT) FROM PUBLIC, auth_app, reporting_readonly;
GRANT EXECUTE ON FUNCTION ai.anonymize_browser_guest_trial(TEXT[], TEXT) TO backend_app;

CREATE OR REPLACE FUNCTION ai.transfer_account_usage(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  UPDATE ai.usage_events SET user_id = target_user_id WHERE user_id = source_user_id;
  PERFORM ai.transfer_browser_guest_trial(source_user_id, target_user_id);
END;
$$;
REVOKE ALL ON FUNCTION ai.transfer_account_usage(TEXT, TEXT) FROM PUBLIC, backend_app, auth_app, reporting_readonly;
