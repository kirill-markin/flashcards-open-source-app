-- Agent-facing auth state for terminal/API-key connections.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.agent_otp_send_events (
  event_id     UUID        PRIMARY KEY,
  email        TEXT        NOT NULL,
  ip_address   TEXT        NOT NULL,
  otp_session_token TEXT,
  decision     TEXT        NOT NULL CHECK (decision IN ('sent', 'suppressed_email_limit', 'blocked_ip_limit')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_otp_send_events_email_created
  ON auth.agent_otp_send_events(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_otp_send_events_ip_created
  ON auth.agent_otp_send_events(ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS auth.agent_api_keys (
  connection_id UUID        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,
  key_id        TEXT        NOT NULL UNIQUE,
  key_hash      TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_created
  ON auth.agent_api_keys(user_id, created_at DESC);

GRANT USAGE ON SCHEMA auth TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
