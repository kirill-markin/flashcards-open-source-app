-- Migration status: Historical / partially superseded.
-- Introduces: selected_workspace_id as the structural basis for per-connection agent workspace selection.
-- Current guidance: this migration adds the data shape, but database-enforced selected-workspace access is hardened later.
-- Replaced or refined by: db/migrations/0030_agent_api_key_selected_workspace_rls.sql.
-- Replaces or corrects: db/migrations/0014_agent_api_keys.sql.
-- See also: docs/architecture.md.
-- Persist per-connection selected workspace for long-lived agent API keys.

ALTER TABLE auth.agent_api_keys
  ADD COLUMN IF NOT EXISTS selected_workspace_id UUID
    REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL;

UPDATE auth.agent_api_keys AS agent_api_keys
SET selected_workspace_id = user_settings.workspace_id
FROM org.user_settings AS user_settings
WHERE agent_api_keys.user_id = user_settings.user_id
  AND agent_api_keys.selected_workspace_id IS NULL
  AND user_settings.workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_selected_workspace
  ON auth.agent_api_keys(user_id, selected_workspace_id);
