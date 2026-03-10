-- Opaque OTP handles for terminal-first auth.
--
-- The client only receives a short handle. The backing Cognito session remains
-- server-side for the short OTP lifetime required by RespondToAuthChallenge.

CREATE TABLE IF NOT EXISTS auth.agent_otp_challenges (
  challenge_id_hash TEXT        PRIMARY KEY,
  email             TEXT        NOT NULL,
  cognito_session   TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  used_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_otp_challenges_expires
  ON auth.agent_otp_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_otp_challenges_email_created
  ON auth.agent_otp_challenges(email, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.agent_otp_challenges TO app;
