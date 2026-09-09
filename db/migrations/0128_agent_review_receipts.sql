-- Migration status: Current / additive.
-- Introduces: exact idempotent replay for dedicated online agent reviews.
-- Schemas touched/read explicitly: sync, org, security, pg_catalog.

CREATE TABLE sync.agent_review_receipts (
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  replica_id UUID NOT NULL REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  review_id UUID NOT NULL,
  user_id TEXT NOT NULL REFERENCES org.user_settings(user_id) ON DELETE CASCADE,
  request JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(request) = 'object'),
  result JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(result) = 'object'),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, replica_id, review_id)
);

COMMENT ON TABLE sync.agent_review_receipts IS
  'Immutable online review requests and original scheduling results; retained beyond hot sync history for safe retry. Contains no card text.';

ALTER TABLE sync.agent_review_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_review_receipts_select_runtime ON sync.agent_review_receipts
  FOR SELECT TO backend_app
  USING (security.current_workspace_access_allowed(workspace_id) AND user_id = security.current_user_id());
CREATE POLICY agent_review_receipts_insert_runtime ON sync.agent_review_receipts
  FOR INSERT TO backend_app
  WITH CHECK (security.current_workspace_access_allowed(workspace_id) AND user_id = security.current_user_id());
GRANT SELECT, INSERT ON sync.agent_review_receipts TO backend_app;
