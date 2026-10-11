-- Migration status: Current / one-time backfill.
-- Introduces: os_name and device_type on the analytics.product_events rows written before clients
--   reported them, wherever the row's own stored platform and device_model make the value certain,
--   plus the restated table comment that permits and records this completion, since 0123 is
--   immutable, and the two column comments 0175 wrote, which claimed every value was reported.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0175_analytics_os_name_device_type.sql,
-- db/migrations/0123_backfill_live_review_answered_platform.sql.
--
-- The Apple client reports platform ios on an iPhone, an iPad and a Mac alike, and before 0175 no
-- client reported os_name or device_type, so without this file every existing event is
-- unclassified. The Apple client's device_model is the hardware identifier, the simulated model on a
-- simulator and otherwise uname's machine (analyticsDeviceModelIdentifier in
-- apps/ios/Flashcards/Flashcards/Analytics/AnalyticsTransport.swift): iPhone* is an iPhone, iPad* an
-- iPad, and arm64 or Mac* a Mac, since no iPhone, iPad or simulator reports either.
-- An Android client runs Android whatever its form factor, so android rows gain os_name but never
-- device_type: nothing stored tells a tablet from a phone. Everything else - web rows, Apple rows
-- with no or another device_model - stays NULL. Every value written is in the CHECK lists 0175 added.
--
-- Only a NULL column is filled and a stored value is never overwritten, the second rewrite the
-- analytics.product_events table comment permits. Events from a client that predates 0175 still
-- arrive NULL after this file, which is accepted. analytics.installation_profiles is not touched
-- here: a later migration backfills it once the writer that keeps a stored os_name, device_type and
-- device_model is live, because the writer still serving while this file applies replaces them with
-- the NULL a client that predates 0175 sends.
--
-- statement_timeout and idle_in_transaction_session_timeout follow 0122 against the migration
-- Lambda's 300-second budget: each statement below is one pass over analytics.product_events, which
-- runs in seconds at its current size, so reaching the bound means the plan is wrong and the release
-- should fail with a 57014 naming the statement rather than a Lambda timeout naming nothing. SET
-- LOCAL keeps both from leaking into the files that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- 0123's comment, restated in full because COMMENT ON TABLE replaces it; only the sentence naming
-- the row itself as a stored record is new.
COMMENT ON TABLE analytics.product_events IS
  'Append-only product analytics events. Every column is written either by the client or by the server, never by both. '
  'No foreign keys are declared on purpose: they would add write contention on an insert-only table and block user deletion, '
  'and reporting joins work without them. '
  'Exactly two rewrites are permitted and no other writer may rewrite a row. The first is the account-deletion '
  'anonymization path, which sets identity_state to anonymized and clears the person-linked columns in place. The second is '
  'a migration completing a column that no writer has ever populated on that row, whatever wrote the row, where the value is '
  'derivable from a record the backend already stored: the column must still be NULL, and a stored non-null value is never '
  'overwritten. The record may be the row itself, as when os_name and device_type are derived from its own platform and '
  'device_model. Null to a derived value is permitted; a value to another value is not, however wrong the stored value is '
  'thought to be, because a wrong value is not an incomplete column. So a row may gain a fact it always should have carried '
  'and may never change one. The table is otherwise append-only.';

-- 0175's column comments, restated because they called every value client-reported.
COMMENT ON COLUMN analytics.product_events.os_name IS
  'Operating system family: ios, ipados, macos or android. Unlike platform, which names the client '
  'build, it separates an iPhone, an iPad and a Mac running the same Apple client. Reported by the '
  'client; on rows written before clients reported it, derived by 0177 from the row''s own platform '
  'and device_model. NULL means no value is known for the row; the web client reports none. Kept on '
  'account anonymization, as platform is.';

COMMENT ON COLUMN analytics.product_events.device_type IS
  'Device class: phone, tablet, desktop or tv. Reported by the client; on rows written before '
  'clients reported it, derived by 0177 from the row''s own platform and device_model. NULL means no '
  'value is known for the row; the web client reports none. Kept on account anonymization, as '
  'platform is.';

-- One statement per mapping rule. The rules are disjoint, so no row is visited twice. Each column is
-- filled only where it is NULL; COALESCE writes a stored value back unchanged.
UPDATE analytics.product_events AS product_events
SET
  os_name = COALESCE(product_events.os_name, 'ios'),
  device_type = COALESCE(product_events.device_type, 'phone')
WHERE product_events.platform = 'ios'
  AND product_events.device_model LIKE 'iPhone%'
  AND (product_events.os_name IS NULL OR product_events.device_type IS NULL);

UPDATE analytics.product_events AS product_events
SET
  os_name = COALESCE(product_events.os_name, 'ipados'),
  device_type = COALESCE(product_events.device_type, 'tablet')
WHERE product_events.platform = 'ios'
  AND product_events.device_model LIKE 'iPad%'
  AND (product_events.os_name IS NULL OR product_events.device_type IS NULL);

UPDATE analytics.product_events AS product_events
SET
  os_name = COALESCE(product_events.os_name, 'macos'),
  device_type = COALESCE(product_events.device_type, 'desktop')
WHERE product_events.platform = 'ios'
  AND (product_events.device_model = 'arm64' OR product_events.device_model LIKE 'Mac%')
  AND (product_events.os_name IS NULL OR product_events.device_type IS NULL);

UPDATE analytics.product_events AS product_events
SET os_name = 'android'
WHERE product_events.platform = 'android'
  AND product_events.os_name IS NULL;
