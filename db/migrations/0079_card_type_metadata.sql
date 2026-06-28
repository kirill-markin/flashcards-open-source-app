-- Migration status: Current / additive.
-- Introduces: canonical card type and structured card metadata.
-- Schemas touched/read explicitly: content.

ALTER TABLE content.cards
  ADD COLUMN IF NOT EXISTS card_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

UPDATE content.cards AS cards
SET card_type = 'basic'
WHERE cards.card_type IS NULL
  OR btrim(cards.card_type) = '';

UPDATE content.cards AS cards
SET metadata = jsonb_build_object(
  'version', 1,
  'source', jsonb_build_object(
    'label', NULL,
    'author', NULL,
    'comment', NULL,
    'createdAt', to_char(date_trunc('milliseconds', cards.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'importedAt', NULL,
    'importId', NULL
  )
)
WHERE cards.metadata IS NULL;

ALTER TABLE content.cards
  ALTER COLUMN card_type SET DEFAULT 'basic',
  ALTER COLUMN card_type SET NOT NULL,
  ALTER COLUMN metadata SET NOT NULL;

ALTER TABLE content.cards
  DROP CONSTRAINT IF EXISTS cards_card_type_nonempty;

ALTER TABLE content.cards
  ADD CONSTRAINT cards_card_type_nonempty
  CHECK (btrim(card_type) <> '');

ALTER TABLE content.cards
  DROP CONSTRAINT IF EXISTS cards_metadata_version_current;

ALTER TABLE content.cards
  ADD CONSTRAINT cards_metadata_version_current
  CHECK (metadata->>'version' = '1');

COMMENT ON COLUMN content.cards.card_type IS 'Canonical card rendering type. Unknown non-empty values are preserved for forward-compatible clients; blank values are normalized by backend writes.';
COMMENT ON COLUMN content.cards.metadata IS 'Canonical structured card metadata JSON. Version 1 contains an optional source object for import/manual provenance.';

GRANT SELECT ON TABLE content.cards TO reporting_readonly;
