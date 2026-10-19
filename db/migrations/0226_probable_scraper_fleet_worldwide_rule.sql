-- Migration status: Current / canonical.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0225_probable_scraper_fleet_facts_rule.sql, with the same name, columns, unique
-- index, grants and readers.
-- Current guidance: a subject, an actor or one daily visitor hash, qualifies in either of two ways:
--   - its whole history is one site_page_viewed plus nothing but the passive impressions that page
--     produces on its own, and that page view meets one of the fleet arms below;
--   - any of its site_page_viewed rows carries automation = 'webdriver', whatever else it did.
--   The cutoff, 2026-10-19 10:53:20.04 UTC, is the server_received_at of the first row that stored
--   a non-NULL network_asn (db/migrations/0224_anonymous_event_network_and_browser_facts.sql).
--   Before it, behaviour alone marks a page view; from it, a page view needs a stored signal.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0223_probable_scraper_fleet_visitors.sql,
-- apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- History has no lower bound, so the rows of 2026-09-22 to 2026-09-24 count too: 0223 and 0225
-- began at 2026-09-25 because their behaviour-only arm tests the ingest-time country, which earlier
-- rows lack, and arm A below tests none. "Direct desktop" below means device_category 'desktop',
-- source 'direct' and no referrer_host. A page view qualifies when one of these arms holds:
-- - A. Before the cutoff, direct desktop on a blog_article, catalog_package or catalog_other page,
--   in any country or none. In the first 8.5 hours of facts there were 455 such page views
--   worldwide, counted before any exclusion, none engaged (a second page or a non-passive site
--   event that UTC day), and only 10 came from a residential network on a modern Chrome with a
--   matching hint. Over 2026-09-23 to 2026-10-19 the shape made 2,777 of the 6,862 visitor-days
--   the Web series of the admin Who saw us report counted under 0225, including bursts of 63
--   visitors on 63 distinct articles within 2 minutes at 2026-09-26 22:09 UTC and 145 visitors on
--   145 distinct pages within 4 minutes at 2026-10-10 22:43 UTC. A real one-page visitor of this
--   shape is an accepted loss, in a window that ends at the cutoff.
-- - B. Before the cutoff, direct desktop on any page, in SG, CN, HK, VN or ID: 0223's rule, for
--   0223's reasons.
-- - C. From the cutoff, direct desktop on any page, in any country or none, with at least one of:
--   - network_asn is a cloud or hosting network. Real visitors rarely browse from a data centre: in
--     the first 4 hours of facts this list matched 198 of 232 fleet-shaped visitors worldwide and 1
--     of 36 human-looking ones.
--   - user_agent_chrome_major is 12 or more below the reference. Chrome updates itself and ships a
--     major about every four weeks, so 12 behind is about a year without an update, which fleets
--     running a pinned build show. Evidence for the signal, not output of this rule, which cannot
--     fire on 2026-10-19 (below): that day, from the cutoff, the visitors 0225 still counted whose
--     Chrome User-Agent major was 142 or lower with a matching hint were 28 one-page and 1 engaged;
--     the 29 ran Chrome 133-142, from US residential networks (Frontier, Windstream, Cox, RCN) and
--     from countries including PH, FR, PT and TN, so the signal applies in every country.
--   - device_locale has the language zh while the country is unknown or not CN, TW, HK or MO, where
--     zh is a local language. Since 2026-09-23 about 800 direct desktop visitor-days with a zh
--     browser locale from the US, MX or no country were one page only, and about 1% of that shape
--     engaged, against about 50% of the same shape inside CN.
-- - D. From the cutoff, on any device, source or referrer: user_agent_chrome_major is set but
--   client_hint_chromium_major is absent or differs. Chromium browsers on desktop and Android have
--   sent by default, since Chromium 89, a Sec-CH-UA hint naming their own Chromium major on every
--   secure request, so a Chrome claim without that matching hint is a forged User-Agent or a client
--   that is not the browser it claims to be. A Chrome 117 visit from AS3356 with a forged bing.com
--   referrer and a mobile Chrome 75 visit with no hint showed that such clients do not keep to the
--   direct desktop shape. An in-app browser on an older Android WebView that sends no hint, and a
--   genuine Chrome older than 89, which predates the hint, are marked too, accepted losses the
--   one-page condition limits.
--
-- The reference for an old Chrome is fixed by the visit's UTC day, never by the refresh time, so a
-- mark on an old visit never moves as Chrome advances, and it is computed once per day. A day's
-- common major is the client_hint_chromium_major stored most often that UTC day, ties going to the
-- higher major, counting only rows from the cutoff on whose hint equals their User-Agent major and
-- whose network_asn is not a cloud network; forged hints, or Beta, Dev and Canary builds a few
-- majors ahead of stable, set it only by matching or outnumbering every other major stored that
-- day. The reference is the highest common major of the 30 UTC days before the visit's day, so on
-- 2026-10-19 it has no earlier day to read and the signal cannot fire.
--
-- automation = 'webdriver' is what the marketing site reports on a page view when
-- navigator.webdriver is true: the browser itself declares that WebDriver or another automation
-- protocol drives it, so the events that follow are the script's, and no activity clears the mark.
--
-- Refreshed as 0223 says, so the next refresh re-marks history under this rule. Nothing is deleted.
-- Actor history, restores and daily visitor hashes are handled as in 0223: a restore in
-- analytics.excluded_actors overrides an actor match on either path, and a hash has no restore
-- path.
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
    SELECT DISTINCT (page_view.server_received_at AT TIME ZONE 'UTC')::date AS received_on
    FROM site_page_views AS page_view
    WHERE page_view.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
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
      'site_page_viewed', 'site_locale_suggestion_shown', 'site_app_entry_shown', 'site_store_qr_shown'
    ))
  UNION
  SELECT page_view.actor_id
  FROM site_page_views AS page_view
  WHERE page_view.automation = 'webdriver'
    AND page_view.actor_id IS NOT NULL
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
      'site_page_viewed', 'site_locale_suggestion_shown', 'site_app_entry_shown', 'site_store_qr_shown'
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
