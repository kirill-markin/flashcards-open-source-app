-- Schemas touched/read explicitly: org, auth, pg_catalog.
ALTER TABLE org.user_settings
  ADD COLUMN paywall_intro_shown_at TIMESTAMPTZ,
  ADD COLUMN paywall_intro_local_date DATE,
  ADD COLUMN paywall_intro_time_zone TEXT,
  ADD COLUMN paywall_follow_up_shown_at TIMESTAMPTZ,
  ADD COLUMN paywall_last_shown_at TIMESTAMPTZ,
  ADD CONSTRAINT user_settings_paywall_intro_tuple CHECK (
    (paywall_intro_shown_at IS NULL AND paywall_intro_local_date IS NULL AND paywall_intro_time_zone IS NULL)
    OR (paywall_intro_shown_at IS NOT NULL AND paywall_intro_local_date IS NOT NULL
      AND paywall_intro_time_zone IS NOT NULL AND btrim(paywall_intro_time_zone) <> '')
  );

-- Account union already holds the lifecycle fences and both settings rows. Keep the fold inside
-- its narrow retirement helper, before the source becomes an unwritable retained alias.
CREATE OR REPLACE FUNCTION auth.record_account_retirement(
  source_user_id TEXT, target_user_id TEXT, target_retirement_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_retirement_id IS NULL THEN
    RAISE EXCEPTION 'Retirement requires a receipt id' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  WITH intro AS (
    SELECT paywall_intro_shown_at, paywall_intro_local_date, paywall_intro_time_zone
    FROM org.user_settings
    WHERE user_id IN (source_user_id, target_user_id) AND paywall_intro_shown_at IS NOT NULL
    ORDER BY paywall_intro_shown_at, paywall_intro_local_date, paywall_intro_time_zone COLLATE "C"
    LIMIT 1
  )
  UPDATE org.user_settings AS target SET
    paywall_intro_shown_at = (SELECT paywall_intro_shown_at FROM intro),
    paywall_intro_local_date = (SELECT paywall_intro_local_date FROM intro),
    paywall_intro_time_zone = (SELECT paywall_intro_time_zone FROM intro),
    paywall_follow_up_shown_at = LEAST(target.paywall_follow_up_shown_at, source.paywall_follow_up_shown_at),
    paywall_last_shown_at = GREATEST(target.paywall_last_shown_at, source.paywall_last_shown_at)
  FROM org.user_settings AS source
  WHERE target.user_id = target_user_id AND source.user_id = source_user_id;
  -- Version the retained shell to invalidate existing repeatable-read writers.
  UPDATE org.user_settings SET user_id = user_id WHERE user_id = source_user_id;
  UPDATE auth.account_retirements SET canonical_user_id = target_user_id WHERE canonical_user_id = source_user_id;
  INSERT INTO auth.account_retirements(retired_user_id, canonical_user_id, retirement_id)
  VALUES (source_user_id, target_user_id, target_retirement_id);
END;
$$;
REVOKE ALL ON FUNCTION auth.record_account_retirement(TEXT, TEXT, UUID)
  FROM PUBLIC, backend_app, auth_app, reporting_readonly;
