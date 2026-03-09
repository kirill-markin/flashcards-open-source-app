-- Sync-capable web clients own a stable browser-local deviceId.
-- The old one-web-device-per-(workspace_id, user_id) index collides with
-- /sync/push and /sync/pull when the browser registers its own deviceId.
DROP INDEX IF EXISTS idx_devices_workspace_user_web;
