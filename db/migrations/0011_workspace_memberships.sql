-- Migration status: Current / canonical.
-- Introduces: explicit workspace memberships and replaces the original implicit single-workspace model.
-- Current guidance: this migration is the key lineage point for current multi-workspace access behavior.
-- Replaces or corrects: db/migrations/0001_initial_schema.sql.
-- See also: docs/architecture.md.
-- Explicit workspace memberships replace the old implicit single-workspace model.
-- user_settings.workspace_id now acts as the selected/default workspace pointer.

CREATE TABLE IF NOT EXISTS org.workspace_memberships (
  workspace_id UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  user_id      TEXT        NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('owner', 'member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user
  ON org.workspace_memberships(user_id, created_at, workspace_id);

INSERT INTO org.workspace_memberships (workspace_id, user_id, role)
SELECT user_settings.workspace_id, user_settings.user_id, 'owner'
FROM org.user_settings
WHERE user_settings.workspace_id IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;
