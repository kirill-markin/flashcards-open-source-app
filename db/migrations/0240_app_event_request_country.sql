-- Migration status: Current / comment change.
-- Introduces: no schema change. It restates analytics.product_events.country, which the
--   authenticated ingest, POST /v1/analytics/events, now fills too: on every guest_client and
--   authenticated_client row of the web, iOS and Android apps it stores the country derived at
--   ingest from the address the request arrived from, the way the credential-free collector does
--   (0158_anonymous_event_country.sql). It also restates analytics.product_events.event_properties,
--   which now holds raw browser values on web app_opened and site_page_viewed that account deletion
--   removes from the rows of the account and its linked guests, while credential-free site rows keep
--   them, so 0114's "never contains free text, which is why it survives anonymization intact" no
--   longer holds.
-- Current guidance: the authenticated ingest derives the country once per batch, beside network_asn
--   (0228_app_event_bot_evidence.sql), and stamps it on every row of that batch
--   (apps/backend/src/routes/productAnalytics.ts). A queued event therefore carries the country of
--   the request that uploaded it, which can differ from where it happened; that is what the column
--   means on these rows, not an error in it. A failed lookup refuses the batch, so the client
--   retries it. A relayed request has no direct source address of its own and stores NULL. Nothing
--   is backfilled: every authenticated row stored before this migration holds NULL, because the
--   ingest never filled the column, and analytics.product_events is append-only. Account deletion
--   clears the column by user_id (apps/backend/src/auth/accountDeletion.ts), as it already did.
--   Installation country sampling is unchanged and stays in
--   analytics.installation_country_observations. The catalog that binds event_properties, and its
--   named exceptions, is apps/backend/src/productAnalytics/catalog.ts.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0114_product_analytics_storage.sql,
-- db/migrations/0158_anonymous_event_country.sql, db/migrations/0228_app_event_bot_evidence.sql,
-- apps/backend/src/routes/productAnalytics.ts, apps/backend/src/routes/anonymousAnalytics.ts,
-- apps/backend/src/productAnalytics/catalog.ts, docs/anonymous-client-analytics.md,
-- docs/geolite-country.md.

COMMENT ON COLUMN analytics.product_events.country IS
  'Two-letter country the backend derived at ingest from the address the client request arrived '
  'from, which can be a relay''s address rather than the person''s. Set on a credential-free '
  'collector row and, from migration 0240 on, on every guest_client and authenticated_client row of '
  'any platform, derived once per batch, so a queued event carries the country of the request that '
  'uploaded it. NULL for an identity-free event, the auth origin''s server-side sign-in funnel, a '
  'server-derived or backfilled row, a request with no direct source address of its own, an address '
  'the GeoLite database cannot place, a row whose account was deleted, and a row stored before its '
  'producer filled this column, which includes every authenticated row stored before migration '
  '0240; nothing is backfilled. The address itself is never stored, and no region or city is derived '
  'from it. Installation country samples belong to analytics.installation_country_observations. '
  'A credential-free row carries no account to delete, so nothing clears its country.';

COMMENT ON COLUMN analytics.product_events.event_properties IS
  'Per-event properties allowlisted by the catalog. Every value is an allowlisted enum member, a '
  'non-negative integer, or a string the catalog binds to a declared format, except for the '
  'exceptions the catalog names, which can carry text a person typed or a link carried, and raw '
  'browser values on web app_opened and site_page_viewed that describe one device closely. Account '
  'deletion removes those raw browser keys from the rows of the account and of the guests linked to '
  'it and keeps every other property; a credential-free row carries no account to delete, so it '
  'keeps them.';
