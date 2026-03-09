-- The original web-only unique index was created in the sync schema.
-- A previous cleanup migration used an unqualified DROP INDEX statement,
-- which can be a no-op when the session search_path does not include sync.
-- This corrective migration drops the exact schema-qualified index and then
-- fails loudly if any index with the same name still exists.
DROP INDEX IF EXISTS sync.idx_devices_workspace_user_web;

DO $$
DECLARE
  remaining_schema TEXT;
BEGIN
  SELECT schemaname
  INTO remaining_schema
  FROM pg_indexes
  WHERE indexname = 'idx_devices_workspace_user_web'
  LIMIT 1;

  IF remaining_schema IS NOT NULL THEN
    RAISE EXCEPTION
      'Index idx_devices_workspace_user_web still exists in schema % after corrective drop',
      remaining_schema;
  END IF;
END
$$;
