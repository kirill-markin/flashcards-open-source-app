-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- Transient secrets and proof results are encrypted by auth. No tokens are stored in completions.
CREATE TABLE auth.social_attempts (
  attempt_sha256 TEXT PRIMARY KEY CHECK (attempt_sha256 ~ '^[0-9a-f]{64}$'),
  provider_type TEXT NOT NULL CHECK (provider_type IN ('apple', 'google')),
  client_type TEXT NOT NULL CHECK (client_type IN ('web', 'android', 'ios', 'ios-development', 'macos', 'macos-development')),
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'link', 'reauth')),
  binding_sha256 TEXT NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  origin TEXT,
  redirect_uri TEXT,
  current_subject TEXT,
  current_account TEXT,
  reauth_attempt_sha256 TEXT,
  provider_subject TEXT,
  proved_subject TEXT,
  proved_username TEXT,
  proved_account TEXT,
  method_activated_at TIMESTAMPTZ,
  snapshot_subject TEXT,
  snapshot_username TEXT,
  snapshot_account TEXT,
  snapshot_provider_created_at TIMESTAMPTZ,
  snapshot_principal_created_at TIMESTAMPTZ,
  snapshot_method_activated_at TIMESTAMPTZ,
  phase TEXT NOT NULL DEFAULT 'provider_ready' CHECK (phase IN
    ('provider_ready', 'provider_claimed', 'provider_verifying', 'provider_proved', 'provider_enrolling', 'mailbox_required', 'mailbox_sending', 'mailbox_ready', 'mailbox_claimed', 'mailbox_verifying', 'completed', 'redeemed')),
  claim_id UUID,
  secret_ciphertext TEXT NOT NULL CHECK (length(secret_ciphertext) BETWEEN 1 AND 65536),
  completion_sha256 TEXT UNIQUE CHECK (completion_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (pg_catalog.clock_timestamp() + INTERVAL '10 minutes'),
  completion_expires_at TIMESTAMPTZ,
  CHECK ((purpose = 'login') = (current_subject IS NULL)),
  CHECK ((current_subject IS NULL) = (current_account IS NULL)),
  CHECK ((client_type = 'web') = (origin IS NOT NULL)),
  CHECK (redirect_uri IS NULL OR redirect_uri IN (
    'https://auth.nibomo.com/api/social/' || provider_type || '/callback',
    'https://auth.flashcards-open-source-app.com/api/social/' || provider_type || '/callback')),
  CHECK ((client_type = 'web' OR (client_type = 'android' AND provider_type = 'apple')) = (redirect_uri IS NOT NULL))
);
CREATE INDEX ON auth.social_attempts(expires_at);
REVOKE ALL ON auth.social_attempts FROM PUBLIC, auth_app, backend_app;

CREATE TABLE auth.social_rate_buckets (
  bucket_sha256 TEXT NOT NULL CHECK (bucket_sha256 ~ '^[0-9a-f]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL CHECK (hits BETWEEN 1 AND 201),
  PRIMARY KEY (bucket_sha256, window_start)
);
REVOKE ALL ON auth.social_rate_buckets FROM PUBLIC, auth_app, backend_app;

-- Sorted subject locks, then sorted account locks, then method rows, then attempt rows.
CREATE FUNCTION auth.lock_social_attempt_lifecycle(target_current TEXT, target_proved TEXT, target_reauth TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE subject TEXT; account_id TEXT;
BEGIN
  FOR subject IN SELECT DISTINCT unnest(ARRAY[target_current, target_proved, target_reauth]) ORDER BY 1 LOOP
    IF subject IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || subject, 2::bigint));
    END IF;
  END LOOP;
  FOR account_id IN
    SELECT identities.user_id FROM auth.user_identities AS identities
    WHERE identities.provider_type = 'cognito' AND identities.provider_subject IN (target_current, target_proved, target_reauth)
    UNION SELECT settings.user_id FROM org.user_settings AS settings
    WHERE settings.user_id IN (target_current, target_proved, target_reauth)
    ORDER BY 1
  LOOP
    PERFORM auth.lock_account_lifecycle(account_id);
    PERFORM auth.assert_account_live(account_id);
  END LOOP;
  FOR subject IN SELECT DISTINCT unnest(ARRAY[target_current, target_proved, target_reauth]) ORDER BY 1 LOOP
    IF subject IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM auth.deleted_subjects
        WHERE subject_sha256 = encode(sha256(convert_to(subject, 'UTF8')), 'hex'))
        OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = subject) THEN
        RAISE EXCEPTION 'Attempt principal is deleted or missing' USING ERRCODE = '23514';
      END IF;
      PERFORM auth.assert_real_principal_login_policy(subject);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_social_attempt_lifecycle(TEXT, TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.assert_social_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT; method auth.provider_login_methods%ROWTYPE; receipt auth.social_attempts%ROWTYPE;
BEGIN
  IF target_attempt.reauth_attempt_sha256 IS NOT NULL THEN
    SELECT * INTO receipt FROM auth.social_attempts WHERE attempt_sha256 = target_attempt.reauth_attempt_sha256;
    IF NOT FOUND OR receipt.purpose <> 'reauth' OR receipt.phase <> 'redeemed'
      OR receipt.current_account IS DISTINCT FROM target_attempt.current_account
      OR receipt.current_subject IS DISTINCT FROM target_attempt.current_subject
      OR receipt.completion_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Current account reauthentication expired or changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM auth.lock_social_attempt_lifecycle(target_attempt.current_subject, COALESCE(target_attempt.snapshot_subject, target_attempt.proved_subject), receipt.proved_subject);
  IF target_attempt.reauth_attempt_sha256 IS NOT NULL THEN
    PERFORM auth.assert_social_attempt_live(receipt);
  END IF;
  IF target_attempt.current_subject IS NOT NULL THEN
    SELECT user_id INTO account_id FROM auth.user_identities
    WHERE provider_type = 'cognito' AND provider_subject = target_attempt.current_subject;
    IF account_id IS DISTINCT FROM target_attempt.current_account THEN
      RAISE EXCEPTION 'Attempt current account changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF target_attempt.snapshot_subject IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM auth.provider_identities AS identities
      JOIN auth.cognito_principals AS principals ON principals.cognito_subject = identities.cognito_subject
      WHERE identities.provider_type = target_attempt.provider_type AND identities.provider_subject = target_attempt.provider_subject
        AND identities.cognito_subject = target_attempt.snapshot_subject
        AND identities.created_at = target_attempt.snapshot_provider_created_at
        AND principals.cognito_username = target_attempt.snapshot_username
        AND principals.created_at = target_attempt.snapshot_principal_created_at
    ) THEN
      RAISE EXCEPTION 'Verified provider binding was deleted or changed; start again' USING ERRCODE = '23514';
    END IF;
    SELECT user_id INTO account_id FROM auth.user_identities
    WHERE provider_type = 'cognito' AND provider_subject = target_attempt.snapshot_subject;
    IF account_id IS DISTINCT FROM target_attempt.snapshot_account
      AND NOT (target_attempt.purpose = 'link' AND target_attempt.snapshot_account IS NULL
        AND account_id IS NOT DISTINCT FROM target_attempt.current_account) THEN
      RAISE EXCEPTION 'Verified provider account changed; start again' USING ERRCODE = '23514';
    END IF;
    IF target_attempt.snapshot_method_activated_at IS NOT NULL THEN
      SELECT * INTO method FROM auth.provider_login_methods
      WHERE provider_type = target_attempt.provider_type AND provider_subject = target_attempt.provider_subject FOR UPDATE;
      IF NOT FOUND OR method.status <> 'active' OR method.cognito_subject <> target_attempt.snapshot_subject
        OR method.activated_at IS DISTINCT FROM target_attempt.snapshot_method_activated_at THEN
        RAISE EXCEPTION 'Verified provider method was deleted, disabled or changed; start again' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF target_attempt.proved_subject IS NOT NULL THEN
    SELECT user_id INTO account_id FROM auth.user_identities
    WHERE provider_type = 'cognito' AND provider_subject = target_attempt.proved_subject;
    IF target_attempt.proved_account IS NOT NULL AND account_id IS DISTINCT FROM target_attempt.proved_account
      OR target_attempt.purpose = 'reauth' AND account_id IS DISTINCT FROM target_attempt.current_account
      OR target_attempt.purpose = 'link' AND account_id IS NOT NULL AND account_id <> target_attempt.current_account THEN
      RAISE EXCEPTION 'Attempt proof belongs to another account' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO method FROM auth.provider_login_methods
    WHERE provider_type = target_attempt.provider_type AND provider_subject = target_attempt.provider_subject FOR UPDATE;
    IF NOT FOUND OR method.status <> 'active' OR method.cognito_subject <> target_attempt.proved_subject
      OR method.activated_at IS DISTINCT FROM target_attempt.method_activated_at
      OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals
        WHERE cognito_subject = target_attempt.proved_subject AND cognito_username = target_attempt.proved_username) THEN
      RAISE EXCEPTION 'Attempt provider method is missing, disabled or changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF target_attempt.provider_type = 'apple' AND target_attempt.provider_subject IS NOT NULL THEN
    PERFORM auth.lock_apple_credentials(target_attempt.provider_subject);
    IF auth.apple_revocation_pending(target_attempt.provider_subject) THEN
      RAISE EXCEPTION 'Apple revocation pending' USING ERRCODE = '55006';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_social_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.create_social_attempt(
  target_hash TEXT, target_provider TEXT, target_client TEXT, target_purpose TEXT, target_binding TEXT,
  target_origin TEXT, target_redirect TEXT, target_current TEXT, target_account TEXT, target_ciphertext TEXT,
  target_reauth_hash TEXT, target_reauth_binding TEXT, target_reauth_client TEXT, target_reauth_origin TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt auth.social_attempts%ROWTYPE; attempt auth.social_attempts%ROWTYPE; expiry TIMESTAMPTZ;
BEGIN
  attempt.current_subject := target_current; attempt.current_account := target_account;
  attempt.provider_type := target_provider; attempt.purpose := target_purpose;
  IF target_purpose = 'link' THEN
    SELECT * INTO receipt FROM auth.social_attempts WHERE completion_sha256 = target_reauth_hash;
    IF NOT FOUND OR receipt.purpose <> 'reauth' OR receipt.current_subject IS DISTINCT FROM target_current
      OR receipt.current_account IS DISTINCT FROM target_account OR receipt.phase <> 'completed'
      OR receipt.binding_sha256 IS DISTINCT FROM target_reauth_binding OR receipt.client_type IS DISTINCT FROM target_reauth_client
      OR receipt.origin IS DISTINCT FROM target_reauth_origin
      OR receipt.completion_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'Link requires fresh current account reauthentication' USING ERRCODE = '23514';
    END IF;
    PERFORM auth.assert_social_attempt_live(receipt);
    UPDATE auth.social_attempts SET phase = 'redeemed', secret_ciphertext = 'erased'
    WHERE attempt_sha256 = receipt.attempt_sha256 AND phase = 'completed' AND completion_expires_at > clock_timestamp()
      AND binding_sha256 = target_reauth_binding AND client_type = target_reauth_client
      AND origin IS NOT DISTINCT FROM target_reauth_origin;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reauthentication was already used' USING ERRCODE = '55006'; END IF;
  ELSE
    PERFORM auth.assert_social_attempt_live(attempt);
  END IF;
  -- Cleanup touches only this transient ledger, never proof grants, tombstones or revocation jobs.
  DELETE FROM auth.social_attempts WHERE attempt_sha256 IN
    (SELECT attempt_sha256 FROM auth.social_attempts WHERE expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
  INSERT INTO auth.social_attempts(attempt_sha256, provider_type, client_type, purpose, binding_sha256,
    origin, redirect_uri, current_subject, current_account, secret_ciphertext, reauth_attempt_sha256, expires_at)
  VALUES (target_hash, target_provider, target_client, target_purpose, target_binding,
    target_origin, target_redirect, target_current, target_account, target_ciphertext,
    CASE WHEN target_purpose = 'link' THEN receipt.attempt_sha256 ELSE NULL END,
    CASE WHEN target_purpose = 'link' THEN LEAST(clock_timestamp() + INTERVAL '10 minutes', receipt.completion_expires_at)
      ELSE clock_timestamp() + INTERVAL '10 minutes' END)
  RETURNING expires_at INTO expiry;
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.create_social_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.create_social_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

-- Claim commits before any provider/Cognito call. A lost response cannot reopen this phase.
CREATE FUNCTION auth.claim_social_attempt(
  target_hash TEXT, target_binding TEXT, target_purpose TEXT, target_client TEXT, target_origin TEXT, target_phase TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  IF target_phase IS NULL OR target_phase NOT IN ('provider_ready', 'mailbox_ready') THEN
    RAISE EXCEPTION 'Invalid attempt claim phase' USING ERRCODE = '23514';
  END IF;
  RETURN QUERY UPDATE auth.social_attempts SET phase = CASE target_phase
    WHEN 'provider_ready' THEN 'provider_claimed' ELSE 'mailbox_claimed' END, claim_id = gen_random_uuid()
  WHERE attempt_sha256 = target_hash AND binding_sha256 = target_binding AND purpose = target_purpose
    AND client_type = target_client AND origin IS NOT DISTINCT FROM target_origin
    AND phase = target_phase AND expires_at > clock_timestamp()
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION auth.claim_social_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.claim_social_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE FUNCTION auth.advance_social_attempt(
  target_hash TEXT, target_claim UUID, target_from TEXT, target_to TEXT, target_ciphertext TEXT, target_provider_subject TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt expired; start again' USING ERRCODE = '55006'; END IF;
  IF target_from = 'provider_verifying' AND target_to = 'provider_proved' THEN
    attempt.provider_subject := target_provider_subject;
    SELECT identities.cognito_subject, identities.created_at, principals.cognito_username, principals.created_at
    INTO attempt.snapshot_subject, attempt.snapshot_provider_created_at, attempt.snapshot_username, attempt.snapshot_principal_created_at
    FROM auth.provider_identities AS identities
    JOIN auth.cognito_principals AS principals ON principals.cognito_subject = identities.cognito_subject
    WHERE identities.provider_type = attempt.provider_type AND identities.provider_subject = target_provider_subject;
    PERFORM auth.lock_social_attempt_lifecycle(attempt.current_subject, attempt.snapshot_subject,
      (SELECT proved_subject FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256));
    SELECT user_id INTO attempt.snapshot_account FROM auth.user_identities
    WHERE provider_type = 'cognito' AND provider_subject = attempt.snapshot_subject;
    SELECT * INTO method FROM auth.provider_login_methods
    WHERE provider_type = attempt.provider_type AND provider_subject = target_provider_subject FOR UPDATE;
    attempt.snapshot_method_activated_at := method.activated_at;
    IF FOUND AND method.status <> 'active' THEN
      RAISE EXCEPTION 'Verified provider method is disabled; start again' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  IF NOT ((target_from = 'provider_claimed' AND target_to = 'provider_verifying')
    OR (target_from = 'provider_verifying' AND target_to = 'provider_proved')
    OR (target_from = 'provider_proved' AND target_to = 'provider_enrolling')
    OR (target_from = 'provider_enrolling' AND target_to = 'mailbox_required')
    OR (target_from = 'mailbox_required' AND target_to = 'mailbox_sending')
    OR (target_from = 'mailbox_claimed' AND target_to = 'mailbox_verifying')
    OR (target_from = 'mailbox_sending' AND target_to = 'mailbox_ready')) THEN
    RAISE EXCEPTION 'Invalid attempt transition' USING ERRCODE = '23514';
  END IF;
  IF target_to <> 'provider_verifying' AND (target_provider_subject IS NULL OR length(target_provider_subject) NOT BETWEEN 1 AND 255) THEN
    RAISE EXCEPTION 'Missing verified provider subject' USING ERRCODE = '23514';
  END IF;
  UPDATE auth.social_attempts SET phase = target_to, secret_ciphertext = target_ciphertext,
    provider_subject = target_provider_subject,
    snapshot_subject = attempt.snapshot_subject, snapshot_username = attempt.snapshot_username, snapshot_account = attempt.snapshot_account,
    snapshot_provider_created_at = attempt.snapshot_provider_created_at, snapshot_principal_created_at = attempt.snapshot_principal_created_at,
    snapshot_method_activated_at = attempt.snapshot_method_activated_at,
    verified_at = CASE WHEN target_from = 'provider_verifying' THEN clock_timestamp() ELSE verified_at END
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = target_from AND expires_at > clock_timestamp()
    AND (provider_subject IS NULL OR provider_subject = target_provider_subject);
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt was consumed or expired; start again' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.advance_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.advance_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE FUNCTION auth.complete_social_attempt(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT, target_completion TEXT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE; expiry TIMESTAMPTZ;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt expired; start again' USING ERRCODE = '55006'; END IF;
  IF target_claim IS NULL OR attempt.claim_id IS DISTINCT FROM target_claim
    OR attempt.phase NOT IN ('provider_enrolling', 'mailbox_verifying') OR attempt.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Attempt was consumed or expired; restart with fresh proof' USING ERRCODE = '55006';
  END IF;
  IF target_subject IS NULL OR btrim(target_subject) = '' OR target_username IS NULL OR btrim(target_username) = '' THEN
    RAISE EXCEPTION 'Completion requires a proved immutable principal' USING ERRCODE = '23514';
  END IF;
  IF attempt.snapshot_subject IS NOT NULL AND (attempt.snapshot_subject <> target_subject OR attempt.snapshot_username <> target_username) THEN
    RAISE EXCEPTION 'Verified provider principal changed; start again' USING ERRCODE = '23514';
  END IF;
  attempt.proved_subject := target_subject; attempt.proved_username := target_username;
  -- Include the current proof principal before taking any account or method lock.
  IF attempt.reauth_attempt_sha256 IS NOT NULL THEN
    PERFORM auth.lock_social_attempt_lifecycle(attempt.current_subject, target_subject,
      (SELECT proved_subject FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256));
  ELSE
    PERFORM auth.lock_social_attempt_lifecycle(attempt.current_subject, target_subject, NULL);
  END IF;
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = attempt.provider_type AND provider_subject = attempt.provider_subject FOR UPDATE;
  attempt.method_activated_at := method.activated_at;
  SELECT user_id INTO attempt.proved_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  PERFORM auth.assert_social_attempt_live(attempt);
  expiry := LEAST(attempt.expires_at, clock_timestamp() + INTERVAL '120 seconds');
  UPDATE auth.social_attempts SET phase = 'completed', proved_subject = target_subject, proved_username = target_username,
    proved_account = attempt.proved_account, method_activated_at = attempt.method_activated_at,
    completion_sha256 = target_completion, completed_at = clock_timestamp(), completion_expires_at = expiry,
    secret_ciphertext = 'erased'
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase IN ('provider_enrolling', 'mailbox_verifying')
    AND verified_at > clock_timestamp() - INTERVAL '10 minutes' AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt was consumed or expired; restart with fresh proof' USING ERRCODE = '55006'; END IF;
  RETURN expiry;
END;
$$;
REVOKE ALL ON FUNCTION auth.complete_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.complete_social_attempt(TEXT, UUID, TEXT, TEXT, TEXT) TO auth_app;

CREATE FUNCTION auth.redeem_social_completion(
  target_completion TEXT, target_binding TEXT, target_purpose TEXT, target_client TEXT, target_origin TEXT
) RETURNS TABLE(cognito_subject TEXT, cognito_username TEXT, current_subject TEXT, current_account TEXT, purpose TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE completion_sha256 = target_completion;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN QUERY UPDATE auth.social_attempts SET phase = 'redeemed'
  WHERE attempt_sha256 = attempt.attempt_sha256 AND binding_sha256 = target_binding
    AND auth.social_attempts.purpose = target_purpose AND auth.social_attempts.purpose <> 'link'
    AND client_type = target_client AND origin IS NOT DISTINCT FROM target_origin
    AND phase = 'completed' AND completion_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
  RETURNING proved_subject, proved_username, auth.social_attempts.current_subject, auth.social_attempts.current_account, auth.social_attempts.purpose;
END;
$$;
REVOKE ALL ON FUNCTION auth.redeem_social_completion(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.redeem_social_completion(TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;

-- Metadata registration commits earlier. Subject-only prelocks preserve linking as the first identity operation.
CREATE FUNCTION auth.link_and_redeem_social_completion(
  target_completion TEXT, target_binding TEXT, target_client TEXT, target_origin TEXT
) RETURNS TABLE(cognito_subject TEXT, cognito_username TEXT, current_subject TEXT, current_account TEXT, purpose TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; reauth_subject TEXT; subject TEXT;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE completion_sha256 = target_completion
    AND binding_sha256 = target_binding AND auth.social_attempts.purpose = 'link' AND client_type = target_client
    AND origin IS NOT DISTINCT FROM target_origin AND phase = 'completed'
    AND completion_expires_at > clock_timestamp() AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  SELECT proved_subject INTO reauth_subject FROM auth.social_attempts WHERE attempt_sha256 = attempt.reauth_attempt_sha256;
  FOR subject IN SELECT DISTINCT unnest(ARRAY[attempt.current_subject, attempt.proved_subject, reauth_subject]) ORDER BY 1 LOOP
    IF subject IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || subject, 2::bigint));
    END IF;
  END LOOP;
  PERFORM auth.link_proved_cognito_principal(attempt.current_subject, attempt.proved_subject);
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN QUERY UPDATE auth.social_attempts SET phase = 'redeemed'
  WHERE attempt_sha256 = attempt.attempt_sha256 AND phase = 'completed'
    AND completion_expires_at > clock_timestamp() AND expires_at > clock_timestamp()
  RETURNING proved_subject, proved_username, auth.social_attempts.current_subject, auth.social_attempts.current_account, auth.social_attempts.purpose;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link completion was consumed or expired; start again' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.link_and_redeem_social_completion(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.link_and_redeem_social_completion(TEXT, TEXT, TEXT, TEXT) TO auth_app;

-- Atomic fixed windows bound public work even when distinct attempt handles are invented.
CREATE FUNCTION auth.consume_social_rate_bucket(target_hash TEXT, target_limit INTEGER) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE window_at TIMESTAMPTZ := date_bin(INTERVAL '15 minutes', clock_timestamp(), '2000-01-01'::TIMESTAMPTZ); count_hits INTEGER;
BEGIN
  IF target_limit IS NULL OR target_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid social rate limit' USING ERRCODE = '23514';
  END IF;
  DELETE FROM auth.social_rate_buckets WHERE (bucket_sha256, window_start) IN
    (SELECT bucket_sha256, window_start FROM auth.social_rate_buckets WHERE window_start < window_at ORDER BY window_start LIMIT 100 FOR UPDATE SKIP LOCKED);
  INSERT INTO auth.social_rate_buckets(bucket_sha256, window_start, hits) VALUES (target_hash, window_at, 1)
  ON CONFLICT (bucket_sha256, window_start) DO UPDATE SET hits = LEAST(auth.social_rate_buckets.hits + 1, 201)
  RETURNING hits INTO count_hits;
  RETURN count_hits <= target_limit;
END;
$$;
REVOKE ALL ON FUNCTION auth.consume_social_rate_bucket(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.consume_social_rate_bucket(TEXT, INTEGER) TO auth_app;

CREATE FUNCTION auth.load_social_mailbox_attempt(
  target_hash TEXT, target_binding TEXT, target_purpose TEXT, target_client TEXT, target_origin TEXT
) RETURNS SETOF auth.social_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash
    AND binding_sha256 = target_binding AND purpose = target_purpose AND client_type = target_client
    AND origin IS NOT DISTINCT FROM target_origin AND phase = 'mailbox_required'
    AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  RETURN NEXT attempt;
END;
$$;
REVOKE ALL ON FUNCTION auth.load_social_mailbox_attempt(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.load_social_mailbox_attempt(TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;
