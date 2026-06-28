-- Migration status: Current / additive.
-- Introduces: media asset registry metadata as a hot sync root.
-- Schemas touched/read explicitly: sync, content.

ALTER TABLE sync.hot_changes
  DROP CONSTRAINT IF EXISTS hot_changes_entity_type_check;

ALTER TABLE sync.hot_changes
  ADD CONSTRAINT hot_changes_entity_type_check
  CHECK (entity_type IN ('card', 'deck', 'workspace_scheduler_settings', 'media_asset'));

ALTER TABLE sync.applied_operations_current
  DROP CONSTRAINT IF EXISTS applied_operations_current_entity_type_check;

ALTER TABLE sync.applied_operations_current
  ADD CONSTRAINT applied_operations_current_entity_type_check
  CHECK (entity_type IN ('card', 'deck', 'workspace_scheduler_settings', 'review_event', 'media_asset'));

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
SET search_path = pg_catalog
AS $$
DECLARE
  target_entity_uuid UUID;
BEGIN
  IF target_entity_type NOT IN ('card', 'deck', 'review_event', 'media_asset') THEN
    RAISE EXCEPTION 'Unsupported sync conflict entity type: %', target_entity_type
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    target_entity_uuid := target_entity_id::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid sync conflict entity id for %: %', target_entity_type, target_entity_id
        USING ERRCODE = '22P02';
  END;

  IF target_entity_type = 'card' THEN
    RETURN QUERY
    SELECT cards.workspace_id
    FROM content.cards AS cards
    WHERE cards.card_id = target_entity_uuid
    LIMIT 1;
    RETURN;
  END IF;

  IF target_entity_type = 'deck' THEN
    RETURN QUERY
    SELECT decks.workspace_id
    FROM content.decks AS decks
    WHERE decks.deck_id = target_entity_uuid
    LIMIT 1;
    RETURN;
  END IF;

  IF target_entity_type = 'review_event' THEN
    RETURN QUERY
    SELECT review_events.workspace_id
    FROM content.review_events AS review_events
    WHERE review_events.review_event_id = target_entity_uuid
    LIMIT 1;
    RETURN;
  END IF;

  IF target_entity_type = 'media_asset' THEN
    RETURN QUERY
    SELECT media_assets.workspace_id
    FROM content.media_assets AS media_assets
    WHERE media_assets.media_asset_id = target_entity_uuid
    LIMIT 1;
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) TO backend_app;

COMMENT ON FUNCTION sync.find_conflicting_workspace_id(TEXT, TEXT) IS
  'Returns the owning workspace for one globally keyed sync entity id without depending on caller-visible workspace memberships.';
