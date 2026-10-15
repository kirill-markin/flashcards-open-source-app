-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- A disabled-generation marker is internal-only; generic provider completion cannot consume it.
ALTER TABLE auth.social_attempts ADD COLUMN reenable_disabled_at TIMESTAMPTZ,
  ADD COLUMN reenable_minimum_auth_time BIGINT;

CREATE FUNCTION auth.account_provider_context(target_subject TEXT, target_username TEXT, original_auth_time BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT;
BEGIN
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, NULL, NULL);
  SELECT user_id INTO account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF (original_auth_time IS NOT NULL AND original_auth_time < 0)
    OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_subject
      AND cognito_username = target_username)
    OR account_id IS NULL OR auth.principal_session_status(target_subject, original_auth_time) <> 'valid' THEN
    RAISE EXCEPTION 'A live current-account session is required' USING ERRCODE = '23514';
  END IF;
  RETURN account_id;
END;
$$;
REVOKE ALL ON FUNCTION auth.account_provider_context(TEXT, TEXT, BIGINT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.account_provider_context(TEXT, TEXT, BIGINT) TO auth_app;

CREATE FUNCTION auth.list_account_provider_methods(target_subject TEXT, target_username TEXT, original_auth_time BIGINT)
RETURNS TABLE(provider_type TEXT, provider_subject TEXT, status TEXT, generation TEXT, revocation_pending BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT;
BEGIN
  PERFORM auth.register_cognito_principal(target_subject, target_username);
  account_id := auth.account_provider_context(target_subject, target_username, original_auth_time);
  RETURN QUERY SELECT methods.provider_type, methods.provider_subject, methods.status, methods.activated_at::TEXT,
    ((methods.provider_type = 'apple' AND auth.apple_revocation_pending(methods.provider_subject))
      OR EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
        encode(sha256(convert_to(methods.cognito_subject, 'UTF8')), 'hex') AND completed_at IS NULL))
  FROM auth.provider_login_methods AS methods
  JOIN auth.user_identities AS identities ON identities.provider_type = 'cognito'
    AND identities.provider_subject = methods.cognito_subject
  WHERE identities.user_id = account_id ORDER BY methods.provider_type, methods.provider_subject;
END;
$$;
REVOKE ALL ON FUNCTION auth.list_account_provider_methods(TEXT, TEXT, BIGINT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.list_account_provider_methods(TEXT, TEXT, BIGINT) TO auth_app;

-- Prelock the complete A/current, C/method, B/reauth set before any account, method or receipt lock.
CREATE FUNCTION auth.authorize_account_provider_action(
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT, target_provider TEXT, target_provider_subject TEXT,
  target_receipt TEXT, receipt_binding TEXT, receipt_client TEXT, receipt_origin TEXT
) RETURNS auth.social_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.social_attempts%ROWTYPE; method_subject TEXT; account_id TEXT;
BEGIN
  SELECT * INTO receipt FROM auth.social_attempts WHERE completion_sha256 = target_receipt;
  SELECT cognito_subject INTO method_subject FROM auth.provider_login_methods
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  IF receipt.attempt_sha256 IS NULL OR method_subject IS NULL THEN
    RAISE EXCEPTION 'Method conflict or recent current-account proof required' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, method_subject, receipt.proved_subject);
  account_id := auth.account_provider_context(target_subject, target_username, original_auth_time);
  IF receipt.purpose <> 'reauth' OR receipt.phase <> 'completed'
    OR receipt.current_subject IS DISTINCT FROM target_subject OR receipt.current_account IS DISTINCT FROM account_id
    OR receipt.binding_sha256 IS DISTINCT FROM receipt_binding OR receipt.client_type IS DISTINCT FROM receipt_client
    OR receipt.origin IS DISTINCT FROM receipt_origin OR receipt.completion_expires_at <= clock_timestamp()
    OR receipt.expires_at <= clock_timestamp() OR receipt.verified_at IS NULL
    OR receipt.verified_at < clock_timestamp() - INTERVAL '120 seconds'
    OR NOT EXISTS (SELECT 1 FROM auth.user_identities WHERE provider_type = 'cognito'
      AND provider_subject = method_subject AND user_id = account_id)
    OR auth.principal_session_status(receipt.proved_subject,
      floor(EXTRACT(EPOCH FROM receipt.verified_at))::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Recent bound current-account proof required; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_social_attempt_live(receipt);
  PERFORM 1 FROM auth.provider_login_methods WHERE cognito_subject IN (target_subject, method_subject, receipt.proved_subject)
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

CREATE FUNCTION auth.unlink_account_provider_method(
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT, target_provider TEXT, target_provider_subject TEXT,
  target_generation TIMESTAMPTZ, target_receipt TEXT, receipt_binding TEXT, receipt_client TEXT, receipt_origin TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE;
BEGIN
  receipt := auth.authorize_account_provider_action(target_subject, target_username, original_auth_time,
    target_provider, target_provider_subject, target_receipt, receipt_binding, receipt_client, receipt_origin);
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject FOR UPDATE;
  IF method.status <> 'active' OR method.activated_at IS DISTINCT FROM target_generation THEN
    RAISE EXCEPTION 'Provider method changed; reload account methods' USING ERRCODE = '23514';
  END IF;
  -- A relay address is technical recovery, never a substitute for another usable sign-in method.
  IF NOT EXISTS (
    SELECT 1 FROM auth.user_identities AS identities JOIN auth.provider_login_methods AS other
      ON other.cognito_subject = identities.provider_subject
    WHERE identities.provider_type = 'cognito' AND identities.user_id = receipt.current_account AND other.status = 'active'
      AND (other.provider_type, other.provider_subject) <> (target_provider, target_provider_subject)
      AND (other.provider_type <> 'apple' OR NOT auth.apple_revocation_pending(other.provider_subject))
      AND NOT EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
        encode(sha256(convert_to(other.cognito_subject, 'UTF8')), 'hex') AND completed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 =
        encode(sha256(convert_to(other.cognito_subject, 'UTF8')), 'hex'))
  ) AND NOT EXISTS (
    SELECT 1 FROM auth.user_identities AS identities JOIN auth.verified_login_emails AS emails
      ON emails.cognito_subject = identities.provider_subject
    WHERE identities.provider_type = 'cognito' AND identities.user_id = receipt.current_account
      AND emails.email !~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$'
      AND emails.email NOT LIKE '%@example.com'
      AND NOT EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 =
        encode(sha256(convert_to(emails.cognito_subject, 'UTF8')), 'hex'))
  ) AND NOT (receipt.provider_type IS NULL AND receipt.email_address IS NOT NULL
    AND receipt.email_address !~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$') THEN
    RAISE EXCEPTION 'Cannot unlink the last usable method; prove a non-relay email or link another provider' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.social_attempts SET phase = 'redeemed', secret_ciphertext = 'erased'
  WHERE attempt_sha256 = receipt.attempt_sha256 AND phase = 'completed';
  IF target_provider = 'apple' THEN
    PERFORM auth.queue_apple_revocation(target_provider_subject, 'unlink');
  ELSE
    PERFORM auth.invalidate_principal_sessions(method.cognito_subject, gen_random_uuid());
  END IF;
  UPDATE auth.provider_login_methods SET status = 'disabled', disabled_at = clock_timestamp(),
    activated_at = GREATEST(clock_timestamp(), activated_at + INTERVAL '1 microsecond')
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
END;
$$;
REVOKE ALL ON FUNCTION auth.unlink_account_provider_method(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.unlink_account_provider_method(TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) TO auth_app;

ALTER FUNCTION auth.assert_social_attempt_live(auth.social_attempts) RENAME TO assert_standard_attempt_live;
REVOKE ALL ON FUNCTION auth.assert_standard_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.assert_social_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ordinary auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE;
BEGIN
  IF target_attempt.reenable_disabled_at IS NULL THEN
    PERFORM auth.assert_standard_attempt_live(target_attempt);
    RETURN;
  END IF;
  ordinary := target_attempt;
  ordinary.snapshot_method_activated_at := NULL;
  PERFORM auth.assert_standard_attempt_live(ordinary);
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = target_attempt.provider_type AND provider_subject = target_attempt.provider_subject FOR UPDATE;
  IF NOT FOUND OR target_attempt.purpose <> 'link' OR target_attempt.reauth_attempt_sha256 IS NULL
    OR target_attempt.proved_subject IS NOT NULL OR method.status <> 'disabled'
    OR method.disabled_at IS DISTINCT FROM target_attempt.reenable_disabled_at
    OR method.activated_at IS DISTINCT FROM target_attempt.snapshot_method_activated_at
    OR method.cognito_subject IS DISTINCT FROM target_attempt.snapshot_subject
    OR target_attempt.snapshot_account IS DISTINCT FROM target_attempt.current_account
    OR target_attempt.reenable_minimum_auth_time IS DISTINCT FROM COALESCE((SELECT minimum_auth_time
      FROM auth.principal_session_fences WHERE subject_sha256 =
        encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex')), 0)
    OR EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
      encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex') AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Disabled method changed or revocation is pending; start again after cleanup' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_social_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.create_account_provider_reenable(
  target_hash TEXT, target_provider TEXT, target_provider_subject TEXT, target_generation TIMESTAMPTZ,
  target_client TEXT, target_binding TEXT, target_origin TEXT, target_redirect TEXT,
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT, target_ciphertext TEXT,
  target_receipt TEXT, receipt_binding TEXT, receipt_client TEXT, receipt_origin TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE; attempt auth.social_attempts%ROWTYPE; expiry TIMESTAMPTZ;
BEGIN
  receipt := auth.authorize_account_provider_action(target_subject, target_username, original_auth_time,
    target_provider, target_provider_subject, target_receipt, receipt_binding, receipt_client, receipt_origin);
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject FOR UPDATE;
  IF method.status <> 'disabled' OR method.activated_at IS DISTINCT FROM target_generation THEN
    RAISE EXCEPTION 'Re-enable requires the current disabled provider method' USING ERRCODE = '23514';
  END IF;
  expiry := auth.create_social_attempt(target_hash, target_provider, target_client, 'link', target_binding,
    target_origin, target_redirect, target_subject, receipt.current_account, target_ciphertext,
    target_receipt, receipt_binding, receipt_client, receipt_origin);
  UPDATE auth.social_attempts SET provider_subject = target_provider_subject, snapshot_subject = method.cognito_subject,
    snapshot_username = (SELECT cognito_username FROM auth.cognito_principals WHERE cognito_subject = method.cognito_subject),
    snapshot_principal_created_at = (SELECT created_at FROM auth.cognito_principals WHERE cognito_subject = method.cognito_subject),
    snapshot_provider_created_at = (SELECT created_at FROM auth.provider_identities
      WHERE provider_type = target_provider AND provider_subject = target_provider_subject),
    snapshot_account = receipt.current_account, snapshot_method_activated_at = method.activated_at,
    reenable_disabled_at = method.disabled_at,
    reenable_minimum_auth_time = COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences
      WHERE subject_sha256 = encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex')), 0)
  WHERE attempt_sha256 = target_hash RETURNING * INTO attempt;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_account_provider_reenable(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.create_account_provider_reenable(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

ALTER FUNCTION auth.advance_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) RENAME TO advance_standard_attempt;
REVOKE ALL ON FUNCTION auth.advance_standard_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.advance_social_attempt(
  target_hash TEXT, target_claim UUID, target_from TEXT, target_to TEXT, target_ciphertext TEXT, target_provider_subject TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF attempt.reenable_disabled_at IS NULL THEN
    PERFORM auth.advance_standard_attempt(target_hash, target_claim, target_from, target_to, target_ciphertext, target_provider_subject);
    RETURN;
  END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  IF NOT ((target_from = 'provider_claimed' AND target_to = 'provider_verifying' AND target_provider_subject IS NULL)
    OR (target_from = 'provider_verifying' AND target_to = 'provider_proved' AND target_provider_subject = attempt.provider_subject)) THEN
    RAISE EXCEPTION 'Explicit re-enable requires fresh proof of this disabled provider identity' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.social_attempts SET phase = target_to, secret_ciphertext = target_ciphertext,
    verified_at = CASE WHEN target_to = 'provider_proved' THEN clock_timestamp() ELSE verified_at END
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = target_from AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Re-enable proof consumed or expired; start again' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.advance_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.advance_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.complete_social_attempt(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT, target_completion TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.social_attempts WHERE attempt_sha256 = target_hash
    AND (provider_type IS NULL OR reenable_disabled_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'This proof requires its dedicated internal completion' USING ERRCODE = '23514';
  END IF;
  RETURN auth.complete_provider_attempt(target_hash, target_claim, target_subject, target_username, target_completion);
END;
$$;

CREATE FUNCTION auth.complete_account_provider_reenable(
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT,
  target_hash TEXT, target_claim UUID, target_binding TEXT, target_client TEXT, target_origin TEXT,
  target_provider_subject TEXT, target_client_id TEXT, apple_ciphertext TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; receipt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND OR attempt.reenable_disabled_at IS NULL OR attempt.current_subject IS DISTINCT FROM target_subject
    OR attempt.binding_sha256 IS DISTINCT FROM target_binding OR attempt.client_type IS DISTINCT FROM target_client
    OR attempt.origin IS DISTINCT FROM target_origin OR attempt.claim_id IS DISTINCT FROM target_claim
    OR target_claim IS NULL OR attempt.phase <> 'provider_proved' OR attempt.expires_at <= clock_timestamp()
    OR attempt.verified_at IS NULL OR attempt.verified_at < clock_timestamp() - INTERVAL '120 seconds'
    OR attempt.provider_subject IS DISTINCT FROM target_provider_subject THEN
    RAISE EXCEPTION 'Bound fresh re-enable proof required; start again' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO receipt FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256;
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, attempt.snapshot_subject, receipt.proved_subject);
  IF auth.account_provider_context(target_subject, target_username, original_auth_time) IS DISTINCT FROM attempt.current_account
    OR auth.principal_session_status(receipt.proved_subject, floor(EXTRACT(EPOCH FROM receipt.verified_at))::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Re-enable session or account proof changed; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 = target_hash FOR UPDATE;
  UPDATE auth.social_attempts SET phase = 'redeemed', secret_ciphertext = 'erased'
  WHERE attempt_sha256 = target_hash AND phase = 'provider_proved' AND claim_id = target_claim AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Re-enable proof consumed or expired; start again' USING ERRCODE = '55006'; END IF;
  UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL,
    activated_at = GREATEST(clock_timestamp(), activated_at + INTERVAL '1 microsecond')
  WHERE provider_type = attempt.provider_type AND provider_subject = target_provider_subject;
  IF attempt.provider_type = 'apple' THEN
    IF apple_ciphertext IS NULL OR target_client_id IS NULL THEN
      RAISE EXCEPTION 'Apple re-enable requires the freshly verified encrypted credential' USING ERRCODE = '23514';
    END IF;
    PERFORM auth.store_apple_credential(attempt.snapshot_subject, target_provider_subject, target_client_id, apple_ciphertext);
  ELSIF apple_ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'Google re-enable cannot store an Apple credential' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_account_provider_reenable(TEXT, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.complete_account_provider_reenable(TEXT, TEXT, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE FUNCTION auth.redeem_account_provider_link(
  target_subject TEXT, target_username TEXT, original_auth_time BIGINT,
  target_completion TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; receipt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE completion_sha256 = target_completion
    AND current_subject = target_subject AND purpose = 'link' AND reenable_disabled_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bound provider link completion required' USING ERRCODE = '23514'; END IF;
  SELECT * INTO receipt FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256;
  PERFORM auth.lock_social_attempt_lifecycle(target_subject, attempt.proved_subject, receipt.proved_subject);
  IF auth.account_provider_context(target_subject, target_username, original_auth_time) IS DISTINCT FROM attempt.current_account
    OR auth.principal_session_status(receipt.proved_subject, floor(EXTRACT(EPOCH FROM receipt.verified_at))::BIGINT) <> 'valid' THEN
    RAISE EXCEPTION 'Link session or account proof changed; start again' USING ERRCODE = '23514';
  END IF;
  PERFORM * FROM auth.link_and_redeem_social_completion(target_completion, target_binding, target_client, target_origin);
  IF NOT FOUND THEN RAISE EXCEPTION 'Link proof consumed or expired; start again' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.redeem_account_provider_link(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.redeem_account_provider_link(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO auth_app;
