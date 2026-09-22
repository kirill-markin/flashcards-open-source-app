-- Migration status: Current / additive.
-- Introduces: auth.guest_sessions.analytics_consent, the analytics consent decision of a person who
--   has no account, recorded beside the credential that identifies them. It is the guest half of
--   org.user_settings.analytics_consent (db/migrations/0142_analytics_consent_choice.sql): same
--   type, same two allowed values, same meaning for NULL, so one decision has one shape wherever
--   the person happens to be stored.
-- Current guidance: read on GET /v1/me and written on PATCH /v1/me/preferences
--   (apps/backend/src/routes/system/account/accountPreferences.ts) whenever the request presents a
--   guest credential, which is the same endpoint an account uses; the transport, not a second
--   route, decides which of the two columns the answer lands in. Nothing writes NULL back, so a
--   withdrawn consent is recorded as declined rather than as a return to unanswered, and upgrading
--   a guest into an account copies a recorded answer onto org.user_settings.analytics_consent
--   (apps/backend/src/guestAuth/upgrade/index.ts) unless that account already answered for itself.
-- Schemas touched/read explicitly: auth.
-- See also: db/migrations/0142_analytics_consent_choice.sql, docs/analytics-visitor-identity.md.

ALTER TABLE auth.guest_sessions
  ADD COLUMN analytics_consent TEXT
    CONSTRAINT guest_sessions_analytics_consent_choice CHECK (
      analytics_consent IS NULL OR analytics_consent IN ('granted', 'declined')
    );

COMMENT ON COLUMN auth.guest_sessions.analytics_consent IS
  'What a person with no account answered about whether the product may collect analytics about '
  'them. Three states: granted, declined, and NULL for no decision recorded on this guest session, '
  'which is also every guest session that existed before the column. NULL is collection allowed, '
  'exactly as it is on org.user_settings.analytics_consent, and by design: nothing prompts anyone, '
  'and the opt-out is offered only in the legal and privacy settings screen of the mobile apps. '
  'Withdrawing a consent is declined, '
  'not a return to NULL: nothing sets this column back to NULL, and PATCH /v1/me/preferences '
  '(apps/backend/src/routes/system/account/accountPreferences.ts) rejects an explicit null for the '
  'field instead of erasing a recorded answer. The answer belongs to one guest credential and to '
  'nothing wider: a client that mints a new guest session starts again at NULL, while an upgrade '
  'into a real account copies a recorded answer onto org.user_settings.analytics_consent unless '
  'that account already holds one of its own. A web guest session can never hold a value here: '
  'that credential is refused on every authenticated surface except analytics ingest '
  '(apps/backend/src/guestAuth/webPlatform.ts), and a signed-out browser keeps its own per-browser '
  'answer in a cookie instead; see docs/analytics-visitor-identity.md. Removed with the guest '
  'identity, because auth.guest_sessions.user_id cascades from org.user_settings.';

-- 0066 gave reporting_readonly a column list on this table rather than the whole row, so a new
-- column stays unreadable to that role until it is named. The admin audience number that counts
-- people who switched analytics off reads this column through exactly that role, and the grant
-- belongs to the change that adds the column rather than to a later one.
GRANT SELECT (analytics_consent) ON TABLE auth.guest_sessions TO reporting_readonly;
