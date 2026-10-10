-- Migration status: Current / additive.
-- Introduces: ai.chat_file_deletions, the keys of objects in the media assets bucket that no ai.chat_files
--   row names any more, and the two triggers that record them. A row releases its object when it is
--   deleted, whichever statement deletes it: a cascade from ai.chat_sessions such as account deletion, an
--   attachment taking its derived rows with it, or a direct delete. Row triggers fire for rows a foreign
--   key cascade deletes too, so these cover every DELETE, later ones included; TRUNCATE fires no row
--   trigger and records nothing. An UPDATE that replaces s3_key releases the old object the same way.
-- Current guidance: apps/backend/src/chatFiles/cleanup.ts deletes each recorded object from the bucket
--   and then its row here, so a row here means the object may still exist. A writer never stores an
--   object under a released key: the cleanup would delete it.
-- Current guidance: the trigger function is SECURITY DEFINER, so the insert runs as its owner, which owns
--   this table, whichever role's statement released the row and whatever that role's grants and row
--   level security say. backend_app therefore holds no INSERT or UPDATE here. It reads and deletes rows
--   through unscoped policies, because the cleanup runs outside any person's scope and a row carries
--   nothing but an object key. The shape follows
--   analytics.prevent_restored_excluded_actor_delete() in db/migrations/0140_analytics_excluded_actors.sql
--   and the revoked default privileges follow db/migrations/0152_ai_usage_facts.sql.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0173_ai_chat_files.sql, apps/backend/src/chatFiles/cleanup.ts.

-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on ai.chat_files, which waits behind every open transaction
-- that wrote a chat file and queues every new chat file write behind it, and the runner
-- (apps/backend/src/database/migrationRunner.ts) sets no lock_timeout. 30s caps that queue; past it the
-- migration fails 55P03, the release fails, and a rerun retries the file.
SET LOCAL lock_timeout = '30s';

CREATE TABLE ai.chat_file_deletions (
  s3_key     TEXT        PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No index beside the primary key: a row leaves once the cleanup deletes its object, so the oldest-first
-- read sorts only the keys the cleanup has not reached yet.

COMMENT ON TABLE ai.chat_file_deletions IS
  'Keys of objects in the media assets bucket that no ai.chat_files row names any more, recorded by '
  'triggers on ai.chat_files when a row is deleted or its s3_key is replaced. The cleanup deletes each '
  'object and then its row here, so a row means the object may still exist. A writer never stores an '
  'object under a released key, because the cleanup would delete it.';

COMMENT ON COLUMN ai.chat_file_deletions.s3_key IS
  'Key of the released object, as ai.chat_files.s3_key held it.';
COMMENT ON COLUMN ai.chat_file_deletions.deleted_at IS
  'When the key was released. The cleanup takes the oldest first.';

-- ON CONFLICT keeps a key released twice from failing the statement that released it, which may be an
-- account deletion.
CREATE FUNCTION ai.record_released_chat_file_object()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO ai.chat_file_deletions (s3_key)
  VALUES (OLD.s3_key)
  ON CONFLICT (s3_key) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER chat_files_record_deleted_object
  AFTER DELETE ON ai.chat_files
  FOR EACH ROW
  EXECUTE FUNCTION ai.record_released_chat_file_object();

CREATE TRIGGER chat_files_record_replaced_object
  AFTER UPDATE OF s3_key ON ai.chat_files
  FOR EACH ROW
  WHEN (OLD.s3_key IS DISTINCT FROM NEW.s3_key)
  EXECUTE FUNCTION ai.record_released_chat_file_object();

REVOKE ALL ON FUNCTION ai.record_released_chat_file_object()
FROM PUBLIC, backend_app, auth_app, reporting_readonly;

ALTER TABLE ai.chat_file_deletions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, DELETE ON TABLE ai.chat_file_deletions TO backend_app;

-- 0032's ALTER DEFAULT PRIVILEGES IN SCHEMA ai already handed backend_app all four privileges on this
-- table when it was created above, so only the triggers write rows once these two are taken back.
REVOKE INSERT, UPDATE ON TABLE ai.chat_file_deletions FROM backend_app;

CREATE POLICY chat_file_deletions_backend_select
  ON ai.chat_file_deletions
  FOR SELECT
  TO backend_app
  USING (true);

CREATE POLICY chat_file_deletions_backend_delete
  ON ai.chat_file_deletions
  FOR DELETE
  TO backend_app
  USING (true);
