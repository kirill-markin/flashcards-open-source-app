-- Schemas touched/read explicitly: analytics, pg_catalog.
ALTER TABLE analytics.product_events ADD COLUMN ui_locale TEXT
  CONSTRAINT product_events_ui_locale_shape CHECK (
    ui_locale IS NULL OR (
      pg_catalog.length(ui_locale) BETWEEN 1 AND 64
      AND ui_locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
    )
  );

COMMENT ON COLUMN analytics.product_events.ui_locale IS
  'Actual UI language captured with the event before offline queuing. NULL means unknown; never '
  'infer it from device_locale, account settings, or later requests. Cleared on account deletion.';

COMMENT ON COLUMN analytics.product_events.country IS
  'Legacy event country, retained for compatibility and cleared on account deletion. Installation '
  'country samples belong to analytics.installation_country_observations; upload country must not '
  'be projected back onto queued events. No raw IP is stored.';

-- Append after actor_id so existing column positions, identity resolution, and view grants survive.
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
  product_events.ui_locale
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

GRANT SELECT (ui_locale) ON TABLE analytics.product_events TO reporting_readonly;
GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;

CREATE TABLE analytics.installation_profiles (
  anonymous_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  user_id UUID NOT NULL,
  app_version TEXT CHECK (app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,2}$'),
  os_version TEXT CHECK (pg_catalog.length(os_version) <= 200),
  device_locale TEXT CHECK (pg_catalog.length(device_locale) <= 200),
  timezone TEXT CHECK (pg_catalog.length(timezone) <= 200),
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  country_sampled_at TIMESTAMPTZ,
  first_country TEXT CHECK (first_country ~ '^[A-Z]{2}$'),
  first_country_sampled_at TIMESTAMPTZ,
  PRIMARY KEY (anonymous_id, platform),
  CHECK (first_seen <= last_seen),
  CHECK ((first_country IS NULL) = (first_country_sampled_at IS NULL)),
  CHECK (first_country_sampled_at IS NULL OR (
    country_sampled_at IS NOT NULL AND first_country_sampled_at <= country_sampled_at
  ))
);

CREATE INDEX idx_installation_profiles_user_id
  ON analytics.installation_profiles (user_id);

COMMENT ON TABLE analytics.installation_profiles IS
  'Current request-time metadata keyed by the authenticated batch anonymousId and header platform. '
  'The ID is an installation/browser analytics ID, not a sync installation or catalog journey ID. '
  'user_id is the latest observed authenticated or guest owner; previous ownership is retained by '
  'product event identities and identity_links. Delete associated profiles before anonymizing events. '
  'No metadata backfill. Missing context replaces prior values with NULL. Unchanged metadata writes '
  'last_seen at most once per hour; changes write immediately. last_seen is approximate request time, '
  'not event time. first_country is the first non-NULL GeoIP result and survives country-period retention.';

COMMENT ON COLUMN analytics.installation_profiles.country_sampled_at IS
  'Latest completed GeoIP sample, including a NULL result. The country writer must lock this profile '
  'FOR UPDATE and sample only when this timestamp is NULL or its UTC date precedes the current UTC '
  'date. Recheck after obtaining the lock; use the same server sample timestamp for the profile and '
  'observation. Metadata upserts never overwrite country fields. No timezone or UI locale inference.';

CREATE TABLE analytics.installation_country_observations (
  anonymous_id UUID NOT NULL,
  platform TEXT NOT NULL,
  country TEXT CHECK (country ~ '^[A-Z]{2}$'),
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  sampled_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source = 'geoip'),
  PRIMARY KEY (anonymous_id, platform, first_seen),
  FOREIGN KEY (anonymous_id, platform)
    REFERENCES analytics.installation_profiles (anonymous_id, platform) ON DELETE CASCADE,
  CHECK (first_seen <= last_seen AND last_seen <= sampled_at)
);

CREATE INDEX idx_installation_country_observations_last_seen
  ON analytics.installation_country_observations (last_seen);

COMMENT ON TABLE analytics.installation_country_observations IS
  'Sparse GeoIP observation periods, never event-time location. Under the profile row lock, read '
  'the latest period ORDER BY first_seen DESC LIMIT 1. Compare countries with IS NOT DISTINCT FROM '
  '(NULL is an unknown country, not a reason to keep an old known country). For an unchanged country '
  'update that period last_seen and sampled_at to the sample time; on change, insert a new period '
  'with first_seen = last_seen = sampled_at = sample time and source = geoip. Do not extend the '
  'previous period across the unobserved gap. In the same transaction advance profile.country_sampled_at '
  'and set first_country/first_country_sampled_at only for its first non-NULL result. '
  'Keep 90 days of periods by last_seen; first_country lives separately on the profile. These times '
  'are server sample times, not client event times. No raw IP, city, coordinates, or inferred location.';

ALTER TABLE analytics.installation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.installation_country_observations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  analytics.installation_profiles, analytics.installation_country_observations TO backend_app;

CREATE POLICY installation_profiles_backend ON analytics.installation_profiles
  FOR ALL TO backend_app USING (true) WITH CHECK (true);
CREATE POLICY installation_country_observations_backend ON analytics.installation_country_observations
  FOR ALL TO backend_app USING (true) WITH CHECK (true);

GRANT SELECT (
  anonymous_id, platform, user_id, app_version, os_version, device_locale, timezone,
  first_seen, last_seen, country_sampled_at, first_country, first_country_sampled_at
) ON TABLE analytics.installation_profiles TO reporting_readonly;
GRANT SELECT (
  anonymous_id, platform, country, first_seen, last_seen, sampled_at, source
) ON TABLE analytics.installation_country_observations TO reporting_readonly;

CREATE POLICY installation_profiles_reporting_readonly ON analytics.installation_profiles
  FOR SELECT TO reporting_readonly USING (true);
CREATE POLICY installation_country_observations_reporting_readonly ON analytics.installation_country_observations
  FOR SELECT TO reporting_readonly USING (true);
