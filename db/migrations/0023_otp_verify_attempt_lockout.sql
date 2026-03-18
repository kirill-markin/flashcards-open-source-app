-- Migration status: Current / canonical.
-- Introduces: OTP verification attempt lockout storage for the auth flow.
-- Current guidance: this migration remains part of the canonical auth schema and builds on the OTP lineage introduced in db/migrations/0014_agent_api_keys.sql and db/migrations/0016_agent_otp_challenges.sql.
-- Replaced or refined by: db/migrations/0024_auth_runtime_roles.sql.
-- See also: docs/architecture.md.
CREATE TABLE IF NOT EXISTS auth.otp_verify_attempts (
  challenge_key_hash    TEXT        PRIMARY KEY,
  email                 TEXT        NOT NULL,
  failed_attempt_count  INTEGER     NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  locked_at             TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_otp_verify_attempts_expires
  ON auth.otp_verify_attempts(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.otp_verify_attempts TO app;
