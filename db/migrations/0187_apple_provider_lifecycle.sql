-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- No principal FK: the queue and encrypted credential must survive account erasure together.
CREATE TABLE auth.apple_revocation_jobs (
  job_id UUID NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
  provider_subject TEXT NOT NULL,
  client_id TEXT NOT NULL,
  credential_sha256 TEXT NOT NULL CHECK (credential_sha256 ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (reason IN ('unlink', 'account_deleted', 'consent-revoked', 'account-deleted')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (provider_subject, client_id),
  CHECK ((lease_id IS NULL) = (lease_until IS NULL))
);
CREATE INDEX ON auth.apple_revocation_jobs(available_at, lease_until);
REVOKE ALL ON auth.apple_revocation_jobs FROM PUBLIC, auth_app, backend_app;

-- Completion receipts prevent provider retries from revoking newly recovered email sessions again.
CREATE TABLE auth.apple_session_revocation_jobs (
  provider_subject_sha256 TEXT PRIMARY KEY CHECK (provider_subject_sha256 ~ '^[0-9a-f]{64}$'),
  job_id UUID NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
  cognito_subject TEXT,
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
  CHECK ((completed_at IS NULL) = (cognito_subject IS NOT NULL))
);
CREATE INDEX ON auth.apple_session_revocation_jobs(available_at) WHERE completed_at IS NULL;
REVOKE ALL ON auth.apple_session_revocation_jobs FROM PUBLIC, auth_app, backend_app;

CREATE TABLE auth.apple_notification_receipts (
  notification_sha256 TEXT PRIMARY KEY CHECK (notification_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'ignored_unbound', 'ignored_stale')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
REVOKE ALL ON auth.apple_notification_receipts FROM PUBLIC, auth_app, backend_app;

CREATE TABLE auth.apple_relay_delivery (
  email_sha256 TEXT PRIMARY KEY CHECK (email_sha256 ~ '^[0-9a-f]{64}$'),
  enabled BOOLEAN NOT NULL,
  event_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON auth.apple_relay_delivery FROM PUBLIC, auth_app, backend_app;

CREATE TABLE auth.apple_provider_notifications (
  provider_type TEXT NOT NULL DEFAULT 'apple' CHECK (provider_type = 'apple'),
  provider_subject TEXT PRIMARY KEY,
  consent_event_at TIMESTAMPTZ,
  account_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (provider_type, provider_subject) REFERENCES auth.provider_identities(provider_type, provider_subject)
    ON DELETE CASCADE
);
REVOKE ALL ON auth.apple_provider_notifications FROM PUBLIC, auth_app, backend_app;

-- The provider lock follows subject/account/method locks and covers every client of this Apple subject.
CREATE FUNCTION auth.lock_apple_credentials(target_provider_subject TEXT) RETURNS VOID
LANGUAGE sql SET search_path = pg_catalog AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.apple_credentials:' || target_provider_subject, 2::bigint));
$$;
REVOKE ALL ON FUNCTION auth.lock_apple_credentials(TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE OR REPLACE FUNCTION auth.store_apple_credential(
  target_subject TEXT, target_provider_subject TEXT, target_client_id TEXT, target_ciphertext TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  PERFORM auth.assert_real_principal_login_policy(target_subject);
  PERFORM 1 FROM auth.provider_login_methods
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject
    AND cognito_subject = target_subject FOR UPDATE;
  PERFORM auth.lock_apple_credentials(target_provider_subject);
  IF EXISTS (SELECT 1 FROM auth.apple_revocation_jobs WHERE provider_subject = target_provider_subject)
    OR EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_provider_subject, 'UTF8')), 'hex') AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Apple revocation is pending; retry a fresh Apple sign-in after cleanup completes' USING ERRCODE = '55006';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.provider_login_methods WHERE provider_type = 'apple'
    AND provider_subject = target_provider_subject AND status = 'disabled') THEN
    RAISE EXCEPTION 'Apple login method is disabled; explicit reauthorization is required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_subject)
    OR NOT EXISTS (SELECT 1 FROM auth.provider_identities
      WHERE provider_type = 'apple' AND provider_subject = target_provider_subject AND cognito_subject = target_subject) THEN
    RAISE EXCEPTION 'Apple credential requires a live bound principal' USING ERRCODE = '23514';
  END IF;
  -- A fresh explicitly enabled enrollment starts a new lifecycle after the prior revocation completed.
  DELETE FROM auth.apple_session_revocation_jobs
  WHERE provider_subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_provider_subject, 'UTF8')), 'hex')
    AND completed_at IS NOT NULL;
  INSERT INTO auth.apple_revocation_credentials(provider_subject, client_id, cognito_subject, ciphertext)
  VALUES (target_provider_subject, target_client_id, target_subject, target_ciphertext)
  ON CONFLICT (provider_subject, client_id) DO UPDATE
  SET ciphertext = EXCLUDED.ciphertext, updated_at = pg_catalog.now()
  WHERE auth.apple_revocation_credentials.cognito_subject = EXCLUDED.cognito_subject;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple credential principal is immutable' USING ERRCODE = '23505';
  END IF;
END;
$$;

-- Called only with the account/method lifecycle already locked; never returns credential material.
CREATE FUNCTION auth.queue_apple_revocation(target_provider_subject TEXT, target_reason TEXT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE queued INTEGER;
BEGIN
  IF target_reason IS NULL OR target_reason NOT IN ('unlink', 'account_deleted', 'consent-revoked', 'account-deleted') THEN
    RAISE EXCEPTION 'Invalid Apple revocation reason' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_apple_credentials(target_provider_subject);
  INSERT INTO auth.apple_session_revocation_jobs(provider_subject_sha256, cognito_subject)
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(identities.provider_subject, 'UTF8')), 'hex'), principals.cognito_subject FROM auth.provider_identities AS identities
  JOIN auth.cognito_principals AS principals ON principals.cognito_subject = identities.cognito_subject
  WHERE identities.provider_type = 'apple' AND identities.provider_subject = target_provider_subject
  ON CONFLICT (provider_subject_sha256) DO NOTHING;
  PERFORM 1 FROM auth.apple_revocation_credentials WHERE provider_subject = target_provider_subject
  ORDER BY client_id FOR UPDATE;
  INSERT INTO auth.apple_revocation_jobs(provider_subject, client_id, credential_sha256, reason)
  SELECT credentials.provider_subject, credentials.client_id,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(credentials.ciphertext, 'UTF8')), 'hex'), target_reason
  FROM auth.apple_revocation_credentials AS credentials WHERE credentials.provider_subject = target_provider_subject
  ON CONFLICT (provider_subject, client_id) DO NOTHING;
  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$$;
REVOKE ALL ON FUNCTION auth.queue_apple_revocation(TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;

-- Install before orphan recovery: old backend instances can still delete principals during rollout.
CREATE FUNCTION auth.stage_apple_revocations_before_principal_delete() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE apple_subject TEXT;
BEGIN
  -- Deletion owns the account lock; taking alias subject locks here would invert lifecycle ordering.
  FOR apple_subject IN
    SELECT DISTINCT credentials.provider_subject FROM auth.apple_revocation_credentials AS credentials
    WHERE credentials.cognito_subject = OLD.cognito_subject ORDER BY credentials.provider_subject
  LOOP
    PERFORM auth.queue_apple_revocation(apple_subject, 'account_deleted');
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION auth.stage_apple_revocations_before_principal_delete() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER cognito_principals_stage_apple_revocations BEFORE DELETE ON auth.cognito_principals
FOR EACH ROW EXECUTE FUNCTION auth.stage_apple_revocations_before_principal_delete();

-- Recover credentials retained by earlier erasure without requiring the deleted person to return.
DO $$
DECLARE apple_subject TEXT;
BEGIN
  FOR apple_subject IN
    SELECT DISTINCT credentials.provider_subject FROM auth.apple_revocation_credentials AS credentials
    WHERE NOT EXISTS (SELECT 1 FROM auth.cognito_principals AS principals WHERE principals.cognito_subject = credentials.cognito_subject)
      OR EXISTS (SELECT 1 FROM auth.deleted_subjects AS deleted
        WHERE deleted.subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(credentials.cognito_subject, 'UTF8')), 'hex'))
    ORDER BY credentials.provider_subject
  LOOP
    PERFORM auth.queue_apple_revocation(apple_subject, 'account_deleted');
  END LOOP;
END;
$$;

CREATE FUNCTION auth.stage_apple_method_revocation(target_subject TEXT, target_provider_subject TEXT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE queued INTEGER;
BEGIN
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  PERFORM auth.assert_real_principal_login_policy(target_subject);
  PERFORM 1 FROM auth.provider_login_methods
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject AND cognito_subject = target_subject FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apple login method does not belong to this principal' USING ERRCODE = '23514';
  END IF;
  queued := auth.queue_apple_revocation(target_provider_subject, 'unlink');
  UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = COALESCE(disabled_at, pg_catalog.clock_timestamp())
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject;
  RETURN queued;
END;
$$;
REVOKE ALL ON FUNCTION auth.stage_apple_method_revocation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.stage_apple_method_revocation(TEXT, TEXT) TO auth_app;

-- Deletion owns the account lock and its complete alias inventory; do not acquire alias subject locks here.
CREATE FUNCTION auth.stage_deleted_apple_revocations(target_deletion_id UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE apple_subject TEXT; queued INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_deletion_jobs AS jobs
    JOIN auth.deleted_subjects AS deleted ON deleted.deletion_id = jobs.deletion_id
      AND deleted.subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jobs.cognito_subject, 'UTF8')), 'hex')
    WHERE jobs.deletion_id = target_deletion_id) THEN
    RAISE EXCEPTION 'Apple deletion staging requires durable account deletion inventory' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM auth.provider_login_methods AS methods
  WHERE methods.provider_type = 'apple' AND methods.cognito_subject IN
    (SELECT cognito_subject FROM auth.cognito_deletion_jobs WHERE deletion_id = target_deletion_id)
  ORDER BY methods.provider_subject FOR UPDATE;
  FOR apple_subject IN
    SELECT identities.provider_subject FROM auth.provider_identities AS identities
    JOIN auth.cognito_deletion_jobs AS jobs ON jobs.cognito_subject = identities.cognito_subject
    WHERE jobs.deletion_id = target_deletion_id AND identities.provider_type = 'apple'
    UNION
    SELECT credentials.provider_subject FROM auth.apple_revocation_credentials AS credentials
    JOIN auth.cognito_deletion_jobs AS jobs ON jobs.cognito_subject = credentials.cognito_subject
    WHERE jobs.deletion_id = target_deletion_id ORDER BY 1
  LOOP
    queued := queued + auth.queue_apple_revocation(apple_subject, 'account_deleted');
  END LOOP;
  RETURN queued;
END;
$$;
REVOKE ALL ON FUNCTION auth.stage_deleted_apple_revocations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.stage_deleted_apple_revocations(UUID) TO backend_app;

CREATE FUNCTION auth.claim_apple_revocation()
RETURNS TABLE(job_id UUID, lease_id UUID, provider_subject TEXT, client_id TEXT, ciphertext TEXT, attempts INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE selected_job auth.apple_revocation_jobs%ROWTYPE; claimed_lease UUID := pg_catalog.gen_random_uuid();
BEGIN
  SELECT jobs.* INTO selected_job FROM auth.apple_revocation_jobs AS jobs
  WHERE jobs.available_at <= pg_catalog.clock_timestamp()
    AND (jobs.lease_until IS NULL OR jobs.lease_until <= pg_catalog.clock_timestamp())
  ORDER BY jobs.available_at, jobs.created_at, jobs.job_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.apple_revocation_credentials AS credentials
    WHERE credentials.provider_subject = selected_job.provider_subject AND credentials.client_id = selected_job.client_id
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(credentials.ciphertext, 'UTF8')), 'hex') = selected_job.credential_sha256) THEN
    RAISE EXCEPTION 'Queued Apple credential is missing or changed; operator repair is required' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.apple_revocation_jobs AS jobs
  SET lease_id = claimed_lease, lease_until = pg_catalog.clock_timestamp() + INTERVAL '90 seconds', attempts = jobs.attempts + 1
  WHERE jobs.job_id = selected_job.job_id;
  RETURN QUERY SELECT selected_job.job_id, claimed_lease, credentials.provider_subject, credentials.client_id,
    credentials.ciphertext, selected_job.attempts + 1
  FROM auth.apple_revocation_credentials AS credentials
  WHERE credentials.provider_subject = selected_job.provider_subject AND credentials.client_id = selected_job.client_id;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_apple_revocation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.claim_apple_revocation() TO auth_app;

-- Only this fenced completion can erase queued ciphertext. Provider success precedes this transaction.
REVOKE EXECUTE ON FUNCTION auth.delete_apple_credential(TEXT, TEXT, TEXT) FROM auth_app;
CREATE FUNCTION auth.complete_apple_revocation(target_job UUID, target_lease UUID, target_ciphertext TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE selected_job auth.apple_revocation_jobs%ROWTYPE;
BEGIN
  SELECT * INTO selected_job FROM auth.apple_revocation_jobs WHERE job_id = target_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple revocation job no longer exists' USING ERRCODE = '55006'; END IF;
  PERFORM auth.lock_apple_credentials(selected_job.provider_subject);
  PERFORM 1 FROM auth.apple_revocation_credentials
  WHERE provider_subject = selected_job.provider_subject AND client_id = selected_job.client_id FOR UPDATE;
  SELECT * INTO selected_job FROM auth.apple_revocation_jobs WHERE job_id = target_job FOR UPDATE;
  IF NOT FOUND OR target_lease IS NULL OR selected_job.lease_id IS NULL OR selected_job.lease_id IS DISTINCT FROM target_lease
    OR selected_job.lease_until <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Apple revocation lease expired or changed' USING ERRCODE = '55006';
  END IF;
  IF selected_job.credential_sha256 <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_ciphertext, 'UTF8')), 'hex')
    OR NOT auth.delete_apple_credential(selected_job.provider_subject, selected_job.client_id, target_ciphertext) THEN
    RAISE EXCEPTION 'Revoked Apple credential changed; cleanup refused' USING ERRCODE = '23514';
  END IF;
  DELETE FROM auth.apple_revocation_jobs WHERE job_id = target_job;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_apple_revocation(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.complete_apple_revocation(UUID, UUID, TEXT) TO auth_app;

CREATE FUNCTION auth.retry_apple_revocation(target_job UUID, target_lease UUID, target_error_code TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_error_code IS NULL OR target_error_code NOT IN ('PROVIDER_UNAVAILABLE', 'PROVIDER_CONFIGURATION_INVALID',
    'PROVIDER_PROOF_INVALID', 'PROVIDER_TEMPORARILY_UNAVAILABLE', 'PROVIDER_CREDENTIAL_INVALID', 'APPLE_REVOCATION_FAILED') THEN
    RAISE EXCEPTION 'Invalid redacted Apple revocation error code' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.apple_revocation_jobs SET lease_id = NULL, lease_until = NULL, last_error_code = target_error_code,
    available_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs =>
      LEAST(21600, 30 * pg_catalog.power(2, LEAST(attempts, 10)))::INTEGER)
  WHERE job_id = target_job AND lease_id = target_lease AND lease_until > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple revocation retry lost its lease' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.retry_apple_revocation(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.retry_apple_revocation(UUID, UUID, TEXT) TO auth_app;

CREATE FUNCTION auth.apple_relay_delivery_allowed(target_email TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM auth.apple_relay_delivery
    WHERE email_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(target_email), 'UTF8')), 'hex')
      AND NOT enabled);
$$;
REVOKE ALL ON FUNCTION auth.apple_relay_delivery_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.apple_relay_delivery_allowed(TEXT) TO auth_app;

-- This server-only capability accepts claims only after Apple signature/issuer/audience verification.
CREATE FUNCTION auth.apply_apple_notification(
  target_notification_sha256 TEXT, target_payload_sha256 TEXT, target_provider_subject TEXT,
  target_type TEXT, target_event_at TIMESTAMPTZ, target_email TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_subject TEXT; stored_payload TEXT; stored_outcome TEXT; result_outcome TEXT := 'applied';
  method_activated TIMESTAMPTZ; method_recovery TEXT; consent_at TIMESTAMPTZ; apple_account_deleted BOOLEAN;
BEGIN
  IF target_type IS NULL OR target_type NOT IN ('email-enabled', 'email-disabled', 'consent-revoked', 'account-deleted')
    OR target_event_at IS NULL OR target_event_at > pg_catalog.clock_timestamp() + INTERVAL '30 seconds'
    OR target_notification_sha256 IS NULL OR target_notification_sha256 !~ '^[0-9a-f]{64}$'
    OR target_payload_sha256 IS NULL OR target_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid verified Apple notification claims' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.apple_notification:' || target_notification_sha256, 2::bigint));
  SELECT payload_sha256, outcome INTO stored_payload, stored_outcome FROM auth.apple_notification_receipts
  WHERE notification_sha256 = target_notification_sha256;
  IF FOUND THEN
    IF stored_payload <> target_payload_sha256 THEN
      RAISE EXCEPTION 'Apple notification identifier payload conflict' USING ERRCODE = '23505';
    END IF;
    RETURN stored_outcome;
  END IF;
  IF target_type IN ('email-enabled', 'email-disabled') THEN
    IF target_email IS NULL OR target_email <> pg_catalog.lower(target_email)
      OR target_email !~ '^[^[:space:]@]+@(privaterelay\.appleid\.com|private\.icloud\.com)$' THEN
      RAISE EXCEPTION 'Apple relay notification requires a private relay address' USING ERRCODE = '23514';
    END IF;
    INSERT INTO auth.apple_relay_delivery(email_sha256, enabled, event_at)
    VALUES (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_email, 'UTF8')), 'hex'), target_type = 'email-enabled', target_event_at)
    ON CONFLICT (email_sha256) DO UPDATE SET enabled = EXCLUDED.enabled, event_at = EXCLUDED.event_at
    WHERE auth.apple_relay_delivery.event_at < EXCLUDED.event_at
      OR (auth.apple_relay_delivery.event_at = EXCLUDED.event_at AND NOT EXCLUDED.enabled);
    IF NOT FOUND THEN result_outcome := 'ignored_stale'; END IF;
  ELSE
    SELECT cognito_subject INTO target_subject FROM auth.provider_identities
    WHERE provider_type = 'apple' AND provider_subject = target_provider_subject;
    IF target_subject IS NULL THEN
      result_outcome := 'ignored_unbound';
    ELSE
      -- Deletion can win the account lock without owning this subject lock. Recheck after waiting.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
      PERFORM auth.lock_account_lifecycle(identities.user_id) FROM auth.user_identities AS identities
      WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
      SELECT activated_at, recovery_email INTO method_activated, method_recovery FROM auth.provider_login_methods
      WHERE provider_type = 'apple' AND provider_subject = target_provider_subject AND cognito_subject = target_subject FOR UPDATE;
      IF NOT FOUND THEN
        result_outcome := 'ignored_unbound';
      ELSIF target_event_at < pg_catalog.date_trunc('second', method_activated) THEN
        result_outcome := 'ignored_stale';
      ELSE
        PERFORM auth.assert_real_principal_login_policy(target_subject);
        INSERT INTO auth.apple_provider_notifications(provider_subject) VALUES (target_provider_subject) ON CONFLICT DO NOTHING;
        SELECT consent_event_at, account_deleted INTO consent_at, apple_account_deleted
        FROM auth.apple_provider_notifications WHERE provider_subject = target_provider_subject FOR UPDATE;
        IF apple_account_deleted OR (target_type <> 'account-deleted' AND consent_at IS NOT NULL AND target_event_at <= consent_at) THEN
          result_outcome := 'ignored_stale';
        ELSE
          PERFORM auth.queue_apple_revocation(target_provider_subject, target_type);
          UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = COALESCE(disabled_at, pg_catalog.clock_timestamp())
          WHERE provider_type = 'apple' AND provider_subject = target_provider_subject;
          UPDATE auth.apple_provider_notifications SET consent_event_at = GREATEST(consent_event_at, target_event_at),
            account_deleted = target_type = 'account-deleted' WHERE provider_subject = target_provider_subject;
          IF target_type = 'account-deleted' AND method_recovery ~ '^[^[:space:]@]+@(privaterelay\.appleid\.com|private\.icloud\.com)$' THEN
            INSERT INTO auth.apple_relay_delivery(email_sha256, enabled, event_at)
            VALUES (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(method_recovery, 'UTF8')), 'hex'), FALSE, target_event_at)
            ON CONFLICT (email_sha256) DO UPDATE SET enabled = FALSE, event_at = EXCLUDED.event_at
            WHERE auth.apple_relay_delivery.event_at <= EXCLUDED.event_at;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  INSERT INTO auth.apple_notification_receipts(notification_sha256, payload_sha256, outcome)
  VALUES (target_notification_sha256, target_payload_sha256, result_outcome);
  RETURN result_outcome;
END;
$$;
REVOKE ALL ON FUNCTION auth.apply_apple_notification(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.apply_apple_notification(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO auth_app;

CREATE FUNCTION auth.apple_revocation_pending(target_provider_subject TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM auth.apple_revocation_jobs WHERE provider_subject = target_provider_subject)
    OR EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE provider_subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_provider_subject, 'UTF8')), 'hex') AND completed_at IS NULL);
$$;
REVOKE ALL ON FUNCTION auth.apple_revocation_pending(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.apple_revocation_pending(TEXT) TO auth_app;

CREATE FUNCTION auth.claim_apple_session_revocation()
RETURNS TABLE(job_id UUID, lease_id UUID, cognito_subject TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE selected_job auth.apple_session_revocation_jobs%ROWTYPE; claimed_lease UUID := pg_catalog.gen_random_uuid();
BEGIN
  SELECT jobs.* INTO selected_job FROM auth.apple_session_revocation_jobs AS jobs
  WHERE jobs.completed_at IS NULL AND jobs.available_at <= pg_catalog.clock_timestamp()
    AND (jobs.lease_until IS NULL OR jobs.lease_until <= pg_catalog.clock_timestamp())
  ORDER BY jobs.available_at, jobs.job_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE auth.apple_session_revocation_jobs AS jobs
  SET lease_id = claimed_lease, lease_until = pg_catalog.clock_timestamp() + INTERVAL '90 seconds', attempts = jobs.attempts + 1
  WHERE jobs.job_id = selected_job.job_id;
  RETURN QUERY SELECT selected_job.job_id, claimed_lease, selected_job.cognito_subject;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_apple_session_revocation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.claim_apple_session_revocation() TO auth_app;

CREATE FUNCTION auth.complete_apple_session_revocation(target_job UUID, target_lease UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE auth.apple_session_revocation_jobs
  SET completed_at = pg_catalog.clock_timestamp(), cognito_subject = NULL, lease_id = NULL, lease_until = NULL, last_error_code = NULL
  WHERE job_id = target_job AND lease_id = target_lease AND lease_until > pg_catalog.clock_timestamp() AND completed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple session revocation lease expired or changed' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_apple_session_revocation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.complete_apple_session_revocation(UUID, UUID) TO auth_app;

CREATE FUNCTION auth.retry_apple_session_revocation(target_job UUID, target_lease UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE auth.apple_session_revocation_jobs SET lease_id = NULL, lease_until = NULL,
    last_error_code = 'APPLE_SESSION_REVOCATION_FAILED',
    available_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs =>
      LEAST(21600, 30 * pg_catalog.power(2, LEAST(attempts, 10)))::INTEGER)
  WHERE job_id = target_job AND lease_id = target_lease AND lease_until > pg_catalog.clock_timestamp() AND completed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple session revocation retry lost its lease' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.retry_apple_session_revocation(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.retry_apple_session_revocation(UUID, UUID) TO auth_app;
