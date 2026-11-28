-- Schemas touched/read explicitly: auth, pg_catalog.
-- Standalone email sign-in (AUTH_IDENTITY_PROVIDER=local, apps/auth/src/server/local/). AWS
-- deployments leave these tables empty. Local subjects map to accounts through auth.user_identities
-- exactly like Cognito subjects, under the same provider_type.

SET LOCAL lock_timeout = '30s';

CREATE TABLE auth.local_identities (
  subject UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
    CHECK (email = pg_catalog.lower(pg_catalog.btrim(email)) AND pg_catalog.strpos(email, '@') > 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  disabled_at TIMESTAMPTZ
);

-- One row per requested code, also for an address that may not sign in (no mail is sent and every
-- code fails), so a response never reveals the allowlist. Only keyed digests are stored.
CREATE TABLE auth.local_email_otp_challenges (
  session_hmac TEXT PRIMARY KEY CHECK (session_hmac ~ '^[0-9a-f]{64}$'),
  email TEXT NOT NULL CHECK (email = pg_catalog.lower(pg_catalog.btrim(email))),
  code_hmac TEXT NOT NULL CHECK (code_hmac ~ '^[0-9a-f]{64}$'),
  may_sign_in BOOLEAN NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX ON auth.local_email_otp_challenges (email);
CREATE INDEX ON auth.local_email_otp_challenges (expires_at);

-- One row per sign-in. session_id is the ID token's `sid`; the refresh token does not rotate.
CREATE TABLE auth.local_sessions (
  session_id UUID PRIMARY KEY,
  subject UUID NOT NULL REFERENCES auth.local_identities (subject) ON DELETE CASCADE,
  refresh_token_sha256 TEXT NOT NULL UNIQUE CHECK (refresh_token_sha256 ~ '^[0-9a-f]{64}$'),
  auth_time BIGINT NOT NULL CHECK (auth_time > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX ON auth.local_sessions (subject);
CREATE INDEX ON auth.local_sessions (absolute_expires_at);

REVOKE ALL ON auth.local_identities, auth.local_email_otp_challenges, auth.local_sessions
  FROM PUBLIC, backend_app, reporting_readonly;
GRANT SELECT, INSERT, UPDATE ON auth.local_identities TO auth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.local_email_otp_challenges, auth.local_sessions TO auth_app;

-- The backend's only read of these tables: whether one signed (sid, sub) is still live. Deletion
-- cascades the sessions away, so a tombstoned subject answers 'deleted' and the caller's principal
-- check decides it (410, or a deletion retry), as a Cognito ID token still verifies after deletion.
CREATE FUNCTION auth.local_session_status(target_session_id UUID, target_subject TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM auth.deleted_subjects AS deleted WHERE deleted.subject_sha256 =
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(target_subject, 'UTF8')), 'hex')
  ) THEN 'deleted' WHEN EXISTS (
    SELECT 1 FROM auth.local_sessions AS sessions
    JOIN auth.local_identities AS identities ON identities.subject = sessions.subject
    WHERE sessions.session_id = target_session_id
      AND sessions.subject::TEXT = target_subject
      AND sessions.revoked_at IS NULL
      AND sessions.idle_expires_at > pg_catalog.clock_timestamp()
      AND sessions.absolute_expires_at > pg_catalog.clock_timestamp()
      AND identities.disabled_at IS NULL
  ) THEN 'valid' ELSE 'revoked' END
$$;
REVOKE ALL ON FUNCTION auth.local_session_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.local_session_status(UUID, TEXT) TO auth_app, backend_app;

-- Account deletion's identity step for local subjects; idempotent, so a deletion retry may repeat it.
CREATE FUNCTION auth.delete_local_identity(target_subject TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE deleted_email TEXT;
BEGIN
  DELETE FROM auth.local_identities WHERE subject::TEXT = target_subject RETURNING email INTO deleted_email;
  IF deleted_email IS NOT NULL THEN
    DELETE FROM auth.local_email_otp_challenges WHERE email = deleted_email;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION auth.delete_local_identity(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.delete_local_identity(TEXT) TO backend_app;
