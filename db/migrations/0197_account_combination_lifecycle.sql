-- Schemas touched/read explicitly: auth, org, security, pg_catalog.
-- No runtime mutation grant: proof, data union and public combination are separate prerequisites.
CREATE TABLE auth.account_retirements (
  retired_user_id TEXT PRIMARY KEY CHECK (btrim(retired_user_id) <> ''),
  canonical_user_id TEXT NOT NULL CHECK (btrim(canonical_user_id) <> ''),
  retirement_id UUID NOT NULL UNIQUE,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (retired_user_id <> canonical_user_id)
);
CREATE INDEX ON auth.account_retirements(canonical_user_id);
REVOKE ALL ON auth.account_retirements FROM PUBLIC, backend_app, auth_app;

-- Receipts survive profile erasure. There is one edge to a live owner, never recursive resolution.
CREATE FUNCTION auth.canonical_account_id(target_user_id TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE((SELECT canonical_user_id FROM auth.account_retirements
    WHERE retired_user_id = target_user_id), target_user_id);
$$;
REVOKE ALL ON FUNCTION auth.canonical_account_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.canonical_account_id(TEXT) TO backend_app, auth_app;

CREATE FUNCTION auth.assert_flat_account_retirements() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.account_retirements AS incoming
    JOIN auth.account_retirements AS outgoing ON outgoing.retired_user_id = incoming.canonical_user_id) THEN
    RAISE EXCEPTION 'Account retirement must point directly to a live owner' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_flat_account_retirements() FROM PUBLIC, backend_app, auth_app;
CREATE CONSTRAINT TRIGGER account_retirements_flat AFTER INSERT OR UPDATE ON auth.account_retirements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION auth.assert_flat_account_retirements();

-- A separate key avoids upgrading the existing exclusive account lifecycle lock. Try both sides:
-- a scope may already own a row/account lock, or later need a subject held by a retirement caller.
CREATE FUNCTION auth.assert_account_write_scope(target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_user_id IS NULL OR btrim(target_user_id) = '' THEN
    RAISE EXCEPTION 'An explicit account scope is required' USING ERRCODE = '23514';
  END IF;
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('auth.account_writer:' || target_user_id, 2::BIGINT)) THEN
    RAISE EXCEPTION 'Account retirement is in progress; reload the account and retry' USING ERRCODE = 'P0A01';
  END IF;
  -- Advisory locks cannot refresh a repeatable-read snapshot. The retirement commit versions the
  -- retained source profile; locking that tuple detects an old writable snapshot before any SQL.
  IF current_setting('transaction_isolation') <> 'read committed' AND current_setting('transaction_read_only') <> 'on' THEN
    BEGIN
      PERFORM 1 FROM org.user_settings WHERE user_id = target_user_id FOR KEY SHARE;
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
REVOKE ALL ON FUNCTION auth.assert_account_write_scope(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.assert_account_write_scope(TEXT) TO backend_app, auth_app;

CREATE OR REPLACE FUNCTION auth.assert_account_live(target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.deleted_accounts
    WHERE user_id_sha256 = encode(sha256(convert_to(target_user_id, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Application account has been deleted' USING ERRCODE = '23514';
  END IF;
  IF auth.canonical_account_id(target_user_id) IS DISTINCT FROM target_user_id THEN
    RAISE EXCEPTION 'Account was retired; reload the canonical account and retry' USING ERRCODE = 'P0A01';
  END IF;
END;
$$;

-- Private preparation for the future union transaction. First operation, before any common scope:
-- inventory -> sorted subjects -> nonblocking exclusive writer fences -> sorted account locks.
-- Revalidation refuses newly observed subjects instead of acquiring them after account locks.
CREATE FUNCTION auth.lock_account_retirement(source_user_id TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_ids TEXT[]; subjects TEXT[]; fresh_accounts TEXT[]; fresh_subjects TEXT[]; item TEXT;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account retirement requires a fresh read-committed transaction' USING ERRCODE = 'P0A01';
  END IF;
  IF source_user_id IS NULL OR target_user_id IS NULL OR btrim(source_user_id) = '' OR btrim(target_user_id) = ''
    OR source_user_id = target_user_id THEN
    RAISE EXCEPTION 'Retirement requires two distinct live accounts' USING ERRCODE = '23514';
  END IF;
  SELECT array_agg(user_id ORDER BY user_id) INTO account_ids FROM (
    SELECT source_user_id AS user_id UNION SELECT target_user_id
    UNION SELECT retired_user_id FROM auth.account_retirements WHERE canonical_user_id IN (source_user_id, target_user_id)
  ) AS accounts;
  SELECT COALESCE(array_agg(provider_subject ORDER BY provider_subject), ARRAY[]::TEXT[]) INTO subjects
  FROM auth.user_identities WHERE provider_type = 'cognito' AND user_id = ANY(account_ids);
  FOREACH item IN ARRAY subjects LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || item, 2::BIGINT));
  END LOOP;
  FOREACH item IN ARRAY account_ids LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('auth.account_writer:' || item, 2::BIGINT)) THEN
      RAISE EXCEPTION 'Account has an active scope; restart retirement after it finishes' USING ERRCODE = 'P0A01';
    END IF;
  END LOOP;
  FOREACH item IN ARRAY account_ids LOOP
    PERFORM auth.lock_account_lifecycle(item);
  END LOOP;
  SELECT array_agg(user_id ORDER BY user_id) INTO fresh_accounts FROM (
    SELECT source_user_id AS user_id UNION SELECT target_user_id
    UNION SELECT retired_user_id FROM auth.account_retirements WHERE canonical_user_id IN (source_user_id, target_user_id)
  ) AS accounts;
  SELECT COALESCE(array_agg(provider_subject ORDER BY provider_subject), ARRAY[]::TEXT[]) INTO fresh_subjects
  FROM auth.user_identities WHERE provider_type = 'cognito' AND user_id = ANY(fresh_accounts);
  IF fresh_accounts IS DISTINCT FROM account_ids OR fresh_subjects IS DISTINCT FROM subjects THEN
    RAISE EXCEPTION 'Account identity inventory changed; restart retirement' USING ERRCODE = 'P0A01';
  END IF;
  PERFORM auth.assert_account_live(source_user_id);
  PERFORM auth.assert_account_live(target_user_id);
  IF (SELECT count(*) FROM org.user_settings WHERE user_id IN (source_user_id, target_user_id)) <> 2 THEN
    RAISE EXCEPTION 'Retirement requires both existing account profiles' USING ERRCODE = '23503';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_account_retirement(TEXT, TEXT) FROM PUBLIC, backend_app, auth_app;

CREATE FUNCTION auth.record_account_retirement(source_user_id TEXT, target_user_id TEXT, target_retirement_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_retirement_id IS NULL THEN
    RAISE EXCEPTION 'Retirement requires a receipt id' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_account_retirement(source_user_id, target_user_id);
  -- Keep the shell and change its tuple version for existing repeatable-read writers.
  UPDATE org.user_settings SET user_id = user_id WHERE user_id = source_user_id;
  UPDATE auth.account_retirements SET canonical_user_id = target_user_id WHERE canonical_user_id = source_user_id;
  INSERT INTO auth.account_retirements(retired_user_id, canonical_user_id, retirement_id)
  VALUES (source_user_id, target_user_id, target_retirement_id);
END;
$$;
REVOKE ALL ON FUNCTION auth.record_account_retirement(TEXT, TEXT, UUID) FROM PUBLIC, backend_app, auth_app;

CREATE OR REPLACE FUNCTION auth.lock_principal_login_lifecycle(target_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE original_account_id TEXT; account_id TEXT; item TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || target_subject, 2::BIGINT));
  SELECT identities.user_id INTO original_account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF original_account_id IS NULL AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = target_subject) THEN
    original_account_id := target_subject;
  END IF;
  IF original_account_id IS NOT NULL THEN
    account_id := auth.canonical_account_id(original_account_id);
    -- Nested principal enrollment helpers reacquire the literal mapping's account lock.
    FOR item IN SELECT DISTINCT unnest(ARRAY[original_account_id, account_id]) ORDER BY 1 LOOP
      PERFORM auth.lock_account_lifecycle(item);
    END LOOP;
    PERFORM auth.assert_account_live(account_id);
  END IF;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
    WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Login principal has been deleted' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION auth.principal_session_status(target_subject TEXT, original_auth_time BIGINT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_hash TEXT; original_account_id TEXT; account_id TEXT; item TEXT; minimum_time BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || target_subject, 2::BIGINT));
  SELECT identities.user_id INTO original_account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF original_account_id IS NULL AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = target_subject) THEN
    original_account_id := target_subject;
  END IF;
  IF original_account_id IS NOT NULL THEN
    account_id := auth.canonical_account_id(original_account_id);
    FOR item IN SELECT DISTINCT unnest(ARRAY[original_account_id, account_id]) ORDER BY 1 LOOP
      PERFORM auth.lock_account_lifecycle(item);
    END LOOP;
  END IF;
  target_hash := encode(sha256(convert_to(target_subject, 'UTF8')), 'hex');
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 = target_hash) THEN RETURN 'deleted'; END IF;
  IF EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = target_hash AND completed_at IS NULL) THEN
    RETURN 'pending';
  END IF;
  SELECT minimum_auth_time INTO minimum_time FROM auth.principal_session_fences WHERE subject_sha256 = target_hash;
  IF FOUND AND (original_auth_time IS NULL OR original_auth_time < minimum_time) THEN RETURN 'revoked'; END IF;
  RETURN 'valid';
END;
$$;

CREATE OR REPLACE FUNCTION auth.account_live_session_status(target_account TEXT, original_issued_at BIGINT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT; item TEXT;
BEGIN
  account_id := auth.canonical_account_id(target_account);
  FOR item IN SELECT DISTINCT unnest(ARRAY[target_account, account_id]) ORDER BY 1 LOOP
    PERFORM auth.lock_account_lifecycle(item);
  END LOOP;
  IF auth.canonical_account_id(target_account) IS DISTINCT FROM account_id THEN
    RAISE EXCEPTION 'Account credential owner changed; retry with fresh authorization' USING ERRCODE = 'P0A01';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.deleted_accounts WHERE user_id_sha256 IN (
    encode(sha256(convert_to(target_account, 'UTF8')), 'hex'),
    encode(sha256(convert_to(account_id, 'UTF8')), 'hex'))) THEN RETURN 'deleted'; END IF;
  IF EXISTS (SELECT 1 FROM auth.user_identities AS identities
    JOIN auth.apple_session_revocation_jobs AS jobs ON jobs.subject_sha256 =
      encode(sha256(convert_to(identities.provider_subject, 'UTF8')), 'hex')
    WHERE identities.provider_type = 'cognito' AND identities.user_id IN (SELECT account_id UNION SELECT retired_user_id
        FROM auth.account_retirements WHERE canonical_user_id = account_id)
      AND jobs.completed_at IS NULL) THEN RETURN 'pending'; END IF;
  IF EXISTS (SELECT 1 FROM auth.user_identities AS identities
    JOIN auth.principal_session_fences AS fences ON fences.subject_sha256 =
      encode(sha256(convert_to(identities.provider_subject, 'UTF8')), 'hex')
    WHERE identities.provider_type = 'cognito' AND identities.user_id IN (SELECT account_id UNION SELECT retired_user_id
        FROM auth.account_retirements WHERE canonical_user_id = account_id)
      AND (original_issued_at IS NULL OR original_issued_at < fences.minimum_auth_time)) THEN RETURN 'revoked'; END IF;
  RETURN 'valid';
END;
$$;

-- Keep exact principal/method/session checks; a pre-retirement account snapshot is never upgraded
-- into consent for the survivor. The existing implementation acquires subjects before accounts.
ALTER FUNCTION auth.assert_social_attempt_live(auth.social_attempts) RENAME TO assert_unretired_social_attempt_live;
REVOKE ALL ON FUNCTION auth.assert_unretired_social_attempt_live(auth.social_attempts) FROM PUBLIC, backend_app, auth_app;
CREATE FUNCTION auth.assert_social_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE snapshot TEXT;
BEGIN
  BEGIN
    PERFORM auth.assert_unretired_social_attempt_live(target_attempt);
  EXCEPTION WHEN SQLSTATE 'P0A01' THEN
    RAISE EXCEPTION 'Attempt account changed; start again with fresh proof' USING ERRCODE = '23514';
  END;
  FOREACH snapshot IN ARRAY ARRAY[target_attempt.current_account, target_attempt.snapshot_account, target_attempt.proved_account] LOOP
    IF snapshot IS NOT NULL AND auth.canonical_account_id(snapshot) IS DISTINCT FROM snapshot THEN
      RAISE EXCEPTION 'Attempt account was retired; start again with fresh proof' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_social_attempt_live(auth.social_attempts) FROM PUBLIC, backend_app, auth_app;

CREATE OR REPLACE FUNCTION auth.linked_client_account_ids() RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  WITH account_ids AS (
    SELECT security.current_user_id() AS user_id
    UNION SELECT retired_user_id FROM auth.account_retirements WHERE canonical_user_id = security.current_user_id()
  )
  SELECT ARRAY(SELECT identity.user_id FROM (
    SELECT user_id FROM account_ids
    UNION SELECT original_client_user_id FROM auth.user_identities WHERE user_id IN (SELECT user_id FROM account_ids)
    UNION SELECT original_client_user_id FROM auth.agent_api_keys WHERE user_id IN (SELECT user_id FROM account_ids)
    UNION SELECT original_client_user_id FROM auth.oauth_connections WHERE user_id IN (SELECT user_id FROM account_ids)
  ) AS identity WHERE identity.user_id IS NOT NULL ORDER BY identity.user_id);
$$;
