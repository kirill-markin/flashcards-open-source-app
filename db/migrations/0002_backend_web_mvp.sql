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

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_workspace_user_web
  ON sync.devices(workspace_id, user_id)
  WHERE platform = 'web';
