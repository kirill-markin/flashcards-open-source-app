-- Schemas touched/read explicitly: auth, pg_catalog.
-- No principal FK: erasure must leave the encrypted token available until Apple revocation succeeds.
CREATE TABLE auth.apple_revocation_credentials (
  provider_subject TEXT NOT NULL CHECK (pg_catalog.btrim(provider_subject) <> ''),
  client_id TEXT NOT NULL CHECK (pg_catalog.btrim(client_id) <> ''),
  cognito_subject TEXT NOT NULL CHECK (pg_catalog.btrim(cognito_subject) <> ''),
  ciphertext TEXT NOT NULL CHECK (pg_catalog.length(ciphertext) <= 12000
    AND ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (provider_subject, client_id)
);
CREATE INDEX ON auth.apple_revocation_credentials(cognito_subject);
REVOKE ALL ON auth.apple_revocation_credentials FROM PUBLIC, auth_app, backend_app;

CREATE FUNCTION auth.store_apple_credential(
  target_subject TEXT, target_provider_subject TEXT, target_client_id TEXT, target_ciphertext TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex'))
    OR NOT EXISTS (SELECT 1 FROM auth.cognito_principals WHERE cognito_subject = target_subject)
    OR NOT EXISTS (SELECT 1 FROM auth.provider_identities
                   WHERE provider_type = 'apple' AND provider_subject = target_provider_subject AND cognito_subject = target_subject) THEN
    RAISE EXCEPTION 'Apple credential requires a live bound principal' USING ERRCODE = '23514';
  END IF;
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

CREATE FUNCTION auth.load_apple_credentials(target_subject TEXT)
RETURNS TABLE (provider_subject TEXT, client_id TEXT, ciphertext TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT credentials.provider_subject, credentials.client_id, credentials.ciphertext
  FROM auth.apple_revocation_credentials AS credentials
  WHERE credentials.cognito_subject = target_subject
  ORDER BY credentials.provider_subject, credentials.client_id;
$$;

CREATE FUNCTION auth.delete_apple_credential(target_provider_subject TEXT, target_client_id TEXT, target_ciphertext TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  DELETE FROM auth.apple_revocation_credentials
  WHERE provider_subject = target_provider_subject AND client_id = target_client_id AND ciphertext = target_ciphertext;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION auth.store_apple_credential(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.load_apple_credentials(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.delete_apple_credential(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.store_apple_credential(TEXT, TEXT, TEXT, TEXT),
  auth.load_apple_credentials(TEXT), auth.delete_apple_credential(TEXT, TEXT, TEXT) TO auth_app;
