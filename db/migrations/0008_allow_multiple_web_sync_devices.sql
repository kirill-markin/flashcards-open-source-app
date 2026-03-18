-- Migration status: Superseded / corrective.
-- Introduces: the first attempt to remove the one-web-device-per-user constraint for browser sync devices.
-- Current guidance: this migration was corrected by a schema-qualified follow-up and is useful mainly as historical context.
-- Replaced or refined by: db/migrations/0009_drop_sync_web_device_index.sql.
-- Replaces or corrects: db/migrations/0002_backend_web_mvp.sql.
-- See also: docs/architecture.md.
-- Sync-capable web clients own a stable browser-local deviceId.
-- The old one-web-device-per-(workspace_id, user_id) index collides with
-- /sync/push and /sync/pull when the browser registers its own deviceId.
DROP INDEX IF EXISTS idx_devices_workspace_user_web;
