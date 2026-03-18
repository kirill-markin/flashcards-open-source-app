-- Migration status: Historical / partially superseded.
-- Introduces: backend/web MVP adjustments, including card server-version sequencing and early web device handling.
-- Current guidance: the web-device uniqueness assumptions in this migration were corrected later and should not be treated as canonical sync behavior.
-- Replaced or refined by: db/migrations/0008_allow_multiple_web_sync_devices.sql, db/migrations/0009_drop_sync_web_device_index.sql, db/migrations/0028_sync_hot_state_rewrite.sql.
-- See also: docs/architecture.md.
CREATE SEQUENCE IF NOT EXISTS content.cards_server_version_seq AS BIGINT;

DO $$
DECLARE
  current_max BIGINT;
BEGIN
  SELECT COALESCE(MAX(server_version), 0) INTO current_max FROM content.cards;

  IF current_max = 0 THEN
    PERFORM setval('content.cards_server_version_seq', 1, false);
  ELSE
    PERFORM setval('content.cards_server_version_seq', current_max, true);
  END IF;
END
$$;

ALTER TABLE content.cards
  ALTER COLUMN server_version SET DEFAULT nextval('content.cards_server_version_seq');

ALTER TABLE sync.devices
  DROP CONSTRAINT IF EXISTS devices_platform_check;

ALTER TABLE sync.devices
  ADD CONSTRAINT devices_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));
-- Web sync clients now own their own stable browser-local device ids.
-- Multiple web devices per (workspace_id, user_id) must remain allowed.
