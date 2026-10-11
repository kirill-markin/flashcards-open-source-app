-- Migration status: Current / one-time backfill.
-- Introduces: os_name, device_type and device_model on the analytics.installation_profiles rows
--   written before clients reported them, wherever the installation's own stored events and device
--   model make the value certain, plus the restated table comment, since 0137 is immutable and said no metadata is
--   backfilled, and the three column comments 0175 wrote, which claimed every value was reported.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0177_backfill_analytics_os_name_device_type.sql,
-- db/migrations/0175_analytics_os_name_device_type.sql, db/migrations/0137_audience_context.sql,
-- apps/backend/src/productAnalytics/writer.ts.
--
-- An Android client runs Android whatever its form factor, so every android profile gains os_name
-- but never device_type here. Everything else starts from the installation's latest client event
-- that carried a device_model: the same (anonymous_id, platform) pair, newest server_received_at,
-- event_id breaking a tie. That event's device_model fills an ios or android profile's NULL
-- device_model. On ios, os_name and device_type are then read from one model only, the profile's
-- device_model after that fill: they come from that event when its device_model is that model, so
-- a value a client reported is kept, and otherwise, or where the event holds NULL, are derived from
-- that model by 0177's mapping: iPhone* is ios on a phone, iPad* ipados on a tablet, and arm64 or
-- Mac* macos on a desktop. The mapping is needed because 0177 filled only the events stored before
-- it ran, and every event stored after it from a client that reports neither value holds NULL. An
-- ios profile whose model matches none of the three patterns, and whose event holds no value, gains
-- device_model alone, since nothing stored makes its os_name or device_type certain. Web profiles,
-- and profiles whose events never carried a device_model, stay NULL.
-- Anonymization clears anonymous_id and device_model on its events, so an anonymized event never
-- matches a profile. Every value written passes the CHECKs 0175 added: os_name and device_type come
-- from product_events, which holds the same lists, or from the mapping, whose values are in them,
-- and device_model is validated to 200 characters at ingest, the profile's own limit.
--
-- Only a NULL column is filled and a stored value is never overwritten. The profile writer
-- (upsertInstallationProfileSql) keeps these three when a client omits them, so a client that
-- predates 0175 cannot erase what this file writes. An upsert committed while this file runs is
-- re-read by the UPDATE, whose COALESCE then keeps the reported value.
--
-- statement_timeout and idle_in_transaction_session_timeout follow 0122 against the migration
-- Lambda's 300-second budget: the second UPDATE is one pass over analytics.product_events, which
-- runs in seconds at its current size, so reaching the bound means the plan is wrong and the release
-- should fail with a 57014 naming the statement rather than a Lambda timeout naming nothing. SET
-- LOCAL keeps both from leaking into the files that share this client.
SET LOCAL statement_timeout = '240s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- 0137's comment, restated in full because COMMENT ON TABLE replaces it; only the two sentences on
-- missing context and backfill change.
COMMENT ON TABLE analytics.installation_profiles IS
  'Current request-time metadata keyed by the authenticated batch anonymousId and header platform. '
  'The ID is an installation/browser analytics ID, not a sync installation or catalog journey ID. '
  'user_id is the latest observed authenticated or guest owner; previous ownership is retained by '
  'product event identities and identity_links. Delete associated profiles before anonymizing events. '
  'Missing context replaces prior values with NULL, except os_name, device_type and device_model, which '
  'keep the last reported value. The only metadata backfill is 0178, which filled those three where the '
  'installation''s own client events and device model make them certain. Unchanged metadata writes '
  'last_seen at most once per hour; changes write immediately. last_seen is approximate request time, '
  'not event time. first_country is the first non-NULL GeoIP result and survives country-period retention.';

-- 0175's column comments, restated because they called every value reported.
COMMENT ON COLUMN analytics.installation_profiles.os_name IS
  'Latest operating system family the installation reported, with the meaning of '
  'analytics.product_events.os_name; a report without one keeps the stored value. On profiles '
  'written before clients reported it, filled by 0178: android for every android profile; on ios, '
  'from the installation''s latest client event that carried a device_model when that model is the '
  'device_model this row held after 0178, otherwise derived from that device_model as 0177 derives '
  'it for events (iPhone* ios, iPad* ipados, arm64 or Mac* macos), and left NULL when neither '
  'gives a value.';

COMMENT ON COLUMN analytics.installation_profiles.device_type IS
  'Latest device class the installation reported, with the meaning of '
  'analytics.product_events.device_type; a report without one keeps the stored value. On ios '
  'profiles written before clients reported it, filled by 0178 from the installation''s latest '
  'client event that carried a device_model when that model is the device_model this row held after '
  '0178, otherwise derived from that device_model as 0177 derives it for events (iPhone* phone, '
  'iPad* tablet, arm64 or Mac* desktop), and left NULL when neither gives a value. Never filled on '
  'android profiles.';

COMMENT ON COLUMN analytics.installation_profiles.device_model IS
  'Latest device model the installation reported, with the meaning of '
  'analytics.product_events.device_model; a report without one keeps the stored value. On ios and '
  'android profiles written before clients reported it, filled by 0178 from the installation''s '
  'latest client event that carried one. On ios profiles, the value this row held after 0178 is the '
  'only model 0178 read os_name and device_type from.';

UPDATE analytics.installation_profiles AS installation_profiles
SET os_name = 'android'
WHERE installation_profiles.platform = 'android'
  AND installation_profiles.os_name IS NULL;

-- Each column is filled only where it is NULL; COALESCE writes a stored value back unchanged, and
-- the CASE keeps android device_type out of reach. On ios, os_name and device_type read one model,
-- COALESCE(installation_profiles.device_model, latest_events.device_model), the value device_model
-- holds after this statement: the event's own value counts only when the event carries that model,
-- and 0177's mapping on that model fills what remains.
UPDATE analytics.installation_profiles AS installation_profiles
SET
  device_model = COALESCE(installation_profiles.device_model, latest_events.device_model),
  os_name = CASE
    WHEN installation_profiles.platform = 'ios' THEN COALESCE(
      installation_profiles.os_name,
      CASE
        WHEN installation_profiles.device_model IS NULL
          OR installation_profiles.device_model = latest_events.device_model
          THEN latest_events.os_name
      END,
      CASE
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'iPhone%'
          THEN 'ios'
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'iPad%'
          THEN 'ipados'
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) = 'arm64'
          OR COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'Mac%'
          THEN 'macos'
      END
    )
    ELSE installation_profiles.os_name
  END,
  device_type = CASE
    WHEN installation_profiles.platform = 'ios' THEN COALESCE(
      installation_profiles.device_type,
      CASE
        WHEN installation_profiles.device_model IS NULL
          OR installation_profiles.device_model = latest_events.device_model
          THEN latest_events.device_type
      END,
      CASE
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'iPhone%'
          THEN 'phone'
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'iPad%'
          THEN 'tablet'
        WHEN COALESCE(installation_profiles.device_model, latest_events.device_model) = 'arm64'
          OR COALESCE(installation_profiles.device_model, latest_events.device_model) LIKE 'Mac%'
          THEN 'desktop'
      END
    )
    ELSE installation_profiles.device_type
  END
FROM (
  SELECT DISTINCT ON (product_events.anonymous_id, product_events.platform)
    product_events.anonymous_id,
    product_events.platform,
    product_events.device_model,
    product_events.os_name,
    product_events.device_type
  FROM analytics.product_events AS product_events
  WHERE product_events.origin = 'client'
    AND product_events.platform IN ('ios', 'android')
    AND product_events.anonymous_id IS NOT NULL
    AND product_events.device_model IS NOT NULL
  ORDER BY
    product_events.anonymous_id,
    product_events.platform,
    product_events.server_received_at DESC,
    product_events.event_id DESC
) AS latest_events
WHERE latest_events.anonymous_id = installation_profiles.anonymous_id
  AND latest_events.platform = installation_profiles.platform
  AND (
    installation_profiles.device_model IS NULL
    OR (
      installation_profiles.platform = 'ios'
      AND (installation_profiles.os_name IS NULL OR installation_profiles.device_type IS NULL)
    )
  );
