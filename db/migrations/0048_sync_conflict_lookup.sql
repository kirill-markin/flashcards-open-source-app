-- Migration status: Current / canonical.
-- Introduces: a narrow cross-workspace sync conflict lookup helper for globally keyed entities.
-- Current guidance: typed sync fork errors must not depend on the caller's visible memberships.
-- See also: docs/sync-identity-model.md, db/migrations/0035_sync_installations_and_workspace_replicas.sql.

CREATE OR REPLACE FUNCTION sync.find_conflicting_workspace_id(
  target_entity_type TEXT,
  target_entity_id TEXT
)
RETURNS TABLE (
  workspace_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF target_entity_type = 'card' THEN
    RETURN QUERY
    SELECT cards.workspace_id
    FROM content.cards AS cards
    WHERE cards.card_id::text = target_entity_id
    LIMIT 1;
    RETURN;
  END IF;

  IF target_entity_type = 'deck' THEN
    RETURN QUERY
    SELECT decks.workspace_id
    FROM content.decks AS decks
    WHERE decks.deck_id::text = target_entity_id
    LIMIT 1;
    RETURN;
  END IF;

  IF target_entity_type = 'review_event' THEN
    RETURN QUERY
    SELECT review_events.workspace_id
    FROM content.review_events AS review_events
    WHERE review_events.review_event_id::text = target_entity_id
    LIMIT 1;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Unsupported sync conflict entity type: %', target_entity_type
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) TO backend_app;

COMMENT ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) IS
  'Returns the owning workspace for one globally keyed sync entity id without depending on caller-visible workspace memberships.';
