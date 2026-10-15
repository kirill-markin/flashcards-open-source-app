-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- No principal FK: fences and pending signout must survive principal/account erasure.
CREATE TABLE auth.principal_session_fences (
  subject_sha256 TEXT PRIMARY KEY CHECK (subject_sha256 ~ '^[0-9a-f]{64}$'),
  minimum_auth_time BIGINT NOT NULL CHECK (minimum_auth_time > 0)
);
REVOKE ALL ON auth.principal_session_fences FROM PUBLIC, auth_app, backend_app;

-- Keep the existing queue and lease API so an old scheduled Lambda can drain during rollout.
ALTER TABLE auth.apple_session_revocation_jobs ADD COLUMN subject_sha256 TEXT
  CHECK (subject_sha256 ~ '^[0-9a-f]{64}$');
UPDATE auth.apple_session_revocation_jobs AS jobs SET subject_sha256 =
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(jobs.cognito_subject, identities.cognito_subject), 'UTF8')), 'hex')
FROM auth.provider_identities AS identities
WHERE identities.provider_type = 'apple' AND jobs.provider_subject_sha256 =
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(identities.provider_subject, 'UTF8')), 'hex');
UPDATE auth.apple_session_revocation_jobs SET subject_sha256 =
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(cognito_subject, 'UTF8')), 'hex')
WHERE completed_at IS NULL;
CREATE INDEX ON auth.apple_session_revocation_jobs(subject_sha256) WHERE completed_at IS NULL;
ALTER TABLE auth.apple_session_revocation_jobs ADD CONSTRAINT pending_session_revocation_subject
  CHECK (completed_at IS NOT NULL OR subject_sha256 IS NOT NULL);

CREATE FUNCTION auth.identify_session_revocation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.cognito_subject IS NULL OR pg_catalog.btrim(NEW.cognito_subject) = '' OR NEW.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Session invalidation requires a pending immutable principal' USING ERRCODE = '23514';
  END IF;
  NEW.subject_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(NEW.cognito_subject, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.identify_session_revocation() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER identify_session_revocation BEFORE INSERT ON auth.apple_session_revocation_jobs
FOR EACH ROW EXECUTE FUNCTION auth.identify_session_revocation();

-- AFTER INSERT excludes ON CONFLICT retries of completed receipts. Completion moves the fence past
-- every session that might have been minted while an external signout outcome was ambiguous.
-- Cognito auth_time has second precision: recovery starts in the next whole second.
CREATE FUNCTION auth.fence_principal_sessions() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO auth.principal_session_fences(subject_sha256, minimum_auth_time)
  VALUES (NEW.subject_sha256, pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::BIGINT + 1)
  ON CONFLICT (subject_sha256) DO UPDATE SET minimum_auth_time =
    GREATEST(auth.principal_session_fences.minimum_auth_time, EXCLUDED.minimum_auth_time);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.fence_principal_sessions() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER fence_inserted_principal_sessions AFTER INSERT ON auth.apple_session_revocation_jobs
FOR EACH ROW EXECUTE FUNCTION auth.fence_principal_sessions();
CREATE TRIGGER fence_completed_principal_sessions AFTER UPDATE OF completed_at ON auth.apple_session_revocation_jobs
FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
EXECUTE FUNCTION auth.fence_principal_sessions();

INSERT INTO auth.principal_session_fences(subject_sha256, minimum_auth_time)
SELECT subject_sha256, MAX(pg_catalog.floor(EXTRACT(EPOCH FROM COALESCE(completed_at, pg_catalog.clock_timestamp())))::BIGINT + 1)
FROM auth.apple_session_revocation_jobs WHERE subject_sha256 IS NOT NULL GROUP BY subject_sha256;

-- Server-only capability; the caller has freshly authorized the principal-wide action. One stable
-- operation id per action makes transaction retries unable to sign out a later recovered session.
CREATE FUNCTION auth.invalidate_principal_sessions(target_subject TEXT, target_operation UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_hash TEXT; operation_key TEXT;
BEGIN
  IF target_operation IS NULL THEN
    RAISE EXCEPTION 'Session invalidation requires a stable operation id' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_subject) THEN
    RAISE EXCEPTION 'Session invalidation requires a registered principal' USING ERRCODE = '23514';
  END IF;
  target_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex');
  operation_key := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('principal-session:' || target_operation::TEXT, 'UTF8')), 'hex');
  INSERT INTO auth.apple_session_revocation_jobs(provider_subject_sha256, job_id, cognito_subject)
  VALUES (operation_key, target_operation, target_subject) ON CONFLICT (provider_subject_sha256) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs
    WHERE provider_subject_sha256 = operation_key AND subject_sha256 = target_hash AND job_id = target_operation) THEN
    RAISE EXCEPTION 'Session invalidation operation belongs to another principal' USING ERRCODE = '23505';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.invalidate_principal_sessions(TEXT, UUID) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.invalidate_principal_sessions(TEXT, UUID) TO auth_app;

-- Only a signature-verified Cognito auth_time may be supplied. NULL preserves unfenced legacy
-- credentials; once fenced, missing original authentication time cannot be replaced by refresh iat.
CREATE FUNCTION auth.principal_session_status(target_subject TEXT, original_auth_time BIGINT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_hash TEXT; account_id TEXT; minimum_time BIGINT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::BIGINT));
  SELECT identities.user_id INTO account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF account_id IS NULL AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = target_subject) THEN
    account_id := target_subject;
  END IF;
  IF account_id IS NOT NULL THEN PERFORM auth.lock_account_lifecycle(account_id); END IF;
  target_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex');
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 = target_hash) THEN RETURN 'deleted'; END IF;
  IF EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 = target_hash AND completed_at IS NULL) THEN
    RETURN 'pending';
  END IF;
  SELECT minimum_auth_time INTO minimum_time FROM auth.principal_session_fences WHERE subject_sha256 = target_hash;
  IF FOUND AND (original_auth_time IS NULL OR original_auth_time < minimum_time) THEN RETURN 'revoked'; END IF;
  RETURN 'valid';
END;
$$;
REVOKE ALL ON FUNCTION auth.principal_session_status(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.principal_session_status(TEXT, BIGINT) TO auth_app, backend_app;

-- Live HMAC tokens contain a signed expiry and fixed lifetime, but only the product account id.
-- Check every principal of that account, conservatively invalidating its derived live credentials.
CREATE FUNCTION auth.account_live_session_status(target_account TEXT, original_issued_at BIGINT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_account_lifecycle(target_account);
  IF EXISTS (SELECT 1 FROM auth.deleted_accounts WHERE user_id_sha256 =
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_account, 'UTF8')), 'hex')) THEN RETURN 'deleted'; END IF;
  IF EXISTS (SELECT 1 FROM auth.user_identities AS identities
    JOIN auth.apple_session_revocation_jobs AS jobs ON jobs.subject_sha256 =
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(identities.provider_subject, 'UTF8')), 'hex')
    WHERE identities.provider_type = 'cognito' AND identities.user_id = target_account AND jobs.completed_at IS NULL) THEN
    RETURN 'pending';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.user_identities AS identities
    JOIN auth.principal_session_fences AS fences ON fences.subject_sha256 =
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(identities.provider_subject, 'UTF8')), 'hex')
    WHERE identities.provider_type = 'cognito' AND identities.user_id = target_account
      AND (original_issued_at IS NULL OR original_issued_at < fences.minimum_auth_time)) THEN RETURN 'revoked'; END IF;
  RETURN 'valid';
END;
$$;
REVOKE ALL ON FUNCTION auth.account_live_session_status(TEXT, BIGINT) FROM PUBLIC, auth_app;
GRANT EXECUTE ON FUNCTION auth.account_live_session_status(TEXT, BIGINT) TO backend_app;
