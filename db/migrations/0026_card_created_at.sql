-- Migration status: Current / canonical.
-- Introduces: content.cards.created_at as the canonical original card creation timestamp.
-- Current guidance: this column remains canonical and is followed by sync backfill and ordering-index updates in later migrations.
-- Replaced or refined by: db/migrations/0027_sync_card_created_at_and_device_rls.sql, db/migrations/0028_created_at_ordering_indexes.sql.
-- See also: docs/architecture.md.
ALTER TABLE content.cards
  ADD COLUMN created_at TIMESTAMPTZ;

UPDATE content.cards
SET created_at = updated_at
WHERE created_at IS NULL;

ALTER TABLE content.cards
  ALTER COLUMN created_at SET NOT NULL;

COMMENT ON COLUMN content.cards.created_at IS 'Original card creation timestamp preserved across later edits, reviews, deletes, and sync merges.';
