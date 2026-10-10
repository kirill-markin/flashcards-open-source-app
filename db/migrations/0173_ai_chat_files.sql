-- Migration status: Current / additive.
-- Introduces: ai.chat_files, the files of one chat session: what a person attached to a turn, the text
--   derived from those attachments, and the files the model writes for itself. The bytes live in the
--   media assets bucket under s3_key; a row is what the backend needs to find, name and describe them.
-- Current guidance: the model reaches every file by its virtual path, unique within the session.
--   Attachments and the text derived from them sit under /files/ and are read-only to the model; the
--   model's own scratch files sit under /work/. A new session starts with no files.
-- Current guidance: user_id and workspace_id repeat the owning session's values so that row level
--   security scopes a row without a join, in the shape db/migrations/0032_ai_chat_sessions.sql gives
--   ai.chat_sessions. Deleting the session deletes its rows. No database action deletes the object a
--   row's s3_key names; that is the application's job.
-- Current guidance: reporting_readonly gets the columns that describe a file without naming it - its
--   origin, media type, size and creation time - and not path, which carries the name the person gave
--   the file. The column-list grant follows db/migrations/0152_ai_usage_facts.sql, because
--   db/migrations/0066_reporting_readonly_operational_analytics.sql revoked that role's default access to
--   new ai tables.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0032_ai_chat_sessions.sql, db/migrations/0152_ai_usage_facts.sql,
--   db/migrations/0153_reporting_readonly_ai_chat_content.sql, apps/backend/src/chatFiles/.

-- The foreign key to ai.chat_sessions takes SHARE ROW EXCLUSIVE on that table, which waits behind every
-- open transaction that wrote a session and queues every new session write behind it, and the runner
-- (apps/backend/src/database/migrationRunner.ts) sets no lock_timeout. 30s caps that queue; past it the
-- CREATE fails 55P03, the release fails, and a rerun retries the file.
SET LOCAL lock_timeout = '30s';

CREATE TABLE ai.chat_files (
  file_id                 UUID        PRIMARY KEY,
  session_id              UUID        NOT NULL REFERENCES ai.chat_sessions(session_id) ON DELETE CASCADE,
  user_id                 TEXT        NOT NULL,
  workspace_id            UUID        NOT NULL,
  path                    TEXT        NOT NULL,
  origin                  TEXT        NOT NULL,
  source_file_id          UUID        NULL REFERENCES ai.chat_files(file_id) ON DELETE CASCADE,
  media_type              TEXT        NOT NULL,
  size_bytes              BIGINT      NOT NULL,
  sha256                  TEXT        NOT NULL,
  s3_key                  TEXT        NOT NULL,
  derivatives_prepared_at TIMESTAMPTZ NULL,
  derivatives_error       TEXT        NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Its index also serves every lookup by session_id alone, so that column needs no index of its own.
  CONSTRAINT chat_files_session_path_unique UNIQUE (session_id, path),
  CONSTRAINT chat_files_s3_key_unique UNIQUE (s3_key),
  CONSTRAINT chat_files_origin_valid CHECK (origin IN ('attachment', 'derived', 'work')),
  CONSTRAINT chat_files_source_matches_origin CHECK ((origin = 'derived') = (source_file_id IS NOT NULL)),
  CONSTRAINT chat_files_path_matches_origin CHECK (
    CASE origin
      WHEN 'work' THEN path LIKE '/work/_%'
      ELSE path LIKE '/files/_%'
    END
  ),
  CONSTRAINT chat_files_size_bytes_non_negative CHECK (size_bytes >= 0),
  CONSTRAINT chat_files_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

-- What deleting an attachment reads to cascade to the rows derived from it.
CREATE INDEX idx_ai_chat_files_source_file
  ON ai.chat_files(source_file_id)
  WHERE source_file_id IS NOT NULL;

COMMENT ON TABLE ai.chat_files IS
  'Files of one chat session. The bytes live in the media assets bucket under s3_key; a row is what the '
  'backend needs to find, name and describe them. Every file belongs to exactly one session and its row '
  'is deleted with that session. No database action deletes the object s3_key names; that is the '
  'application''s job.';

COMMENT ON COLUMN ai.chat_files.file_id IS
  'Writer-generated id, so that the object can be stored before its row is inserted.';
COMMENT ON COLUMN ai.chat_files.session_id IS
  'Chat session the file belongs to. Deleting the session deletes the row.';
COMMENT ON COLUMN ai.chat_files.user_id IS
  'Owner of the session, repeated from ai.chat_sessions so that row level security scopes the row '
  'without a join.';
COMMENT ON COLUMN ai.chat_files.workspace_id IS
  'Workspace of the session, repeated from ai.chat_sessions for the same reason as user_id.';
COMMENT ON COLUMN ai.chat_files.path IS
  'Virtual path the model reaches the file by, unique within the session: /files/<name> for attachments '
  'and the text derived from them, /work/<name> for files the model writes.';
COMMENT ON COLUMN ai.chat_files.origin IS
  'attachment: a file the person attached to a chat turn. derived: text extracted from the attachment '
  'source_file_id names. work: a file the model wrote under /work/.';
COMMENT ON COLUMN ai.chat_files.source_file_id IS
  'Attachment a derived row was extracted from, and NULL for every other origin. Deleting the attachment '
  'deletes the rows derived from it.';
COMMENT ON COLUMN ai.chat_files.media_type IS
  'Media type of the stored bytes, canonicalized by the writer.';
COMMENT ON COLUMN ai.chat_files.size_bytes IS
  'Size of the stored bytes.';
COMMENT ON COLUMN ai.chat_files.sha256 IS
  'Lowercase hex SHA-256 of the stored bytes.';
COMMENT ON COLUMN ai.chat_files.s3_key IS
  'Key of the object in the media assets bucket that holds the bytes. Unique, so an object belongs to one '
  'row.';
COMMENT ON COLUMN ai.chat_files.derivatives_prepared_at IS
  'When preparing the derived rows of this file finished, or NULL while it has not.';
COMMENT ON COLUMN ai.chat_files.derivatives_error IS
  'Why preparing the derived rows of this file failed, or NULL while it has not failed.';

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_files TO backend_app;

ALTER TABLE ai.chat_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_files_scoped_select_runtime
  ON ai.chat_files
  FOR SELECT
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

-- Inserts and updates also require the row to repeat its session's owner and workspace, which is what
-- lets every policy trust user_id and workspace_id without reading the session.
CREATE POLICY chat_files_scoped_insert_runtime
  ON ai.chat_files
  FOR INSERT
  TO backend_app
  WITH CHECK (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_files.session_id
        AND chat_sessions.user_id = chat_files.user_id
        AND chat_sessions.workspace_id = chat_files.workspace_id
    )
  );

CREATE POLICY chat_files_scoped_update_runtime
  ON ai.chat_files
  FOR UPDATE
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  )
  WITH CHECK (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = chat_files.session_id
        AND chat_sessions.user_id = chat_files.user_id
        AND chat_sessions.workspace_id = chat_files.workspace_id
    )
  );

CREATE POLICY chat_files_scoped_delete_runtime
  ON ai.chat_files
  FOR DELETE
  TO backend_app
  USING (
    user_id = security.current_user_id()
    AND security.current_workspace_access_allowed(workspace_id)
  );

GRANT SELECT (
  file_id,
  session_id,
  workspace_id,
  origin,
  media_type,
  size_bytes,
  created_at
) ON TABLE ai.chat_files TO reporting_readonly;

CREATE POLICY chat_files_reporting_readonly_select
  ON ai.chat_files
  FOR SELECT
  TO reporting_readonly
  USING (true);
