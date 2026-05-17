-- Allow the auth service to map Cognito subjects to canonical app users when
-- creating long-lived agent API keys.

GRANT SELECT ON TABLE auth.user_identities TO auth_app;
