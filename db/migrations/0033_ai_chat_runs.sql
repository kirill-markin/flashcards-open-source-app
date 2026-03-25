-- Durable AI chat runs for backend-owned v2 execution.

CREATE TABLE IF NOT EXISTS ai.chat_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai.chat_sessions(session_id) ON DELETE CASCADE,
  assistant_item_id UUID NOT NULL REFERENCES ai.chat_items(item_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted')),
  request_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  timezone TEXT NOT NULL,
  turn_input JSONB NOT NULL,
  worker_claimed_at TIMESTAMPTZ,
  worker_heartbeat_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_runs_session_created
  ON ai.chat_runs(session_id, created_at DESC, run_id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_runs_active_status
  ON ai.chat_runs(status, worker_heartbeat_at, created_at DESC)
  WHERE status IN ('queued', 'running');

ALTER TABLE ai.chat_sessions
  ADD COLUMN IF NOT EXISTS active_run_id UUID;

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_active_run
  ON ai.chat_sessions(active_run_id)
  WHERE active_run_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_runs TO backend_app;

ALTER TABLE ai.chat_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_runs_scoped_select_runtime ON ai.chat_runs;
DROP POLICY IF EXISTS chat_runs_scoped_insert_runtime ON ai.chat_runs;
DROP POLICY IF EXISTS chat_runs_scoped_update_runtime ON ai.chat_runs;
DROP POLICY IF EXISTS chat_runs_scoped_delete_runtime ON ai.chat_runs;

CREATE POLICY chat_runs_scoped_select_runtime
  ON ai.chat_runs
  FOR SELECT
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_runs.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_runs_scoped_insert_runtime
  ON ai.chat_runs
  FOR INSERT
  TO backend_app
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_runs.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_runs_scoped_update_runtime
  ON ai.chat_runs
  FOR UPDATE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_runs.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_runs.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_runs_scoped_delete_runtime
  ON ai.chat_runs
  FOR DELETE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_runs.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );
