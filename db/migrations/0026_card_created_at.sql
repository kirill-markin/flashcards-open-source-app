ALTER TABLE content.cards
  ADD COLUMN created_at TIMESTAMPTZ;

UPDATE content.cards
SET created_at = updated_at
WHERE created_at IS NULL;

ALTER TABLE content.cards
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN content.cards.created_at IS 'Original card creation timestamp preserved across later edits, reviews, deletes, and sync merges.';
