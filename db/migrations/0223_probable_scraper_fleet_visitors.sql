-- Migration status: Current / additive.
-- Introduces: analytics.probable_scraper_fleet_visitors, the one-page automated marketing-site
--   visitors from SG, CN, HK, VN and ID, as identified actors and as cookieless daily visitor hashes.
--   The shared report exclusion rule (apps/backend/src/reviewMetricsSql.ts) reads the actor rows, and
--   the hashed site cohort (apps/admin/src/reports/funnels/funnelAudienceSql.ts) reads the hash rows.
-- Schemas touched/read explicitly: analytics.

-- Refreshed by the same scheduled backend job as analytics.probable_android_burst_actors, so a later
-- event, a human restore or a rule change re-marks history at the next refresh. Nothing is deleted.
--
-- A subject qualifies when its whole history is one direct, referrer-less, desktop site_page_viewed
-- in one of the five countries since 2026-09-25, plus nothing but the passive impressions that page
-- produces on its own. The rule is behaviour only, so it is limited to these countries: bots
-- dominate their one-page traffic, while the same one-page, direct, desktop shape is common among
-- real visitors elsewhere. It starts at 2026-09-25, the day the collector began storing the
-- ingest-time country it tests (0158_anonymous_event_country.sql), from that day's deploy on; earlier
-- rows carry a NULL country and can never match, so the evaluated data, and the fleet as seen in it,
-- begin there. A real person who matches is a known, accepted loss, estimated at 1-8 per day in
-- CN against about 160 bots per day. A later migration bounds the end of the window.
--
-- An actor's history is every trust level of analytics.product_events_resolved, so a visitor who
-- later did anything else, or signed in, never qualifies. A restore in analytics.excluded_actors
-- overrides the match. A hash names one browser for one UTC day of server_received_at (0144), so
-- bounding its rows by server_received_at keeps every hash whole; a hash has no restore path.
CREATE MATERIALIZED VIEW analytics.probable_scraper_fleet_visitors AS
WITH candidate_actors AS MATERIALIZED (
  SELECT DISTINCT page_view.actor_id
  FROM analytics.product_events_resolved AS page_view
  WHERE page_view.event_name = 'site_page_viewed'
    AND page_view.trust_level = 'anonymous_client'
    AND page_view.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
    AND page_view.server_received_at >= TIMESTAMPTZ '2026-09-25 00:00:00+00'
    AND page_view.event_properties ->> 'source' = 'direct'
    AND page_view.event_properties ->> 'referrer_host' IS NULL
    AND page_view.event_properties ->> 'device_category' = 'desktop'
    AND page_view.actor_id IS NOT NULL
),
fleet_actors AS (
  SELECT history.actor_id
  FROM analytics.product_events_resolved AS history
  WHERE history.actor_id IN (SELECT candidate_actors.actor_id FROM candidate_actors)
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
  AND hashed.daily_visitor_hash IS NOT NULL
  AND hashed.server_received_at >= TIMESTAMPTZ '2026-09-25 00:00:00+00'
GROUP BY hashed.daily_visitor_hash
HAVING count(*) FILTER (WHERE hashed.event_name = 'site_page_viewed') = 1
  AND count(*) FILTER (
    WHERE hashed.event_name = 'site_page_viewed'
      AND hashed.country IN ('SG', 'CN', 'HK', 'VN', 'ID')
      AND hashed.event_properties ->> 'source' = 'direct'
      AND hashed.event_properties ->> 'referrer_host' IS NULL
      AND hashed.event_properties ->> 'device_category' = 'desktop'
  ) = 1
  AND bool_and(hashed.event_name IN (
    'site_page_viewed', 'site_locale_suggestion_shown', 'site_app_entry_shown', 'site_store_qr_shown'
  ));

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY, which keeps reports readable during a refresh.
CREATE UNIQUE INDEX probable_scraper_fleet_visitors_subject
  ON analytics.probable_scraper_fleet_visitors (subject_kind, subject_id);

GRANT SELECT ON analytics.probable_scraper_fleet_visitors TO reporting_readonly;
GRANT MAINTAIN ON analytics.probable_scraper_fleet_visitors TO backend_app;
