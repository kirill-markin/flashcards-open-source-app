-- Keep consented identity attached to each grant; reconnecting a client cannot
-- retroactively add identity claims to tokens issued without those scopes.
ALTER TABLE auth.oauth_authorization_codes
  ADD COLUMN nonce TEXT,
  ADD COLUMN identity_email TEXT,
  ADD COLUMN identity_email_verified BOOLEAN;

ALTER TABLE auth.oauth_access_tokens
  ADD COLUMN identity_email TEXT,
  ADD COLUMN identity_email_verified BOOLEAN;

ALTER TABLE auth.oauth_refresh_tokens
  ADD COLUMN identity_email TEXT,
  ADD COLUMN identity_email_verified BOOLEAN;

GRANT SELECT ON auth.oauth_access_tokens TO auth_app;
