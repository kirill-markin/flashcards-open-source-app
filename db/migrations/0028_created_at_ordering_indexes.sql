DROP INDEX IF EXISTS content.idx_cards_workspace_updated_at_active;

DROP INDEX IF EXISTS content.idx_decks_workspace_updated_active;

DROP INDEX IF EXISTS content.idx_decks_workspace_updated_at;

CREATE INDEX IF NOT EXISTS idx_cards_workspace_created_at_active
  ON content.cards(workspace_id, created_at DESC, card_id ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_decks_workspace_created_at_active
  ON content.decks(workspace_id, created_at DESC, deck_id DESC)
  WHERE deleted_at IS NULL;
