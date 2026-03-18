-- Guest AI identity, monthly quota tracking, and Cognito-to-app-user mappings.

CREATE TABLE IF NOT EXISTS auth.user_identities (
  provider_type TEXT NOT NULL CHECK (provider_type IN ('cognito')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_type, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_created
  ON auth.user_identities(user_id, created_at, provider_type, provider_subject);

INSERT INTO auth.user_identities (provider_type, provider_subject, user_id)
SELECT
  'cognito',
  user_settings.user_id,
  user_settings.user_id
FROM org.user_settings AS user_settings
WHERE user_settings.user_id <> 'local'
ON CONFLICT (provider_type, provider_subject) DO NOTHING;

CREATE TABLE IF NOT EXISTS auth.guest_sessions (
  session_id UUID PRIMARY KEY,
  session_secret_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_user_created
  ON auth.guest_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_active_hash
  ON auth.guest_sessions(session_secret_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.guest_ai_monthly_usage (
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  usage_month TEXT NOT NULL,
  weighted_tokens BIGINT NOT NULL DEFAULT 0 CHECK (weighted_tokens >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_month)
);

CREATE INDEX IF NOT EXISTS idx_guest_ai_monthly_usage_updated
  ON auth.guest_ai_monthly_usage(updated_at DESC, user_id, usage_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth.user_identities TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.guest_sessions TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.guest_ai_monthly_usage TO backend_app;
