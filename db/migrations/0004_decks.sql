CREATE TABLE IF NOT EXISTS content.decks (
  deck_id            UUID        PRIMARY KEY,
  workspace_id       UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  filter_definition  JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decks_workspace_updated_at
  ON content.decks(workspace_id, updated_at DESC);
