-- Migration status: Current / additive.
-- Introduces: ai.chat_runs.client_platform, the device platform named by the request that started a
--   chat run, kept on the run because the work the run does for the person continues after that
--   request has returned.
-- Schemas touched/read explicitly: ai.

ALTER TABLE ai.chat_runs
  ADD COLUMN IF NOT EXISTS client_platform TEXT CHECK (client_platform IN ('ios', 'android', 'web'));

COMMENT ON COLUMN ai.chat_runs.client_platform IS
  'Device platform the request that started this run named in its X-Client-Platform header. NULL '
  'means that request named no ios, android or web platform, which includes every run started '
  'before this column existed.';
