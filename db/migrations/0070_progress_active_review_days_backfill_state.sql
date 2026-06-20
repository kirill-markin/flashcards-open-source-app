-- Migration status: Current / additive.
-- Introduces: durable cursor state for the Progress active-day backfill job.
-- Current guidance: the hourly backend job resumes from this cursor so each
--   invocation advances through bounded reviewer/workspace key pages.

CREATE TABLE IF NOT EXISTS progress.active_review_days_backfill_state (
  job_name            TEXT        PRIMARY KEY CHECK (job_name = 'progress_active_days_backfill'),
  cursor_user_id      TEXT,
  cursor_workspace_id UUID,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (cursor_user_id IS NULL AND cursor_workspace_id IS NULL)
    OR (cursor_user_id IS NOT NULL AND cursor_workspace_id IS NOT NULL)
  )
);

COMMENT ON TABLE progress.active_review_days_backfill_state IS
  'Single-row durable cursor for the backend Progress active-day backfill job.';
COMMENT ON COLUMN progress.active_review_days_backfill_state.cursor_user_id IS
  'Last reviewed_by_user_id scanned by the Progress active-day backfill, or NULL after a full pass completes.';
COMMENT ON COLUMN progress.active_review_days_backfill_state.cursor_workspace_id IS
  'Last workspace_id scanned with cursor_user_id by the Progress active-day backfill, or NULL after a full pass completes.';
COMMENT ON COLUMN progress.active_review_days_backfill_state.updated_at IS
  'Server timestamp when the backfill cursor was last advanced or reset.';

ALTER TABLE progress.active_review_days_backfill_state ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA progress TO backend_app;

GRANT SELECT (
  job_name,
  cursor_user_id,
  cursor_workspace_id
) ON TABLE progress.active_review_days_backfill_state TO backend_app;

GRANT INSERT (
  job_name,
  cursor_user_id,
  cursor_workspace_id
) ON TABLE progress.active_review_days_backfill_state TO backend_app;

GRANT UPDATE (
  cursor_user_id,
  cursor_workspace_id,
  updated_at
) ON TABLE progress.active_review_days_backfill_state TO backend_app;

DROP POLICY IF EXISTS active_review_days_backfill_state_backend_select ON progress.active_review_days_backfill_state;
CREATE POLICY active_review_days_backfill_state_backend_select
  ON progress.active_review_days_backfill_state
  FOR SELECT
  TO backend_app
  USING (true);

DROP POLICY IF EXISTS active_review_days_backfill_state_backend_insert ON progress.active_review_days_backfill_state;
CREATE POLICY active_review_days_backfill_state_backend_insert
  ON progress.active_review_days_backfill_state
  FOR INSERT
  TO backend_app
  WITH CHECK (true);

DROP POLICY IF EXISTS active_review_days_backfill_state_backend_update ON progress.active_review_days_backfill_state;
CREATE POLICY active_review_days_backfill_state_backend_update
  ON progress.active_review_days_backfill_state
  FOR UPDATE
  TO backend_app
  USING (true)
  WITH CHECK (true);
