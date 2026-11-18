-- Migration status: Current / additive.
-- Schemas touched/read explicitly: analytics, auth, content, org, pg_catalog, security, sync.

CREATE FUNCTION analytics.card_addition_recovery_candidates(target_workspace_id UUID)
RETURNS TABLE (
  event_id UUID, source_event_id UUID, user_id UUID, subject_user_id UUID, actor_id UUID,
  workspace_id UUID, platform TEXT, occurred_at TIMESTAMPTZ, server_received_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  caller_role TEXT := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
BEGIN
  IF caller_role <> 'reporting_readonly' AND (
    caller_role <> 'backend_app' OR target_workspace_id IS NULL
    OR security.current_workspace_access_allowed(target_workspace_id) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Card addition recovery requires reporting access or an explicit authorized workspace scope'
      USING ERRCODE = '42501';
  END IF;

RETURN QUERY
WITH seed_workspaces AS MATERIALIZED (
  SELECT card.workspace_id
  FROM content.cards AS card
  WHERE (target_workspace_id IS NULL OR card.workspace_id = target_workspace_id)
    AND card.metadata->'onboardingDemo'->'version' = '1'::jsonb
  UNION
  SELECT event.workspace_id FROM analytics.product_events AS event
  WHERE (target_workspace_id IS NULL OR event.workspace_id = target_workspace_id)
    AND event.event_name = 'card_addition_committed' AND event.origin = 'server'
    AND event.identity_state = 'active' AND event.event_properties->>'demo_status' = 'demo'
), workspace_card_keys AS MATERIALIZED (
  SELECT card.card_id, card.workspace_id, card.created_at,
    card.metadata ? 'onboardingDemo' AS has_demo_marker,
    card.metadata->'onboardingDemo'->'version' = '1'::jsonb AS marked_demo,
    key.event_name, analytics.derive_server_event_id(key.event_name, ARRAY[card.card_id::text]) AS event_id
  FROM seed_workspaces AS workspace
  JOIN content.cards AS card ON card.workspace_id = workspace.workspace_id
  CROSS JOIN (VALUES ('card_created'::text), ('card_addition_committed'::text)) AS key(event_name)
), matched_card_events AS MATERIALIZED (
  SELECT card.card_id, card.workspace_id, card.created_at, card.has_demo_marker, card.marked_demo,
    creation.event_id AS source_event_id, creation.user_id, creation.subject_user_id, creation.platform,
    creation.occurred_at, creation.server_received_at, creation.event_properties->>'demo_status' AS demo_status
  FROM workspace_card_keys AS card
  JOIN analytics.product_events AS creation
    ON creation.event_id = card.event_id AND creation.event_name = card.event_name
  WHERE creation.workspace_id = card.workspace_id
    AND creation.identity_state = 'active'
    AND creation.user_id = creation.subject_user_id
    AND creation.user_id IS NOT NULL
    AND (caller_role = 'reporting_readonly' OR creation.user_id::text = security.current_user_id())
    AND creation.trust_level IN ('server_derived', 'backfill_derived')
    AND (
      (creation.event_name = 'card_addition_committed' AND creation.origin = 'server'
        AND creation.event_properties->>'demo_status' IN ('unknown', 'demo'))
      OR (creation.event_name = 'card_created' AND creation.origin IN ('server', 'backfill')
        AND COALESCE(creation.event_properties->>'source', 'app') = 'app'
        AND NOT EXISTS (
          SELECT 1 FROM analytics.product_events AS committed
          WHERE committed.event_id = analytics.derive_server_event_id('card_addition_committed', ARRAY[card.card_id::text])
        ))
    )
    AND card.created_at <= creation.server_received_at
    AND creation.occurred_at <= creation.server_received_at
), original_writes AS MATERIALIZED (
  SELECT creation.*, original.replica_id AS original_replica_id
  FROM matched_card_events AS creation
  JOIN LATERAL (
    SELECT change.replica_id, change.recorded_at
    FROM sync.hot_changes AS change
    WHERE change.workspace_id = creation.workspace_id
      AND change.entity_type = 'card' AND change.entity_id = creation.card_id::text
    ORDER BY change.change_id LIMIT 1
  ) AS original ON original.recorded_at <= creation.server_received_at
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.guest_upgrade_history AS upgrade
    WHERE upgrade.target_workspace_id = creation.workspace_id AND upgrade.merged_at = original.recorded_at
  )
), identity_edges AS MATERIALIZED (
  -- Keep the erasing-owner inventory aligned with auth/accountDeletion.ts.
  SELECT upgrade.source_guest_user_id AS source_user_id, upgrade.target_user_id FROM auth.guest_upgrade_history AS upgrade
  UNION
  SELECT link.anonymous_id::text, link.user_id::text FROM analytics.identity_links AS link WHERE link.source = 'server_derived'
  UNION
  SELECT retired.retired_user_id, retired.canonical_user_id FROM auth.account_retirements AS retired
), identity_owners AS MATERIALIZED (
  SELECT source_user_id, MIN(target_user_id) AS target_user_id, COUNT(*) AS owner_count
  FROM identity_edges GROUP BY source_user_id
), resolved_creations AS MATERIALIZED (
  SELECT creation.*, CASE
    WHEN pg_input_is_valid(COALESCE(owner.target_user_id, creation.user_id::text), 'uuid')
    THEN COALESCE(owner.target_user_id, creation.user_id::text)::uuid
  END AS actor_id
  FROM original_writes AS creation
  JOIN sync.workspace_replicas AS replica
    ON replica.replica_id = creation.original_replica_id AND replica.workspace_id = creation.workspace_id
    AND replica.user_id = creation.user_id::text AND replica.actor_kind = 'client_installation'
  JOIN sync.installations AS installation ON installation.installation_id = replica.installation_id
    AND NOT installation.is_automation AND NOT installation.is_test_distribution
  LEFT JOIN identity_owners AS owner ON owner.source_user_id = creation.user_id::text
  LEFT JOIN identity_owners AS indirect_owner ON indirect_owner.source_user_id = owner.target_user_id
  -- The writer and one direct owner are the entire lock inventory used by recovery.
  WHERE owner.owner_count IS NULL OR (owner.owner_count = 1 AND indirect_owner.source_user_id IS NULL)
), matched_creations AS MATERIALIZED (
  SELECT creation.*
  FROM resolved_creations AS creation
  JOIN org.user_settings AS writer_profile ON writer_profile.user_id = creation.user_id::text
  JOIN org.user_settings AS actor_profile ON actor_profile.user_id = creation.actor_id::text
  JOIN org.workspace_memberships AS membership
    ON membership.user_id = writer_profile.user_id AND membership.workspace_id = creation.workspace_id
  JOIN org.workspaces AS workspace ON workspace.workspace_id = membership.workspace_id
  WHERE NOT EXISTS (SELECT 1 FROM auth.account_retirements AS retired
    WHERE retired.retired_user_id IN (creation.user_id::text, creation.actor_id::text))
), demo_seeds AS MATERIALIZED (
  SELECT creation.workspace_id, creation.user_id, creation.subject_user_id, creation.original_replica_id,
    MIN(creation.created_at) AS seed_created_at
  FROM matched_creations AS creation
  WHERE creation.marked_demo OR creation.demo_status = 'demo'
  GROUP BY creation.workspace_id, creation.user_id, creation.subject_user_id, creation.original_replica_id
)
SELECT analytics.derive_server_event_id('card_addition_recovered', ARRAY[creation.card_id::text]) AS event_id,
  creation.source_event_id, creation.user_id, creation.subject_user_id, creation.actor_id,
  creation.workspace_id, creation.platform,
  GREATEST(creation.created_at, creation.occurred_at) AS occurred_at, creation.server_received_at
FROM matched_creations AS creation
JOIN demo_seeds AS seed
  ON seed.workspace_id = creation.workspace_id AND seed.user_id = creation.user_id
  AND seed.subject_user_id = creation.subject_user_id
  AND seed.original_replica_id = creation.original_replica_id AND seed.seed_created_at < creation.created_at
WHERE NOT creation.has_demo_marker AND creation.demo_status IS DISTINCT FROM 'demo'
  AND NOT EXISTS (SELECT 1 FROM analytics.product_events AS recovered
    WHERE recovered.event_id = analytics.derive_server_event_id('card_addition_recovered', ARRAY[creation.card_id::text]));
END;
$$;

COMMENT ON FUNCTION analytics.card_addition_recovery_candidates(UUID) IS
  'Unrecovered non-demo card additions proved by the exact original server event, writer, workspace '
  'and retained original hot write, following a marked demo on the same original replica. Missing, '
  'late and transfer-only provenance stays unknown. This proof is rescanned each run without a persistent cursor.';
REVOKE ALL ON FUNCTION analytics.card_addition_recovery_candidates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.card_addition_recovery_candidates(UUID) TO reporting_readonly, backend_app;

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
  WHERE history.event_name NOT IN ('card_addition_committed', 'card_addition_recovered')
    AND history.actor_id IN (
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
  WHERE history.event_name NOT IN ('card_addition_committed', 'card_addition_recovered')
    AND history.actor_id IN (
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

DROP MATERIALIZED VIEW analytics.probable_android_burst_actors;

CREATE MATERIALIZED VIEW analytics.probable_android_burst_actors AS
WITH actor_history AS MATERIALIZED (
  SELECT
    pg_catalog.lower(pg_catalog.btrim(resolved.actor_id::text)) AS actor_id,
    min(resolved.device_model) FILTER (WHERE resolved.platform = 'android') AS device_model,
    min(resolved.os_version) FILTER (WHERE resolved.platform = 'android') AS os_version,
    min(resolved.app_version) FILTER (WHERE resolved.platform = 'android') AS app_version,
    min(resolved.occurred_at) AS first_event_at,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.user_id::text)))
      FILTER (WHERE resolved.user_id IS NOT NULL) AS event_user_ids,
    array_agg(DISTINCT pg_catalog.lower(pg_catalog.btrim(resolved.subject_user_id::text)))
      FILTER (WHERE resolved.subject_user_id IS NOT NULL) AS event_subject_user_ids
  FROM analytics.product_events_resolved AS resolved
  WHERE resolved.actor_id IS NOT NULL
    AND resolved.trust_level <> 'anonymous_client'
    AND resolved.event_name NOT IN ('card_addition_committed', 'card_addition_recovered')
  GROUP BY 1
  HAVING count(DISTINCT resolved.device_model) FILTER (WHERE resolved.platform = 'android') = 1
    AND count(DISTINCT resolved.os_version) FILTER (WHERE resolved.platform = 'android') = 1
    AND count(DISTINCT resolved.app_version) FILTER (WHERE resolved.platform = 'android') = 1
    AND max(resolved.occurred_at) - min(resolved.occurred_at) < interval '24 hours'
),
person_ids AS MATERIALIZED (
  SELECT DISTINCT actor_history.actor_id, person_key.person_id
  FROM actor_history
  CROSS JOIN LATERAL unnest(
    ARRAY[actor_history.actor_id]
      || COALESCE(actor_history.event_user_ids, ARRAY[]::text[])
      || COALESCE(actor_history.event_subject_user_ids, ARRAY[]::text[])
  ) AS person_key(person_id)
),
qualifying AS (
  SELECT actor_history.*
  FROM actor_history
  WHERE NOT EXISTS (
    SELECT 1
    FROM person_ids AS signed_in_person
    JOIN auth.user_identities AS signed_in_identities
      ON pg_catalog.lower(signed_in_identities.user_id) = signed_in_person.person_id
    WHERE signed_in_person.actor_id = actor_history.actor_id
      AND signed_in_identities.provider_type = 'cognito'
  )
),
burst_windows AS (
  SELECT anchor.device_model, anchor.os_version, anchor.app_version,
    anchor.first_event_at AS window_start
  FROM qualifying AS anchor
  JOIN qualifying AS member
    ON member.device_model = anchor.device_model
    AND member.os_version = anchor.os_version
    AND member.app_version = anchor.app_version
    AND member.first_event_at >= anchor.first_event_at
    AND member.first_event_at < anchor.first_event_at + interval '24 hours'
  GROUP BY anchor.actor_id, anchor.device_model, anchor.os_version, anchor.app_version, anchor.first_event_at
  HAVING count(*) >= 4
),
burst_members AS (
  SELECT DISTINCT member.actor_id
  FROM qualifying AS member
  JOIN burst_windows
    ON burst_windows.device_model = member.device_model
    AND burst_windows.os_version = member.os_version
    AND burst_windows.app_version = member.app_version
    AND member.first_event_at >= burst_windows.window_start
    AND member.first_event_at < burst_windows.window_start + interval '24 hours'
)
SELECT burst_members.actor_id
FROM burst_members
WHERE NOT EXISTS (
  SELECT 1
  FROM analytics.excluded_actors AS restored
  JOIN person_ids AS restored_person
    ON restored_person.person_id = restored.actor_id
  WHERE restored_person.actor_id = burst_members.actor_id
    AND restored.restored_at IS NOT NULL
);

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY, which keeps reports readable during a refresh.
CREATE UNIQUE INDEX probable_android_burst_actors_actor_id
  ON analytics.probable_android_burst_actors (actor_id);

GRANT SELECT ON analytics.probable_android_burst_actors TO reporting_readonly;
GRANT MAINTAIN ON analytics.probable_android_burst_actors TO backend_app;
