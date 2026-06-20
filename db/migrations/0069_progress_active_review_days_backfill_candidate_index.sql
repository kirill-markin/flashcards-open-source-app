-- Migration status: Current / additive.
-- Introduces: reviewer/workspace keyset support for Progress active-day backfill.
-- Current guidance: keeps the backend active-day catch-up job paging over
--   bounded reviewer/workspace keys instead of repeatedly grouping all review events.

CREATE INDEX IF NOT EXISTS idx_review_events_reviewer_workspace
  ON content.review_events(reviewed_by_user_id, workspace_id)
  WHERE reviewed_by_user_id IS NOT NULL;

COMMENT ON INDEX content.idx_review_events_reviewer_workspace IS
  'Supports Progress active-day backfill candidate keyset scans by reviewer and workspace.';
