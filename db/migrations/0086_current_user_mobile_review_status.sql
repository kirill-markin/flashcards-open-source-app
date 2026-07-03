-- Migration status: Current / additive.
-- Introduces: backend-owned current-user mobile review history signal.
-- Schemas touched/read explicitly: content, sync, security.

CREATE OR REPLACE FUNCTION content.current_user_has_mobile_review_event()
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
      AND workspace_replicas.actor_kind = 'client_installation'
      AND workspace_replicas.platform IN ('ios', 'android')
  );
$$;

REVOKE ALL ON FUNCTION content.current_user_has_mobile_review_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content.current_user_has_mobile_review_event() TO backend_app;

COMMENT ON FUNCTION content.current_user_has_mobile_review_event() IS
  'Returns whether the request-scoped user has any retained review event authored by that user from an iOS or Android client installation. Does not depend on security.current_workspace_id().';
