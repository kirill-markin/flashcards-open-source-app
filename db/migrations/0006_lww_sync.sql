-- LWW sync metadata and per-table server cursors.
-- This migration makes cards, decks, and workspace scheduler settings
-- row-authoritative sync roots. review_events stay append-only history and
-- receive their own server cursor for incremental pull.

ALTER TABLE content.cards
  ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id UUID,
  ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

ALTER TABLE content.decks
  ADD COLUMN IF NOT EXISTS server_version BIGINT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified_by_device_id UUID,
  ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

ALTER TABLE org.workspaces
  ADD COLUMN IF NOT EXISTS fsrs_server_version BIGINT,
  ADD COLUMN IF NOT EXISTS fsrs_client_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fsrs_last_modified_by_device_id UUID,
  ADD COLUMN IF NOT EXISTS fsrs_last_operation_id TEXT;

ALTER TABLE content.review_events
  ADD COLUMN IF NOT EXISTS server_version BIGINT;

ALTER TABLE sync.applied_operations
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resulting_server_version BIGINT;

WITH missing_workspaces AS (
  SELECT
    workspaces.workspace_id,
    COALESCE(
      (
        SELECT user_settings.user_id
        FROM org.user_settings AS user_settings
        WHERE user_settings.workspace_id = workspaces.workspace_id
        ORDER BY user_settings.created_at ASC, user_settings.user_id ASC
        LIMIT 1
      ),
      'migration-backfill'
    ) AS user_id,
    md5(workspaces.workspace_id::text || ':sync-bootstrap-device') AS digest
  FROM org.workspaces AS workspaces
  WHERE NOT EXISTS (
    SELECT 1
    FROM sync.devices AS devices
    WHERE devices.workspace_id = workspaces.workspace_id
  )
)
INSERT INTO sync.devices (
  device_id,
  workspace_id,
  user_id,
  platform,
  app_version,
  created_at,
  last_seen_at
)
SELECT
  (
    substr(digest, 1, 8) || '-' ||
    substr(digest, 9, 4) || '-' ||
    substr(digest, 13, 4) || '-' ||
    substr(digest, 17, 4) || '-' ||
    substr(digest, 21, 12)
  )::uuid,
  workspace_id,
  user_id,
  'ios',
  'migration-0006-lww-sync',
  now(),
  now()
FROM missing_workspaces;

UPDATE content.cards AS cards
SET
  client_updated_at = COALESCE(cards.updated_at, now()),
  last_modified_by_device_id = (
    SELECT devices.device_id
    FROM sync.devices AS devices
    WHERE devices.workspace_id = cards.workspace_id
    ORDER BY devices.created_at ASC, devices.device_id ASC
    LIMIT 1
  ),
  last_operation_id = 'migration-0006-card-backfill-' || cards.card_id::text
WHERE
  cards.client_updated_at IS NULL
  OR cards.last_modified_by_device_id IS NULL
  OR cards.last_operation_id IS NULL;

UPDATE content.decks AS decks
SET
  client_updated_at = COALESCE(decks.updated_at, decks.created_at, now()),
  last_modified_by_device_id = (
    SELECT devices.device_id
    FROM sync.devices AS devices
    WHERE devices.workspace_id = decks.workspace_id
    ORDER BY devices.created_at ASC, devices.device_id ASC
    LIMIT 1
  ),
  last_operation_id = 'migration-0006-deck-backfill-' || decks.deck_id::text
WHERE
  decks.client_updated_at IS NULL
  OR decks.last_modified_by_device_id IS NULL
  OR decks.last_operation_id IS NULL;

UPDATE org.workspaces AS workspaces
SET
  fsrs_client_updated_at = COALESCE(workspaces.fsrs_updated_at, workspaces.created_at, now()),
  fsrs_last_modified_by_device_id = (
    SELECT devices.device_id
    FROM sync.devices AS devices
    WHERE devices.workspace_id = workspaces.workspace_id
    ORDER BY devices.created_at ASC, devices.device_id ASC
    LIMIT 1
  ),
  fsrs_last_operation_id = 'migration-0006-fsrs-backfill-' || workspaces.workspace_id::text
WHERE
  workspaces.fsrs_client_updated_at IS NULL
  OR workspaces.fsrs_last_modified_by_device_id IS NULL
  OR workspaces.fsrs_last_operation_id IS NULL;

UPDATE sync.applied_operations AS applied_operations
SET
  entity_type = COALESCE(applied_operations.entity_type, 'legacy'),
  entity_id = COALESCE(applied_operations.entity_id, applied_operations.operation_id),
  client_updated_at = COALESCE(applied_operations.client_updated_at, applied_operations.applied_at)
WHERE
  applied_operations.entity_type IS NULL
  OR applied_operations.entity_id IS NULL
  OR applied_operations.client_updated_at IS NULL;

CREATE SEQUENCE IF NOT EXISTS content.decks_server_version_seq AS BIGINT;
CREATE SEQUENCE IF NOT EXISTS content.review_events_server_version_seq AS BIGINT;
CREATE SEQUENCE IF NOT EXISTS org.workspaces_fsrs_server_version_seq AS BIGINT;

DO $$
DECLARE
  decks_max BIGINT;
  review_events_max BIGINT;
  fsrs_max BIGINT;
BEGIN
  SELECT COALESCE(MAX(server_version), 0) INTO decks_max FROM content.decks;
  IF decks_max = 0 THEN
    PERFORM setval('content.decks_server_version_seq', 1, false);
  ELSE
    PERFORM setval('content.decks_server_version_seq', decks_max, true);
  END IF;

  SELECT COALESCE(MAX(server_version), 0) INTO review_events_max FROM content.review_events;
  IF review_events_max = 0 THEN
    PERFORM setval('content.review_events_server_version_seq', 1, false);
  ELSE
    PERFORM setval('content.review_events_server_version_seq', review_events_max, true);
  END IF;

  SELECT COALESCE(MAX(fsrs_server_version), 0) INTO fsrs_max FROM org.workspaces;
  IF fsrs_max = 0 THEN
    PERFORM setval('org.workspaces_fsrs_server_version_seq', 1, false);
  ELSE
    PERFORM setval('org.workspaces_fsrs_server_version_seq', fsrs_max, true);
  END IF;
END
$$;

UPDATE content.decks
SET server_version = nextval('content.decks_server_version_seq')
WHERE server_version IS NULL;

UPDATE content.review_events
SET server_version = nextval('content.review_events_server_version_seq')
WHERE server_version IS NULL;

UPDATE org.workspaces
SET fsrs_server_version = nextval('org.workspaces_fsrs_server_version_seq')
WHERE fsrs_server_version IS NULL;

ALTER TABLE content.decks
  ALTER COLUMN server_version SET DEFAULT nextval('content.decks_server_version_seq'),
  ALTER COLUMN server_version SET NOT NULL,
  ALTER COLUMN client_updated_at SET NOT NULL,
  ALTER COLUMN last_modified_by_device_id SET NOT NULL,
  ALTER COLUMN last_operation_id SET NOT NULL;

ALTER TABLE content.review_events
  ALTER COLUMN server_version SET DEFAULT nextval('content.review_events_server_version_seq'),
  ALTER COLUMN server_version SET NOT NULL;

ALTER TABLE org.workspaces
  ALTER COLUMN fsrs_server_version SET DEFAULT nextval('org.workspaces_fsrs_server_version_seq'),
  ALTER COLUMN fsrs_server_version SET NOT NULL,
  ALTER COLUMN fsrs_client_updated_at SET NOT NULL,
  ALTER COLUMN fsrs_last_modified_by_device_id SET NOT NULL,
  ALTER COLUMN fsrs_last_operation_id SET NOT NULL;

ALTER TABLE content.cards
  ALTER COLUMN client_updated_at SET NOT NULL,
  ALTER COLUMN last_modified_by_device_id SET NOT NULL,
  ALTER COLUMN last_operation_id SET NOT NULL;

ALTER TABLE sync.applied_operations
  ALTER COLUMN entity_type SET NOT NULL,
  ALTER COLUMN entity_id SET NOT NULL,
  ALTER COLUMN client_updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_cards_last_modified_device'
  ) THEN
    ALTER TABLE content.cards
      ADD CONSTRAINT fk_cards_last_modified_device
      FOREIGN KEY (last_modified_by_device_id) REFERENCES sync.devices(device_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_decks_last_modified_device'
  ) THEN
    ALTER TABLE content.decks
      ADD CONSTRAINT fk_decks_last_modified_device
      FOREIGN KEY (last_modified_by_device_id) REFERENCES sync.devices(device_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_workspaces_fsrs_last_modified_device'
  ) THEN
    ALTER TABLE org.workspaces
      ADD CONSTRAINT fk_workspaces_fsrs_last_modified_device
      FOREIGN KEY (fsrs_last_modified_by_device_id) REFERENCES sync.devices(device_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_decks_workspace_server_version
  ON content.decks(workspace_id, server_version);

CREATE INDEX IF NOT EXISTS idx_decks_workspace_updated_active
  ON content.decks(workspace_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_server_version
  ON content.review_events(workspace_id, server_version);

CREATE INDEX IF NOT EXISTS idx_workspaces_fsrs_server_version
  ON org.workspaces(workspace_id, fsrs_server_version);

COMMENT ON COLUMN content.cards.client_updated_at IS 'LWW ordering timestamp provided by the client that last changed this card row.';
COMMENT ON COLUMN content.cards.last_modified_by_device_id IS 'Device that last produced the winning card row according to the LWW tuple.';
COMMENT ON COLUMN content.cards.last_operation_id IS 'Client-generated operation identifier used as the final deterministic LWW tie-break for cards.';

COMMENT ON COLUMN content.decks.server_version IS 'Server-assigned monotonic cursor for incremental deck pull without rescanning the full table.';
COMMENT ON COLUMN content.decks.deleted_at IS 'Deck tombstone timestamp. Non-NULL means the deck is deleted but must still sync to other devices.';
COMMENT ON COLUMN content.decks.client_updated_at IS 'LWW ordering timestamp provided by the client that last changed this deck row.';
COMMENT ON COLUMN content.decks.last_modified_by_device_id IS 'Device that last produced the winning deck row according to the LWW tuple.';
COMMENT ON COLUMN content.decks.last_operation_id IS 'Client-generated operation identifier used as the final deterministic LWW tie-break for decks.';

COMMENT ON COLUMN org.workspaces.fsrs_server_version IS 'Server-assigned monotonic cursor for incremental pull of workspace scheduler settings.';
COMMENT ON COLUMN org.workspaces.fsrs_client_updated_at IS 'LWW ordering timestamp provided by the client that last changed the persisted workspace scheduler settings.';
COMMENT ON COLUMN org.workspaces.fsrs_last_modified_by_device_id IS 'Device that last produced the winning workspace scheduler settings row according to the LWW tuple.';
COMMENT ON COLUMN org.workspaces.fsrs_last_operation_id IS 'Client-generated operation identifier used as the final deterministic LWW tie-break for workspace scheduler settings.';

COMMENT ON COLUMN content.review_events.server_version IS 'Server-assigned monotonic cursor for incremental review-event pull. review_events remain append-only facts.';

COMMENT ON COLUMN sync.applied_operations.entity_type IS 'Logical sync root targeted by the idempotent operation, such as card, deck, workspace_scheduler_settings, or review_event.';
COMMENT ON COLUMN sync.applied_operations.entity_id IS 'Identifier of the logical sync root targeted by the idempotent operation.';
COMMENT ON COLUMN sync.applied_operations.client_updated_at IS 'Client-provided timestamp recorded with the operation for debugging LWW ordering decisions and replay traces.';
COMMENT ON COLUMN sync.applied_operations.resulting_server_version IS 'Server cursor of the row or review event that won after this operation was applied or ignored.';

COMMENT ON SEQUENCE content.decks_server_version_seq IS 'Generates monotonic server cursors for deck delta pull.';
COMMENT ON SEQUENCE content.review_events_server_version_seq IS 'Generates monotonic server cursors for append-only review-event delta pull.';
COMMENT ON SEQUENCE org.workspaces_fsrs_server_version_seq IS 'Generates monotonic server cursors for workspace scheduler settings delta pull.';

COMMENT ON INDEX idx_decks_workspace_server_version IS 'Supports incremental deck pull by workspace and server cursor.';
COMMENT ON INDEX idx_decks_workspace_updated_active IS 'Supports active deck listing ordered by the latest server-side write time.';
COMMENT ON INDEX idx_review_events_workspace_server_version IS 'Supports incremental review-event pull by workspace and server cursor.';
COMMENT ON INDEX idx_workspaces_fsrs_server_version IS 'Supports incremental workspace scheduler settings pull by workspace and server cursor.';
