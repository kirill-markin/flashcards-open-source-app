-- Migration status: Current / additive.
-- Introduces: analytics.guest_browser_checks, one row per decision the guest browser check (the
--   Turnstile gate on web guest creation) makes while it is configured, kept indefinitely.
-- Current guidance: the backend writes the row; nothing here derives it. A request that is refused
--   (required, failed) is recorded on its own with no guest. A request that is let through (allowed,
--   passed, bypassed) is recorded in the transaction that creates the guest, with that guest's user
--   id, and an idempotent retry that resumes an already created guest records nothing new. While the
--   check is not configured nothing is recorded. Account deletion rewrites guest_user_id to the
--   deleted person's analytics pseudonym and clears the per-device columns, as it does for
--   analytics.product_events (apps/backend/src/auth/accountDeletion.ts).
-- Schemas touched/read explicitly: analytics.

CREATE TABLE analytics.guest_browser_checks (
  check_id UUID PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('allowed', 'required', 'passed', 'failed', 'bypassed')),
  flags TEXT[] NOT NULL,
  network_asn BIGINT,
  user_agent_chrome_major SMALLINT,
  client_hint_chromium_major SMALLINT,
  current_chromium_major SMALLINT,
  failure_reason TEXT,
  turnstile_error_codes TEXT[],
  guest_user_id UUID,
  CONSTRAINT guest_browser_checks_allowed_unflagged CHECK (
    outcome <> 'allowed' OR pg_catalog.cardinality(flags) = 0
  ),
  CONSTRAINT guest_browser_checks_failure_shape CHECK (
    (outcome = 'failed') = (failure_reason IS NOT NULL)
    AND (outcome = 'failed') = (turnstile_error_codes IS NOT NULL)
  ),
  CONSTRAINT guest_browser_checks_guest_shape CHECK (
    (outcome IN ('allowed', 'passed', 'bypassed')) = (guest_user_id IS NOT NULL)
  )
);

COMMENT ON TABLE analytics.guest_browser_checks IS
  'One row per decision of the guest browser check on web guest creation, written by the backend '
  'while the check is configured. Rows are never deleted.';

COMMENT ON COLUMN analytics.guest_browser_checks.outcome IS
  'allowed: no flag and no bypass token, so the guest was created without a check. required: flagged '
  'and no Turnstile token, so creation was refused and the browser was asked for the check. passed: '
  'flagged and Cloudflare verified the token. failed: a rejected token or an invalid bypass token. '
  'bypassed: a valid bypass token (release smoke), recorded whether or not the request was flagged.';

COMMENT ON COLUMN analytics.guest_browser_checks.flags IS
  'The server signals that flagged the request, as named in '
  'apps/backend/src/guestAuth/browser/challengeRisk.ts. Empty when nothing flagged it.';

COMMENT ON COLUMN analytics.guest_browser_checks.network_asn IS
  'Autonomous system number of the address the request arrived from; NULL when unknown. Cleared by '
  'account deletion.';

COMMENT ON COLUMN analytics.guest_browser_checks.user_agent_chrome_major IS
  'Chrome major version the User-Agent claims; NULL when it claims none. Cleared by account deletion.';

COMMENT ON COLUMN analytics.guest_browser_checks.client_hint_chromium_major IS
  'Chromium major version the Sec-CH-UA client hint claims; NULL when absent. Cleared by account '
  'deletion.';

COMMENT ON COLUMN analytics.guest_browser_checks.current_chromium_major IS
  'The current Chrome major the check compared the claim with, read from '
  'analytics.current_chromium_by_day; NULL when the User-Agent claims no Chrome.';

COMMENT ON COLUMN analytics.guest_browser_checks.failure_reason IS
  'Why a failed check failed; set exactly when outcome is failed.';

COMMENT ON COLUMN analytics.guest_browser_checks.turnstile_error_codes IS
  'Error codes Cloudflare returned for a failed check, empty when it returned none or the token was '
  'never sent to Cloudflare; set exactly when outcome is failed.';

COMMENT ON COLUMN analytics.guest_browser_checks.guest_user_id IS
  'User id of the guest the request created, the id that guest''s analytics events resolve to; set '
  'exactly when the outcome let the request through. Account deletion rewrites it to the deleted '
  'person''s analytics pseudonym.';

-- Serves counting the guests created without a check for one claimed Chrome major since a moment.
CREATE INDEX idx_guest_browser_checks_allowed_chrome_major
  ON analytics.guest_browser_checks (user_agent_chrome_major, checked_at)
  WHERE outcome = 'allowed';

CREATE INDEX idx_guest_browser_checks_guest_user_id
  ON analytics.guest_browser_checks (guest_user_id)
  WHERE guest_user_id IS NOT NULL;

ALTER TABLE analytics.guest_browser_checks ENABLE ROW LEVEL SECURITY;

-- UPDATE is column-scoped to what account deletion rewrites.
GRANT SELECT, INSERT ON TABLE analytics.guest_browser_checks TO backend_app;
GRANT UPDATE (
  guest_user_id, network_asn, user_agent_chrome_major, client_hint_chromium_major
) ON TABLE analytics.guest_browser_checks TO backend_app;

CREATE POLICY guest_browser_checks_backend ON analytics.guest_browser_checks
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

-- db/migrations/0114_product_analytics_storage.sql revoked default SELECT on tables in this schema
-- from reporting_readonly, so the columns are granted explicitly.
GRANT SELECT (
  check_id, checked_at, outcome, flags, network_asn, user_agent_chrome_major,
  client_hint_chromium_major, current_chromium_major, failure_reason, turnstile_error_codes,
  guest_user_id
) ON TABLE analytics.guest_browser_checks TO reporting_readonly;

CREATE POLICY guest_browser_checks_reporting_readonly ON analytics.guest_browser_checks
  FOR SELECT TO reporting_readonly USING (true);
