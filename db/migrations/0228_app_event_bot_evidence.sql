-- Migration status: Current / constraint and comment change.
-- Introduces: no column. The four request facts the credential-free collector stores -
--   automated_client (0145_anonymous_client_automated_marker.sql) and network_asn,
--   user_agent_chrome_major and client_hint_chromium_major
--   (0224_anonymous_event_network_and_browser_facts.sql) - may now also be stored by the
--   authenticated ingest, POST /v1/analytics/events, on the guest_client and authenticated_client
--   rows of the web, iOS and Android apps. This file widens the two constraints that kept them on
--   anonymous_client rows and restates the four column comments.
-- Current guidance: the authenticated ingest derives the facts once per batch from the request that
--   carried it and stamps them on every row of that batch
--   (apps/backend/src/routes/productAnalytics.ts). network_asn and both majors are derived for every
--   platform; a native app sends no Chrome version, so its majors parse to NULL. automated_client is
--   assessed only on platform = 'web' rows and stays NULL on iOS and Android rows, because the
--   marker list (apps/backend/src/productAnalytics/automatedClient.ts) matches okhttp, the HTTP
--   library the Android app itself sends, and would mark every Android user. A failed ASN lookup
--   refuses the batch, as it refuses a collector event, so the client retries it. country stays
--   NULL on these rows. Nothing is backfilled: a row stored before its ingest filled a column keeps
--   NULL there for good, because analytics.product_events is append-only. Account deletion now
--   reaches rows that carry these facts, and its rewrite (apps/backend/src/auth/accountDeletion.ts)
--   clears network_asn and both majors, which joined with time could re-link the anonymized history
--   to the person's visitor rows, and keeps automated_client, so a deleted bot stays excluded. The
--   constraints keep 0224's value ranges and still forbid every fact
--   on server_derived and backfill_derived rows.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0145_anonymous_client_automated_marker.sql,
-- db/migrations/0224_anonymous_event_network_and_browser_facts.sql,
-- apps/backend/src/routes/productAnalytics.ts, apps/backend/src/routes/anonymousAnalytics.ts,
-- docs/anonymous-client-analytics.md, docs/analytics-audience.md.

-- Re-added NOT VALID and never validated, for the reason 0143 and 0144 give: scripts/deploy/migrate.sh
-- applies each migration with --single-transaction, so validating would hold the busiest
-- append-only table against every read and every analytics insert for a whole-table scan that could
-- only confirm what the narrower rules being replaced already enforced on every stored row.
ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_automated_client_shape;

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_automated_client_shape CHECK (
    automated_client IS NULL
    OR (
      origin = 'client'
      AND trust_level IN ('anonymous_client', 'guest_client', 'authenticated_client')
    )
  ) NOT VALID;

ALTER TABLE analytics.product_events
  DROP CONSTRAINT product_events_network_and_browser_facts_shape;

ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_network_and_browser_facts_shape CHECK (
    (network_asn IS NULL AND user_agent_chrome_major IS NULL AND client_hint_chromium_major IS NULL)
    OR (
      origin = 'client'
      AND trust_level IN ('anonymous_client', 'guest_client', 'authenticated_client')
      AND (network_asn IS NULL OR network_asn BETWEEN 1 AND 4294967295)
      AND (user_agent_chrome_major IS NULL OR user_agent_chrome_major BETWEEN 1 AND 999)
      AND (client_hint_chromium_major IS NULL OR client_hint_chromium_major BETWEEN 1 AND 999)
    )
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.automated_client IS
  'Whether the request that reported the event came from an automated client - a bot, crawler, '
  'headless browser or HTTP library - judged at ingest from its User-Agent alone, with a missing or '
  'empty User-Agent counted as automated. Any other User-Agent is matched against one fixed marker '
  'list only after the known colliding vendor tokens - device and product names that carry a marker '
  'inside them - have been cut out of it; apps/backend/src/productAnalytics/automatedClient.ts holds '
  'both lists. TRUE is such a match, FALSE is no such match. Assessed on every credential-free '
  'collector row and on every web app row of the authenticated ingest. NULL means the row was not '
  'assessed: an iOS or Android app row, because the marker list matches the Android app''s own HTTP '
  'library; an app row with no platform; a server-derived or backfilled row; and a row stored before '
  'its ingest assessed it. A report excluding automated traffic excludes TRUE and must not read NULL '
  'as a person, nor write FALSE for a person. FALSE is an unverified self-claim, not proof of one: '
  'an automated client can send an ordinary browser User-Agent. No User-Agent is stored in this table '
  'or any other analytics table; the API Gateway access log keeps the request header for one week '
  'outside the analytics store.';

COMMENT ON COLUMN analytics.product_events.network_asn IS
  'Autonomous system number of the network the client request arrived from, derived at ingest from '
  'the GeoLite ASN database; the address itself is never stored. Set on an anonymous_client row that '
  'may carry a country and on every guest_client and authenticated_client row of any platform. NULL '
  'for an identity-free event, the auth origin''s server-side sign-in funnel, a server-derived or '
  'backfilled row, a request with no direct source address of its own, an address the database '
  'cannot place, a row whose account was deleted, and a row stored before its ingest filled this '
  'column.';

COMMENT ON COLUMN analytics.product_events.user_agent_chrome_major IS
  'Chrome major version the client request''s User-Agent claims (Chrome/<major>); the User-Agent '
  'itself is never stored. Derived for the same rows as network_asn. NULL when the User-Agent claims '
  'no Chrome version, which includes every iOS and Android app request, and for an identity-free '
  'event, the auth origin''s server-side sign-in funnel, a server-derived or backfilled row, a row '
  'whose account was deleted, and a row stored before its ingest filled this column.';

COMMENT ON COLUMN analytics.product_events.client_hint_chromium_major IS
  'Chromium major version the client request''s Sec-CH-UA client hint reports ("Chromium";v="<major>"). '
  'Derived for the same rows as network_asn. NULL when the header is absent or has no Chromium '
  'brand, which includes every iOS and Android app request, and for an identity-free event, the auth '
  'origin''s server-side sign-in funnel, a server-derived or backfilled row, a row whose account was '
  'deleted, and a row stored before its ingest filled this column.';
