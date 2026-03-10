CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at_active
  ON content.cards(workspace_id, updated_at DESC, card_id ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cards_active_search_trgm
  ON content.cards
  USING GIN (
    (
      lower(
        front_text
        || ' '
        || back_text
      )
    ) public.gin_trgm_ops
  )
  WHERE deleted_at IS NULL;
