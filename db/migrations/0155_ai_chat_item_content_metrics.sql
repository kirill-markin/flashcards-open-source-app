-- Migration status: Current / additive.
-- Introduces: ai.chat_items.role and ai.chat_items.content_char_count, two STORED generated columns
--   that let a report measure chat volume by role without reading ai.chat_items.payload, and the
--   reporting_readonly grant that makes them readable.
-- Current guidance: reading payload is the cost this migration exists to remove. That column held
--   about 763 MB of JSONB across roughly 17,000 rows when this was written, and its large values
--   live in TOAST, so pulling one key out of a row costs about what pulling the whole message costs.
--   A report that groups by role and sums characters therefore has to avoid the column entirely,
--   which is also why a counter that still sat inside the JSON would have bought nothing.
-- Current guidance: generated rather than written. GENERATED ALWAYS AS (...) STORED makes Postgres
--   compute both values on insert, recompute them on every update of payload, and fill every
--   existing row while this ALTER runs, so the columns cannot drift from the transcript and no
--   writer, trigger or backfill owns them. No backend change comes with this migration and none is
--   wanted: no statement anywhere that reads or writes ai.chat_items selects *, and every insert
--   names its columns, so a generated column is invisible to the application and no insert can
--   collide with one by writing it. That held across apps/backend/src/chat/store/repository.ts,
--   apps/backend/src/chat/runs/generatedImageAttemptRepository.ts and the Postgres integration
--   fixtures when this was written; the rule is the requirement, and the files are only where it
--   was checked.
-- Current guidance: one row is one message with one role, so the split between what a person wrote
--   and what the model produced is a grouping over rows and never two counters on one row.
-- Current guidance: content_char_count counts the text a person or the model actually wrote, and
--   nothing else. payload->'content' is an array of typed parts rather than a string - text, image,
--   file, card, tool_call and reasoning_summary, defined in apps/backend/src/chat/types.ts - so
--   length(payload->>'content') would have measured a serialized JSON array, brackets, keys,
--   escapes and the base64 bodies of attached images and files included, and would have returned 2
--   for a message whose content is empty. This column instead sums length() over the text of the
--   parts whose type is 'text'. Attachment base64, tool-call input and output, card fields and
--   reasoning summaries are deliberately not counted, so an assistant row counts its visible answer
--   and not the work behind it, and an image-heavy user message does not outweigh every real
--   question in the same period.
-- Current guidance: that sum needs an aggregate over the array, which a generation expression may
--   not contain, so it lives in the IMMUTABLE function below and the column calls it. Its
--   search_path is pinned to pg_catalog, because Postgres trusts the stored column as immutable and
--   recomputes the expression on restore, where the caller's search_path is not ours. EXECUTE on
--   that function stays at the PUBLIC default on purpose rather than being revoked and re-granted:
--   it is a pure counter over its own argument that reads nothing, and every role that writes a
--   chat item has to be able to evaluate it for the insert to succeed.
-- Current guidance: the grant below is required, not decorative.
--   db/migrations/0153_reporting_readonly_ai_chat_content.sql granted this table as an explicit
--   column list, so a column added after it is unreadable to reporting until its own migration
--   names it. That is the trap ai.chat_runs.client_platform fell into between
--   db/migrations/0136_ai_chat_run_client_platform.sql and 0153. The FOR SELECT policy 0153 created
--   for this role on this table already covers these columns and is not repeated here.
-- Current guidance: a stored generated column forces a table rewrite, so this ALTER takes ACCESS
--   EXCLUSIVE on ai.chat_items and blocks chat reads and writes while it copies those 763 MB. Both
--   columns are added in one statement so that rewrite happens once instead of twice. At this size
--   the rewrite fits the five-minute timeout of the migration Lambda in
--   infra/aws/lib/migration-runner.ts with room to spare, and the time it takes grows with the
--   table. Waiting for the lock is the part that has no bound of its own, so the SET LOCAL below
--   caps that wait at 30s and lets a blocked release fail and retry instead of holding every chat
--   statement behind it.
-- Current guidance: no index, on purpose. The report these columns serve reads whole periods rather
--   than single rows, so the planner would not choose an index on either one; adding one on a guess
--   would be write cost and rewrite time with no reader behind it.
-- Schemas touched/read explicitly: ai.
-- See also: db/migrations/0032_ai_chat_sessions.sql,
--   db/migrations/0153_reporting_readonly_ai_chat_content.sql,
--   db/migrations/0136_ai_chat_run_client_platform.sql, docs/analytics-db-access.md.

CREATE OR REPLACE FUNCTION ai.chat_item_content_char_count(item_payload JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(SUM(length(content_part->>'text')), 0)::INTEGER
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(item_payload->'content') = 'array' THEN item_payload->'content'
      ELSE '[]'::JSONB
    END
  ) AS content_part
  WHERE content_part->>'type' = 'text'
    AND jsonb_typeof(content_part->'text') = 'string';
$$;

COMMENT ON FUNCTION ai.chat_item_content_char_count(JSONB) IS
  'Characters of the written text inside a chat item payload: the sum of length() over the text of '
  'every content part whose type is ''text''. Attachment base64, tool-call input and output, card '
  'fields and reasoning summaries are not counted, and a payload with no text parts counts 0. It '
  'exists because ai.chat_items.content_char_count needs an aggregate over payload->''content'', '
  'which a generation expression cannot contain. Immutable in the strict sense: same payload, same '
  'number, forever. Changing what it counts changes values already stored in that column, so a '
  'different measure is a different column rather than a redefinition of this function.';

-- The ALTER below takes ACCESS EXCLUSIVE on ai.chat_items: it waits behind every transaction holding
-- a lock on chat_items while every new chat_items statement queues behind it, and the runner
-- (apps/backend/src/database/migrationRunner.ts) sets no lock_timeout, so the wait would otherwise be
-- unbounded. 30s caps only how long the ALTER waits for that lock before it starts; past it the
-- ALTER fails 55P03, the release fails, and a rerun retries the file. It does not cap how long chat
-- traffic queues: once the lock is acquired the rewrite holds it until this migration's
-- transaction commits.
SET LOCAL lock_timeout = '30s';
ALTER TABLE ai.chat_items
  ADD COLUMN IF NOT EXISTS role TEXT
    GENERATED ALWAYS AS (payload->>'role') STORED,
  ADD COLUMN IF NOT EXISTS content_char_count INTEGER
    GENERATED ALWAYS AS (ai.chat_item_content_char_count(payload)) STORED;

COMMENT ON COLUMN ai.chat_items.role IS
  'Author of this message, read out of payload->>''role'': ''user'' or ''assistant''. Generated and '
  'stored, so it follows payload and cannot drift from it. It exists so that a report can split '
  'what people wrote from what the model produced without reading the transcript itself.';

COMMENT ON COLUMN ai.chat_items.content_char_count IS
  'Characters of written text in this message, from ai.chat_item_content_char_count(payload). Text '
  'content parts only: attachment base64, tool-call input and output, card fields and reasoning '
  'summaries are not counted, so this is the visible message and not the work behind it, and 0 '
  'means a message that carried no text rather than a missing value. Generated and stored, so it '
  'follows payload. It is not the size of the payload and must not be read as one.';

GRANT SELECT (
  role,
  content_char_count
) ON TABLE ai.chat_items TO reporting_readonly;
