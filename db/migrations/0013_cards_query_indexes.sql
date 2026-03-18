-- Migration status: Historical / partially superseded.
-- Introduces: cards query indexes, including trigram search support and the original active-cards default ordering index.
-- Current guidance: the trigram/search indexing remains relevant, but the old active ordering index was replaced later.
-- Replaced or refined by: db/migrations/0028_created_at_ordering_indexes.sql.
-- See also: docs/architecture.md.
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
