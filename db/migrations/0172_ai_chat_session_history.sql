-- Migration status: Current / additive.
-- Introduces: ai.chat_sessions.title and ai.chat_sessions.archived_at, the user-owned chat history
--   state of a session.
-- Schemas touched/read explicitly: ai.

-- The ALTER below takes ACCESS EXCLUSIVE on ai.chat_sessions: it waits behind every transaction holding
-- a lock on chat_sessions while every new chat_sessions statement queues behind it, and the runner
-- (apps/backend/src/database/migrationRunner.ts) sets no lock_timeout, so the wait would otherwise be
-- unbounded. 30s caps how long chat traffic can queue; past it the ALTER fails 55P03, the release
-- fails, and a rerun retries the file. Both columns are nullable without a default, so once the lock
-- is acquired the ALTER changes only the catalog and rewrites no rows.
SET LOCAL lock_timeout = '30s';
ALTER TABLE ai.chat_sessions
  ADD COLUMN title VARCHAR(200) NULL,
  ADD COLUMN archived_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN ai.chat_sessions.title IS
  'Title the user gave this chat. NULL means the user has not named it.';

COMMENT ON COLUMN ai.chat_sessions.archived_at IS
  'When the user archived this chat. NULL means it is not archived.';
