-- Simplify deck filters to one canonical model:
-- - effortLevels are OR inside one array
-- - tags are AND inside one array

UPDATE content.decks
SET filter_definition = jsonb_build_object(
  'version',
  2,
  'effortLevels',
  COALESCE(
    (
      SELECT predicate->'values'
      FROM jsonb_array_elements(content.decks.filter_definition->'predicates') AS predicate
      WHERE predicate->>'field' = 'effortLevel'
      LIMIT 1
    ),
    '[]'::jsonb
  ),
  'tags',
  COALESCE(
    (
      SELECT predicate->'values'
      FROM jsonb_array_elements(content.decks.filter_definition->'predicates') AS predicate
      WHERE predicate->>'field' = 'tags'
      LIMIT 1
    ),
    '[]'::jsonb
  )
)
WHERE content.decks.filter_definition->>'version' = '1';

UPDATE sync.changes
SET payload = jsonb_set(
  sync.changes.payload,
  '{filterDefinition}',
  jsonb_build_object(
    'version',
    2,
    'effortLevels',
    COALESCE(
      (
        SELECT predicate->'values'
        FROM jsonb_array_elements(sync.changes.payload->'filterDefinition'->'predicates') AS predicate
        WHERE predicate->>'field' = 'effortLevel'
        LIMIT 1
      ),
      '[]'::jsonb
    ),
    'tags',
    COALESCE(
      (
        SELECT predicate->'values'
        FROM jsonb_array_elements(sync.changes.payload->'filterDefinition'->'predicates') AS predicate
        WHERE predicate->>'field' = 'tags'
        LIMIT 1
      ),
      '[]'::jsonb
    )
  ),
  false
)
WHERE sync.changes.entity_type = 'deck'
  AND sync.changes.payload->'filterDefinition'->>'version' = '1';
