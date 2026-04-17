-- Migration status: Current / canonical.
-- Introduces: a backend-facing review-event index for user progress and other client-time range reads.
-- Current guidance: keep range predicates on content.review_events.reviewed_at_client sargable so the planner can use this index.
-- See also: apps/backend/src/progress.ts.

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_client_time
  ON content.review_events(workspace_id, reviewed_at_client);

COMMENT ON INDEX content.idx_review_events_workspace_client_time IS
  'Supports workspace-scoped reviewed_at_client range scans such as user progress history reads.';
