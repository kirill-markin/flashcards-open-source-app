-- Migration status: Current / canonical.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0230_probable_scraper_fleet_app_visitors.sql, with the same name, columns,
-- unique index, grants and readers.
-- Current guidance: 0230's rule unchanged, except that the app-guest history allow-list also admits
--   a card_created row whose source is 'app'. Every new web guest seeds the onboarding demo card on
--   the client (docs/demo-card.md), and its sync makes the server report exactly that row, so on
--   its own it is no deliberate act. A person who writes a card also sends card_create_started, and
--   the AI chat sends ai_message_sent, neither of which is allowed; a card_created of any other
--   source, or of none, still keeps an actor unmarked.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0230_probable_scraper_fleet_app_visitors.sql for the app path and its
-- evidence, docs/demo-card.md, apps/backend/src/productAnalytics/catalog.ts for the events,
-- apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- From 2026-10-21 to 2026-10-28, 14 web guests had stored bot evidence and 7 of them were marked;
-- the other 7, whose evidence was networks 396982, 15169 and 45102 and Chrome claims without a
-- matching hint, escaped only through one card_created with source 'app', and 6 of them still
-- reached admin charts.
--
-- Refreshed as 0223 says, so the next refresh re-marks history under this rule. Nothing is deleted.
DROP MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors;

CREATE MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors AS
WITH site_page_views AS MATERIALIZED (
  SELECT
    page_view.actor_id,
    page_view.anonymous_id,
    page_view.daily_visitor_hash,
    page_view.server_received_at,
    page_view.country,
    page_view.device_locale,
    page_view.network_asn,
    page_view.user_agent_chrome_major,
    page_view.client_hint_chromium_major,
    page_view.event_properties ->> 'device_category' AS device_category,
    page_view.event_properties ->> 'source' AS source,
    page_view.event_properties ->> 'referrer_host' AS referrer_host,
    page_view.event_properties ->> 'page_kind' AS page_kind,
    page_view.event_properties ->> 'automation' AS automation
  FROM analytics.product_events_resolved AS page_view
  WHERE page_view.event_name = 'site_page_viewed'
    AND page_view.trust_level = 'anonymous_client'
    AND (
      page_view.actor_id IS NOT NULL
      OR (page_view.anonymous_id IS NULL AND page_view.daily_visitor_hash IS NOT NULL)
    )
),
app_guest_events AS MATERIALIZED (
  SELECT
    app_event.actor_id,
    app_event.server_received_at,
    app_event.platform,
    app_event.network_asn,
    app_event.user_agent_chrome_major,
    app_event.client_hint_chromium_major
  FROM analytics.product_events_resolved AS app_event
  WHERE app_event.origin = 'client'
    AND app_event.trust_level = 'guest_client'
    AND (app_event.network_asn IS NOT NULL OR app_event.user_agent_chrome_major IS NOT NULL)
),
cloud_networks (network_asn) AS (
  VALUES
    (16509::bigint), (14618), -- Amazon AWS
    (15169), (396982), -- Google, Google Cloud
    (8075), -- Microsoft
    (45102), (37963), -- Alibaba Cloud
    (132203), (45090), -- Tencent Cloud
    (136907), (55990), -- Huawei Cloud
    (31898), -- Oracle Cloud
    (14061), -- DigitalOcean
    (16276), -- OVH
    (24940), -- Hetzner
    (63949), -- Linode / Akamai
    (20473) -- Vultr
),
chromium_daily_common AS MATERIALIZED (
  SELECT DISTINCT ON (daily_major.received_on)
    daily_major.received_on,
    daily_major.chromium_major
  FROM (
    SELECT
      (hinted.server_received_at AT TIME ZONE 'UTC')::date AS received_on,
      hinted.client_hint_chromium_major AS chromium_major,
      count(*) AS row_count
    FROM analytics.product_events AS hinted
    WHERE hinted.client_hint_chromium_major = hinted.user_agent_chrome_major
      AND hinted.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND (
        hinted.network_asn IS NULL
        OR hinted.network_asn NOT IN (SELECT cloud.network_asn FROM cloud_networks AS cloud)
      )
    GROUP BY 1, 2
  ) AS daily_major
  ORDER BY daily_major.received_on, daily_major.row_count DESC, daily_major.chromium_major DESC
),
current_chromium_by_day AS MATERIALIZED (
  SELECT visit_day.received_on, max(daily.chromium_major) AS chromium_major
  FROM (
    SELECT (page_view.server_received_at AT TIME ZONE 'UTC')::date AS received_on
    FROM site_page_views AS page_view
    WHERE page_view.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
    UNION
    SELECT (app_event.server_received_at AT TIME ZONE 'UTC')::date AS received_on
    FROM app_guest_events AS app_event
    WHERE app_event.platform = 'web'
      AND app_event.user_agent_chrome_major IS NOT NULL
  ) AS visit_day
  LEFT JOIN chromium_daily_common AS daily
    ON daily.received_on >= visit_day.received_on - 30
    AND daily.received_on < visit_day.received_on
  GROUP BY visit_day.received_on
),
fleet_page_views AS MATERIALIZED (
  SELECT page_view.actor_id, page_view.anonymous_id, page_view.daily_visitor_hash
  FROM site_page_views AS page_view
  LEFT JOIN current_chromium_by_day AS current_chromium
    ON current_chromium.received_on = (page_view.server_received_at AT TIME ZONE 'UTC')::date
  WHERE (
      -- Arms A and B.
      page_view.server_received_at < TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND page_view.device_category = 'desktop'
      AND page_view.source = 'direct'
      AND page_view.referrer_host IS NULL
      AND (
        page_view.page_kind IN ('blog_article', 'catalog_package', 'catalog_other')
        OR page_view.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
      )
    )
    OR (
      -- Arm C.
      page_view.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND page_view.device_category = 'desktop'
      AND page_view.source = 'direct'
      AND page_view.referrer_host IS NULL
      AND (
        page_view.network_asn IN (SELECT cloud.network_asn FROM cloud_networks AS cloud)
        OR page_view.user_agent_chrome_major <= current_chromium.chromium_major - 12
        OR (
          split_part(page_view.device_locale, '-', 1) = 'zh'
          AND (page_view.country IS NULL OR page_view.country NOT IN ('CN', 'TW', 'HK', 'MO'))
        )
      )
    )
    OR (
      -- Arm D.
      page_view.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND page_view.user_agent_chrome_major IS NOT NULL
      AND (
        page_view.client_hint_chromium_major IS NULL
        OR page_view.client_hint_chromium_major <> page_view.user_agent_chrome_major
      )
    )
),
fleet_app_guests AS MATERIALIZED (
  SELECT DISTINCT app_event.actor_id
  FROM app_guest_events AS app_event
  LEFT JOIN current_chromium_by_day AS current_chromium
    ON current_chromium.received_on = (app_event.server_received_at AT TIME ZONE 'UTC')::date
  WHERE app_event.network_asn IN (SELECT cloud.network_asn FROM cloud_networks AS cloud)
    OR (
      app_event.platform = 'web'
      AND app_event.user_agent_chrome_major IS NOT NULL
      AND (
        app_event.client_hint_chromium_major IS NULL
        OR app_event.client_hint_chromium_major <> app_event.user_agent_chrome_major
        OR app_event.user_agent_chrome_major <= current_chromium.chromium_major - 12
      )
    )
),
fleet_actors AS (
  SELECT history.actor_id
  FROM analytics.product_events_resolved AS history
  WHERE history.actor_id IN (
    SELECT fleet_page_views.actor_id
    FROM fleet_page_views
    WHERE fleet_page_views.actor_id IS NOT NULL
  )
  GROUP BY history.actor_id
  HAVING count(*) FILTER (WHERE history.event_name = 'site_page_viewed') = 1
    AND bool_and(history.event_name IN (
      'site_page_viewed', 'site_page_engaged', 'site_locale_suggestion_shown', 'site_app_entry_shown',
      'site_store_qr_shown'
    ))
  UNION
  SELECT page_view.actor_id
  FROM site_page_views AS page_view
  WHERE page_view.automation = 'webdriver'
    AND page_view.actor_id IS NOT NULL
  UNION
  SELECT history.actor_id
  FROM analytics.product_events_resolved AS history
  WHERE history.actor_id IN (SELECT fleet_app_guests.actor_id FROM fleet_app_guests)
  GROUP BY history.actor_id
  HAVING count(*) FILTER (WHERE history.event_name = 'site_page_viewed') <= 1
    AND bool_and(history.trust_level <> 'authenticated_client')
    AND bool_and(history.event_name IN (
      'app_opened', 'screen_viewed', 'catalog_install_landed', 'catalog_install_preview_ready',
      'catalog_deck_installed', 'sync_failed', 'analytics_events_dropped',
      'site_page_viewed', 'site_page_engaged', 'site_locale_suggestion_shown', 'site_app_entry_shown',
      'site_store_qr_shown'
    ) OR (
      history.event_name = 'card_created'
      -- Not "=": bool_and skips NULL, so a row without a source would otherwise pass.
      AND history.event_properties ->> 'source' IS NOT DISTINCT FROM 'app'
    ))
),
fleet_daily_visitor_hashes AS (
  SELECT hashed.daily_visitor_hash
  FROM analytics.product_events AS hashed
  WHERE hashed.trust_level = 'anonymous_client'
    AND hashed.anonymous_id IS NULL
    AND hashed.daily_visitor_hash IN (
      SELECT fleet_page_views.daily_visitor_hash
      FROM fleet_page_views
      WHERE fleet_page_views.anonymous_id IS NULL
        AND fleet_page_views.daily_visitor_hash IS NOT NULL
    )
  GROUP BY hashed.daily_visitor_hash
  HAVING count(*) FILTER (WHERE hashed.event_name = 'site_page_viewed') = 1
    AND bool_and(hashed.event_name IN (
      'site_page_viewed', 'site_page_engaged', 'site_locale_suggestion_shown', 'site_app_entry_shown',
      'site_store_qr_shown'
    ))
  UNION
  SELECT page_view.daily_visitor_hash
  FROM site_page_views AS page_view
  WHERE page_view.automation = 'webdriver'
    AND page_view.anonymous_id IS NULL
    AND page_view.daily_visitor_hash IS NOT NULL
)
SELECT 'actor'::text AS subject_kind, fleet_actors.actor_id::text AS subject_id
FROM fleet_actors
WHERE NOT EXISTS (
  SELECT 1
  FROM analytics.excluded_actors AS restored
  WHERE restored.actor_id = fleet_actors.actor_id::text
    AND restored.restored_at IS NOT NULL
)
UNION ALL
SELECT 'daily_visitor_hash'::text AS subject_kind, fleet_hashes.daily_visitor_hash AS subject_id
FROM fleet_daily_visitor_hashes AS fleet_hashes;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY, which keeps reports readable during a refresh.
CREATE UNIQUE INDEX probable_scraper_fleet_visitors_subject
  ON analytics.probable_scraper_fleet_visitors (subject_kind, subject_id);

GRANT SELECT ON analytics.probable_scraper_fleet_visitors TO reporting_readonly;
GRANT MAINTAIN ON analytics.probable_scraper_fleet_visitors TO backend_app;
