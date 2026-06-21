-- Migration status: Current / additive.
-- Introduces: canonical tag storage for legacy medium/long card effort.
-- Schemas touched/read explicitly: content, sync.

CREATE OR REPLACE FUNCTION pg_temp.append_legacy_effort_tags(
  p_existing_tags TEXT[],
  p_legacy_efforts TEXT[]
)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
AS $$
  WITH source_tags AS (
    SELECT existing_tags.tag, existing_tags.ordinality
    FROM unnest(coalesce(p_existing_tags, ARRAY[]::TEXT[])) WITH ORDINALITY AS existing_tags(tag, ordinality)
  ),
  source_effort_tags AS (
    SELECT legacy_efforts.effort AS tag, 1000000 + legacy_efforts.ordinality AS ordinality
    FROM unnest(coalesce(p_legacy_efforts, ARRAY[]::TEXT[])) WITH ORDINALITY AS legacy_efforts(effort, ordinality)
    WHERE legacy_efforts.effort IN ('medium', 'long')
  ),
  ranked_tags AS (
    SELECT DISTINCT ON (combined_tags.tag)
      combined_tags.tag,
      combined_tags.ordinality
    FROM (
      SELECT source_tags.tag, source_tags.ordinality
      FROM source_tags
      UNION ALL
      SELECT source_effort_tags.tag, source_effort_tags.ordinality
      FROM source_effort_tags
    ) AS combined_tags
    ORDER BY combined_tags.tag, combined_tags.ordinality
  )
  SELECT coalesce(array_agg(ranked_tags.tag ORDER BY ranked_tags.ordinality), ARRAY[]::TEXT[])
  FROM ranked_tags;
$$;

CREATE OR REPLACE FUNCTION pg_temp.jsonb_text_array(p_value JSONB)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(item.value), ARRAY[]::TEXT[])
  FROM jsonb_array_elements_text(p_value) AS item(value);
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content.decks AS decks
    WHERE decks.filter_definition->>'version' IS DISTINCT FROM '2'
      OR jsonb_typeof(decks.filter_definition->'tags') IS DISTINCT FROM 'array'
      OR jsonb_typeof(decks.filter_definition->'effortLevels') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION '0073_card_effort_tag_backfill requires content.decks filter_definition version 2 with array tags and effortLevels';
  END IF;
END
$$;

CREATE TEMP TABLE migration_0073_changed_cards ON COMMIT DROP AS
SELECT
  cards.workspace_id,
  cards.card_id,
  cards.last_modified_by_replica_id,
  cards.client_updated_at
FROM content.cards AS cards
WHERE cards.effort_level IN ('medium', 'long');

CREATE TEMP TABLE migration_0073_changed_decks ON COMMIT DROP AS
WITH normalized_decks AS (
  SELECT
    decks.workspace_id,
    decks.deck_id,
    decks.last_modified_by_replica_id,
    decks.client_updated_at,
    jsonb_build_object(
      'version', 2,
      'effortLevels', '[]'::jsonb,
      'tags', to_jsonb(
        pg_temp.append_legacy_effort_tags(
          pg_temp.jsonb_text_array(decks.filter_definition->'tags'),
          pg_temp.jsonb_text_array(decks.filter_definition->'effortLevels')
        )
      )
    ) AS normalized_filter_definition
  FROM content.decks AS decks
)
SELECT
  normalized_decks.workspace_id,
  normalized_decks.deck_id,
  normalized_decks.last_modified_by_replica_id,
  normalized_decks.client_updated_at,
  normalized_decks.normalized_filter_definition
FROM normalized_decks
INNER JOIN content.decks AS decks
  ON decks.workspace_id = normalized_decks.workspace_id
  AND decks.deck_id = normalized_decks.deck_id
WHERE decks.filter_definition IS DISTINCT FROM normalized_decks.normalized_filter_definition;

UPDATE content.cards AS cards
SET
  tags = pg_temp.append_legacy_effort_tags(cards.tags, ARRAY[cards.effort_level]),
  effort_level = 'fast',
  updated_at = now()
FROM migration_0073_changed_cards AS changed_cards
WHERE cards.workspace_id = changed_cards.workspace_id
  AND cards.card_id = changed_cards.card_id;

UPDATE content.decks AS decks
SET
  filter_definition = changed_decks.normalized_filter_definition,
  updated_at = now()
FROM migration_0073_changed_decks AS changed_decks
WHERE decks.workspace_id = changed_decks.workspace_id
  AND decks.deck_id = changed_decks.deck_id;

INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
SELECT changed_entities.workspace_id, 0, now()
FROM (
  SELECT changed_cards.workspace_id
  FROM migration_0073_changed_cards AS changed_cards
  UNION
  SELECT changed_decks.workspace_id
  FROM migration_0073_changed_decks AS changed_decks
) AS changed_entities
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO sync.hot_changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  replica_id,
  operation_id,
  client_updated_at
)
SELECT
  changed_cards.workspace_id,
  'card',
  changed_cards.card_id::text,
  'upsert',
  changed_cards.last_modified_by_replica_id,
  'migration-0073-effort-tag-card-' || changed_cards.card_id::text,
  changed_cards.client_updated_at
FROM migration_0073_changed_cards AS changed_cards;

INSERT INTO sync.hot_changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  replica_id,
  operation_id,
  client_updated_at
)
SELECT
  changed_decks.workspace_id,
  'deck',
  changed_decks.deck_id::text,
  'upsert',
  changed_decks.last_modified_by_replica_id,
  'migration-0073-effort-tag-deck-' || changed_decks.deck_id::text,
  changed_decks.client_updated_at
FROM migration_0073_changed_decks AS changed_decks;
