-- Migration status: Current / additive.
-- Introduces: analytics.product_events.os_name and device_type, the operating system family and the
--   device class a client reports in its batch context, and the same two columns on
--   analytics.installation_profiles together with device_model, which product_events already
--   stored per event. platform keeps naming the client build: the Apple client reports ios on an
--   iPhone, an iPad and a Mac alike, so these columns are what tell those devices apart, and an
--   Android tablet from an Android phone.
-- Current guidance: os_name is one of ios, ipados, macos, android, and device_type one of phone,
--   tablet, desktop, tv. apps/backend/src/productAnalytics/catalog.ts holds both lists; a value added
--   there needs a migration widening the matching constraint here before any client sends it. The
--   two columns are independent, so a row may carry either without the other. NULL means no value is
--   known for the row; the web client reports neither. Account anonymization keeps os_name and
--   device_type on product_events, as it keeps platform, because a device class identifies no one;
--   installation_profiles rows are deleted with the account.
-- Schemas touched/read explicitly: analytics, pg_catalog.
-- See also: db/migrations/0137_audience_context.sql,
-- db/migrations/0145_anonymous_client_automated_marker.sql,
-- apps/backend/src/productAnalytics/validation.ts, apps/backend/src/productAnalytics/writer.ts.

ALTER TABLE analytics.product_events
  ADD COLUMN os_name TEXT,
  ADD COLUMN device_type TEXT;

-- Added NOT VALID and never validated, for the reason 0143, 0144 and 0145 give: the migration runs in
-- one transaction, so validating would hold the ACCESS EXCLUSIVE lock of this ALTER TABLE across a
-- whole-table scan of the busiest append-only table, only to confirm what the columns added empty
-- just above cannot violate. NOT VALID still enforces both rules on every future insert and update.
ALTER TABLE analytics.product_events
  ADD CONSTRAINT product_events_os_name_valid CHECK (
    os_name IS NULL
    OR os_name IN ('ios', 'ipados', 'macos', 'android')
  ) NOT VALID,
  ADD CONSTRAINT product_events_device_type_valid CHECK (
    device_type IS NULL
    OR device_type IN ('phone', 'tablet', 'desktop', 'tv')
  ) NOT VALID;

COMMENT ON COLUMN analytics.product_events.os_name IS
  'Operating system family the client reported: ios, ipados, macos or android. Unlike platform, '
  'which names the client build, it separates an iPhone, an iPad and a Mac running the same Apple '
  'client. NULL means no value is known for the row; the web client reports none. Kept on account '
  'anonymization, as platform is.';

COMMENT ON COLUMN analytics.product_events.device_type IS
  'Device class the client reported: phone, tablet, desktop or tv. NULL means no value is known for '
  'the row; the web client reports none. Kept on account anonymization, as platform is.';

-- A small table, so the constraints are added validated.
ALTER TABLE analytics.installation_profiles
  ADD COLUMN os_name TEXT
    CONSTRAINT installation_profiles_os_name_valid CHECK (
      os_name IS NULL
      OR os_name IN ('ios', 'ipados', 'macos', 'android')
    ),
  ADD COLUMN device_type TEXT
    CONSTRAINT installation_profiles_device_type_valid CHECK (
      device_type IS NULL
      OR device_type IN ('phone', 'tablet', 'desktop', 'tv')
    ),
  ADD COLUMN device_model TEXT
    CONSTRAINT installation_profiles_device_model_length CHECK (
      pg_catalog.length(device_model) <= 200
    );

COMMENT ON COLUMN analytics.installation_profiles.os_name IS
  'Latest operating system family the installation reported, with the meaning of '
  'analytics.product_events.os_name.';

COMMENT ON COLUMN analytics.installation_profiles.device_type IS
  'Latest device class the installation reported, with the meaning of '
  'analytics.product_events.device_type.';

COMMENT ON COLUMN analytics.installation_profiles.device_model IS
  'Latest device model the installation reported, with the meaning of '
  'analytics.product_events.device_model.';

-- 0145's definition unchanged, with the new columns appended last so existing column positions,
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
  product_events.device_type
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
GRANT SELECT (os_name, device_type) ON TABLE analytics.product_events TO reporting_readonly;
GRANT SELECT (os_name, device_type, device_model) ON TABLE analytics.installation_profiles
  TO reporting_readonly;
GRANT SELECT ON analytics.product_events_resolved TO reporting_readonly;
