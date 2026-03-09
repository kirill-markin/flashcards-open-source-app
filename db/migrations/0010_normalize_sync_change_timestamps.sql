-- The original sync.changes backfill stored Postgres timestamp text inside
-- JSON payloads. The sync API later validates those payloads as canonical UTC
-- ISO strings, so existing rows must be rewritten to the same wire format used
-- by live application writes.
CREATE FUNCTION pg_temp.to_canonical_jsonb_timestamp_text(value TEXT)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL THEN 'null'::jsonb
    ELSE to_jsonb(
      to_char(
        date_trunc('milliseconds', value::timestamptz AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    )
  END
$$;

-- Mutable card snapshots require canonical timestamps for dueAt and all LWW
-- metadata fields so sync pull can validate and replay them.
UPDATE sync.changes
SET payload = jsonb_build_object(
  'cardId', payload->>'cardId',
  'frontText', payload->>'frontText',
  'backText', payload->>'backText',
  'tags', payload->'tags',
  'effortLevel', payload->>'effortLevel',
  'dueAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'dueAt'),
  'reps', payload->'reps',
  'lapses', payload->'lapses',
  'fsrsCardState', payload->>'fsrsCardState',
  'fsrsStepIndex', payload->'fsrsStepIndex',
  'fsrsStability', payload->'fsrsStability',
  'fsrsDifficulty', payload->'fsrsDifficulty',
  'fsrsLastReviewedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'fsrsLastReviewedAt'),
  'fsrsScheduledDays', payload->'fsrsScheduledDays',
  'clientUpdatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'clientUpdatedAt'),
  'lastModifiedByDeviceId', payload->>'lastModifiedByDeviceId',
  'lastOperationId', payload->>'lastOperationId',
  'updatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'updatedAt'),
  'deletedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'deletedAt')
)
WHERE entity_type = 'card';

-- Deck snapshots must expose canonical createdAt and LWW timestamps for pull.
UPDATE sync.changes
SET payload = jsonb_build_object(
  'deckId', payload->>'deckId',
  'workspaceId', payload->>'workspaceId',
  'name', payload->>'name',
  'filterDefinition', payload->'filterDefinition',
  'createdAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'createdAt'),
  'clientUpdatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'clientUpdatedAt'),
  'lastModifiedByDeviceId', payload->>'lastModifiedByDeviceId',
  'lastOperationId', payload->>'lastOperationId',
  'updatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'updatedAt'),
  'deletedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'deletedAt')
)
WHERE entity_type = 'deck';

-- Workspace scheduler payloads participate in LWW sync and therefore must use
-- the same canonical timestamp encoding as cards and decks.
UPDATE sync.changes
SET payload = jsonb_build_object(
  'algorithm', payload->>'algorithm',
  'desiredRetention', payload->'desiredRetention',
  'learningStepsMinutes', payload->'learningStepsMinutes',
  'relearningStepsMinutes', payload->'relearningStepsMinutes',
  'maximumIntervalDays', payload->'maximumIntervalDays',
  'enableFuzz', payload->'enableFuzz',
  'clientUpdatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'clientUpdatedAt'),
  'lastModifiedByDeviceId', payload->>'lastModifiedByDeviceId',
  'lastOperationId', payload->>'lastOperationId',
  'updatedAt', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'updatedAt')
)
WHERE entity_type = 'workspace_scheduler_settings';

-- Immutable review history still travels through the same sync feed, so its
-- timestamps must also be normalized for strict payload validation.
UPDATE sync.changes
SET payload = jsonb_build_object(
  'reviewEventId', payload->>'reviewEventId',
  'workspaceId', payload->>'workspaceId',
  'cardId', payload->>'cardId',
  'deviceId', payload->>'deviceId',
  'clientEventId', payload->>'clientEventId',
  'rating', payload->'rating',
  'reviewedAtClient', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'reviewedAtClient'),
  'reviewedAtServer', pg_temp.to_canonical_jsonb_timestamp_text(payload->>'reviewedAtServer')
)
WHERE entity_type = 'review_event';

-- Fail loudly if any required timestamp field is still NULL after the rewrite.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sync.changes
    WHERE entity_type = 'card'
      AND ((payload->>'clientUpdatedAt') IS NULL OR (payload->>'updatedAt') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Card sync payloads still contain NULL required timestamps after normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sync.changes
    WHERE entity_type = 'deck'
      AND ((payload->>'createdAt') IS NULL OR (payload->>'clientUpdatedAt') IS NULL OR (payload->>'updatedAt') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Deck sync payloads still contain NULL required timestamps after normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sync.changes
    WHERE entity_type = 'workspace_scheduler_settings'
      AND ((payload->>'clientUpdatedAt') IS NULL OR (payload->>'updatedAt') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Workspace scheduler sync payloads still contain NULL required timestamps after normalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sync.changes
    WHERE entity_type = 'review_event'
      AND ((payload->>'reviewedAtClient') IS NULL OR (payload->>'reviewedAtServer') IS NULL)
  ) THEN
    RAISE EXCEPTION 'Review event sync payloads still contain NULL required timestamps after normalization';
  END IF;
END
$$;
