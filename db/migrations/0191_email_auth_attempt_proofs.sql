-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- Email reauthentication uses the same one-use ledger; NULL provider means no provider identity.
ALTER TABLE auth.social_attempts ALTER COLUMN provider_type DROP NOT NULL;
ALTER TABLE auth.social_attempts DROP CONSTRAINT social_attempts_check4;
ALTER TABLE auth.social_attempts ADD CONSTRAINT social_attempts_redirect_binding CHECK (
  (provider_type IS NULL AND redirect_uri IS NULL)
  OR (provider_type IS NOT NULL AND
    ((client_type = 'web' OR (client_type = 'android' AND provider_type = 'apple')) = (redirect_uri IS NOT NULL))));
ALTER TABLE auth.social_attempts
  ADD COLUMN email_address TEXT,
  ADD COLUMN current_auth_time BIGINT,
  ADD COLUMN email_minimum_auth_time BIGINT,
  ADD COLUMN email_started_at TIMESTAMPTZ,
  ADD COLUMN email_proof_auth_time BIGINT,
  ADD CONSTRAINT social_attempts_email_proof CHECK (
    (provider_type IS NOT NULL AND email_address IS NULL AND email_started_at IS NULL
      AND email_minimum_auth_time IS NULL AND email_proof_auth_time IS NULL AND current_auth_time IS NULL)
    OR (provider_type IS NULL AND purpose = 'reauth' AND current_subject IS NOT NULL
      AND email_address IS NOT NULL AND email_address = pg_catalog.lower(pg_catalog.btrim(email_address))
      AND pg_catalog.length(email_address) <= 254 AND email_address NOT LIKE '%@example.com'
      AND email_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND email_started_at IS NOT NULL AND email_minimum_auth_time IS NOT NULL
      AND email_minimum_auth_time >= 0 AND (current_auth_time IS NULL OR current_auth_time >= 0)
      AND snapshot_subject IS NOT DISTINCT FROM current_subject AND snapshot_username IS NOT NULL
      AND snapshot_account IS NOT DISTINCT FROM current_account AND snapshot_principal_created_at IS NOT NULL
      AND provider_subject IS NULL AND reauth_attempt_sha256 IS NULL
      AND snapshot_provider_created_at IS NULL AND snapshot_method_activated_at IS NULL AND method_activated_at IS NULL
      AND result_ciphertext IS NULL
      AND phase IN ('mailbox_sending', 'mailbox_ready', 'mailbox_claimed', 'mailbox_verifying', 'completed', 'redeemed')
      AND (phase NOT IN ('completed', 'redeemed') OR
        (email_proof_auth_time IS NOT NULL AND proved_subject IS NOT DISTINCT FROM current_subject
          AND proved_username IS NOT DISTINCT FROM snapshot_username))));

ALTER FUNCTION auth.assert_social_attempt_live(auth.social_attempts) RENAME TO assert_provider_attempt_live;
CREATE FUNCTION auth.assert_social_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT; minimum_time BIGINT;
BEGIN
  IF target_attempt.provider_type IS NOT NULL THEN
    PERFORM auth.assert_provider_attempt_live(target_attempt);
    RETURN;
  END IF;
  PERFORM auth.lock_social_attempt_lifecycle(target_attempt.current_subject, NULL, NULL);
  SELECT user_id INTO account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_attempt.current_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences
    WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_attempt.current_subject, 'UTF8')), 'hex')), 0)
  INTO minimum_time;
  IF target_attempt.email_address IS NULL OR target_attempt.purpose IS DISTINCT FROM 'reauth'
    OR account_id IS NULL OR account_id IS DISTINCT FROM target_attempt.current_account
    OR minimum_time IS DISTINCT FROM target_attempt.email_minimum_auth_time
    OR auth.principal_session_status(target_attempt.current_subject, target_attempt.current_auth_time) <> 'valid'
    OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals
      WHERE cognito_subject = target_attempt.current_subject AND cognito_username = target_attempt.snapshot_username
        AND created_at = target_attempt.snapshot_principal_created_at)
    OR (target_attempt.proved_subject IS NOT NULL AND
      (target_attempt.proved_subject IS DISTINCT FROM target_attempt.current_subject
        OR target_attempt.proved_username IS DISTINCT FROM target_attempt.snapshot_username
        OR target_attempt.proved_account IS DISTINCT FROM account_id
        OR target_attempt.email_proof_auth_time IS NULL
        OR auth.principal_session_status(target_attempt.proved_subject, target_attempt.email_proof_auth_time) <> 'valid')) THEN
    RAISE EXCEPTION 'Email reauthentication principal, account or session changed; start again' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_social_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;

-- Generic provider completion cannot manufacture an email receipt or bypass the EMAIL_OTP boundary.
ALTER FUNCTION auth.complete_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT) RENAME TO complete_provider_attempt;
REVOKE ALL ON FUNCTION auth.complete_provider_attempt(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.complete_social_attempt(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT, target_completion TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.social_attempts WHERE attempt_sha256 = target_hash AND provider_type IS NULL) THEN
    RAISE EXCEPTION 'Email reauthentication requires its real mailbox proof completion' USING ERRCODE = '23514';
  END IF;
  RETURN auth.complete_provider_attempt(target_hash, target_claim, target_subject, target_username, target_completion);
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.complete_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT) TO auth_app;

-- All principal fields come from the internal signature-verifying adapter, never request JSON.
CREATE FUNCTION auth.create_email_auth_attempt(
  target_hash TEXT, target_client TEXT, target_binding TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, target_email TEXT, original_auth_time BIGINT, target_ciphertext TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  PERFORM auth.register_cognito_principal(target_subject, target_username);
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, NULL, NULL);
  attempt.attempt_sha256 := target_hash; attempt.client_type := target_client; attempt.purpose := 'reauth';
  attempt.binding_sha256 := target_binding; attempt.origin := target_origin;
  attempt.current_subject := target_subject; attempt.current_auth_time := original_auth_time;
  SELECT user_id INTO attempt.current_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  attempt.snapshot_subject := target_subject; attempt.snapshot_username := target_username;
  attempt.snapshot_account := attempt.current_account;
  SELECT created_at INTO attempt.snapshot_principal_created_at FROM auth.cognito_principals WHERE cognito_subject = target_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences
    WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')), 0)
  INTO attempt.email_minimum_auth_time;
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

CREATE FUNCTION auth.ready_email_auth_attempt(target_hash TEXT, target_claim UUID, target_ciphertext TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash AND provider_type IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email attempt missing; start again' USING ERRCODE = '55006'; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  UPDATE auth.social_attempts SET phase = 'mailbox_ready', secret_ciphertext = target_ciphertext
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = 'mailbox_sending'
    AND expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Email sending outcome is ambiguous or expired; start again' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.ready_email_auth_attempt(TEXT, UUID, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.ready_email_auth_attempt(TEXT, UUID, TEXT) TO auth_app;

CREATE FUNCTION auth.claim_email_auth_attempt(
  target_hash TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT,
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash AND provider_type IS NULL
    AND purpose = 'reauth' AND current_subject = target_subject AND snapshot_username = target_username
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

-- Server-only verified EMAIL_OTP result, signed original auth_time and immutable username/sub.
CREATE FUNCTION auth.complete_email_auth_attempt(
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
  IF target_subject IS DISTINCT FROM attempt.current_subject OR target_username IS DISTINCT FROM attempt.snapshot_username
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
