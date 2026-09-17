-- Schemas touched: support.
ALTER TABLE support.feedback_submissions ADD COLUMN country TEXT
  CHECK (country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN support.feedback_submissions.country IS
  'Connection country at the first accepted direct feedback submission, resolved from trusted '
  'API Gateway source IP. NULL means unknown or unavailable. Never event-time geography or '
  'updated on retry. No raw IP is persisted. Shares the feedback row account-deletion lifecycle.';
