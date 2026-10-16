-- Schemas touched/read explicitly: auth, org, pg_catalog.
CREATE OR REPLACE FUNCTION auth.assert_account_write_scope(target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_user_id IS NULL OR btrim(target_user_id) = '' THEN
    RAISE EXCEPTION 'An explicit account scope is required' USING ERRCODE = '23514';
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('auth.account_writer:' || target_user_id, 2::BIGINT)) THEN
    RAISE EXCEPTION 'Account retirement is in progress; reload the account and retry' USING ERRCODE = 'P0A01';
  END IF;
  -- Retirement versions the retained profile without changing its key. Lock with writer strength
  -- up front to detect stale writable snapshots without a later shared-to-writer lock upgrade.
  IF current_setting('transaction_isolation') <> 'read committed' AND current_setting('transaction_read_only') <> 'on' THEN
    BEGIN
      PERFORM 1 FROM org.user_settings WHERE user_id = target_user_id FOR NO KEY UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Writable snapshot has no account; restart with fresh authorization' USING ERRCODE = 'P0A01';
      END IF;
    EXCEPTION WHEN serialization_failure THEN
      RAISE EXCEPTION 'Account snapshot changed; reload the account and retry' USING ERRCODE = 'P0A01';
    END;
  END IF;
  IF auth.canonical_account_id(target_user_id) IS DISTINCT FROM target_user_id THEN
    RAISE EXCEPTION 'Account scope was retired; reload the canonical account and retry' USING ERRCODE = 'P0A01';
  END IF;
END;
$$;
