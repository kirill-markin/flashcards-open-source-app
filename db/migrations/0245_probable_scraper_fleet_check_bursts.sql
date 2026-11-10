-- Migration status: Current / canonical.
-- Introduces: no new object.
-- Replaces or corrects: analytics.probable_scraper_fleet_visitors from
-- db/migrations/0243_current_chromium_cap_and_checked_guests.sql, with the same name, columns,
-- unique index, grants and readers. analytics.current_chromium_by_day stays as 0243 defines it.
-- Current guidance: 0243's rules unchanged, except that:
--   - a guest who passed the guest browser check is judged like any other guest;
--   - a guest with a passing history is also marked when its own analytics.guest_browser_checks row
--     (outcome allowed or passed) is in a burst of guest creation attempts: 10 or more on one UTC day
--     for one Chrome major below each attempt's current_chromium_major, or 6 or more within 60 minutes
--     for one claimed browser family and major version. Only allowed and required rows are attempts;
--     passed and failed rows follow a required row and bypassed rows are release smokes, so none of
--     them count. A guest whose only rows are server-derived, such as catalog_deck_installed, passes
--     the history test, so an install-only bot is marked.
-- Schemas touched/read explicitly: analytics.
-- See also: db/migrations/0244_guest_browser_check_browser.sql,
-- apps/backend/src/guestAuth/browser/challengeRisk.ts,
-- apps/backend/src/entrypoints/scheduledJobs/lambda-probable-android-burst-refresh.ts,
-- docs/analytics-audience.md.

-- A fleet can buy solved Turnstile checks, so passing one is no evidence of a person; a guest who does
-- anything beyond the passive allow-list below is still never marked. While configured, the check
-- records every new web guest at creation, so a burst is seen there before any app event, and it includes the guests let in
-- before the burst was large enough to flag.
--
-- Refreshed as 0223 says, so the next refresh re-marks history under these rules. Nothing is deleted.
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
-- Also in 0243's analytics.current_chromium_by_day and challengeRisk.ts; keep all lists equal.
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
-- guest_user_id is the actor_id of that guest's events; only allowed and passed rows carry one. An
-- attempt is an allowed or required row. A guest row is in an hourly burst when some 60-minute window
-- containing it holds 6 or more attempts for its browser version, that is when the row itself or a row
-- of that version up to 60 minutes later has 6 or more attempts in its past 60 minutes. Only a row of
-- family chrome, firefox or safari with a major claims a browser version; any other row, including one
-- written before 0244's columns were filled, counts only toward the daily burst, because an unknown
-- User-Agent is shared by in-app browsers, home-screen web apps and scripts alike.
check_burst_guests AS MATERIALIZED (
  SELECT DISTINCT decision.guest_user_id AS actor_id
  FROM (
    SELECT
      counted.guest_user_id,
      counted.outdated_chrome_attempts_that_day,
      counted.user_agent_browser_major IS NOT NULL
        AND counted.user_agent_browser <> 'other'
        AND bool_or(counted.browser_attempts_past_hour >= 6) OVER (
          PARTITION BY counted.user_agent_browser, counted.user_agent_browser_major
          ORDER BY counted.checked_at
          RANGE BETWEEN CURRENT ROW AND INTERVAL '60 minutes' FOLLOWING
        ) AS in_hourly_burst
    FROM (
      SELECT
        checked.guest_user_id,
        checked.checked_at,
        checked.user_agent_browser,
        checked.user_agent_browser_major,
        count(*) FILTER (WHERE checked.outcome IN ('allowed', 'required')) OVER (
          PARTITION BY checked.user_agent_browser, checked.user_agent_browser_major
          ORDER BY checked.checked_at
          RANGE BETWEEN INTERVAL '60 minutes' PRECEDING AND CURRENT ROW
        ) AS browser_attempts_past_hour,
        -- NULL unless this row's Chrome major is below its current_chromium_major.
        CASE
          WHEN checked.user_agent_chrome_major < checked.current_chromium_major THEN count(*) FILTER (
            WHERE checked.outcome IN ('allowed', 'required')
              AND checked.user_agent_chrome_major < checked.current_chromium_major
          ) OVER (
            PARTITION BY (checked.checked_at AT TIME ZONE 'UTC')::date, checked.user_agent_chrome_major
          )
        END AS outdated_chrome_attempts_that_day
      FROM analytics.guest_browser_checks AS checked
      WHERE checked.outcome <> 'bypassed'
    ) AS counted
  ) AS decision
  WHERE decision.guest_user_id IS NOT NULL
    AND (decision.outdated_chrome_attempts_that_day >= 10 OR decision.in_hourly_burst)
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
    UNION
    SELECT check_burst_guests.actor_id FROM check_burst_guests
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
  SELECT passive_app_guests.actor_id
  FROM passive_app_guests
  WHERE passive_app_guests.actor_id IN (SELECT check_burst_guests.actor_id FROM check_burst_guests)
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
