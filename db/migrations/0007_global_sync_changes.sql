-- Global workspace checkpoint sync through sync.changes.
-- This migration removes per-table server cursors and replaces them with one
-- append-only change feed ordered by sync.changes.change_id.

CREATE TABLE IF NOT EXISTS sync.changes (
  change_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- global server checkpoint for ordered pull across all sync roots in one workspace
  workspace_id  UUID        NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE, -- workspace whose sync stream this change belongs to
  entity_type   TEXT        NOT NULL CHECK (entity_type IN ('card', 'deck', 'workspace_scheduler_settings', 'review_event')), -- which sync root changed
  entity_id     TEXT        NOT NULL, -- identifier of the changed sync root or appended review event
  action        TEXT        NOT NULL CHECK (action IN ('upsert', 'append')), -- whether the payload overwrites a mutable root or appends a historical event
  device_id     UUID        NOT NULL REFERENCES sync.devices(device_id) ON DELETE RESTRICT, -- authenticated sync device that produced the winning mutation or appended event
  operation_id  TEXT        NOT NULL, -- client-generated operation identifier recorded for retries and debugging
  payload       JSONB       NOT NULL, -- full entity snapshot at the moment this change was recorded so pull can replay exact historical pages without reconstructing older row versions
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now() -- when the server appended this change to the global workspace stream
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_workspace_change_id
  ON sync.changes(workspace_id, change_id);

CREATE INDEX IF NOT EXISTS idx_sync_changes_workspace_entity_latest
  ON sync.changes(workspace_id, entity_type, entity_id, change_id DESC);

INSERT INTO sync.changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  device_id,
  operation_id,
  payload,
  recorded_at
)
SELECT
  cards.workspace_id,
  'card',
  cards.card_id::text,
  'upsert',
  cards.last_modified_by_device_id,
  cards.last_operation_id,
  jsonb_build_object(
    'cardId', cards.card_id::text,
    'frontText', cards.front_text,
    'backText', cards.back_text,
    'tags', cards.tags,
    'effortLevel', cards.effort_level,
    'dueAt', cards.due_at,
    'reps', cards.reps,
    'lapses', cards.lapses,
    'fsrsCardState', cards.fsrs_card_state,
    'fsrsStepIndex', cards.fsrs_step_index,
    'fsrsStability', cards.fsrs_stability,
    'fsrsDifficulty', cards.fsrs_difficulty,
    'fsrsLastReviewedAt', cards.fsrs_last_reviewed_at,
    'fsrsScheduledDays', cards.fsrs_scheduled_days,
    'clientUpdatedAt', cards.client_updated_at,
    'lastModifiedByDeviceId', cards.last_modified_by_device_id::text,
    'lastOperationId', cards.last_operation_id,
    'updatedAt', cards.updated_at,
    'deletedAt', cards.deleted_at
  ),
  cards.updated_at
FROM content.cards AS cards;

INSERT INTO sync.changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  device_id,
  operation_id,
  payload,
  recorded_at
)
SELECT
  decks.workspace_id,
  'deck',
  decks.deck_id::text,
  'upsert',
  decks.last_modified_by_device_id,
  decks.last_operation_id,
  jsonb_build_object(
    'deckId', decks.deck_id::text,
    'workspaceId', decks.workspace_id::text,
    'name', decks.name,
    'filterDefinition', decks.filter_definition,
    'createdAt', decks.created_at,
    'clientUpdatedAt', decks.client_updated_at,
    'lastModifiedByDeviceId', decks.last_modified_by_device_id::text,
    'lastOperationId', decks.last_operation_id,
    'updatedAt', decks.updated_at,
    'deletedAt', decks.deleted_at
  ),
  decks.updated_at
FROM content.decks AS decks;

INSERT INTO sync.changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  device_id,
  operation_id,
  payload,
  recorded_at
)
SELECT
  workspaces.workspace_id,
  'workspace_scheduler_settings',
  workspaces.workspace_id::text,
  'upsert',
  workspaces.fsrs_last_modified_by_device_id,
  workspaces.fsrs_last_operation_id,
  jsonb_build_object(
    'algorithm', workspaces.fsrs_algorithm,
    'desiredRetention', workspaces.fsrs_desired_retention,
    'learningStepsMinutes', workspaces.fsrs_learning_steps_minutes,
    'relearningStepsMinutes', workspaces.fsrs_relearning_steps_minutes,
    'maximumIntervalDays', workspaces.fsrs_maximum_interval_days,
    'enableFuzz', workspaces.fsrs_enable_fuzz,
    'clientUpdatedAt', workspaces.fsrs_client_updated_at,
    'lastModifiedByDeviceId', workspaces.fsrs_last_modified_by_device_id::text,
    'lastOperationId', workspaces.fsrs_last_operation_id,
    'updatedAt', workspaces.fsrs_updated_at
  ),
  workspaces.fsrs_updated_at
FROM org.workspaces AS workspaces;

INSERT INTO sync.changes (
  workspace_id,
  entity_type,
  entity_id,
  action,
  device_id,
  operation_id,
  payload,
  recorded_at
)
SELECT
  review_events.workspace_id,
  'review_event',
  review_events.review_event_id::text,
  'append',
  review_events.device_id,
  'migration-0007-review-event-backfill-' || review_events.review_event_id::text,
  jsonb_build_object(
    'reviewEventId', review_events.review_event_id::text,
    'workspaceId', review_events.workspace_id::text,
    'cardId', review_events.card_id::text,
    'deviceId', review_events.device_id::text,
    'clientEventId', review_events.client_event_id,
    'rating', review_events.rating,
    'reviewedAtClient', review_events.reviewed_at_client,
    'reviewedAtServer', review_events.reviewed_at_server
  ),
  review_events.reviewed_at_server
FROM content.review_events AS review_events;

ALTER TABLE sync.applied_operations
  DROP COLUMN IF EXISTS resulting_server_version,
  ADD COLUMN IF NOT EXISTS resulting_change_id BIGINT REFERENCES sync.changes(change_id) ON DELETE SET NULL;

ALTER TABLE content.cards
  ALTER COLUMN server_version DROP DEFAULT,
  DROP COLUMN IF EXISTS server_version;

ALTER TABLE content.decks
  ALTER COLUMN server_version DROP DEFAULT,
  DROP COLUMN IF EXISTS server_version;

ALTER TABLE content.review_events
  ALTER COLUMN server_version DROP DEFAULT,
  DROP COLUMN IF EXISTS server_version;

ALTER TABLE org.workspaces
  ALTER COLUMN fsrs_server_version DROP DEFAULT,
  DROP COLUMN IF EXISTS fsrs_server_version;

DROP INDEX IF EXISTS idx_cards_workspace_server_version;
DROP INDEX IF EXISTS idx_decks_workspace_server_version;
DROP INDEX IF EXISTS idx_review_events_workspace_server_version;
DROP INDEX IF EXISTS idx_workspaces_fsrs_server_version;

DROP SEQUENCE IF EXISTS content.cards_server_version_seq;
DROP SEQUENCE IF EXISTS content.decks_server_version_seq;
DROP SEQUENCE IF EXISTS content.review_events_server_version_seq;
DROP SEQUENCE IF EXISTS org.workspaces_fsrs_server_version_seq;

COMMENT ON TABLE sync.changes IS 'Global append-only workspace change feed used for incremental pull with one checkpoint instead of per-table cursors.';

COMMENT ON COLUMN sync.changes.change_id IS 'Monotonic global workspace checkpoint used by clients as afterChangeId during pull.';
COMMENT ON COLUMN sync.changes.workspace_id IS 'Workspace whose ordered sync stream owns this change row.';
COMMENT ON COLUMN sync.changes.entity_type IS 'Sync root kind whose snapshot was recorded in this feed entry.';
COMMENT ON COLUMN sync.changes.entity_id IS 'Identifier of the sync root or immutable review event represented by this change row.';
COMMENT ON COLUMN sync.changes.action IS 'Whether the payload is a mutable-root upsert snapshot or an append-only review event.';
COMMENT ON COLUMN sync.changes.device_id IS 'Authenticated sync device that produced the mutation recorded in this feed entry.';
COMMENT ON COLUMN sync.changes.operation_id IS 'Client-generated operation identifier copied into the feed for idempotency traces and debugging.';
COMMENT ON COLUMN sync.changes.payload IS 'Full entity snapshot stored with the feed entry so pull can replay exact ordered changes without reconstructing historical row versions.';
COMMENT ON COLUMN sync.changes.recorded_at IS 'Server timestamp when this change became visible in the global sync stream.';

COMMENT ON COLUMN sync.applied_operations.resulting_change_id IS 'Change feed checkpoint produced by the applied or ignored operation. NULL means the operation lost LWW before creating a new feed entry.';

COMMENT ON INDEX idx_sync_changes_workspace_change_id IS 'Supports ordered incremental pull by workspace and change checkpoint.';
COMMENT ON INDEX idx_sync_changes_workspace_entity_latest IS 'Supports finding the latest feed checkpoint for a specific sync root when an incoming operation loses LWW or dedupes.';
