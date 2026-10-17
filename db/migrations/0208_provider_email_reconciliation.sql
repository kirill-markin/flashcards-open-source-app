-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- The server owns fresh provider/mailbox proof; Cognito preparation happens before this transaction.
CREATE FUNCTION auth.lock_provider_email_enrollment(
  target_provider TEXT, target_provider_subject TEXT, email_subject TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE bound_subject TEXT; fresh_subject TEXT; item TEXT; accounts TEXT[]; fresh_accounts TEXT[];
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Email enrollment requires a fresh read-committed transaction' USING ERRCODE = 'P0A01';
  END IF;
  IF target_provider NOT IN ('apple', 'google') OR target_provider IS NULL
    OR target_provider_subject IS NULL OR length(target_provider_subject) NOT BETWEEN 1 AND 255
    OR email_subject IS NOT NULL AND btrim(email_subject) = '' THEN
    RAISE EXCEPTION 'Provider email enrollment identity is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT cognito_subject INTO bound_subject FROM auth.provider_identities
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  FOR item IN SELECT DISTINCT unnest(ARRAY[bound_subject, email_subject]) ORDER BY 1 LOOP
    IF item IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || item, 2::BIGINT));
    END IF;
  END LOOP;
  SELECT cognito_subject INTO fresh_subject FROM auth.provider_identities
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  IF fresh_subject IS DISTINCT FROM bound_subject THEN
    RAISE EXCEPTION 'Provider binding changed; restart sign-in' USING ERRCODE = '23505';
  END IF;
  SELECT COALESCE(array_agg(user_id ORDER BY user_id), ARRAY[]::TEXT[]) INTO accounts FROM (
    SELECT identities.user_id FROM auth.user_identities AS identities
    WHERE identities.provider_type = 'cognito' AND identities.provider_subject IN (bound_subject, email_subject)
    UNION SELECT settings.user_id FROM org.user_settings AS settings WHERE settings.user_id IN (bound_subject, email_subject)
    UNION SELECT auth.canonical_account_id(identities.user_id) FROM auth.user_identities AS identities
    WHERE identities.provider_type = 'cognito' AND identities.provider_subject IN (bound_subject, email_subject)
    UNION SELECT auth.canonical_account_id(settings.user_id) FROM org.user_settings AS settings
    WHERE settings.user_id IN (bound_subject, email_subject)
  ) AS owners;
  FOREACH item IN ARRAY accounts LOOP
    IF auth.canonical_account_id(item) = item THEN PERFORM auth.assert_account_write_scope(item); END IF;
  END LOOP;
  FOREACH item IN ARRAY accounts LOOP
    PERFORM auth.lock_account_lifecycle(item);
  END LOOP;
  SELECT COALESCE(array_agg(user_id ORDER BY user_id), ARRAY[]::TEXT[]) INTO fresh_accounts FROM (
    SELECT identities.user_id FROM auth.user_identities AS identities
    WHERE identities.provider_type = 'cognito' AND identities.provider_subject IN (bound_subject, email_subject)
    UNION SELECT settings.user_id FROM org.user_settings AS settings WHERE settings.user_id IN (bound_subject, email_subject)
    UNION SELECT auth.canonical_account_id(identities.user_id) FROM auth.user_identities AS identities
    WHERE identities.provider_type = 'cognito' AND identities.provider_subject IN (bound_subject, email_subject)
    UNION SELECT auth.canonical_account_id(settings.user_id) FROM org.user_settings AS settings
    WHERE settings.user_id IN (bound_subject, email_subject)
  ) AS owners;
  IF fresh_accounts IS DISTINCT FROM accounts THEN
    RAISE EXCEPTION 'Email enrollment account inventory changed; restart sign-in' USING ERRCODE = 'P0A01';
  END IF;
  FOREACH item IN ARRAY accounts LOOP
    IF EXISTS (SELECT 1 FROM auth.deleted_accounts WHERE user_id_sha256 =
      encode(sha256(convert_to(item, 'UTF8')), 'hex')) THEN
      RAISE EXCEPTION 'Email enrollment account has been deleted' USING ERRCODE = '23514';
    END IF;
    PERFORM auth.assert_account_live(auth.canonical_account_id(item));
  END LOOP;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects WHERE subject_sha256 IN (
    encode(sha256(convert_to(bound_subject, 'UTF8')), 'hex'), encode(sha256(convert_to(email_subject, 'UTF8')), 'hex'))) THEN
    RAISE EXCEPTION 'Email enrollment principal has been deleted' USING ERRCODE = '23514';
  END IF;
  RETURN bound_subject;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_provider_email_enrollment(TEXT, TEXT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.lock_provider_email_enrollment(TEXT, TEXT, TEXT) TO auth_app;

-- The composer prelocks both owners before reconnect; this boundary rechecks the exact claimed proof.
CREATE FUNCTION auth.enroll_apple_login_email(
  target_hash TEXT, target_claim UUID, target_provider_subject TEXT, current_subject TEXT,
  email_subject TEXT, email_username TEXT, target_email TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; locked_attempt auth.social_attempts%ROWTYPE;
  original_account TEXT; selected_account TEXT; email_raw_account TEXT; email_legacy_account TEXT;
  email_account TEXT; outcome TEXT; affected INTEGER;
BEGIN
  IF auth.lock_provider_email_enrollment(
    'apple', target_provider_subject, email_subject) IS DISTINCT FROM current_subject THEN
    RAISE EXCEPTION 'Apple provider binding changed; restart sign-in' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND OR target_hash IS NULL OR target_hash !~ '^[0-9a-f]{64}$' OR target_claim IS NULL
    OR attempt.claim_id IS DISTINCT FROM target_claim OR attempt.provider_type IS DISTINCT FROM 'apple'
    OR attempt.purpose IS DISTINCT FROM 'login' OR attempt.phase IS DISTINCT FROM 'provider_enrolling'
    OR attempt.provider_subject IS DISTINCT FROM target_provider_subject
    OR attempt.expires_at <= clock_timestamp() OR attempt.verified_at IS NULL
    OR attempt.verified_at <= clock_timestamp() - INTERVAL '10 minutes'
    OR attempt.verified_at > clock_timestamp() + INTERVAL '30 seconds' THEN
    RAISE EXCEPTION 'Apple Email enrollment requires this live claimed login proof' USING ERRCODE = '55006';
  END IF;
  IF current_subject IS NULL OR email_subject IS NULL OR btrim(email_subject) = ''
    OR email_username IS NULL OR btrim(email_username) = ''
    OR attempt.snapshot_subject IS DISTINCT FROM current_subject OR attempt.snapshot_username IS NULL
    OR attempt.snapshot_provider_created_at IS NULL OR attempt.snapshot_principal_created_at IS NULL
    OR attempt.snapshot_method_activated_at IS NULL OR attempt.current_subject IS NOT NULL
    OR attempt.current_account IS NOT NULL OR attempt.current_auth_time IS NOT NULL
    OR attempt.reauth_attempt_sha256 IS NOT NULL OR attempt.proved_subject IS NOT NULL
    OR attempt.proved_username IS NOT NULL OR attempt.proved_account IS NOT NULL
    OR attempt.method_activated_at IS NOT NULL OR attempt.reenable_disabled_at IS NOT NULL
    OR attempt.reenable_minimum_auth_time IS NOT NULL OR attempt.reconnect_disabled_at IS NOT NULL
    OR attempt.reconnect_consent_at IS NOT NULL OR attempt.reconnect_proof_issued_at IS NOT NULL
    OR attempt.reconnect_minimum_auth_time IS NOT NULL THEN
    RAISE EXCEPTION 'Apple Email enrollment requires the unchanged bound login principal' USING ERRCODE = '23514';
  END IF;
  IF target_email IS NULL OR target_email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$' THEN
    RAISE EXCEPTION 'Apple Email enrollment requires an authoritative real mailbox' USING ERRCODE = '23514';
  END IF;
  -- Assert the ORIGINAL snapshot before any product write; no other null snapshot is advanced.
  PERFORM auth.assert_social_attempt_live(attempt);
  SELECT * INTO locked_attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash FOR UPDATE;
  IF NOT FOUND OR locked_attempt IS DISTINCT FROM attempt OR locked_attempt.expires_at <= clock_timestamp()
    OR locked_attempt.verified_at <= clock_timestamp() - INTERVAL '10 minutes' THEN
    RAISE EXCEPTION 'Apple login proof changed or expired; start again' USING ERRCODE = '55006';
  END IF;
  PERFORM auth.assert_real_principal_login_policy(current_subject);
  SELECT user_id INTO original_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = current_subject;
  IF original_account IS NULL THEN
    SELECT user_id INTO original_account FROM org.user_settings WHERE user_id = current_subject;
  END IF;
  SELECT user_id INTO email_raw_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = email_subject;
  SELECT user_id INTO email_legacy_account FROM org.user_settings WHERE user_id = email_subject;
  email_account := auth.canonical_account_id(COALESCE(email_raw_account, email_legacy_account));
  IF original_account IS NOT NULL THEN
    selected_account := auth.canonical_account_id(original_account);
    IF email_account IS NOT NULL AND email_account <> selected_account
      OR email_legacy_account IS NOT NULL AND auth.canonical_account_id(email_legacy_account) <> selected_account THEN
      RETURN 'foreign_account';
    END IF;
  ELSE
    IF email_raw_account IS NOT NULL AND email_legacy_account IS NOT NULL
      AND auth.canonical_account_id(email_raw_account) <> auth.canonical_account_id(email_legacy_account) THEN
      RAISE EXCEPTION 'Email principal has conflicting account owners' USING ERRCODE = '23505';
    END IF;
    -- Select Q's existing owner before minting. Auth creates only the profile; guest transfer owns content.
    selected_account := COALESCE(email_account, gen_random_uuid()::TEXT);
    PERFORM auth.assert_account_write_scope(selected_account);
    PERFORM auth.lock_account_lifecycle(selected_account);
    PERFORM auth.assert_account_live(selected_account);
    IF email_account IS NULL THEN
      INSERT INTO org.user_settings(user_id, email) VALUES (selected_account, target_email);
    END IF;
    PERFORM auth.bind_cognito_account(current_subject, selected_account);
    -- This function alone made P's first mapping under the unchanged original null snapshot.
    UPDATE auth.social_attempts SET snapshot_account = selected_account
    WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND provider_type = 'apple'
      AND purpose = 'login' AND provider_subject = target_provider_subject AND snapshot_subject = enroll_apple_login_email.current_subject
      AND phase = 'provider_enrolling' AND expires_at > clock_timestamp() AND snapshot_account IS NULL
      AND snapshot_username = attempt.snapshot_username
      AND snapshot_provider_created_at = attempt.snapshot_provider_created_at
      AND snapshot_principal_created_at = attempt.snapshot_principal_created_at
      AND snapshot_method_activated_at = attempt.snapshot_method_activated_at
      AND selected_account IS NOT DISTINCT FROM (SELECT user_id FROM auth.user_identities
        WHERE provider_type = 'cognito' AND provider_subject = enroll_apple_login_email.current_subject);
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'Apple first-account proof was consumed or expired; start again' USING ERRCODE = '55006';
    END IF;
    SELECT * INTO STRICT attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
    PERFORM auth.assert_social_attempt_live(attempt);
  END IF;
  PERFORM auth.assert_account_write_scope(selected_account);
  PERFORM auth.assert_account_live(selected_account);
  PERFORM auth.assert_real_principal_login_policy(email_subject);
  IF EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
    encode(sha256(convert_to(email_subject, 'UTF8')), 'hex') AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Email principal signout is pending; retry a fresh sign-in after cleanup completes' USING ERRCODE = '55006';
  END IF;
  PERFORM auth.enroll_proved_email_principal(email_subject, email_username, target_email, attempt.verified_at);
  IF email_raw_account IS NULL THEN
    PERFORM auth.bind_cognito_account(email_subject, selected_account);
    outcome := 'linked';
  ELSE
    outcome := 'already_same_account';
  END IF;
  -- Project only after Q is usable; retain a genuine existing primary and P's recovery binding.
  UPDATE org.user_settings SET email = target_email
  WHERE user_id = selected_account AND (email IS NULL OR email ~ '@(privaterelay\.appleid\.com|private\.icloud\.com)$');
  RETURN outcome;
END;
$$;
REVOKE ALL ON FUNCTION auth.enroll_apple_login_email(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.enroll_apple_login_email(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;
