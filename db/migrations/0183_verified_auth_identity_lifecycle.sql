-- Schemas touched/read explicitly: auth, org, pg_catalog.
-- Subject locks precede account locks, which precede user/guest/workspace row locks.
-- Account locks serialize aliases without acquiring another subject lock during deletion.
CREATE TABLE auth.cognito_principals (
  cognito_subject TEXT PRIMARY KEY CHECK (btrim(cognito_subject) <> ''),
  cognito_username TEXT NOT NULL UNIQUE CHECK (btrim(cognito_username) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.provider_identities (
  provider_type TEXT NOT NULL CHECK (provider_type IN ('apple', 'google')),
  provider_subject TEXT NOT NULL CHECK (btrim(provider_subject) <> ''),
  cognito_subject TEXT NOT NULL REFERENCES auth.cognito_principals(cognito_subject) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_type, provider_subject)
);
CREATE INDEX ON auth.provider_identities(cognito_subject);

-- A verified mailbox is metadata of a proved principal, never an account lookup/linking key.
CREATE TABLE auth.verified_login_emails (
  cognito_subject TEXT NOT NULL REFERENCES auth.cognito_principals(cognito_subject) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  verified_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (cognito_subject, email)
);

ALTER TABLE auth.deleted_subjects ADD COLUMN deletion_id UUID;
CREATE TABLE auth.cognito_deletion_jobs (
  deletion_id UUID NOT NULL,
  cognito_subject TEXT NOT NULL,
  PRIMARY KEY (deletion_id, cognito_subject)
);
CREATE TABLE auth.deleted_accounts (
  user_id_sha256 TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identity mappings are immutable; only account deletion may remove them through the profile cascade.
CREATE FUNCTION auth.lock_account_lifecycle(target_user_id TEXT) RETURNS VOID
LANGUAGE sql AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.account:' || target_user_id, 2::bigint));
$$;
REVOKE ALL ON FUNCTION auth.lock_account_lifecycle(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.lock_account_lifecycle(TEXT) TO backend_app, auth_app;

CREATE FUNCTION auth.assert_account_live(target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.deleted_accounts
             WHERE user_id_sha256 = encode(sha256(convert_to(target_user_id, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Application account has been deleted' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.assert_account_live(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.assert_account_live(TEXT) TO backend_app, auth_app;

-- Covers late profile upserts by a caller that resolved the product id before deletion.
CREATE FUNCTION auth.guard_deleted_account_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_account_lifecycle(NEW.user_id);
  PERFORM auth.assert_account_live(NEW.user_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_settings_deleted_account_guard BEFORE INSERT ON org.user_settings
FOR EACH ROW EXECUTE FUNCTION auth.guard_deleted_account_insert();
REVOKE ALL ON FUNCTION auth.guard_deleted_account_insert() FROM PUBLIC;

CREATE FUNCTION auth.register_cognito_principal(target_subject TEXT, target_username TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE stored_username TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  INSERT INTO auth.cognito_principals(cognito_subject, cognito_username)
  VALUES (target_subject, target_username) ON CONFLICT (cognito_subject) DO NOTHING;
  SELECT cognito_username INTO STRICT stored_username FROM auth.cognito_principals WHERE cognito_subject = target_subject;
  IF stored_username <> target_username THEN
    RAISE EXCEPTION 'Cognito principal username is immutable' USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE FUNCTION auth.bind_provider_identity(target_provider TEXT, target_provider_subject TEXT, target_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE stored_subject TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  -- Mapped principals also take the account lock: deletion enumerates providers under that lock.
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  -- Recheck after waiting for deletion, which need not own this subject lock.
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_subject) THEN
    RAISE EXCEPTION 'Register the Cognito principal before binding a provider' USING ERRCODE = '23503';
  END IF;
  INSERT INTO auth.provider_identities(provider_type, provider_subject, cognito_subject)
  VALUES (target_provider, target_provider_subject, target_subject)
  ON CONFLICT (provider_type, provider_subject) DO NOTHING;
  SELECT cognito_subject INTO STRICT stored_subject FROM auth.provider_identities
  WHERE provider_type = target_provider AND provider_subject = target_provider_subject;
  IF stored_subject <> target_subject THEN
    RAISE EXCEPTION 'Provider identity is already bound to another principal' USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE FUNCTION auth.record_verified_login_email(target_subject TEXT, target_email TEXT, proof_verified_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  INSERT INTO auth.verified_login_emails(cognito_subject, email, verified_at)
  VALUES (target_subject, target_email, proof_verified_at)
  ON CONFLICT (cognito_subject, email) DO NOTHING;
END;
$$;

CREATE FUNCTION auth.bind_cognito_account(target_subject TEXT, target_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE stored_user_id TEXT;
BEGIN
  -- Caller owns the subject lock, or is restoring immutable bindings under the account lock.
  PERFORM auth.lock_account_lifecycle(target_user_id);
  PERFORM auth.assert_account_live(target_user_id);
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  INSERT INTO auth.user_identities(provider_type, provider_subject, user_id)
  VALUES ('cognito', target_subject, target_user_id)
  ON CONFLICT (provider_type, provider_subject) DO NOTHING;
  SELECT user_id INTO STRICT stored_user_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF stored_user_id <> target_user_id THEN
    RAISE EXCEPTION 'Cognito subject is already bound to another account' USING ERRCODE = '23505';
  END IF;
END;
$$;

-- First identity operation in its transaction. The server must freshly prove both identities.
CREATE FUNCTION auth.link_proved_cognito_principal(current_subject TEXT, new_subject TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE subject TEXT; account_id TEXT; existing_account_id TEXT;
BEGIN
  FOR subject IN SELECT DISTINCT unnest(ARRAY[current_subject, new_subject]) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('auth.cognito_identity:' || subject, 2::bigint));
  END LOOP;
  SELECT user_id INTO account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = current_subject;
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to an existing product account before linking' USING ERRCODE = '23503';
  END IF;
  PERFORM auth.lock_account_lifecycle(account_id);
  PERFORM auth.assert_account_live(account_id);
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 IN (encode(sha256(convert_to(current_subject, 'UTF8')), 'hex'),
                                      encode(sha256(convert_to(new_subject, 'UTF8')), 'hex'))) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = new_subject) THEN
    RAISE EXCEPTION 'Register the proved Cognito principal before linking' USING ERRCODE = '23503';
  END IF;
  SELECT user_id INTO existing_account_id FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = new_subject;
  IF (existing_account_id IS NOT NULL AND existing_account_id <> account_id)
     OR (new_subject <> account_id AND EXISTS (SELECT 1 FROM org.user_settings WHERE user_id = new_subject)) THEN
    RAISE EXCEPTION 'Identity already owns another product account; accounts cannot be merged' USING ERRCODE = '23505';
  END IF;
  PERFORM auth.bind_cognito_account(new_subject, account_id);
  RETURN account_id;
END;
$$;
REVOKE ALL ON FUNCTION auth.link_proved_cognito_principal(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.link_proved_cognito_principal(TEXT, TEXT) TO auth_app, backend_app;

-- Keep INSERT compatible with Lambdas serving during the migration/code rollout.
CREATE FUNCTION auth.guard_cognito_account_insert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM auth.lock_account_lifecycle(NEW.user_id);
  PERFORM auth.assert_account_live(NEW.user_id);
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = encode(sha256(convert_to(NEW.provider_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Cognito subject has been deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_identities_lifecycle_guard BEFORE INSERT ON auth.user_identities
FOR EACH ROW EXECUTE FUNCTION auth.guard_cognito_account_insert();
REVOKE ALL ON FUNCTION auth.guard_cognito_account_insert() FROM PUBLIC;
REVOKE UPDATE, DELETE ON auth.user_identities FROM backend_app, auth_app;
GRANT SELECT ON auth.cognito_principals, auth.provider_identities, auth.verified_login_emails TO backend_app, auth_app;
GRANT SELECT, INSERT, DELETE ON auth.cognito_deletion_jobs TO backend_app;
GRANT SELECT, INSERT ON auth.deleted_accounts TO backend_app;
GRANT UPDATE (deletion_id) ON auth.deleted_subjects TO backend_app;
GRANT DELETE ON auth.cognito_principals TO backend_app;
REVOKE ALL ON FUNCTION auth.register_cognito_principal(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.bind_provider_identity(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.record_verified_login_email(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.bind_cognito_account(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.register_cognito_principal(TEXT, TEXT),
  auth.bind_provider_identity(TEXT, TEXT, TEXT),
  auth.record_verified_login_email(TEXT, TEXT, TIMESTAMPTZ),
  auth.bind_cognito_account(TEXT, TEXT) TO auth_app, backend_app;
