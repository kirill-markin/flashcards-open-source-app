-- Migration status: Current / canonical.
-- Introduces: backend_app INSERT access for auth.agent_api_keys so a signed-in
--   human session can mint a long-lived agent API key from the backend.
-- Current guidance: this is the current backend minting authorization layer; the
--   auth_app email-OTP minting path stays intact alongside it.
-- See also: db/migrations/0024_auth_runtime_roles.sql, db/migrations/0030_agent_api_key_selected_workspace_rls.sql, docs/auth-service.md.
-- Allow backend_app to INSERT agent API keys for the authenticated user.

GRANT INSERT ON auth.agent_api_keys TO backend_app;

CREATE POLICY agent_api_keys_insert_backend
  ON auth.agent_api_keys
  FOR INSERT
  TO backend_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      selected_workspace_id IS NULL
      OR security.user_has_workspace_access(selected_workspace_id)
    )
  );
