-- Migration status: Current / canonical.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0227_probable_scraper_fleet_page_read_is_passive.sql, with the same name, columns,
-- unique index, grants and readers.
-- Current guidance: 0227's rule, with its arms A to D, its one-page history test, its webdriver path
--   and its daily visitor hashes unchanged, plus a third way for an actor to qualify: an app guest
--   of the web, iOS or Android app with stored bot evidence on one of its own app events and a
--   whole history of events that fire without a person's deliberate action.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0226_probable_scraper_fleet_worldwide_rule.sql for the arms and their
-- evidence, db/migrations/0228_app_event_bot_evidence.sql for the app facts,
-- apps/backend/src/productAnalytics/catalog.ts for the events,
-- apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- The app path reads the facts 0228 stores on app events. The evidence is any one of these on a
-- guest_client row the app itself reported (origin 'client'):
-- - network_asn is one of the cloud or hosting networks of arm C, on any platform;
-- - on a web row, arm D's forged User-Agent: user_agent_chrome_major is set and
--   client_hint_chromium_major is absent or differs;
-- - on a web row, user_agent_chrome_major is 12 or more below arm C's reference for the row's UTC day.
-- The history test is an allow-list, like the one-page test: every event of the actor, at every
-- trust level, is one the product reports on its own, and none is reported with an account
-- credential:
-- - app_opened and screen_viewed, a launch and a screen impression;
-- - catalog_install_landed, a screen impression that only released clients still send;
-- - catalog_install_preview_ready and catalog_deck_installed, the facts of a deck import a catalog
--   link starts on its own, which is not activity;
-- - sync_failed and analytics_events_dropped, which the sync and analytics queues report on their
--   own timers;
-- - 0227's passive site events, with at most one site_page_viewed, as in the one-page test.
-- Every other event in the catalog keeps an actor unmarked, including those that may fire without
-- a deliberate act but follow one or cannot be told apart from one: a review, a card or deck change,
-- a sign-in step, a consent answer, a paywall, a purchase, a notification a person allowed, the web
-- app's store QR code a person revealed, a link a person clicked, and catalog_deck_install_started,
-- which the web app also sends when a person taps Install. An account credential is a sign-in
-- whether or not a sign-in event reached the actor, so a signed-in account is never marked here.
--
-- In the 7 days to 2026-10-20, 28 guest actors had a whole history of app_opened, screen_viewed
-- and catalog install facts, before any evidence was required, and on 2026-10-20 the API Gateway
-- access log named Reflectionbot as the User-Agent of 15 of the 16 deck installs, each a guest with
-- exactly that history. A bot that names itself so is already marked by automated_client and can
-- no longer create a browser guest; this path is for the bots that do not name themselves.
-- A real guest who only looks around is an accepted loss when they reach the app from a data-centre
-- network, a VPN that exits in one for example, through a web view whose Chrome claim carries no
-- matching hint, or on a mobile Chromium browser whose truthful engine trails Chrome by 12 majors,
-- Samsung Internet for example: arm C asks the version only of a desktop visit, but the web app
-- reports no device_type, so here every web row is asked. The refresh re-reads the whole history,
-- so the first review, card or sign-in clears the mark.
-- NULL is never evidence, so app rows stored before 0228 deployed and the rows of a deleted account
-- never mark an actor, and an iOS or Android row can meet only the network signal.
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
