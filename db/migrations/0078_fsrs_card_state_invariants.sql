-- Migration status: Current / additive.
-- Introduces: persisted FSRS card state repair and database invariants.
-- Schemas touched/read explicitly: content, sync.

CREATE TEMP TABLE migration_0078_invalid_cards ON COMMIT DROP AS
SELECT
  cards.workspace_id,
  cards.card_id,
  cards.deleted_at,
  cards.last_modified_by_replica_id,
  cards.client_updated_at
FROM content.cards AS cards
WHERE (
    cards.fsrs_card_state = 'new'
    AND (
      cards.due_at IS NOT NULL
      OR cards.fsrs_step_index IS NOT NULL
      OR cards.fsrs_stability IS NOT NULL
      OR cards.fsrs_difficulty IS NOT NULL
      OR cards.fsrs_last_reviewed_at IS NOT NULL
      OR cards.fsrs_scheduled_days IS NOT NULL
    )
  )
  OR (
    cards.fsrs_card_state <> 'new'
    AND (
      cards.fsrs_stability IS NULL
      OR cards.fsrs_difficulty IS NULL
      OR cards.fsrs_last_reviewed_at IS NULL
      OR cards.fsrs_scheduled_days IS NULL
    )
  )
  OR (
    cards.fsrs_card_state = 'review'
    AND cards.fsrs_step_index IS NOT NULL
  )
  OR (
    cards.fsrs_card_state IN ('learning', 'relearning')
    AND cards.fsrs_step_index IS NULL
  );

UPDATE content.cards AS cards
SET
  due_at = NULL,
  reps = 0,
  lapses = 0,
  fsrs_card_state = 'new',
  fsrs_step_index = NULL,
  fsrs_stability = NULL,
  fsrs_difficulty = NULL,
  fsrs_last_reviewed_at = NULL,
  fsrs_scheduled_days = NULL,
  updated_at = now()
FROM migration_0078_invalid_cards AS invalid_cards
WHERE cards.workspace_id = invalid_cards.workspace_id
  AND cards.card_id = invalid_cards.card_id;

INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
SELECT invalid_cards.workspace_id, 0, now()
FROM migration_0078_invalid_cards AS invalid_cards
WHERE invalid_cards.deleted_at IS NULL
GROUP BY invalid_cards.workspace_id
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
  invalid_cards.workspace_id,
  'card',
  invalid_cards.card_id::text,
  'upsert',
  invalid_cards.last_modified_by_replica_id,
  'migration-0078-fsrs-state-repair-card-' || invalid_cards.card_id::text,
  invalid_cards.client_updated_at
FROM migration_0078_invalid_cards AS invalid_cards
WHERE invalid_cards.deleted_at IS NULL;

ALTER TABLE content.cards
  DROP CONSTRAINT IF EXISTS cards_fsrs_state_invariants;

ALTER TABLE content.cards
  ADD CONSTRAINT cards_fsrs_state_invariants
  CHECK (
    (
      fsrs_card_state = 'new'
      AND due_at IS NULL
      AND fsrs_step_index IS NULL
      AND fsrs_stability IS NULL
      AND fsrs_difficulty IS NULL
      AND fsrs_last_reviewed_at IS NULL
      AND fsrs_scheduled_days IS NULL
    )
    OR (
      fsrs_card_state <> 'new'
      AND fsrs_stability IS NOT NULL
      AND fsrs_difficulty IS NOT NULL
      AND fsrs_last_reviewed_at IS NOT NULL
      AND fsrs_scheduled_days IS NOT NULL
      AND (
        (
          fsrs_card_state = 'review'
          AND fsrs_step_index IS NULL
        )
        OR (
          fsrs_card_state IN ('learning', 'relearning')
          AND fsrs_step_index IS NOT NULL
        )
      )
    )
  );
