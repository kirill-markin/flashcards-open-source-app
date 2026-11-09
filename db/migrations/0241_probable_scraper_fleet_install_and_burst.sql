-- Migration status: Current / canonical.
-- Introduces: analytics.current_chromium_by_day, one row per UTC day from 2026-10-19 through the
--   refresh day with the current Chrome major of that day, the reference that arm C and the app path
--   of the scraper fleet compare a Chrome claim with, so the guest browser session check can read the
--   same fact.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0239_probable_scraper_fleet_app_chrome_lag.sql, with the same name, columns,
-- unique index, grants and readers.
-- Current guidance: 0239's rule unchanged, except that:
--   - the reference comes from analytics.current_chromium_by_day instead of the view's own query;
--   - the app-guest history allow-list also admits catalog_deck_install_started. 0230 left it out
--     because the web app also sends it when a person taps Install; a person who goes on to review,
--     edit or sign in still stays unmarked, and a person with bot evidence who only taps Install is
--     an accepted loss;
--   - a burst marks app guests without any other evidence: a web guest whose first web app event
--     claims a Chrome major below that UTC day's reference with a matching client hint, when at least
--     10 such new guests with a passing history share that day and major. The history test is the
--     same allow-list as the app path's.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0230_probable_scraper_fleet_app_visitors.sql for the app path and its
-- evidence, db/migrations/0226_probable_scraper_fleet_worldwide_rule.sql for arm C and its
-- reference, apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- On 2026-11-09, one Chrome 151 guest of the burst 0239 describes escaped it only through a
-- catalog_deck_install_started. From 2026-10-21 to 2026-11-09, the only UTC day and Chrome major
-- below the reference with 3 or more passive new web guests was 2026-11-09 and 151: 63 guests, and
-- not one web person who reviewed or signed in.
--
-- The reference is the highest of the daily most common Chrome majors with a matching client hint
-- over the 30 days before the day, cloud networks excluded; the first day has none, and NULL never
-- marks anyone. Refreshed by the same job, before analytics.probable_scraper_fleet_visitors.
CREATE MATERIALIZED VIEW analytics.current_chromium_by_day AS
WITH cloud_networks (network_asn) AS (
  -- The cloud_networks of analytics.probable_scraper_fleet_visitors below; keep both lists equal.
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
)
SELECT calendar_day.received_on, max(daily.chromium_major) AS chromium_major
FROM (
  SELECT DATE '2026-10-19' + day_offset AS received_on
  FROM generate_series(0, (now() AT TIME ZONE 'UTC')::date - DATE '2026-10-19') AS day_offset
) AS calendar_day
LEFT JOIN chromium_daily_common AS daily
  ON daily.received_on >= calendar_day.received_on - 30
  AND daily.received_on < calendar_day.received_on
GROUP BY calendar_day.received_on;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY, which keeps readers working during a refresh.
CREATE UNIQUE INDEX current_chromium_by_day_received_on
  ON analytics.current_chromium_by_day (received_on);

GRANT SELECT ON analytics.current_chromium_by_day TO reporting_readonly;
GRANT SELECT ON analytics.current_chromium_by_day TO backend_app;
GRANT MAINTAIN ON analytics.current_chromium_by_day TO backend_app;

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
fleet_page_views AS MATERIALIZED (
  SELECT page_view.actor_id, page_view.anonymous_id, page_view.daily_visitor_hash
  FROM site_page_views AS page_view
  LEFT JOIN analytics.current_chromium_by_day AS current_chromium
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
  LEFT JOIN analytics.current_chromium_by_day AS current_chromium
    ON current_chromium.received_on = (app_event.server_received_at AT TIME ZONE 'UTC')::date
  WHERE app_event.network_asn IN (SELECT cloud.network_asn FROM cloud_networks AS cloud)
    OR (
      app_event.platform = 'web'
      AND app_event.user_agent_chrome_major IS NOT NULL
      AND (
        app_event.client_hint_chromium_major IS NULL
        OR app_event.client_hint_chromium_major <> app_event.user_agent_chrome_major
        OR app_event.user_agent_chrome_major <= current_chromium.chromium_major - 4
      )
    )
),
outdated_new_web_guests AS MATERIALIZED (
  SELECT first_event.actor_id, first_event.received_on, first_event.user_agent_chrome_major
  FROM (
    SELECT DISTINCT ON (app_event.actor_id)
      app_event.actor_id,
      (app_event.server_received_at AT TIME ZONE 'UTC')::date AS received_on,
      app_event.user_agent_chrome_major,
      app_event.client_hint_chromium_major
    FROM analytics.product_events_resolved AS app_event
    WHERE app_event.origin = 'client'
      AND app_event.trust_level = 'guest_client'
      AND app_event.platform = 'web'
    ORDER BY app_event.actor_id, app_event.server_received_at
  ) AS first_event
  JOIN analytics.current_chromium_by_day AS current_chromium
    ON current_chromium.received_on = first_event.received_on
  WHERE first_event.client_hint_chromium_major = first_event.user_agent_chrome_major
    AND first_event.user_agent_chrome_major < current_chromium.chromium_major
),
passive_app_guests AS MATERIALIZED (
  SELECT history.actor_id
  FROM analytics.product_events_resolved AS history
  WHERE history.actor_id IN (
    SELECT fleet_app_guests.actor_id FROM fleet_app_guests
    UNION
    SELECT outdated_new_web_guests.actor_id FROM outdated_new_web_guests
  )
  GROUP BY history.actor_id
  HAVING count(*) FILTER (WHERE history.event_name = 'site_page_viewed') <= 1
    AND bool_and(history.trust_level <> 'authenticated_client')
    AND bool_and(history.event_name IN (
      'app_opened', 'screen_viewed', 'catalog_install_landed', 'catalog_install_preview_ready',
      'catalog_deck_install_started', 'catalog_deck_installed', 'sync_failed', 'analytics_events_dropped',
      'site_page_viewed', 'site_page_engaged', 'site_locale_suggestion_shown', 'site_app_entry_shown',
      'site_store_qr_shown'
    ) OR (
      history.event_name = 'card_created'
      -- Not "=": bool_and skips NULL, so a row without a source would otherwise pass.
      AND history.event_properties ->> 'source' IS NOT DISTINCT FROM 'app'
    ))
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
  SELECT passive_app_guests.actor_id
  FROM passive_app_guests
  WHERE passive_app_guests.actor_id IN (SELECT fleet_app_guests.actor_id FROM fleet_app_guests)
  UNION
  SELECT burst.actor_id
  FROM (
    SELECT
      outdated.actor_id,
      count(*) OVER (PARTITION BY outdated.received_on, outdated.user_agent_chrome_major) AS guest_count
    FROM outdated_new_web_guests AS outdated
    WHERE outdated.actor_id IN (SELECT passive_app_guests.actor_id FROM passive_app_guests)
  ) AS burst
  WHERE burst.guest_count >= 10
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
