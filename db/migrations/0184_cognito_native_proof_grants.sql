-- Schemas touched/read explicitly: auth, pg_catalog.
CREATE TABLE auth.native_proof_grants (
  proof_sha256 TEXT PRIMARY KEY CHECK (proof_sha256 ~ '^[0-9a-f]{64}$'),
  cognito_subject TEXT NOT NULL REFERENCES auth.cognito_principals(cognito_subject) ON DELETE CASCADE,
  cognito_username TEXT NOT NULL,
  client_id TEXT NOT NULL CHECK (pg_catalog.btrim(client_id) <> ''),
  challenge_nonce TEXT NOT NULL CHECK (challenge_nonce ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON auth.native_proof_grants(expires_at);
REVOKE ALL ON auth.native_proof_grants FROM PUBLIC, auth_app, backend_app;

-- The caller must freshly verify the provider proof; this capability is server-only.
CREATE FUNCTION auth.issue_native_proof_grant(
  target_subject TEXT, target_username TEXT, target_client TEXT,
  target_nonce TEXT, target_proof_sha256 TEXT, target_expires_at TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF NOT EXISTS (SELECT 1 FROM auth.cognito_principals
                 WHERE cognito_subject = target_subject AND cognito_username = target_username)
     OR EXISTS (SELECT 1 FROM auth.deleted_subjects
                WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RAISE EXCEPTION 'Native proof principal is not live or does not match its username' USING ERRCODE = '23514';
  END IF;
  IF target_expires_at IS NULL OR target_expires_at <= pg_catalog.clock_timestamp()
     OR target_expires_at > pg_catalog.clock_timestamp() + INTERVAL '120 seconds' THEN
    RAISE EXCEPTION 'Native proof grant expiry must be within 120 seconds' USING ERRCODE = '23514';
  END IF;
  DELETE FROM auth.native_proof_grants WHERE expires_at <= pg_catalog.clock_timestamp();
  INSERT INTO auth.native_proof_grants(proof_sha256, cognito_subject, cognito_username, client_id, challenge_nonce, expires_at)
  VALUES (target_proof_sha256, target_subject, target_username, target_client, target_nonce, target_expires_at);
END;
$$;

CREATE FUNCTION auth.redeem_native_proof_grant(
  target_subject TEXT, target_username TEXT, target_client TEXT, target_nonce TEXT, target_proof_sha256 TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE redeemed TEXT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth.cognito_identity:' || target_subject, 2::bigint));
  PERFORM auth.lock_account_lifecycle(user_id) FROM auth.user_identities
  WHERE provider_type = 'cognito' AND provider_subject = target_subject;
  IF EXISTS (SELECT 1 FROM auth.deleted_subjects
             WHERE subject_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')) THEN
    RETURN FALSE;
  END IF;
  DELETE FROM auth.native_proof_grants
  WHERE proof_sha256 = target_proof_sha256 AND cognito_subject = target_subject
    AND cognito_username = target_username AND client_id = target_client
    AND challenge_nonce = target_nonce AND expires_at > pg_catalog.clock_timestamp()
  RETURNING proof_sha256 INTO redeemed;
  RETURN redeemed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION auth.issue_native_proof_grant(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.redeem_native_proof_grant(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.issue_native_proof_grant(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ),
  auth.redeem_native_proof_grant(TEXT, TEXT, TEXT, TEXT, TEXT) TO auth_app;
