-- Initial schema for flashcards-open-source-app (v1)
-- Workspace-centric isolation model.

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS devices (
  device_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_devices_workspace_user ON devices(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS cards (
  card_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  front_text TEXT NOT NULL,
  back_text TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  -- Expected effort for solving card in UI filters.
  effort_level TEXT NOT NULL DEFAULT 'fast' CHECK (effort_level IN ('fast', 'medium', 'long')),
  due_at TIMESTAMPTZ,
  reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  server_version BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cards_workspace_server_version ON cards(workspace_id, server_version);
CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_at ON cards(workspace_id, due_at);
CREATE INDEX IF NOT EXISTS idx_cards_workspace_due_active ON cards(workspace_id, due_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS review_events (
  review_event_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  client_event_id TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 0 AND 3),
  reviewed_at_client TIMESTAMPTZ NOT NULL,
  reviewed_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, device_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_card_time ON review_events(workspace_id, card_id, reviewed_at_server DESC);

CREATE TABLE IF NOT EXISTS applied_operations (
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, device_id, operation_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  workspace_id UUID NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE RESTRICT,
  last_pulled_server_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, device_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE flashcards TO app;
GRANT USAGE ON SCHEMA public TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
