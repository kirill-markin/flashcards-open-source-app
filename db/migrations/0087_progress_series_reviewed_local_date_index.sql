-- Migration status: Current / additive.
-- Introduces: backend-facing review-event index support for Progress series local-date reads.
-- Schemas touched/read explicitly: content.

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_reviewer_local_date
  ON content.review_events(workspace_id, reviewed_by_user_id, reviewed_local_date);

COMMENT ON INDEX content.idx_review_events_workspace_reviewer_local_date IS
  'Supports Progress series review-count reads by workspace, reviewer, and canonical reviewed_local_date.';
