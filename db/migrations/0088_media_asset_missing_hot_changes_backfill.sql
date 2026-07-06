-- Migration status: Current / repair backfill.
-- Repairs: media asset registry rows that exist without matching hot sync changes.
-- Schemas touched/read explicitly: sync, content.

-- Repair registry sync for media assets whose blob bytes may already be present
-- but whose logical asset rows were not visible through incremental sync.
INSERT INTO sync.workspace_sync_metadata (workspace_id, min_available_hot_change_id, updated_at)
SELECT media_assets.workspace_id, 0, now()
FROM content.media_assets AS media_assets
WHERE NOT EXISTS (
  SELECT 1
  FROM sync.hot_changes AS hot_changes
  WHERE hot_changes.workspace_id = media_assets.workspace_id
    AND hot_changes.entity_type = 'media_asset'
    AND hot_changes.entity_id = media_assets.media_asset_id::text
)
GROUP BY media_assets.workspace_id
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
  media_assets.workspace_id,
  'media_asset',
  media_assets.media_asset_id::text,
  'upsert',
  media_assets.last_modified_by_replica_id,
  media_assets.last_operation_id,
  media_assets.client_updated_at
FROM content.media_assets AS media_assets
WHERE NOT EXISTS (
  SELECT 1
  FROM sync.hot_changes AS hot_changes
  WHERE hot_changes.workspace_id = media_assets.workspace_id
    AND hot_changes.entity_type = 'media_asset'
    AND hot_changes.entity_id = media_assets.media_asset_id::text
);
