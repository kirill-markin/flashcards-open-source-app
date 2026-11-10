-- Migration status: Current / additive.
-- Introduces: analytics.guest_browser_checks.user_agent_browser and user_agent_browser_major, the
--   browser family and major version the User-Agent claims, and an index for counting decisions per
--   browser version since a moment.
-- Replaces or corrects: nothing in db/migrations/0242_guest_browser_checks.sql; its columns, grants
--   and readers are unchanged.
-- Current guidance: the backend parses both columns from the User-Agent on every row it writes
--   (apps/backend/src/productAnalytics/browserVersion.ts). Rows written before that backend was
--   deployed keep both columns NULL, with no backfill: the raw User-Agent was never stored, and
--   account deletion during the rollout would not clear a major copied from user_agent_chrome_major.
--   Account deletion clears user_agent_browser_major and keeps the family.
-- Schemas touched/read explicitly: analytics.

ALTER TABLE analytics.guest_browser_checks
  ADD COLUMN user_agent_browser TEXT,
  ADD COLUMN user_agent_browser_major SMALLINT,
  ADD CONSTRAINT guest_browser_checks_user_agent_browser_shape CHECK (
    (user_agent_browser IS NULL OR user_agent_browser IN ('chrome', 'firefox', 'safari', 'other'))
    AND (user_agent_browser IS NOT NULL OR user_agent_browser_major IS NULL)
  );

COMMENT ON COLUMN analytics.guest_browser_checks.user_agent_browser IS
  'Browser family the User-Agent claims: chrome (including Edge, Opera and other Chromium browsers), '
  'firefox, safari, or other when it claims none of them. Filled by the backend on every row it '
  'writes; NULL on rows written before that backend was deployed (no backfill). Kept by account '
  'deletion.';

COMMENT ON COLUMN analytics.guest_browser_checks.user_agent_browser_major IS
  'Major version of user_agent_browser the User-Agent claims; NULL when it claims none, the family '
  'is other, or user_agent_browser is NULL. Cleared by account deletion.';

-- Serves counting the decisions for one claimed browser version since a moment; a bypassed row is a
-- release smoke, never counted.
CREATE INDEX idx_guest_browser_checks_browser_recent
  ON analytics.guest_browser_checks (user_agent_browser, user_agent_browser_major, checked_at)
  WHERE outcome <> 'bypassed';

-- backend_app holds table-level SELECT and INSERT from 0242; UPDATE is column-scoped to what account
-- deletion rewrites.
GRANT UPDATE (user_agent_browser_major) ON TABLE analytics.guest_browser_checks TO backend_app;

GRANT SELECT (user_agent_browser, user_agent_browser_major)
  ON TABLE analytics.guest_browser_checks TO reporting_readonly;
