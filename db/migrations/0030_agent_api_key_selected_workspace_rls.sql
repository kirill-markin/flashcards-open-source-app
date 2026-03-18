-- Migration status: Current / canonical.
-- Introduces: database-enforced selected-workspace access for agent API keys.
-- Current guidance: this is the current enforcement layer for the selected-workspace feature that was structurally introduced earlier.
-- Replaces or corrects: db/migrations/0017_agent_api_key_selected_workspace.sql.
-- See also: db/migrations/0017_agent_api_key_selected_workspace.sql, db/migrations/0024_auth_runtime_roles.sql, docs/architecture.md.
-- Enforce API-key selected workspace access at the database boundary.

DROP POLICY IF EXISTS agent_api_keys_insert_runtime ON auth.agent_api_keys;
DROP POLICY IF EXISTS agent_api_keys_update_runtime ON auth.agent_api_keys;

CREATE POLICY agent_api_keys_insert_runtime
  ON auth.agent_api_keys
  FOR INSERT
  TO auth_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      selected_workspace_id IS NULL
      OR security.user_has_workspace_access(selected_workspace_id)
    )
  );

CREATE POLICY agent_api_keys_update_runtime
  ON auth.agent_api_keys
  FOR UPDATE
  TO backend_app
  USING (user_id = security.current_user_id())
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      selected_workspace_id IS NULL
      OR security.user_has_workspace_access(selected_workspace_id)
    )
  );
