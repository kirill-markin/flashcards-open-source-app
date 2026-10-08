-- Migration status: Current / additive.
-- Introduces: analytics.probable_android_burst_actors, the probable Android test-burst
--   classification that the shared report exclusion rule (apps/backend/src/reviewMetricsSql.ts)
--   reads, so each report statement no longer recomputes it from whole event history.
-- Schemas touched/read explicitly: analytics, auth.

-- Refreshed by a scheduled backend job, so a classification change (a new burst, a later sign-in or
-- return, a human restore) reaches reports at the next refresh. REFRESH runs the query as the view
-- owner, so backend_app needs only MAINTAIN.
--
-- Whole trusted history decides the classification. NULL device fields on server facts do not add
-- fingerprints. Restored people contribute to the burst size, but a restore under any of their
-- resolved/raw/subject IDs overrides the match.
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
