CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Supports the default paged Cards screen ordering for active cards.
CREATE INDEX IF NOT EXISTS idx_cards_workspace_updated_at_active
  ON content.cards(workspace_id, updated_at DESC, card_id ASC)
  WHERE deleted_at IS NULL;

-- Speeds up substring search for front/back text in the cloud Cards screen.
-- Keep this expression limited to immutable operations so PostgreSQL accepts
-- it inside the index definition. Do not switch back to concat_ws(...) or
-- array_to_string(...), which would make the migration fail at CREATE INDEX.
-- Tag matching remains part of the runtime query predicate and is evaluated
-- outside this trigram index.
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
