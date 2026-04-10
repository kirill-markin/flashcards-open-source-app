-- Optional UI locale for backend-owned AI chat composer suggestions.
-- Older clients do not send this yet, so NULL intentionally preserves the
-- legacy English fallback until every supported client migrates.

ALTER TABLE ai.chat_runs
  ADD COLUMN IF NOT EXISTS ui_locale TEXT;
