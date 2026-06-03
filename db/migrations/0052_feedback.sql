-- In-app product feedback submissions and automatic prompt events.

CREATE SCHEMA IF NOT EXISTS support;

GRANT USAGE ON SCHEMA support TO backend_app;
GRANT USAGE ON SCHEMA support TO reporting_readonly;

CREATE TABLE IF NOT EXISTS support.feedback_submissions (
  feedback_submission_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  installation_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  app_version TEXT,
  locale TEXT NOT NULL,
  timezone TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('settings', 'automatic')),
  message TEXT NOT NULL CHECK (btrim(message) <> '' AND char_length(message) <= 5000),
  created_at_client TIMESTAMPTZ NOT NULL,
  submitted_at_server TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_submitted
  ON support.feedback_submissions(user_id, submitted_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_workspace_submitted
  ON support.feedback_submissions(workspace_id, submitted_at_server DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_installation_submitted
  ON support.feedback_submissions(installation_id, submitted_at_server DESC)
  WHERE installation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support.feedback_prompt_events (
  feedback_prompt_event_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  installation_id TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  app_version TEXT,
  locale TEXT NOT NULL,
  timezone TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('automatic_prompt_shown')),
  created_at_client TIMESTAMPTZ NOT NULL,
  recorded_at_server TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_prompt_events_user_recorded
  ON support.feedback_prompt_events(user_id, recorded_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_prompt_events_workspace_recorded
  ON support.feedback_prompt_events(workspace_id, recorded_at_server DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_prompt_events_installation_recorded
  ON support.feedback_prompt_events(installation_id, recorded_at_server DESC)
  WHERE installation_id IS NOT NULL;

ALTER TABLE support.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.feedback_prompt_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_submissions_self_select_runtime ON support.feedback_submissions;
DROP POLICY IF EXISTS feedback_submissions_self_insert_runtime ON support.feedback_submissions;
DROP POLICY IF EXISTS feedback_submissions_reporting_readonly_select ON support.feedback_submissions;
DROP POLICY IF EXISTS feedback_prompt_events_self_select_runtime ON support.feedback_prompt_events;
DROP POLICY IF EXISTS feedback_prompt_events_self_insert_runtime ON support.feedback_prompt_events;
DROP POLICY IF EXISTS feedback_prompt_events_reporting_readonly_select ON support.feedback_prompt_events;

CREATE POLICY feedback_submissions_self_select_runtime
  ON support.feedback_submissions
  FOR SELECT
  TO backend_app
  USING (user_id = security.current_user_id());

CREATE POLICY feedback_submissions_self_insert_runtime
  ON support.feedback_submissions
  FOR INSERT
  TO backend_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      workspace_id IS NULL
      OR security.user_has_workspace_access(workspace_id)
    )
  );

CREATE POLICY feedback_submissions_reporting_readonly_select
  ON support.feedback_submissions
  FOR SELECT
  TO reporting_readonly
  USING (true);

CREATE POLICY feedback_prompt_events_self_select_runtime
  ON support.feedback_prompt_events
  FOR SELECT
  TO backend_app
  USING (user_id = security.current_user_id());

CREATE POLICY feedback_prompt_events_self_insert_runtime
  ON support.feedback_prompt_events
  FOR INSERT
  TO backend_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND (
      workspace_id IS NULL
      OR security.user_has_workspace_access(workspace_id)
    )
  );

CREATE POLICY feedback_prompt_events_reporting_readonly_select
  ON support.feedback_prompt_events
  FOR SELECT
  TO reporting_readonly
  USING (true);

GRANT SELECT, INSERT ON TABLE support.feedback_submissions TO backend_app;
GRANT SELECT, INSERT ON TABLE support.feedback_prompt_events TO backend_app;
GRANT SELECT ON TABLE support.feedback_submissions TO reporting_readonly;
GRANT SELECT ON TABLE support.feedback_prompt_events TO reporting_readonly;

COMMENT ON TABLE support.feedback_submissions IS
  'Append-only in-app product feedback messages submitted by authenticated human clients.';

COMMENT ON TABLE support.feedback_prompt_events IS
  'Append-only automatic feedback prompt lifecycle events used for server-side cooldown state.';
