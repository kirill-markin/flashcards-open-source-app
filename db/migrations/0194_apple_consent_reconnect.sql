-- Schemas touched/read explicitly: auth, org, pg_catalog.
ALTER TABLE auth.provider_login_methods ADD COLUMN disabled_reason TEXT
  CHECK (disabled_reason IN ('unlink', 'account_deleted', 'consent-revoked', 'account-deleted'));

-- A matching transaction and a newly stamped disable prove that the applied notification caused it.
-- Unknown historical disables, including rows whose transaction evidence was frozen, stay blocked.
UPDATE auth.provider_login_methods AS methods SET disabled_reason = 'consent-revoked'
FROM auth.apple_provider_notifications AS notifications
WHERE methods.provider_type = 'apple' AND methods.provider_subject = notifications.provider_subject
  AND methods.status = 'disabled' AND NOT notifications.account_deleted
  AND notifications.consent_event_at > methods.activated_at
  AND methods.disabled_at >= notifications.consent_event_at
  AND methods.xmin = notifications.xmin AND methods.xmin::TEXT <> '2'
  AND EXISTS (SELECT 1 FROM auth.apple_notification_receipts AS receipts
    WHERE receipts.xmin = methods.xmin AND receipts.outcome = 'applied'
      AND receipts.received_at <= methods.disabled_at);

CREATE FUNCTION auth.track_provider_method_disable() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'active' THEN
    NEW.disabled_reason := NULL;
  ELSIF OLD.status = 'active' AND NEW.disabled_reason IS NULL THEN
    NEW.disabled_reason := 'unlink';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION auth.track_provider_method_disable() FROM PUBLIC, auth_app, backend_app;
CREATE TRIGGER track_provider_method_disable BEFORE UPDATE OF status ON auth.provider_login_methods
FOR EACH ROW EXECUTE FUNCTION auth.track_provider_method_disable();

ALTER FUNCTION auth.queue_apple_revocation(TEXT, TEXT) RENAME TO queue_apple_revocation_credentials;
REVOKE ALL ON FUNCTION auth.queue_apple_revocation_credentials(TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.queue_apple_revocation(target_provider_subject TEXT, target_reason TEXT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE queued INTEGER;
BEGIN
  queued := auth.queue_apple_revocation_credentials(target_provider_subject, target_reason);
  -- An external delivery may never overwrite an intentional app unlink or an Apple account deletion.
  UPDATE auth.provider_login_methods SET disabled_reason = target_reason
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject
    AND (target_reason IN ('unlink', 'account_deleted', 'account-deleted')
      OR (target_reason = 'consent-revoked' AND
        (status = 'active' OR disabled_reason = 'consent-revoked')));
  RETURN queued;
END;
$$;
REVOKE ALL ON FUNCTION auth.queue_apple_revocation(TEXT, TEXT) FROM PUBLIC, auth_app, backend_app;

ALTER TABLE auth.social_attempts
  ADD COLUMN reconnect_disabled_at TIMESTAMPTZ,
  ADD COLUMN reconnect_consent_at TIMESTAMPTZ,
  ADD COLUMN reconnect_proof_issued_at BIGINT,
  ADD COLUMN reconnect_minimum_auth_time BIGINT,
  ADD CONSTRAINT social_attempts_apple_reconnect CHECK (
    (reconnect_disabled_at IS NULL AND reconnect_consent_at IS NULL
      AND reconnect_proof_issued_at IS NULL AND reconnect_minimum_auth_time IS NULL)
    OR (reconnect_disabled_at IS NOT NULL AND reconnect_consent_at IS NOT NULL
      AND reconnect_proof_issued_at IS NOT NULL AND reconnect_minimum_auth_time IS NOT NULL
      AND provider_type = 'apple' AND purpose = 'login' AND reenable_disabled_at IS NULL
      AND snapshot_subject IS NOT NULL AND snapshot_method_activated_at IS NOT NULL
      AND proved_subject IS NULL AND phase IN ('provider_proved', 'provider_enrolling')));

ALTER FUNCTION auth.assert_social_attempt_live(auth.social_attempts) RENAME TO assert_managed_attempt_live;
REVOKE ALL ON FUNCTION auth.assert_managed_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;
CREATE FUNCTION auth.assert_social_attempt_live(target_attempt auth.social_attempts) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ordinary auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE;
  notification auth.apple_provider_notifications%ROWTYPE; minimum_time BIGINT;
BEGIN
  IF target_attempt.reconnect_disabled_at IS NULL THEN
    PERFORM auth.assert_managed_attempt_live(target_attempt);
    RETURN;
  END IF;
  ordinary := target_attempt;
  ordinary.snapshot_method_activated_at := NULL;
  -- Preserve immutable binding/account/principal checks and the sorted lifecycle/cleanup locks.
  PERFORM auth.assert_managed_attempt_live(ordinary);
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = 'apple' AND provider_subject = target_attempt.provider_subject FOR UPDATE;
  SELECT * INTO notification FROM auth.apple_provider_notifications
  WHERE provider_subject = target_attempt.provider_subject;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 =
    encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex')), 0) INTO minimum_time;
  IF method.provider_subject IS NULL OR method.status <> 'disabled'
    OR method.disabled_reason IS DISTINCT FROM 'consent-revoked'
    OR notification.provider_subject IS NULL OR notification.account_deleted
    OR notification.consent_event_at IS DISTINCT FROM target_attempt.reconnect_consent_at
    OR method.disabled_at IS DISTINCT FROM target_attempt.reconnect_disabled_at
    OR method.activated_at IS DISTINCT FROM target_attempt.snapshot_method_activated_at
    OR method.cognito_subject IS DISTINCT FROM target_attempt.snapshot_subject
    OR target_attempt.provider_type IS DISTINCT FROM 'apple' OR target_attempt.purpose IS DISTINCT FROM 'login'
    OR target_attempt.reenable_disabled_at IS NOT NULL OR target_attempt.proved_subject IS NOT NULL
    OR target_attempt.reconnect_proof_issued_at IS NULL
    OR to_timestamp(target_attempt.reconnect_proof_issued_at) <= notification.consent_event_at
    OR target_attempt.reconnect_proof_issued_at < minimum_time
    OR target_attempt.reconnect_minimum_auth_time IS DISTINCT FROM minimum_time THEN
    RAISE EXCEPTION 'Apple reconnect proof or disabled lifecycle changed' USING ERRCODE = 'P4103';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
    encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex') AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Apple reconnect cleanup is pending' USING ERRCODE = 'P4102';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_social_attempt_live(auth.social_attempts) FROM PUBLIC, auth_app, backend_app;

-- Only the signature-verifying, nonce-bound code exchange calls this server-only proof boundary.
CREATE FUNCTION auth.record_apple_login_proof(
  target_hash TEXT, target_claim UUID, target_ciphertext TEXT, target_provider_subject TEXT, proof_issued_at BIGINT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; method auth.provider_login_methods%ROWTYPE;
  notification auth.apple_provider_notifications%ROWTYPE;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND OR attempt.provider_type <> 'apple' OR attempt.purpose <> 'login'
    OR target_claim IS NULL OR attempt.claim_id IS DISTINCT FROM target_claim
    OR attempt.phase <> 'provider_verifying' OR attempt.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Apple proof attempt consumed or expired' USING ERRCODE = '55006';
  END IF;
  IF proof_issued_at IS NULL OR proof_issued_at < floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT - 600
    OR proof_issued_at > floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT + 30
    OR target_provider_subject IS NULL OR length(target_provider_subject) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Fresh verified Apple proof required' USING ERRCODE = 'P4103';
  END IF;
  attempt.provider_subject := target_provider_subject;
  SELECT identities.cognito_subject, identities.created_at, principals.cognito_username, principals.created_at
  INTO attempt.snapshot_subject, attempt.snapshot_provider_created_at, attempt.snapshot_username, attempt.snapshot_principal_created_at
  FROM auth.provider_identities AS identities
  JOIN auth.cognito_principals AS principals ON principals.cognito_subject = identities.cognito_subject
  WHERE identities.provider_type = 'apple' AND identities.provider_subject = target_provider_subject;
  PERFORM auth.lock_social_attempt_lifecycle(NULL, attempt.snapshot_subject, NULL);
  SELECT * INTO method FROM auth.provider_login_methods
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject FOR UPDATE;
  IF NOT FOUND OR method.status = 'active' THEN
    PERFORM auth.advance_social_attempt(target_hash, target_claim, 'provider_verifying', 'provider_proved', target_ciphertext, target_provider_subject);
    RETURN;
  END IF;
  SELECT * INTO notification FROM auth.apple_provider_notifications WHERE provider_subject = target_provider_subject;
  IF method.disabled_reason IS DISTINCT FROM 'consent-revoked'
    OR notification.provider_subject IS NULL OR notification.consent_event_at IS NULL OR notification.account_deleted THEN
    RAISE EXCEPTION 'Apple method requires explicit account re-enable' USING ERRCODE = 'P4101';
  END IF;
  IF auth.apple_revocation_pending(target_provider_subject)
    OR EXISTS (SELECT 1 FROM auth.apple_session_revocation_jobs WHERE subject_sha256 =
      encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex') AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Apple reconnect cleanup is pending' USING ERRCODE = 'P4102';
  END IF;
  SELECT user_id INTO attempt.snapshot_account FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = attempt.snapshot_subject;
  attempt.snapshot_method_activated_at := method.activated_at;
  attempt.reconnect_disabled_at := method.disabled_at;
  attempt.reconnect_consent_at := notification.consent_event_at;
  attempt.reconnect_proof_issued_at := proof_issued_at;
  SELECT COALESCE((SELECT minimum_auth_time FROM auth.principal_session_fences WHERE subject_sha256 =
    encode(sha256(convert_to(method.cognito_subject, 'UTF8')), 'hex')), 0) INTO attempt.reconnect_minimum_auth_time;
  PERFORM auth.assert_social_attempt_live(attempt);
  UPDATE auth.social_attempts SET phase = 'provider_proved', secret_ciphertext = target_ciphertext,
    provider_subject = target_provider_subject, verified_at = clock_timestamp(),
    snapshot_subject = attempt.snapshot_subject, snapshot_username = attempt.snapshot_username, snapshot_account = attempt.snapshot_account,
    snapshot_provider_created_at = attempt.snapshot_provider_created_at, snapshot_principal_created_at = attempt.snapshot_principal_created_at,
    snapshot_method_activated_at = attempt.snapshot_method_activated_at,
    reconnect_disabled_at = attempt.reconnect_disabled_at, reconnect_consent_at = attempt.reconnect_consent_at,
    reconnect_proof_issued_at = proof_issued_at, reconnect_minimum_auth_time = attempt.reconnect_minimum_auth_time
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = 'provider_verifying' AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple proof attempt consumed or expired' USING ERRCODE = '55006'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.record_apple_login_proof(TEXT, UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.record_apple_login_proof(TEXT, UUID, TEXT, TEXT, BIGINT) TO auth_app;

-- Caller enrolls the unchanged principal, stores the new credential and completes in this transaction.
CREATE FUNCTION auth.reconnect_apple_login_attempt(target_hash TEXT, target_claim UUID, target_provider_subject TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE attempt auth.social_attempts%ROWTYPE; activation TIMESTAMPTZ;
BEGIN
  SELECT * INTO attempt FROM auth.social_attempts WHERE attempt_sha256 = target_hash;
  IF NOT FOUND OR attempt.provider_type <> 'apple' OR attempt.purpose <> 'login'
    OR target_claim IS NULL OR attempt.claim_id IS DISTINCT FROM target_claim
    OR attempt.provider_subject IS DISTINCT FROM target_provider_subject
    OR attempt.phase <> 'provider_enrolling' OR attempt.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Apple login attempt consumed or expired' USING ERRCODE = '55006';
  END IF;
  IF attempt.reconnect_disabled_at IS NULL THEN RETURN FALSE; END IF;
  IF attempt.verified_at IS NULL OR attempt.verified_at < clock_timestamp() - INTERVAL '120 seconds' THEN
    RAISE EXCEPTION 'Fresh verified Apple proof required' USING ERRCODE = 'P4103';
  END IF;
  PERFORM auth.assert_social_attempt_live(attempt);
  PERFORM 1 FROM auth.social_attempts WHERE attempt_sha256 = target_hash FOR UPDATE;
  -- Use the provider proof time as the notification watermark, not a later completion time.
  activation := GREATEST(to_timestamp(attempt.reconnect_proof_issued_at), attempt.snapshot_method_activated_at + INTERVAL '1 microsecond');
  UPDATE auth.provider_login_methods SET status = 'active', disabled_at = NULL, activated_at = activation
  WHERE provider_type = 'apple' AND provider_subject = target_provider_subject;
  UPDATE auth.social_attempts SET snapshot_method_activated_at = activation,
    reconnect_disabled_at = NULL, reconnect_consent_at = NULL,
    reconnect_proof_issued_at = NULL, reconnect_minimum_auth_time = NULL
  WHERE attempt_sha256 = target_hash AND claim_id = target_claim AND phase = 'provider_enrolling' AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'Apple login attempt consumed or expired' USING ERRCODE = '55006'; END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION auth.reconnect_apple_login_attempt(TEXT, UUID, TEXT) FROM PUBLIC, backend_app;
GRANT EXECUTE ON FUNCTION auth.reconnect_apple_login_attempt(TEXT, UUID, TEXT) TO auth_app;

CREATE OR REPLACE FUNCTION auth.complete_social_attempt(
  target_hash TEXT, target_claim UUID, target_subject TEXT, target_username TEXT, target_completion TEXT
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.social_attempts WHERE attempt_sha256 = target_hash
    AND (provider_type IS NULL OR reenable_disabled_at IS NOT NULL OR reconnect_disabled_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'This proof requires its dedicated internal completion' USING ERRCODE = '23514';
  END IF;
  RETURN auth.complete_provider_attempt(target_hash, target_claim, target_subject, target_username, target_completion);
END;
$$;

CREATE OR REPLACE FUNCTION auth.apply_apple_notification(
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
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
      PERFORM auth.lock_account_lifecycle(identities.user_id) FROM auth.user_identities AS identities
      WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
      SELECT activated_at, recovery_email INTO method_activated, method_recovery FROM auth.provider_login_methods
      WHERE provider_type = 'apple' AND provider_subject = target_provider_subject AND cognito_subject = target_subject FOR UPDATE;
      IF NOT FOUND THEN
        result_outcome := 'ignored_unbound';
      ELSIF target_event_at <= pg_catalog.date_trunc('second', method_activated) THEN
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

