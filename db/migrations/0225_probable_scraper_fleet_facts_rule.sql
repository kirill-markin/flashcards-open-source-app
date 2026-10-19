-- Migration status: Current / canonical.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0223_probable_scraper_fleet_visitors.sql, with the same name, columns, unique
-- index, grants and readers.
-- Current guidance: a subject qualifies when its whole history is one direct, referrer-less,
--   desktop site_page_viewed since 2026-09-25, plus nothing but the passive impressions that page
--   produces on its own, and that page view also meets one of two arms:
--   - received before 2026-10-19 10:53:20.04 UTC, the cutoff, in SG, CN, HK, VN or ID: 0223's
--     behaviour-only rule, for 0223's reasons, ending where the next arm begins;
--   - received at or after the cutoff, in any country or none, with at least one strong signal
--     stored by db/migrations/0224_anonymous_event_network_and_browser_facts.sql.
--   The cutoff is the server_received_at of the first row that stored a non-NULL network_asn, so
--   behaviour alone marks only visits from before those facts existed. From the cutoff the
--   one-page shape alone marks no one, so a real one-page visitor needs a signal to be marked.
-- Schemas touched/read explicitly: analytics.
-- See also: apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- The strong signals, each read on the page view itself, since the facts sit on the collector row:
-- - network_asn is a cloud or hosting network. Real visitors rarely browse from a data centre: in
--   the first 4 hours of facts this list matched 198 of 232 fleet-shaped visitors worldwide and 1
--   of 36 human-looking ones.
-- - user_agent_chrome_major is set but client_hint_chromium_major is absent or differs. Desktop
--   Chromium browsers have sent by default, since Chromium 89, a Sec-CH-UA hint naming their own
--   Chromium major on every secure request, so a Chrome claim without that matching hint is a
--   forged User-Agent or a client that is not the browser it claims to be.
-- - user_agent_chrome_major is 12 or more below the reference, in SG, CN, HK, VN or ID only. A
--   day's common major is the client_hint_chromium_major stored most often that UTC day, ties
--   going to the higher major, counting only rows from the cutoff on whose hint equals their
--   User-Agent major and whose network_asn is not a cloud network. The reference is the highest
--   common major of the 30 UTC days before the page view's UTC day. Forged hints, or Beta, Dev and
--   Canary builds a few majors ahead of stable, set a day's common major only by matching or
--   outnumbering every other major stored that day. Chrome updates itself and ships a major about
--   every four weeks, so 12 behind is about a year without an update, which fleets running a
--   pinned build show. The reference is fixed by the visit's day, never by the refresh time, so a
--   mark on an old visit never moves as Chrome advances, and it is computed once per day. On
--   2026-10-19 the reference has no earlier day to read, so this signal cannot fire that day. Its
--   evidence is the first 4 hours of facts measured with a fixed threshold instead, Chrome 144 or
--   older: 12 below Chromium 156, the newest major then seen in stored hints. It is limited to the
--   five countries because the visitors only that threshold caught elsewhere (US, FR, PT, TN, IN,
--   PH) were residential networks with a matching hint on Chrome 133-142: plausibly real people on
--   an outdated browser, in countries where the one-page shape is common among real visitors. In
--   VN and ID the same pattern repeated on Viettel 7552 and VNPT 45899 and looked fleet-like. The
--   two worldwide signals caught 207 of those 232 fleet-shaped visitors; with that threshold in the
--   five countries, about 215.
--
-- Refreshed as 0223 says, so the next refresh re-marks history under this rule. Nothing is deleted.
-- Actor history, restores and daily visitor hashes are handled as in 0223: a restore in
-- analytics.excluded_actors overrides an actor match, and a hash has no restore path.
DROP MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors;

CREATE MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors AS
WITH shaped_page_views AS MATERIALIZED (
  SELECT
    page_view.actor_id,
    page_view.anonymous_id,
    page_view.daily_visitor_hash,
    page_view.server_received_at,
    page_view.country,
    page_view.network_asn,
    page_view.user_agent_chrome_major,
    page_view.client_hint_chromium_major
  FROM analytics.product_events_resolved AS page_view
  WHERE page_view.event_name = 'site_page_viewed'
    AND page_view.trust_level = 'anonymous_client'
    AND page_view.server_received_at >= TIMESTAMPTZ '2026-09-25 00:00:00+00'
    AND (
      page_view.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
      OR page_view.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
    )
    AND page_view.event_properties ->> 'source' = 'direct'
    AND page_view.event_properties ->> 'referrer_host' IS NULL
    AND page_view.event_properties ->> 'device_category' = 'desktop'
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
    SELECT DISTINCT (shaped.server_received_at AT TIME ZONE 'UTC')::date AS received_on
    FROM shaped_page_views AS shaped
    WHERE shaped.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
  ) AS visit_day
  LEFT JOIN chromium_daily_common AS daily
    ON daily.received_on >= visit_day.received_on - 30
    AND daily.received_on < visit_day.received_on
  GROUP BY visit_day.received_on
),
fleet_page_views AS MATERIALIZED (
  SELECT shaped.actor_id, shaped.anonymous_id, shaped.daily_visitor_hash
  FROM shaped_page_views AS shaped
  LEFT JOIN current_chromium_by_day AS current_chromium
    ON current_chromium.received_on = (shaped.server_received_at AT TIME ZONE 'UTC')::date
  WHERE (
      shaped.server_received_at < TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND shaped.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
    )
    OR (
      shaped.server_received_at >= TIMESTAMPTZ '2026-10-19 10:53:20.04+00'
      AND (
        shaped.network_asn IN (SELECT cloud.network_asn FROM cloud_networks AS cloud)
        OR (
          shaped.user_agent_chrome_major IS NOT NULL
          AND (
            shaped.client_hint_chromium_major IS NULL
            OR shaped.client_hint_chromium_major <> shaped.user_agent_chrome_major
          )
        )
        OR (
          shaped.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
          AND shaped.user_agent_chrome_major <= current_chromium.chromium_major - 12
        )
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
SELECT 'daily_visitor_hash'::text AS subject_kind, hashed.daily_visitor_hash AS subject_id
FROM analytics.product_events AS hashed
WHERE hashed.trust_level = 'anonymous_client'
  AND hashed.anonymous_id IS NULL
  AND hashed.server_received_at >= TIMESTAMPTZ '2026-09-25 00:00:00+00'
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
  ));

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY, which keeps reports readable during a refresh.
CREATE UNIQUE INDEX probable_scraper_fleet_visitors_subject
  ON analytics.probable_scraper_fleet_visitors (subject_kind, subject_id);

GRANT SELECT ON analytics.probable_scraper_fleet_visitors TO reporting_readonly;
GRANT MAINTAIN ON analytics.probable_scraper_fleet_visitors TO backend_app;
