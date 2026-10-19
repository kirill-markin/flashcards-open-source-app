-- Migration status: Current / additive.
-- Introduces: three nullable facts on analytics.product_events that the credential-free collector
--   derives at ingest, on the same rows and under the same gating as its stored country
--   (0158_anonymous_event_country.sql): network_asn, the autonomous system number the GeoLite ASN
--   database assigns to the address the request arrived from; user_agent_chrome_major, the Chrome
--   major version the request's User-Agent claims; and client_hint_chromium_major, the Chromium
--   major version its Sec-CH-UA client hint reports. They are facts, not verdicts: a reader that
--   classifies traffic by them owns that rule.
-- Current guidance: none of the three is set on an identityFree event, on the auth origin's
--   server-side sign-in funnel, or on any trust level other than anonymous_client. network_asn is
--   also NULL for a request with no direct source address of its own and for an address the
--   database cannot place, and a lookup that fails outright refuses the event, exactly as a country
--   lookup does. Each major is NULL when its header is absent or does not carry a parseable
--   version. Neither the address nor the User-Agent is stored. Nothing is backfilled, so NULL also
--   means a row stored before its producer filled the column. Account deletion never reaches these
--   columns: it rewrites rows by user_id, which product_events_anonymous_client_shape forbids on a
--   credential-free row.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0158_anonymous_event_country.sql,
-- db/migrations/0175_analytics_os_name_device_type.sql, apps/backend/src/routes/anonymousAnalytics.ts,
-- apps/backend/src/geolocation/asn.ts, apps/backend/src/productAnalytics/browserVersion.ts,
-- docs/anonymous-client-analytics.md, docs/geolite-country.md.

-- bigint because an autonomous system number is an unsigned 32-bit value (RFC 6793) and integer is
-- signed.
ALTER TABLE analytics.product_events
  ADD COLUMN network_asn BIGINT,
  ADD COLUMN user_agent_chrome_major SMALLINT,
  ADD COLUMN client_hint_chromium_major SMALLINT;

-- Added NOT VALID and never validated, for the reason 0143 and 0144 give: scripts/deploy/migrate.sh
-- applies each migration with --single-transaction, so validating would hold the busiest
-- append-only table against every read and every analytics insert for a whole-table scan that
-- could only confirm what the empty new columns cannot violate.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_network_and_browser_facts_shape CHECK (
    (network_asn IS NULL AND user_agent_chrome_major IS NULL AND client_hint_chromium_major IS NULL)
    OR (
      trust_level = 'anonymous_client'
      AND (network_asn IS NULL OR network_asn BETWEEN 1 AND 4294967295)
      AND (user_agent_chrome_major IS NULL OR user_agent_chrome_major BETWEEN 1 AND 999)
      AND (client_hint_chromium_major IS NULL OR client_hint_chromium_major BETWEEN 1 AND 999)
    )
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.network_asn IS
  'Autonomous system number of the network the credential-free collector request arrived from, '
  'derived at ingest from the GeoLite ASN database; the address itself is never stored. Set only on '
  'an anonymous_client row that may carry a country, and NULL for an identity-free event, the auth '
  'origin''s server-side sign-in funnel, a request with no direct source address of its own, an '
  'address the database cannot place, and a row stored before the collector filled this column.';

COMMENT ON COLUMN analytics.product_events.user_agent_chrome_major IS
  'Chrome major version the credential-free collector request''s User-Agent claims (Chrome/<major>); '
  'the User-Agent itself is never stored. Set only on an anonymous_client row that may carry a '
  'country, and NULL when the User-Agent claims no Chrome version, for an identity-free event, the '
  'auth origin''s server-side sign-in funnel, and a row stored before the collector filled this column.';

COMMENT ON COLUMN analytics.product_events.client_hint_chromium_major IS
  'Chromium major version the credential-free collector request''s Sec-CH-UA client hint reports '
  '("Chromium";v="<major>"). Set only on an anonymous_client row that may carry a country, and NULL '
  'when the header is absent or has no Chromium brand, for an identity-free event, the auth '
  'origin''s server-side sign-in funnel, and a row stored before the collector filled this column.';

-- 0175's definition unchanged, with the new columns appended last so existing column positions,
-- identity resolution, view grants and the views that read this one survive.
CREATE OR REPLACE VIEW analytics.product_events_resolved AS
SELECT
  product_events.event_id,
  product_events.schema_version,
  product_events.event_name,
  product_events.origin,
  product_events.backfill_id,
  product_events.client_occurred_at,
  product_events.client_sent_at,
  product_events.server_received_at,
  product_events.occurred_at,
  product_events.ingested_at,
  product_events.user_id,
  product_events.subject_user_id,
  product_events.auth_transport,
  product_events.trust_level,
  product_events.identity_state,
  product_events.guest_session_id,
  product_events.workspace_id,
  product_events.anonymous_id,
  product_events.session_id,
  product_events.platform,
  product_events.app_version,
  product_events.os_version,
  product_events.device_model,
  product_events.device_locale,
  product_events.timezone,
  product_events.country,
  product_events.network_state,
  product_events.screen,
  product_events.event_properties,
  product_events.experiment_assignments,
  product_events.request_id,
  COALESCE(
    first_guest_upgrade_link.user_id,
    product_events.user_id,
    first_anonymous_link.user_id,
    product_events.anonymous_id
  ) AS actor_id,
  product_events.ui_locale,
  product_events.daily_visitor_hash,
  product_events.automated_client,
  product_events.os_name,
  product_events.device_type,
  product_events.network_asn,
  product_events.user_agent_chrome_major,
  product_events.client_hint_chromium_major
FROM analytics.product_events AS product_events
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'authenticated_client'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_anonymous_link
  ON first_anonymous_link.anonymous_id = product_events.anonymous_id
LEFT JOIN (
  SELECT DISTINCT ON (identity_links.anonymous_id)
    identity_links.anonymous_id,
    identity_links.user_id
  FROM analytics.identity_links AS identity_links
  WHERE identity_links.source = 'server_derived'
  ORDER BY identity_links.anonymous_id, identity_links.linked_at, identity_links.link_id
) AS first_guest_upgrade_link
  ON first_guest_upgrade_link.anonymous_id = product_events.subject_user_id;

-- 0114 revoked default reporting access in this schema, so the new columns are granted explicitly.
GRANT SELECT (network_asn, user_agent_chrome_major, client_hint_chromium_major)
  ON TABLE analytics.product_events TO reporting_readonly;
GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;
