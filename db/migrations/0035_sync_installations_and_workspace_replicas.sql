-- Migration status: Current / canonical.
-- Introduces: immutable workspace-scoped sync replicas plus global client installations.
-- Replaces or corrects: the mutable sync.devices model from db/migrations/0001_initial_schema.sql and every later sync migration that referenced device_id directly.
-- Current guidance: installation identity is global to one app/browser install, while replica identity is immutable inside one workspace and is the only historical actor foreign key.
-- See also: docs/sync-identity-model.md.

CREATE TABLE IF NOT EXISTS sync.installations (
  installation_id UUID PRIMARY KEY, -- stable physical app/browser installation identity supplied by the client
  user_id TEXT NOT NULL, -- current authenticated owner of this installation for runtime authorization and diagnostics
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync.installations IS 'Global client installation identities. These rows never move between workspaces and are not used as historical actor foreign keys.';
COMMENT ON COLUMN sync.installations.installation_id IS 'Stable installation identity generated once per app/browser install and reused across user and workspace switches.';
COMMENT ON COLUMN sync.installations.user_id IS 'Current authenticated owner of the installation. This may change when the same physical installation changes accounts.';

CREATE TABLE IF NOT EXISTS sync.workspace_replicas (
  replica_id UUID PRIMARY KEY, -- immutable workspace actor identity referenced by cards, decks, review history, and sync logs
  workspace_id UUID NOT NULL REFERENCES org.workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, -- current authenticated owner of the actor row for runtime authorization and diagnostics
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('client_installation', 'workspace_seed', 'agent_connection', 'ai_chat')),
  installation_id UUID REFERENCES sync.installations(installation_id) ON DELETE RESTRICT,
  actor_key TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'system')),
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_replicas_client_installation_shape CHECK (
    (actor_kind = 'client_installation' AND installation_id IS NOT NULL AND actor_key IS NULL)
    OR (actor_kind <> 'client_installation' AND installation_id IS NULL AND actor_key IS NOT NULL)
  )
);

COMMENT ON TABLE sync.workspace_replicas IS 'Immutable workspace-scoped sync actors. Historical sync metadata must always point here, never to sync.installations.';
COMMENT ON COLUMN sync.workspace_replicas.replica_id IS 'Immutable actor identity for one installation or system actor inside one workspace.';
COMMENT ON COLUMN sync.workspace_replicas.actor_kind IS 'Actor family. Client installations use installation_id; internal actors use actor_key.';
COMMENT ON COLUMN sync.workspace_replicas.actor_key IS 'Deterministic system actor key for workspace_seed, agent_connection, or ai_chat rows.';

ALTER TABLE IF EXISTS auth.guest_device_aliases
  RENAME TO guest_replica_aliases;

ALTER TABLE IF EXISTS auth.guest_replica_aliases
  RENAME COLUMN source_guest_device_id TO source_guest_replica_id;

ALTER TABLE IF EXISTS auth.guest_replica_aliases
  RENAME COLUMN target_device_id TO target_replica_id;

ALTER INDEX IF EXISTS auth.idx_guest_device_aliases_target_device
  RENAME TO idx_guest_replica_aliases_target_replica;

COMMENT ON TABLE auth.guest_replica_aliases IS
  'Append-only lookup table from deleted guest workspace replica ids to their recreated target workspace replica ids after a destructive guest merge.';

COMMENT ON COLUMN auth.guest_replica_aliases.source_guest_replica_id IS
  'Deleted guest workspace replica id that existed before the merge.';

COMMENT ON COLUMN auth.guest_replica_aliases.upgrade_id IS
  'Owning guest upgrade history row for this replica alias.';

COMMENT ON COLUMN auth.guest_replica_aliases.target_replica_id IS
  'Replacement workspace replica id recreated in the destination workspace during merge.';

COMMENT ON COLUMN auth.guest_replica_aliases.merged_at IS
  'Server timestamp when this replica alias row was recorded.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_replicas_workspace_installation
  ON sync.workspace_replicas(workspace_id, installation_id)
  WHERE actor_kind = 'client_installation';

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_replicas_workspace_actor_kind_key
  ON sync.workspace_replicas(workspace_id, actor_kind, actor_key)
  WHERE actor_kind <> 'client_installation';

CREATE INDEX IF NOT EXISTS idx_workspace_replicas_installation
  ON sync.workspace_replicas(installation_id)
  WHERE installation_id IS NOT NULL;

ALTER TABLE sync.installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.workspace_replicas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installations_scoped_select_runtime ON sync.installations;
DROP POLICY IF EXISTS installations_scoped_insert_runtime ON sync.installations;
DROP POLICY IF EXISTS installations_scoped_update_runtime ON sync.installations;
DROP POLICY IF EXISTS installations_scoped_delete_runtime ON sync.installations;

CREATE POLICY installations_scoped_select_runtime
  ON sync.installations
  FOR SELECT
  TO backend_app, auth_app
  USING (user_id = security.current_user_id());

CREATE POLICY installations_scoped_insert_runtime
  ON sync.installations
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY installations_scoped_update_runtime
  ON sync.installations
  FOR UPDATE
  TO backend_app, auth_app
  USING (user_id = security.current_user_id())
  WITH CHECK (user_id = security.current_user_id());

CREATE POLICY installations_scoped_delete_runtime
  ON sync.installations
  FOR DELETE
  TO backend_app
  USING (user_id = security.current_user_id());

DROP POLICY IF EXISTS workspace_replicas_scoped_select_runtime ON sync.workspace_replicas;
DROP POLICY IF EXISTS workspace_replicas_scoped_insert_runtime ON sync.workspace_replicas;
DROP POLICY IF EXISTS workspace_replicas_scoped_update_runtime ON sync.workspace_replicas;
DROP POLICY IF EXISTS workspace_replicas_scoped_delete_runtime ON sync.workspace_replicas;

CREATE POLICY workspace_replicas_scoped_select_runtime
  ON sync.workspace_replicas
  FOR SELECT
  TO backend_app, auth_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY workspace_replicas_scoped_insert_runtime
  ON sync.workspace_replicas
  FOR INSERT
  TO backend_app, auth_app
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY workspace_replicas_scoped_update_runtime
  ON sync.workspace_replicas
  FOR UPDATE
  TO backend_app, auth_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  )
  WITH CHECK (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

CREATE POLICY workspace_replicas_scoped_delete_runtime
  ON sync.workspace_replicas
  FOR DELETE
  TO backend_app
  USING (
    security.current_workspace_access_allowed(workspace_id)
    AND user_id = security.current_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON sync.installations TO backend_app, auth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync.workspace_replicas TO backend_app, auth_app;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE OR REPLACE FUNCTION pg_temp.uuid_from_seed(seed TEXT)
RETURNS UUID
LANGUAGE SQL
IMMUTABLE
AS $$
  WITH digest AS (
    SELECT encode(public.digest(seed, 'sha256'), 'hex') AS hex
  )
  SELECT (
    substr(hex, 1, 8) || '-' ||
    substr(hex, 9, 4) || '-' ||
    '5' || substr(hex, 14, 3) || '-' ||
    lpad(to_hex((get_byte(decode(substr(hex, 17, 2), 'hex'), 0) & 63) | 128), 2, '0') ||
    substr(hex, 19, 2) || '-' ||
    substr(hex, 21, 12)
  )::uuid
  FROM digest
$$;

CREATE TEMP TABLE sync_legacy_device_catalog ON COMMIT DROP AS
SELECT
  devices.device_id AS legacy_device_id,
  devices.user_id,
  devices.platform,
  devices.app_version,
  devices.created_at,
  devices.last_seen_at,
  CASE
    WHEN devices.app_version = 'server-bootstrap' OR devices.app_version LIKE 'migration-%' THEN 'workspace_seed'
    WHEN devices.app_version LIKE 'agent:%' THEN 'agent_connection'
    WHEN devices.app_version LIKE 'ai-chat:%' THEN 'ai_chat'
    ELSE 'client_installation'
  END AS actor_kind,
  CASE
    WHEN devices.app_version = 'server-bootstrap' OR devices.app_version LIKE 'migration-%' THEN 'workspace-seed'
    WHEN devices.app_version LIKE 'agent:%' THEN substr(devices.app_version, length('agent:') + 1)
    WHEN devices.app_version LIKE 'ai-chat:%' THEN substr(devices.app_version, length('ai-chat:') + 1)
    ELSE NULL
  END AS actor_key
FROM sync.devices AS devices;

CREATE TEMP TABLE sync_legacy_replica_sources ON COMMIT DROP AS
SELECT DISTINCT workspace_id, legacy_device_id
FROM (
  SELECT cards.workspace_id, cards.last_modified_by_device_id AS legacy_device_id
  FROM content.cards AS cards
  UNION
  SELECT decks.workspace_id, decks.last_modified_by_device_id AS legacy_device_id
  FROM content.decks AS decks
  UNION
  SELECT workspaces.workspace_id, workspaces.fsrs_last_modified_by_device_id AS legacy_device_id
  FROM org.workspaces AS workspaces
  UNION
  SELECT review_events.workspace_id, review_events.device_id AS legacy_device_id
  FROM content.review_events AS review_events
  UNION
  SELECT hot_changes.workspace_id, hot_changes.device_id AS legacy_device_id
  FROM sync.hot_changes AS hot_changes
  UNION
  SELECT applied.workspace_id, applied.device_id AS legacy_device_id
  FROM sync.applied_operations_current AS applied
) AS replica_sources;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sync_legacy_replica_sources AS sources
    LEFT JOIN sync_legacy_device_catalog AS catalog
      ON catalog.legacy_device_id = sources.legacy_device_id
    WHERE catalog.legacy_device_id IS NULL
  ) THEN
    RAISE EXCEPTION 'sync identity migration failed: one or more historical device ids are missing from sync.devices';
  END IF;
END
$$;

CREATE TEMP TABLE sync_legacy_replica_candidates ON COMMIT DROP AS
SELECT
  sources.workspace_id,
  sources.legacy_device_id,
  catalog.user_id,
  catalog.actor_kind,
  CASE
    WHEN catalog.actor_kind = 'client_installation' THEN catalog.legacy_device_id::text
    WHEN catalog.actor_kind = 'workspace_seed' THEN 'workspace-seed'
    WHEN catalog.actor_kind = 'agent_connection' THEN coalesce(catalog.actor_key, 'missing-agent-connection')
    ELSE coalesce(catalog.actor_key, 'missing-ai-chat-actor')
  END AS canonical_actor_key,
  CASE
    WHEN catalog.actor_kind = 'client_installation' THEN catalog.legacy_device_id
    ELSE NULL
  END AS installation_id,
  CASE
    WHEN catalog.actor_kind = 'client_installation' THEN NULL
    WHEN catalog.actor_kind = 'workspace_seed' THEN 'workspace-seed'
    WHEN catalog.actor_kind = 'agent_connection' THEN coalesce(catalog.actor_key, 'missing-agent-connection')
    ELSE coalesce(catalog.actor_key, 'missing-ai-chat-actor')
  END AS actor_key,
  CASE
    WHEN catalog.actor_kind = 'workspace_seed' THEN 'system'
    ELSE catalog.platform
  END AS platform,
  catalog.app_version,
  catalog.created_at,
  catalog.last_seen_at
FROM sync_legacy_replica_sources AS sources
INNER JOIN sync_legacy_device_catalog AS catalog
  ON catalog.legacy_device_id = sources.legacy_device_id;

CREATE TEMP TABLE sync_legacy_canonical_replicas ON COMMIT DROP AS
SELECT DISTINCT ON (workspace_id, actor_kind, canonical_actor_key)
  CASE
    WHEN actor_kind = 'client_installation'
      THEN pg_temp.uuid_from_seed(format('%s:%s', workspace_id::text, installation_id::text))
    ELSE pg_temp.uuid_from_seed(format('%s:%s:%s', workspace_id::text, actor_kind, canonical_actor_key))
  END AS replica_id,
  workspace_id,
  user_id,
  actor_kind,
  installation_id,
  actor_key,
  platform,
  app_version,
  created_at,
  last_seen_at,
  canonical_actor_key
FROM sync_legacy_replica_candidates
ORDER BY
  workspace_id,
  actor_kind,
  canonical_actor_key,
  last_seen_at DESC,
  created_at DESC,
  legacy_device_id DESC;

CREATE TEMP TABLE sync_legacy_replica_mapping ON COMMIT DROP AS
SELECT
  candidates.workspace_id,
  candidates.legacy_device_id,
  canonical_replicas.replica_id
FROM sync_legacy_replica_candidates AS candidates
INNER JOIN sync_legacy_canonical_replicas AS canonical_replicas
  ON canonical_replicas.workspace_id = candidates.workspace_id
  AND canonical_replicas.actor_kind = candidates.actor_kind
  AND canonical_replicas.canonical_actor_key = candidates.canonical_actor_key;

INSERT INTO sync.installations (
  installation_id,
  user_id,
  platform,
  app_version,
  created_at,
  last_seen_at
)
SELECT DISTINCT
  catalog.legacy_device_id AS installation_id,
  catalog.user_id,
  catalog.platform,
  catalog.app_version,
  catalog.created_at,
  catalog.last_seen_at
FROM sync_legacy_device_catalog AS catalog
WHERE catalog.actor_kind = 'client_installation'
ON CONFLICT (installation_id) DO UPDATE
SET
  user_id = EXCLUDED.user_id,
  platform = EXCLUDED.platform,
  app_version = EXCLUDED.app_version,
  last_seen_at = GREATEST(sync.installations.last_seen_at, EXCLUDED.last_seen_at);

INSERT INTO sync.workspace_replicas (
  replica_id,
  workspace_id,
  user_id,
  actor_kind,
  installation_id,
  actor_key,
  platform,
  app_version,
  created_at,
  last_seen_at
)
SELECT
  canonical_replicas.replica_id,
  canonical_replicas.workspace_id,
  canonical_replicas.user_id,
  canonical_replicas.actor_kind,
  canonical_replicas.installation_id,
  canonical_replicas.actor_key,
  canonical_replicas.platform,
  canonical_replicas.app_version,
  canonical_replicas.created_at,
  canonical_replicas.last_seen_at
FROM sync_legacy_canonical_replicas AS canonical_replicas
ON CONFLICT (replica_id) DO NOTHING;

ALTER TABLE content.cards
  ADD COLUMN last_modified_by_replica_id UUID;

UPDATE content.cards AS cards
SET last_modified_by_replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = cards.workspace_id
  AND mapping.legacy_device_id = cards.last_modified_by_device_id;

ALTER TABLE content.cards
  ALTER COLUMN last_modified_by_replica_id SET NOT NULL;

ALTER TABLE content.decks
  ADD COLUMN last_modified_by_replica_id UUID;

UPDATE content.decks AS decks
SET last_modified_by_replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = decks.workspace_id
  AND mapping.legacy_device_id = decks.last_modified_by_device_id;

ALTER TABLE content.decks
  ALTER COLUMN last_modified_by_replica_id SET NOT NULL;

ALTER TABLE org.workspaces
  ADD COLUMN fsrs_last_modified_by_replica_id UUID;

UPDATE org.workspaces AS workspaces
SET fsrs_last_modified_by_replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = workspaces.workspace_id
  AND mapping.legacy_device_id = workspaces.fsrs_last_modified_by_device_id;

ALTER TABLE org.workspaces
  ALTER COLUMN fsrs_last_modified_by_replica_id SET NOT NULL;

ALTER TABLE content.review_events
  ADD COLUMN replica_id UUID;

UPDATE content.review_events AS review_events
SET replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = review_events.workspace_id
  AND mapping.legacy_device_id = review_events.device_id;

ALTER TABLE content.review_events
  ALTER COLUMN replica_id SET NOT NULL;

ALTER TABLE sync.hot_changes
  ADD COLUMN replica_id UUID;

UPDATE sync.hot_changes AS hot_changes
SET replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = hot_changes.workspace_id
  AND mapping.legacy_device_id = hot_changes.device_id;

ALTER TABLE sync.hot_changes
  ALTER COLUMN replica_id SET NOT NULL;

ALTER TABLE sync.applied_operations_current
  ADD COLUMN replica_id UUID;

UPDATE sync.applied_operations_current AS applied
SET replica_id = mapping.replica_id
FROM sync_legacy_replica_mapping AS mapping
WHERE mapping.workspace_id = applied.workspace_id
  AND mapping.legacy_device_id = applied.device_id;

ALTER TABLE sync.applied_operations_current
  ALTER COLUMN replica_id SET NOT NULL;

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conrelid::regclass AS relation_name, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'sync.devices'::regclass
      AND conrelid IN (
        'content.cards'::regclass,
        'content.decks'::regclass,
        'org.workspaces'::regclass,
        'content.review_events'::regclass,
        'sync.hot_changes'::regclass,
        'sync.applied_operations_current'::regclass
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', constraint_record.relation_name, constraint_record.conname);
  END LOOP;
END
$$;

ALTER TABLE content.cards
  DROP COLUMN last_modified_by_device_id;

ALTER TABLE content.decks
  DROP COLUMN last_modified_by_device_id;

ALTER TABLE org.workspaces
  DROP COLUMN fsrs_last_modified_by_device_id;

ALTER TABLE content.review_events
  DROP COLUMN device_id;

ALTER TABLE sync.hot_changes
  DROP COLUMN device_id;

ALTER TABLE sync.applied_operations_current
  DROP COLUMN device_id;

ALTER TABLE content.cards
  ADD CONSTRAINT fk_cards_last_modified_replica
  FOREIGN KEY (last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

ALTER TABLE content.decks
  ADD CONSTRAINT fk_decks_last_modified_replica
  FOREIGN KEY (last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

ALTER TABLE org.workspaces
  ADD CONSTRAINT fk_workspaces_fsrs_last_modified_replica
  FOREIGN KEY (fsrs_last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

ALTER TABLE content.review_events
  ADD CONSTRAINT fk_review_events_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

ALTER TABLE sync.hot_changes
  ADD CONSTRAINT fk_hot_changes_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

ALTER TABLE sync.applied_operations_current
  DROP CONSTRAINT IF EXISTS applied_operations_current_pkey;

ALTER TABLE sync.applied_operations_current
  ADD CONSTRAINT applied_operations_current_pkey
  PRIMARY KEY (workspace_id, replica_id, operation_id, applied_at);

ALTER TABLE sync.applied_operations_current
  ADD CONSTRAINT fk_applied_operations_current_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS idx_applied_operations_current_workspace_device_operation;
CREATE INDEX idx_applied_operations_current_workspace_replica_operation
  ON sync.applied_operations_current(workspace_id, replica_id, operation_id, applied_at DESC);

DROP INDEX IF EXISTS idx_sync_changes_workspace_change_id;
DROP INDEX IF EXISTS idx_sync_changes_workspace_entity_latest;
CREATE INDEX IF NOT EXISTS idx_hot_changes_workspace_change_id
  ON sync.hot_changes(workspace_id, change_id);
CREATE INDEX IF NOT EXISTS idx_hot_changes_workspace_entity_latest
  ON sync.hot_changes(workspace_id, entity_type, entity_id, change_id DESC);

ALTER TABLE content.review_events
  DROP CONSTRAINT IF EXISTS content_review_events_workspace_id_device_id_client_event_id_key;
ALTER TABLE content.review_events
  DROP CONSTRAINT IF EXISTS review_events_workspace_id_device_id_client_event_id_key;

ALTER TABLE content.review_events
  ADD CONSTRAINT review_events_workspace_id_replica_id_client_event_id_key
  UNIQUE (workspace_id, replica_id, client_event_id);

COMMENT ON COLUMN content.cards.last_modified_by_replica_id IS 'Immutable workspace replica that last produced the winning card row according to the LWW tuple.';
COMMENT ON COLUMN content.decks.last_modified_by_replica_id IS 'Immutable workspace replica that last produced the winning deck row according to the LWW tuple.';
COMMENT ON COLUMN org.workspaces.fsrs_last_modified_by_replica_id IS 'Immutable workspace replica that last produced the winning workspace scheduler settings row according to the LWW tuple.';
COMMENT ON COLUMN content.review_events.replica_id IS 'Immutable workspace replica that recorded the review event.';
COMMENT ON COLUMN sync.hot_changes.replica_id IS 'Immutable workspace replica that produced the winning hot mutation entry.';
COMMENT ON COLUMN sync.applied_operations_current.replica_id IS 'Immutable workspace replica that submitted the idempotent push operation.';

UPDATE auth.guest_replica_aliases AS aliases
SET
  source_guest_replica_id = CASE
    WHEN source_catalog.actor_kind = 'client_installation'
      THEN pg_temp.uuid_from_seed(format('%s:%s', history.source_guest_workspace_id::text, aliases.source_guest_replica_id::text))
    WHEN source_catalog.actor_kind = 'workspace_seed'
      THEN pg_temp.uuid_from_seed(format('%s:%s:%s', history.source_guest_workspace_id::text, source_catalog.actor_kind, 'workspace-seed'))
    WHEN source_catalog.actor_kind = 'agent_connection'
      THEN pg_temp.uuid_from_seed(format('%s:%s:%s', history.source_guest_workspace_id::text, source_catalog.actor_kind, coalesce(source_catalog.actor_key, 'missing-agent-connection')))
    ELSE pg_temp.uuid_from_seed(format('%s:%s:%s', history.source_guest_workspace_id::text, source_catalog.actor_kind, coalesce(source_catalog.actor_key, 'missing-ai-chat-actor')))
  END,
  target_replica_id = CASE
    WHEN target_catalog.actor_kind = 'client_installation'
      THEN pg_temp.uuid_from_seed(format('%s:%s', history.target_workspace_id::text, aliases.target_replica_id::text))
    WHEN target_catalog.actor_kind = 'workspace_seed'
      THEN pg_temp.uuid_from_seed(format('%s:%s:%s', history.target_workspace_id::text, target_catalog.actor_kind, 'workspace-seed'))
    WHEN target_catalog.actor_kind = 'agent_connection'
      THEN pg_temp.uuid_from_seed(format('%s:%s:%s', history.target_workspace_id::text, target_catalog.actor_kind, coalesce(target_catalog.actor_key, 'missing-agent-connection')))
    ELSE pg_temp.uuid_from_seed(format('%s:%s:%s', history.target_workspace_id::text, target_catalog.actor_kind, coalesce(target_catalog.actor_key, 'missing-ai-chat-actor')))
  END
FROM auth.guest_upgrade_history AS history
, sync_legacy_device_catalog AS source_catalog
, sync_legacy_device_catalog AS target_catalog
WHERE history.upgrade_id = aliases.upgrade_id
  AND source_catalog.legacy_device_id = aliases.source_guest_replica_id
  AND target_catalog.legacy_device_id = aliases.target_replica_id;

DROP TABLE sync.devices;
