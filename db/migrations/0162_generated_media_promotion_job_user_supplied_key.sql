-- Migration status: Current / additive.
-- Introduces: content.generated_media_promotion_jobs.user_supplied_key, which records whether the card image
--   generation behind a job was paid with an OpenAI API key the person supplied instead of the platform key.
--   Every job already stored was paid with the platform key, and the DEFAULT states exactly that for them:
--   adding a column with a constant default is a catalog change and rewrites no row.
-- Current guidance: the daily and monthly platform generation limits in
--   apps/backend/src/chat/cardImages/generationBudget.ts count only jobs where this is false, and the own-key
--   monthly ceiling in the same file counts every job whoever paid for it.
-- Current guidance: backend_app holds column-level SELECT and INSERT on this table
--   (db/migrations/0089_generated_media_promotion_jobs.sql), so a column added later is unreadable and
--   unwritable for that role until it is named, which the GRANT below does. reporting_readonly holds no
--   privilege on this table and gains none here.
-- Current guidance: the payload immutability trigger from 0089 compares every column it does not list as
--   mutable, so this flag is fixed once the job is enqueued.
-- Schemas touched/read explicitly: content.
-- See also: db/migrations/0135_generated_media_promotion_job_created_at_select.sql,
--   db/migrations/0161_ai_usage_user_supplied_key.sql.

ALTER TABLE content.generated_media_promotion_jobs
  ADD COLUMN user_supplied_key BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN content.generated_media_promotion_jobs.user_supplied_key IS
  'True when the generation behind this job was paid with an API key the person supplied rather than the '
  'platform key. Such a job counts toward the own-key ceiling and never toward the platform limits.';

GRANT SELECT (user_supplied_key), INSERT (user_supplied_key)
  ON content.generated_media_promotion_jobs TO backend_app;
