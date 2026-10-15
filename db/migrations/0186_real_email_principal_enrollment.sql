-- Schemas touched/read explicitly: auth, org, pg_catalog.
CREATE TABLE auth.principal_login_policies (
  cognito_subject TEXT PRIMARY KEY REFERENCES auth.cognito_principals(cognito_subject) ON DELETE CASCADE,
  principal_kind TEXT NOT NULL CHECK (principal_kind IN ('real', 'demo'))
);
REVOKE ALL ON auth.principal_login_policies FROM PUBLIC, auth_app, backend_app;

-- Preserve the reset policy of registered legacy demo principals before aliases can be activated.
INSERT INTO auth.principal_login_policies(cognito_subject, principal_kind)
SELECT principals.cognito_subject, 'demo'
FROM auth.cognito_principals AS principals
WHERE EXISTS (
  SELECT 1 FROM auth.user_identities AS identities
  JOIN org.user_settings AS settings ON settings.user_id = identities.user_id
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = principals.cognito_subject
    AND pg_catalog.lower(settings.email) LIKE '%@example.com'
) OR EXISTS (
  SELECT 1 FROM auth.verified_login_emails AS emails
  WHERE emails.cognito_subject = principals.cognito_subject AND emails.email LIKE '%@example.com'
);

CREATE TABLE auth.provider_login_methods (
  provider_type TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  cognito_subject TEXT NOT NULL REFERENCES auth.cognito_principals(cognito_subject) ON DELETE CASCADE,
  recovery_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  disabled_at TIMESTAMPTZ,
  PRIMARY KEY (provider_type, provider_subject),
  FOREIGN KEY (provider_type, provider_subject)
    REFERENCES auth.provider_identities(provider_type, provider_subject) ON DELETE CASCADE,
  FOREIGN KEY (cognito_subject, recovery_email)
    REFERENCES auth.verified_login_emails(cognito_subject, email) ON DELETE CASCADE,
  CHECK ((status = 'active' AND disabled_at IS NULL) OR (status = 'disabled' AND disabled_at IS NOT NULL))
);
CREATE INDEX ON auth.provider_login_methods(cognito_subject);
REVOKE ALL ON auth.provider_login_methods FROM PUBLIC, auth_app, backend_app;

-- Caller owns sorted subject locks, then sorted account locks, before this read-only policy assertion.
-- Account-wide alias linking must check both principals here before activating the link.
CREATE FUNCTION auth.assert_real_principal_login_policy(target_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT;
BEGIN
  SELECT identities.user_id INTO account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF account_id IS NULL AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = target_subject) THEN
    account_id := target_subject;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.principal_login_policies
             WHERE cognito_subject = target_subject AND principal_kind = 'demo')
    OR EXISTS (SELECT 1 FROM auth.verified_login_emails
               WHERE cognito_subject = target_subject AND email LIKE '%@example.com')
    OR EXISTS (SELECT 1 FROM org.user_settings
               WHERE user_id = account_id AND pg_catalog.lower(email) LIKE '%@example.com')
    OR EXISTS (
      SELECT 1 FROM auth.user_identities AS identities
      JOIN auth.principal_login_policies AS policies ON policies.cognito_subject = identities.provider_subject
      WHERE identities.provider_type = 'cognito' AND identities.user_id = account_id AND policies.principal_kind = 'demo'
    ) THEN
    RAISE EXCEPTION 'Demo principals cannot enroll real login methods or link to real principals' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_real_principal_login_policy(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.assert_real_principal_login_policy(TEXT) TO auth_app;

CREATE FUNCTION auth.lock_principal_login_lifecycle(target_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE account_id TEXT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  SELECT identities.user_id INTO account_id FROM auth.user_identities AS identities
  WHERE identities.provider_type = 'cognito' AND identities.provider_subject = target_subject;
  IF account_id IS NULL AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = target_subject) THEN
    account_id := target_subject;
  END IF;
  IF account_id IS NOT NULL THEN
    PERFORM auth.lock_account_lifecycle(account_id);
    PERFORM auth.assert_account_live(account_id);
  END IF;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Login principal has been deleted' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.lock_principal_login_lifecycle(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lock_principal_login_lifecycle(TEXT) TO auth_app;

-- Proof authority belongs to the auth server; neither matching emails nor profile metadata are proofs.
CREATE FUNCTION auth.enroll_proved_email_principal(
  target_subject TEXT, target_username TEXT, target_email TEXT, proof_verified_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF target_email IS NULL OR target_email <> pg_catalog.lower(pg_catalog.btrim(target_email))
    OR pg_catalog.length(target_email) > 254 OR target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR target_email LIKE '%@example.com'
    OR proof_verified_at IS NULL OR proof_verified_at < pg_catalog.clock_timestamp() - INTERVAL '10 minutes'
    OR proof_verified_at > pg_catalog.clock_timestamp() + INTERVAL '30 seconds' THEN
    RAISE EXCEPTION 'Real email enrollment requires a fresh verified non-demo mailbox' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  PERFORM auth.register_cognito_principal(target_subject, target_username);
  PERFORM auth.assert_real_principal_login_policy(target_subject);
  INSERT INTO auth.principal_login_policies(cognito_subject, principal_kind)
  VALUES (target_subject, 'real') ON CONFLICT (cognito_subject) DO NOTHING;
  PERFORM auth.record_verified_login_email(target_subject, target_email, proof_verified_at);
END;
$$;
REVOKE ALL ON FUNCTION auth.enroll_proved_email_principal(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.enroll_proved_email_principal(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO auth_app;

CREATE FUNCTION auth.activate_proved_provider_method(
  target_provider TEXT, target_provider_subject TEXT, target_subject TEXT, target_email TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE stored_subject TEXT; stored_email TEXT;
BEGIN
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  PERFORM auth.assert_real_principal_login_policy(target_subject);
  IF NOT EXISTS (SELECT 1 FROM auth.principal_login_policies
                 WHERE cognito_subject = target_subject AND principal_kind = 'real')
    OR NOT EXISTS (SELECT 1 FROM auth.verified_login_emails
                   WHERE cognito_subject = target_subject AND email = target_email) THEN
    RAISE EXCEPTION 'Provider method requires a proved real mailbox principal' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.bind_provider_identity(target_provider, target_provider_subject, target_subject);
  INSERT INTO auth.provider_login_methods(provider_type, provider_subject, cognito_subject, recovery_email, status)
  VALUES (target_provider, target_provider_subject, target_subject, target_email, 'active')
  ON CONFLICT (provider_type, provider_subject) DO NOTHING;
  SELECT cognito_subject, recovery_email INTO STRICT stored_subject, stored_email
  FROM auth.provider_login_methods WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  IF stored_subject <> target_subject OR stored_email <> target_email THEN
    RAISE EXCEPTION 'Provider enrollment principal and recovery mailbox are immutable' USING ERRCODE = '23505';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.activate_proved_provider_method(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.activate_proved_provider_method(TEXT, TEXT, TEXT, TEXT) TO auth_app;

CREATE FUNCTION auth.load_provider_login_method(target_provider TEXT, target_provider_subject TEXT)
RETURNS TABLE (
  provider_type TEXT, provider_subject TEXT, cognito_subject TEXT, cognito_username TEXT,
  status TEXT, recovery_email TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_subject TEXT;
BEGIN
  SELECT identities.cognito_subject INTO target_subject FROM auth.provider_identities AS identities
  WHERE identities.provider_type = target_provider AND identities.provider_subject = target_provider_subject;
  IF target_subject IS NULL THEN RETURN; END IF;
  PERFORM auth.lock_principal_login_lifecycle(target_subject);
  PERFORM auth.assert_real_principal_login_policy(target_subject);
  RETURN QUERY
  SELECT methods.provider_type, methods.provider_subject, methods.cognito_subject, principals.cognito_username,
    methods.status, methods.recovery_email
  FROM auth.provider_login_methods AS methods
  JOIN auth.cognito_principals AS principals ON principals.cognito_subject = methods.cognito_subject
  JOIN auth.provider_identities AS identities ON identities.provider_type = methods.provider_type
    AND identities.provider_subject = methods.provider_subject AND identities.cognito_subject = methods.cognito_subject
  WHERE methods.provider_type = target_provider AND methods.provider_subject = target_provider_subject
  FOR UPDATE OF methods;
END;
$$;
REVOKE ALL ON FUNCTION auth.load_provider_login_method(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.load_provider_login_method(TEXT, TEXT) TO auth_app;
