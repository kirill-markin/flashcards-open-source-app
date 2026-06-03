-- Migration status: Current / canonical.
-- Introduces: backend-owned in-app product feedback storage and notification state.
-- Current guidance: support.feedback_* tables are first-party app feedback, not app-store review state.

CREATE SCHEMA IF NOT EXISTS support;

CREATE TABLE IF NOT EXISTS support.feedback_prompt_events (
  feedback_prompt_event_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  installation_id UUID REFERENCES sync.installations(installation_id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  locale TEXT,
  timezone TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('automatic_prompt_shown', 'automatic_prompt_dismissed')),
  created_at_client TIMESTAMPTZ NOT NULL,
  created_at_server TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE support.feedback_prompt_events IS 'Cross-device in-app feedback prompt events used to enforce automatic prompt cooldown.';
COMMENT ON COLUMN support.feedback_prompt_events.feedback_prompt_event_id IS 'Client-generated idempotency key for one prompt event.';
COMMENT ON COLUMN support.feedback_prompt_events.event_type IS 'Automatic in-app feedback prompt lifecycle event. This is not store-review request state.';

CREATE TABLE IF NOT EXISTS support.feedback_submissions (
  feedback_submission_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  email TEXT,
  workspace_id UUID REFERENCES org.workspaces(workspace_id) ON DELETE SET NULL,
  installation_id UUID REFERENCES sync.installations(installation_id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  locale TEXT,
  timezone TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('automatic', 'settings')),
  message TEXT NOT NULL,
  created_at_client TIMESTAMPTZ NOT NULL,
  created_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_notification_status IN ('pending', 'sent', 'failed')),
  email_notification_error TEXT
);

COMMENT ON TABLE support.feedback_submissions IS 'Free-text first-party in-app product feedback submitted by users.';
COMMENT ON COLUMN support.feedback_submissions.feedback_submission_id IS 'Client-generated idempotency key for one feedback submission.';
COMMENT ON COLUMN support.feedback_submissions.trigger IS 'Client surface that submitted feedback. Automatic prompt cooldown uses this table, but manual settings feedback is never server-blocked.';
COMMENT ON COLUMN support.feedback_submissions.email_notification_status IS 'Best-effort internal notification status. The saved row is the source of truth.';

CREATE INDEX IF NOT EXISTS idx_feedback_prompt_events_user_created_at
  ON support.feedback_prompt_events(user_id, created_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user_created_at
  ON support.feedback_submissions(user_id, created_at_server DESC);

ALTER TABLE support.feedback_prompt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.feedback_submissions ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA support TO backend_app;
GRANT SELECT, INSERT ON TABLE support.feedback_prompt_events TO backend_app;
GRANT SELECT, INSERT ON TABLE support.feedback_submissions TO backend_app;
GRANT UPDATE (email_notification_status, email_notification_error) ON TABLE support.feedback_submissions TO backend_app;

DROP POLICY IF EXISTS feedback_prompt_events_self_select_runtime ON support.feedback_prompt_events;
CREATE POLICY feedback_prompt_events_self_select_runtime
  ON support.feedback_prompt_events
  FOR SELECT
  TO backend_app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS feedback_prompt_events_self_insert_runtime ON support.feedback_prompt_events;
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
    AND (
      installation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM sync.installations AS scoped_installations
        WHERE scoped_installations.installation_id = feedback_prompt_events.installation_id
          AND scoped_installations.user_id = security.current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS feedback_submissions_self_select_runtime ON support.feedback_submissions;
CREATE POLICY feedback_submissions_self_select_runtime
  ON support.feedback_submissions
  FOR SELECT
  TO backend_app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS feedback_submissions_self_insert_runtime ON support.feedback_submissions;
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
    AND (
      installation_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM sync.installations AS scoped_installations
        WHERE scoped_installations.installation_id = feedback_submissions.installation_id
          AND scoped_installations.user_id = security.current_user_id()
      )
    )
  );

DROP POLICY IF EXISTS feedback_submissions_self_email_status_update_runtime ON support.feedback_submissions;
CREATE POLICY feedback_submissions_self_email_status_update_runtime
  ON support.feedback_submissions
  FOR UPDATE
  TO backend_app
  USING (user_id = security.current_user_id())
  WITH CHECK (user_id = security.current_user_id());

GRANT USAGE ON SCHEMA support TO reporting_readonly;
GRANT SELECT ON TABLE support.feedback_prompt_events TO reporting_readonly;
GRANT SELECT ON TABLE support.feedback_submissions TO reporting_readonly;

DROP POLICY IF EXISTS feedback_prompt_events_reporting_readonly_select ON support.feedback_prompt_events;
CREATE POLICY feedback_prompt_events_reporting_readonly_select
  ON support.feedback_prompt_events
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS feedback_submissions_reporting_readonly_select ON support.feedback_submissions;
CREATE POLICY feedback_submissions_reporting_readonly_select
  ON support.feedback_submissions
  FOR SELECT
  TO reporting_readonly
  USING (true);
