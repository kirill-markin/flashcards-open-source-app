-- Migration status: Current / additive.
-- Introduces: org.user_settings.product_analytics_enabled and
--   auth.guest_sessions.product_analytics_enabled, the product-analytics off switch. It is one
--   decision with two homes, on the split db/migrations/0147_guest_session_analytics_consent.sql
--   already uses: a person with an account keeps the answer on the account, a person with none
--   keeps it beside the guest credential that identifies them, and the transport of the request
--   picks the column rather than a second route.
-- Current guidance: NULL means nobody has answered on this row, and NULL reads as ON. Only an
--   explicit FALSE is an opt-out. TRUE is an answer too - the one a person gives by switching
--   collection back on after refusing it - and it is stored rather than collapsed back to NULL, so
--   "never answered" and "answered yes" stay distinguishable. Every row that existed before this
--   migration is NULL and therefore ON, which is the intended reading and not a backfill left
--   undone: the basis for product analytics here is legitimate interest rather than consent, so the
--   switch is offered and never demanded, and nothing prompts anyone for it.
-- Current guidance: this is deliberately not analytics_consent, and no code may derive either
--   column from the other. analytics_consent (db/migrations/0142_analytics_consent_choice.sql and
--   0147) is the answer to a different question: whether this browser may carry the shared
--   analytics_visitor identifier that the cookie banner asks about. Refusing that cookie is not
--   refusing analytics - the shipped banner copy said so, telling people their events are still
--   counted without an identifier - so every person already holding analytics_consent = 'declined'
--   keeps product analytics ON and must be left holding NULL here until they answer this question
--   for themselves. Reusing analytics_consent, or backfilling this column from it, would silently
--   turn a cookie refusal into an analytics opt-out nobody asked for.
-- Current guidance: the switch covers client-reported product analytics and nothing else. Error and
--   crash reporting (Sentry) is outside it, and so are the server-derived facts in
--   apps/backend/src/productAnalytics/serverFacts/, which record the service working rather than a
--   person browsing. Turning it off stops future collection only: analytics.product_events is
--   append-only, this writes no tombstone and deletes nothing, and account deletion remains the
--   erasure path.
-- Current guidance: read on GET /v1/me and written on PATCH /v1/me/preferences
--   (apps/backend/src/routes/system/account/accountPreferences.ts), the same endpoint pair
--   analytics_consent uses. An explicit null in the request body is refused rather than erasing a
--   recorded answer. Enforcement is at ingest: POST /v1/analytics/events
--   (apps/backend/src/routes/productAnalytics.ts) drops every client-reported event of a credential
--   whose owner holds FALSE, before the events, the identity link and the installation profile are
--   written, and answers 200 with the accepted count so a client released before this switch
--   existed retires its queue instead of redelivering a batch that will never be stored. The
--   credential-free collector POST /v1/analytics/anonymous-events cannot enforce it, because that
--   request carries no identity to look an answer up by; a signed-out browser's own switch has to
--   stop the send on the client.
-- Current guidance: upgrading a guest into an account copies a recorded answer onto
--   org.user_settings.product_analytics_enabled (apps/backend/src/guestAuth/upgrade/index.ts)
--   unless that account already answered for itself, exactly as 0147 does for analytics_consent.
--   Without that copy an opt-out would revert to ON at sign-in, because NULL reads as ON.
-- Current guidance: no grant statement accompanies either column. backend_app holds table-level
--   privileges that cover a new column on sight - db/migrations/0024_auth_runtime_roles.sql granted
--   it every table in schema org, and db/migrations/0031_guest_ai_identity_and_quota.sql granted it
--   auth.guest_sessions as a whole - and reporting_readonly holds a table-level SELECT on
--   org.user_settings from db/migrations/0044_reporting_readonly_role.sql, so the account column is
--   already readable to reporting. The guest column is not:
--   db/migrations/0066_reporting_readonly_operational_analytics.sql gave that role a column list on
--   auth.guest_sessions rather than the whole row, which is why 0147 had to name
--   analytics_consent there. No report reads this switch today, so nothing is named here; the first
--   report that counts guest opt-outs adds GRANT SELECT (product_analytics_enabled) ON TABLE
--   auth.guest_sessions TO reporting_readonly in its own migration.
-- Schemas touched/read explicitly: auth, org.
-- See also: db/migrations/0142_analytics_consent_choice.sql,
--   db/migrations/0147_guest_session_analytics_consent.sql, docs/analytics-visitor-identity.md,
--   docs/anonymous-client-analytics.md.

ALTER TABLE org.user_settings
  ADD COLUMN product_analytics_enabled BOOLEAN;

COMMENT ON COLUMN org.user_settings.product_analytics_enabled IS
  'Whether this account allows the product to collect client-reported product analytics about the '
  'person who owns it. Three states: FALSE is an explicit opt-out, TRUE is an explicit opt-in, and '
  'NULL is no answer recorded on this account, which is also every account that existed before the '
  'column. NULL reads as allowed, by design: the basis is legitimate interest rather than consent, '
  'so this is a switch a person seeks out and turns off, never a question anyone is asked. This '
  'is not org.user_settings.analytics_consent and is never derived from it: that column answers '
  'whether this browser may carry the shared analytics_visitor identifier the cookie banner asks '
  'about, and a person who refused that cookie was told their events are still counted without an '
  'identifier, so a cookie refusal leaves product analytics on and this column NULL. FALSE stops '
  'future collection only. It deletes nothing: analytics.product_events is append-only and account '
  'deletion stays the erasure path. It does not cover error and crash reporting, nor the '
  'server-derived facts that record the service working rather than a person browsing. Read on '
  'GET /v1/me, written on PATCH /v1/me/preferences '
  '(apps/backend/src/routes/system/account/accountPreferences.ts), and enforced at ingest by '
  'POST /v1/analytics/events (apps/backend/src/routes/productAnalytics.ts), which drops a batch '
  'from an opted-out credential and still answers 200. Removed with the account, because account '
  'deletion deletes the org.user_settings row.';

ALTER TABLE auth.guest_sessions
  ADD COLUMN product_analytics_enabled BOOLEAN;

COMMENT ON COLUMN auth.guest_sessions.product_analytics_enabled IS
  'The same product-analytics off switch as org.user_settings.product_analytics_enabled, for a '
  'person who has no account: same type, same meaning for FALSE, TRUE and NULL, so one decision has '
  'one shape wherever the person happens to be stored. The answer belongs to one guest credential '
  'and to nothing wider: a client that mints a new guest session starts again at NULL, and NULL '
  'reads as allowed. Upgrading a guest into a real account copies a recorded answer onto '
  'org.user_settings.product_analytics_enabled unless that account already holds one of its own, '
  'which is what stops an opt-out reverting to allowed at sign-in. A web guest session can never '
  'hold a value here: that credential is refused on every authenticated surface except analytics '
  'ingest (apps/backend/src/guestAuth/webPlatform.ts), so it never reaches '
  'PATCH /v1/me/preferences, and a signed-out browser keeps its own answer in that browser instead; '
  'see docs/analytics-visitor-identity.md. Ingest still reads this column on such a credential, so '
  'a value stored by any later route would be enforced rather than ignored. Removed with the guest '
  'identity, because auth.guest_sessions.user_id cascades from org.user_settings.';
