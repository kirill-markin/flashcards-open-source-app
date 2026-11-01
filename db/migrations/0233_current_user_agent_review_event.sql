-- Migration status: Current / additive.
-- Introduces: backend-owned current-user external agent review history signal.
-- Schemas touched/read explicitly: content, sync, security.

CREATE OR REPLACE FUNCTION content.current_user_has_agent_review_event()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM content.review_events AS review_events
    INNER JOIN sync.workspace_replicas AS workspace_replicas
      ON workspace_replicas.workspace_id = review_events.workspace_id
      AND workspace_replicas.replica_id = review_events.replica_id
    WHERE review_events.reviewed_by_user_id = security.current_user_id()
      AND workspace_replicas.actor_kind = 'agent_connection'
  );
$$;

REVOKE ALL ON FUNCTION content.current_user_has_agent_review_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.current_user_has_agent_review_event() TO backend_app;

COMMENT ON FUNCTION content.current_user_has_agent_review_event() IS
  'Returns whether the request-scoped user has any retained review event authored by that user through an external agent connection (MCP or the agent REST API, workspace replica actor_kind agent_connection), whatever the replica platform. Reviews made in the in-app AI chat are stored against an ai_chat replica and do not count. Does not depend on security.current_workspace_id().';
