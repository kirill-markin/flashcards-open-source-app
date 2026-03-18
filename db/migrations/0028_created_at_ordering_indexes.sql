-- Migration status: Current / canonical.
-- Introduces: created_at-based default ordering indexes for cards and decks.
-- Current guidance: this is the canonical default ordering index setup for current cards/decks queries.
-- Replaces or corrects: db/migrations/0013_cards_query_indexes.sql, db/migrations/0004_decks.sql.
-- Ordering note: migration filenames execute lexicographically, so db/migrations/0028_created_at_ordering_indexes.sql runs before db/migrations/0028_sync_hot_state_rewrite.sql.
-- See also: docs/architecture.md.
DROP INDEX IF EXISTS content.idx_cards_workspace_updated_at_active;

DROP INDEX IF EXISTS content.idx_decks_workspace_updated_active;

DROP INDEX IF EXISTS content.idx_decks_workspace_updated_at;

CREATE INDEX IF NOT EXISTS idx_cards_workspace_created_at_active
  ON content.cards(workspace_id, created_at DESC, card_id ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_decks_workspace_created_at_active
  ON content.decks(workspace_id, created_at DESC, deck_id DESC)
  WHERE deleted_at IS NULL;
