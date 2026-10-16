-- Schemas touched/read explicitly: auth, org, pg_catalog.
ALTER TABLE auth.social_attempts
  ADD COLUMN email_current_username TEXT,
  ADD COLUMN email_current_principal_created_at TIMESTAMPTZ,
  ADD COLUMN email_current_minimum_auth_time BIGINT,
  ADD COLUMN email_enrollment_verified_at TIMESTAMPTZ;
UPDATE auth.social_attempts SET email_current_username = snapshot_username,
  email_current_principal_created_at = snapshot_principal_created_at,
  email_current_minimum_auth_time = email_minimum_auth_time WHERE provider_type IS NULL;
ALTER TABLE auth.social_attempts DROP CONSTRAINT social_attempts_email_proof;
ALTER TABLE auth.social_attempts ADD CONSTRAINT social_attempts_email_proof CHECK (
  (provider_type IS NOT NULL AND email_address IS NULL AND email_started_at IS NULL
    AND email_minimum_auth_time IS NULL AND email_proof_auth_time IS NULL AND current_auth_time IS NULL
    AND email_current_username IS NULL AND email_current_principal_created_at IS NULL
    AND email_current_minimum_auth_time IS NULL AND email_enrollment_verified_at IS NULL)
  OR (provider_type IS NULL AND purpose = 'reauth' AND current_subject IS NOT NULL
    AND email_address IS NOT NULL AND email_address = lower(btrim(email_address))
    AND length(email_address) <= 254 AND email_address NOT LIKE '%@example.com'
    AND email_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND email_started_at IS NOT NULL AND email_minimum_auth_time IS NOT NULL AND email_minimum_auth_time >= 0
    AND (current_auth_time IS NULL OR current_auth_time >= 0)
    AND email_current_username IS NOT NULL AND email_current_principal_created_at IS NOT NULL
    AND email_current_minimum_auth_time IS NOT NULL AND email_current_minimum_auth_time >= 0
    AND snapshot_subject IS NOT NULL AND snapshot_username IS NOT NULL
    AND snapshot_account IS NOT DISTINCT FROM current_account AND snapshot_principal_created_at IS NOT NULL
    AND (email_enrollment_verified_at IS NOT NULL OR snapshot_subject = current_subject)
    AND provider_subject IS NULL AND reauth_attempt_sha256 IS NULL
    AND snapshot_provider_created_at IS NULL AND snapshot_method_activated_at IS NULL AND method_activated_at IS NULL
    AND reenable_disabled_at IS NULL AND reenable_minimum_auth_time IS NULL AND result_ciphertext IS NULL
    AND phase IN ('mailbox_sending', 'mailbox_ready', 'mailbox_claimed', 'mailbox_verifying', 'completed', 'redeemed')
    AND (phase NOT IN ('completed', 'redeemed') OR
      (email_proof_auth_time IS NOT NULL AND proved_subject IS NOT DISTINCT FROM snapshot_subject
        AND proved_username IS NOT DISTINCT FROM snapshot_username AND proved_account IS NOT DISTINCT FROM current_account))));

-- Discover all subjects before calling: subject locks precede original/canonical account locks.
CREATE FUNCTION auth.lock_email_attempt_lifecycle(initiator TEXT, mailbox TEXT, action_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE subject TEXT; account_id TEXT;
BEGIN
  FOR subject IN SELECT DISTINCT unnest(ARRAY[initiator, mailbox, action_subject]) ORDER BY 1 LOOP
    IF subject IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || subject, 2::BIGINT));
    END IF;
  END LOOP;
  FOR account_id IN
    WITH originals AS (
      SELECT user_id FROM auth.user_identities WHERE provider_type = 'cognito'
        AND provider_subject IN (initiator, mailbox, action_subject)
      UNION SELECT user_id FROM org.user_settings WHERE user_id IN (initiator, mailbox, action_subject)
    ) SELECT user_id FROM originals UNION SELECT auth.canonical_account_id(user_id) FROM originals ORDER BY 1
  LOOP
    PERFORM auth.lock_account_lifecycle(account_id);
    IF EXISTS (SELECT 1 FROM auth.deleted_accounts WHERE user_id_sha256 =
      encode(sha256(convert_to(account_id, 'UTF8')), 'hex')) THEN
      RAISE EXCEPTION 'Email attempt account was deleted; start again' USING ERRCODE = '23514';
    END IF;
    PERFORM auth.assert_account_write_scope(auth.canonical_account_id(account_id));
    PERFORM auth.assert_account_live(auth.canonical_account_id(account_id));
  END LOOP;
  FOR subject IN SELECT DISTINCT unnest(ARRAY[initiator, mailbox, action_subject]) ORDER BY 1 LOOP
    IF subject IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = subject)
        OR EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 =
          encode(sha256(convert_to(subject, 'UTF8')), 'hex')) THEN
        RAISE EXCEPTION 'Email attempt principal is deleted or missing' USING ERRCODE = '23514';
      END IF;
      PERFORM auth.assert_real_principal_login_policy(subject);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_email_attempt_lifecycle(TEXT, TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.account_recovery_email(target_subject TEXT, target_username TEXT, original_auth_time BIGINT)
RETURNS TABLE(cognito_subject TEXT, cognito_username TEXT, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE candidate RECORD; account_id TEXT;
BEGIN
  SELECT auth.canonical_account_id(identities.user_id) INTO account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF account_id IS NULL THEN RAISE EXCEPTION 'Current account is missing' USING ERRCODE = '23514'; END IF;
  SELECT principals.cognito_subject, principals.cognito_username, emails.email INTO candidate
  FROM auth.user_identities AS identities
  JOIN auth.cognito_principals AS principals ON principals.cognito_subject = identities.provider_subject
  JOIN auth.verified_login_emails AS emails ON emails.cognito_subject = principals.cognito_subject
  LEFT JOIN org.user_settings AS settings ON settings.user_id = account_id
  WHERE identities.provider_type = 'cognito' AND auth.canonical_account_id(identities.user_id) = account_id
    AND emails.email !~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$'
    AND emails.email NOT LIKE '%@example.com'
    AND NOT EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs AS revocation_jobs WHERE revocation_jobs.subject_sha256 =
      encode(sha256(convert_to(principals.cognito_subject, 'UTF8')), 'hex') AND revocation_jobs.completed_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM auth.principal_login_policies AS policies
      WHERE policies.cognito_subject = principals.cognito_subject AND policies.principal_kind = 'demo')
    AND NOT EXISTS (SELECT 1 FROM auth.deleted_subjects AS deleted_subjects WHERE deleted_subjects.subject_sha256 =
      encode(sha256(convert_to(principals.cognito_subject, 'UTF8')), 'hex'))
  ORDER BY (emails.email = lower(btrim(settings.email))) DESC NULLS LAST, emails.email, principals.cognito_subject LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.lock_email_attempt_lifecycle(target_subject, candidate.cognito_subject, NULL);
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals AS principals
    WHERE principals.cognito_subject = target_subject AND principals.cognito_username = target_username)
    OR auth.principal_session_status(target_subject, original_auth_time) <> 'valid'
    OR original_auth_time < 0
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities AS identities
      WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject
      AND auth.canonical_account_id(identities.user_id) = account_id)
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities AS identities JOIN auth.verified_login_emails AS emails
      ON emails.cognito_subject = identities.provider_subject WHERE identities.provider_type = 'cognito'
      AND identities.provider_subject = candidate.cognito_subject AND auth.canonical_account_id(identities.user_id) = account_id
      AND emails.email = candidate.email)
    OR auth.principal_session_status(candidate.cognito_subject, COALESCE((SELECT session_fences.minimum_auth_time
      FROM auth.principal_session_fences AS session_fences WHERE session_fences.subject_sha256 =
        encode(sha256(convert_to(candidate.cognito_subject, 'UTF8')), 'hex')), 0)) <> 'valid' THEN
    RAISE EXCEPTION 'Recovery email or current session changed; start again' USING ERRCODE = '23514';
  END IF;
  RETURN QUERY SELECT candidate.cognito_subject::TEXT, candidate.cognito_username::TEXT, candidate.email::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION auth.account_recovery_email(TEXT, TEXT, BIGINT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.account_recovery_email(TEXT, TEXT, BIGINT) TO auth_app;

-- Replace only the email layer under the existing provider/reenable/retirement assertions.
CREATE OR REPLACE FUNCTION auth.assert_standard_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT;
BEGIN
  IF target_attempt.provider_type IS NOT NULL THEN
    PERFORM auth.assert_provider_attempt_live(target_attempt);
    RETURN;
  END IF;
  PERFORM auth.lock_email_attempt_lifecycle(target_attempt.current_subject, target_attempt.snapshot_subject, NULL);
  SELECT auth.canonical_account_id(user_id) INTO account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_attempt.current_subject;
  IF target_attempt.email_address IS NULL OR target_attempt.purpose IS DISTINCT FROM 'reauth'
    OR account_id IS NULL OR account_id IS DISTINCT FROM target_attempt.current_account
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities WHERE provider_type = 'cognito'
      AND provider_subject = target_attempt.snapshot_subject AND auth.canonical_account_id(user_id) = account_id)
    OR target_attempt.snapshot_account IS DISTINCT FROM account_id
    OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_attempt.current_subject
      AND cognito_username = target_attempt.email_current_username AND created_at = target_attempt.email_current_principal_created_at)
    OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_attempt.snapshot_subject
      AND cognito_username = target_attempt.snapshot_username AND created_at = target_attempt.snapshot_principal_created_at)
    OR target_attempt.email_current_minimum_auth_time IS DISTINCT FROM COALESCE((SELECT minimum_auth_time
      FROM auth.principal_session_fences WHERE subject_sha256 =
        encode(sha256(convert_to(target_attempt.current_subject, 'UTF8')), 'hex')), 0)
    OR target_attempt.email_minimum_auth_time IS DISTINCT FROM COALESCE((SELECT minimum_auth_time
      FROM auth.principal_session_fences WHERE subject_sha256 =
        encode(sha256(convert_to(target_attempt.snapshot_subject, 'UTF8')), 'hex')), 0)
    OR auth.principal_session_status(target_attempt.current_subject, target_attempt.current_auth_time) <> 'valid'
    OR auth.principal_session_status(target_attempt.snapshot_subject, target_attempt.email_minimum_auth_time) <> 'valid'
    OR (target_attempt.email_enrollment_verified_at IS NULL AND target_attempt.snapshot_subject IS DISTINCT FROM target_attempt.current_subject)
    OR (target_attempt.email_enrollment_verified_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM auth.verified_login_emails WHERE cognito_subject = target_attempt.snapshot_subject
        AND email = target_attempt.email_address AND verified_at = target_attempt.email_enrollment_verified_at))
    OR (target_attempt.proved_subject IS NOT NULL AND
      (target_attempt.proved_subject IS DISTINCT FROM target_attempt.snapshot_subject
        OR target_attempt.proved_username IS DISTINCT FROM target_attempt.snapshot_username
        OR target_attempt.proved_account IS DISTINCT FROM account_id OR target_attempt.email_proof_auth_time IS NULL
        OR auth.principal_session_status(target_attempt.proved_subject, target_attempt.email_proof_auth_time) <> 'valid')) THEN
    RAISE EXCEPTION 'Email reauthentication principal, enrollment, account or session changed; start again' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION auth.create_email_auth_attempt(
  target_hash TEXT, target_client TEXT, target_binding TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, target_email TEXT, original_auth_time BIGINT, target_ciphertext TEXT,
  email_subject TEXT, email_username TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  PERFORM auth.lock_email_attempt_lifecycle(target_subject, email_subject, NULL);
  attempt.attempt_sha256 := target_hash; attempt.client_type := target_client; attempt.purpose := 'reauth';
  attempt.binding_sha256 := target_binding; attempt.origin := target_origin;
  attempt.current_subject := target_subject; attempt.current_auth_time := original_auth_time;
  attempt.email_current_username := target_username;
  SELECT auth.canonical_account_id(user_id) INTO attempt.current_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  SELECT created_at INTO attempt.email_current_principal_created_at FROM auth.cognito_principals WHERE cognito_subject = target_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 =
    encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')), 0) INTO attempt.email_current_minimum_auth_time;
  attempt.snapshot_subject := email_subject; attempt.snapshot_username := email_username; attempt.snapshot_account := attempt.current_account;
  SELECT created_at INTO attempt.snapshot_principal_created_at FROM auth.cognito_principals WHERE cognito_subject = email_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 =
    encode(sha256(convert_to(email_subject, 'UTF8')), 'hex')), 0) INTO attempt.email_minimum_auth_time;
  SELECT verified_at INTO attempt.email_enrollment_verified_at FROM auth.verified_login_emails
  WHERE cognito_subject = email_subject AND email = target_email;
  IF attempt.email_enrollment_verified_at IS NULL THEN
    RAISE EXCEPTION 'Recovery email requires an enrolled mailbox principal' USING ERRCODE = '23514';
  END IF;
  attempt.email_address := target_email; attempt.email_started_at := clock_timestamp();
  attempt.phase := 'mailbox_sending'; attempt.claim_id := gen_random_uuid(); attempt.secret_ciphertext := target_ciphertext;
  attempt.expires_at := attempt.email_started_at + INTERVAL '3 minutes';
  PERFORM auth.assert_social_attempt_live(attempt);
  INSERT INTO auth.social_attempts SELECT attempt.*;
  RETURN NEXT attempt;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT)
FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.create_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.create_email_auth_attempt(
  target_hash TEXT, target_client TEXT, target_binding TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, target_email TEXT, original_auth_time BIGINT, target_ciphertext TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  SELECT auth.canonical_account_id(user_id) INTO attempt.current_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  PERFORM auth.assert_account_write_scope(attempt.current_account);
  PERFORM auth.register_cognito_principal(target_subject, target_username);
  PERFORM auth.lock_email_attempt_lifecycle(target_subject, target_subject, NULL);
  attempt.attempt_sha256 := target_hash; attempt.client_type := target_client; attempt.purpose := 'reauth';
  attempt.binding_sha256 := target_binding; attempt.origin := target_origin;
  attempt.current_subject := target_subject; attempt.current_auth_time := original_auth_time;
  attempt.snapshot_subject := target_subject; attempt.snapshot_username := target_username;
  attempt.snapshot_account := attempt.current_account;
  SELECT created_at INTO attempt.snapshot_principal_created_at FROM auth.cognito_principals WHERE cognito_subject = target_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences
    WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')), 0)
  INTO attempt.email_minimum_auth_time;
  attempt.email_current_username := target_username;
  attempt.email_current_principal_created_at := attempt.snapshot_principal_created_at;
  attempt.email_current_minimum_auth_time := attempt.email_minimum_auth_time;
  attempt.email_address := target_email; attempt.email_started_at := pg_catalog.clock_timestamp();
  attempt.phase := 'mailbox_sending'; attempt.claim_id := pg_catalog.gen_random_uuid();
  attempt.secret_ciphertext := target_ciphertext;
  attempt.expires_at := attempt.email_started_at + INTERVAL '3 minutes';
  PERFORM auth.assert_social_attempt_live(attempt);
  INSERT INTO auth.social_attempts SELECT attempt.*;
  RETURN NEXT attempt;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.create_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.claim_email_auth_attempt(
  target_hash TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash AND provider_type IS NULL
    AND purpose = 'reauth' AND current_subject = target_subject AND email_current_username = target_username
    AND current_auth_time IS NOT DISTINCT FROM original_auth_time
    AND binding_sha256 = target_binding AND client_type = target_client AND origin IS NOT DISTINCT FROM target_origin
    AND phase = 'mailbox_ready' AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  -- Commit this external boundary before consuming the Cognito challenge. It can never be reopened.
  RETURN QUERY UPDATE auth.social_attempts SET phase = 'mailbox_verifying', claim_id = pg_catalog.gen_random_uuid()
  WHERE attempt_sha256 = target_hash AND phase = 'mailbox_ready' AND expires_at > pg_catalog.clock_timestamp()
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.claim_email_auth_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.complete_email_auth_attempt(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT,
  target_email TEXT, proof_auth_time BIGINT, target_completion TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; expiry TIMESTAMPTZ;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash AND provider_type IS NULL;
  IF NOT FOUND OR target_claim IS NULL OR attempt.claim_id IS DISTINCT FROM target_claim
    OR attempt.phase <> 'mailbox_verifying' OR attempt.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Email proof was consumed or expired; start again' USING ERRCODE = '55006';
  END IF;
  IF target_subject IS DISTINCT FROM attempt.snapshot_subject OR target_username IS DISTINCT FROM attempt.snapshot_username
    OR target_email IS DISTINCT FROM attempt.email_address OR proof_auth_time IS NULL
    OR proof_auth_time < pg_catalog.floor(EXTRACT(EPOCH FROM attempt.email_started_at))::BIGINT
    OR proof_auth_time < pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::BIGINT - 60
    OR proof_auth_time > pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::BIGINT + 30 THEN
    RAISE EXCEPTION 'Email proof does not match this current-account challenge; start again' USING ERRCODE = '23514';
  END IF;
  attempt.proved_subject := target_subject; attempt.proved_username := target_username;
  attempt.proved_account := attempt.current_account; attempt.email_proof_auth_time := proof_auth_time;
  PERFORM auth.assert_social_attempt_live(attempt);
  expiry := LEAST(attempt.expires_at, pg_catalog.clock_timestamp() + INTERVAL '120 seconds');
  UPDATE auth.social_attempts SET phase = 'completed', proved_subject = target_subject, proved_username = target_username,
    proved_account = attempt.current_account, email_proof_auth_time = proof_auth_time, verified_at = pg_catalog.clock_timestamp(),
    completed_at = pg_catalog.clock_timestamp(), completion_sha256 = target_completion, completion_expires_at = expiry,
    secret_ciphertext = 'erased'
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = 'mailbox_verifying'
    AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Email proof was consumed or expired; start again' USING ERRCODE = '55006'; END IF;
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_email_auth_attempt(TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.complete_email_auth_attempt(TEXT, UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) TO auth_app;

ALTER FUNCTION auth.authorize_account_provider_action(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
RENAME TO authorize_provider_account_action;
REVOKE ALL ON FUNCTION auth.authorize_provider_account_action(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.authorize_account_provider_action(
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT, target_provider TEXT, target_provider_subject TEXT,
  target_receipt TEXT, receipt_binding TEXT, receipt_client TEXT, receipt_origin TEXT
) RETURNS auth.social_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.social_attempts%ROWTYPE; method_subject TEXT; account_id TEXT;
BEGIN
  SELECT * INTO receipt FROM auth.social_attempts WHERE completion_sha256 = target_receipt;
  IF receipt.provider_type IS NOT NULL OR receipt.attempt_sha256 IS NULL THEN
    RETURN auth.authorize_provider_account_action(target_subject, target_username, original_auth_time,
      target_provider, target_provider_subject, target_receipt, receipt_binding, receipt_client, receipt_origin);
  END IF;
  SELECT cognito_subject INTO method_subject FROM auth.provider_login_methods
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  IF method_subject IS NULL THEN
    RAISE EXCEPTION 'Method conflict or recent current-account proof required' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_email_attempt_lifecycle(target_subject, receipt.snapshot_subject, method_subject);
  SELECT auth.canonical_account_id(user_id) INTO account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF receipt.purpose <> 'reauth' OR receipt.phase <> 'completed'
    OR receipt.current_subject IS DISTINCT FROM target_subject OR receipt.current_account IS DISTINCT FROM account_id
    OR receipt.email_current_username IS DISTINCT FROM target_username
    OR receipt.current_auth_time IS DISTINCT FROM original_auth_time
    OR receipt.binding_sha256 IS DISTINCT FROM receipt_binding OR receipt.client_type IS DISTINCT FROM receipt_client
    OR receipt.origin IS DISTINCT FROM receipt_origin OR receipt.completion_expires_at <= clock_timestamp()
    OR receipt.expires_at <= clock_timestamp() OR receipt.verified_at IS NULL
    OR receipt.verified_at < clock_timestamp() - INTERVAL '120 seconds'
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities WHERE provider_type = 'cognito'
      AND provider_subject = method_subject AND auth.canonical_account_id(user_id) = account_id) THEN
    RAISE EXCEPTION 'Recent bound current-account email proof required; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_social_attempt_live(receipt);
  PERFORM 1 FROM auth.provider_login_methods WHERE cognito_subject IN (target_subject, method_subject, receipt.snapshot_subject)
  ORDER BY provider_type, provider_subject FOR UPDATE;
  SELECT * INTO receipt FROM auth.social_attempts WHERE attempt_sha256 = receipt.attempt_sha256 FOR UPDATE;
  IF receipt.phase <> 'completed' OR receipt.completion_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Current-account proof was consumed or expired; start again' USING ERRCODE = '55006';
  END IF;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION auth.authorize_account_provider_action(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, auth_app, backend_app;
