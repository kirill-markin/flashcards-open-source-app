-- Migration status: Current / additive.
-- Introduces: org.user_settings.analytics_consent, the analytics consent decision recorded on the
--   account rather than in a single browser.
-- Current guidance: the value is read on GET /v1/me and written on PATCH /v1/me/preferences
--   (apps/backend/src/routes/system/account/accountPreferences.ts), and nothing writes NULL back,
--   so withdrawing a consent is recorded as declined rather than as a return to unanswered.
-- Schemas touched/read explicitly: org.
-- See also: db/migrations/0056_review_reaction_animation_preference.sql,
--   docs/analytics-visitor-identity.md.

ALTER TABLE org.user_settings
  ADD COLUMN analytics_consent TEXT
    CONSTRAINT user_settings_analytics_consent_choice CHECK (
      analytics_consent IS NULL OR analytics_consent IN ('granted', 'declined')
    );

COMMENT ON COLUMN org.user_settings.analytics_consent IS
  'What this person answered about whether the product may collect analytics about them. Three '
  'states: granted, declined, and NULL for no decision recorded on this account, which is also '
  'every account that existed before the column. Withdrawing a consent is declined, not a return '
  'to NULL: nothing sets this column back to NULL, and PATCH /v1/me/preferences '
  '(apps/backend/src/routes/system/account/accountPreferences.ts) rejects an explicit null for the '
  'field instead of erasing a recorded answer. The decision is stored on the account rather than '
  'in one browser. For how analytics identity and consent prompting work outside this column, see '
  'docs/analytics-visitor-identity.md and apps/backend/src/analyticsVisitor/. Removed with the '
  'account, because account deletion deletes the org.user_settings row.';
