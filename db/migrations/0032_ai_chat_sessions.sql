-- Backend-owned persisted AI chat sessions and transcript items.
-- This is the initial v2 storage layer. Legacy `/chat/turn` remains separate.

CREATE SCHEMA IF NOT EXISTS ai;

GRANT USAGE ON SCHEMA ai TO backend_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backend_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backend_app;

CREATE TABLE IF NOT EXISTS ai.chat_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'interrupted')),
  active_run_heartbeat_at TIMESTAMPTZ,
  main_content_invalidation_version BIGINT NOT NULL DEFAULT 0 CHECK (main_content_invalidation_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_workspace_created
  ON ai.chat_sessions(user_id, workspace_id, created_at DESC, session_id DESC);

CREATE TABLE IF NOT EXISTS ai.chat_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai.chat_sessions(session_id) ON DELETE CASCADE,
  item_order BIGINT GENERATED ALWAYS AS IDENTITY,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('message')),
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'completed', 'error', 'cancelled')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_items_session_order
  ON ai.chat_items(session_id, item_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_sessions TO backend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_items TO backend_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ai TO backend_app;

ALTER TABLE ai.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.chat_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_sessions_scoped_select_runtime ON ai.chat_sessions;
DROP POLICY IF EXISTS chat_sessions_scoped_insert_runtime ON ai.chat_sessions;
DROP POLICY IF EXISTS chat_sessions_scoped_update_runtime ON ai.chat_sessions;
DROP POLICY IF EXISTS chat_sessions_scoped_delete_runtime ON ai.chat_sessions;

CREATE POLICY chat_sessions_scoped_select_runtime
  ON ai.chat_sessions
  FOR SELECT
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY chat_sessions_scoped_insert_runtime
  ON ai.chat_sessions
  FOR INSERT
  TO backend_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY chat_sessions_scoped_update_runtime
  ON ai.chat_sessions
  FOR UPDATE
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

CREATE POLICY chat_sessions_scoped_delete_runtime
  ON ai.chat_sessions
  FOR DELETE
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

DROP POLICY IF EXISTS chat_items_scoped_select_runtime ON ai.chat_items;
DROP POLICY IF EXISTS chat_items_scoped_insert_runtime ON ai.chat_items;
DROP POLICY IF EXISTS chat_items_scoped_update_runtime ON ai.chat_items;
DROP POLICY IF EXISTS chat_items_scoped_delete_runtime ON ai.chat_items;

CREATE POLICY chat_items_scoped_select_runtime
  ON ai.chat_items
  FOR SELECT
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_items.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_items_scoped_insert_runtime
  ON ai.chat_items
  FOR INSERT
  TO backend_app
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_items.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_items_scoped_update_runtime
  ON ai.chat_items
  FOR UPDATE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_items.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_items.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_items_scoped_delete_runtime
  ON ai.chat_items
  FOR DELETE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_items.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );
