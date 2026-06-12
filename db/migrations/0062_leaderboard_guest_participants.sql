-- Includes opted-in unlinked guest public profiles in community leaderboard
-- snapshots while preserving guest read restrictions in the API layer.

CREATE OR REPLACE FUNCTION community.refresh_leaderboard_snapshot(
  p_metric_version           TEXT,
  p_window_key               TEXT,
  p_window_lower_bound_hours INTEGER,
  p_as_of_server_hour        TIMESTAMPTZ,
  p_generated_at             TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_snapshot_id UUID;
BEGIN
  INSERT INTO community.leaderboard_snapshots AS snapshots (
    snapshot_id,
    metric_version,
    window_key,
    generated_at,
    as_of_server_hour
  )
  VALUES (
    gen_random_uuid(),
    p_metric_version,
    p_window_key,
    p_generated_at,
    p_as_of_server_hour
  )
  ON CONFLICT (metric_version, window_key, as_of_server_hour)
  DO UPDATE SET generated_at = EXCLUDED.generated_at
  RETURNING snapshots.snapshot_id INTO v_snapshot_id;

  DELETE FROM community.leaderboard_snapshot_entries
  WHERE snapshot_id = v_snapshot_id;

  INSERT INTO community.leaderboard_snapshot_entries (
    snapshot_id,
    public_profile_id,
    qualified_review_count,
    base_sort_position
  )
  SELECT
    v_snapshot_id,
    eligible.public_profile_id,
    eligible.qualified_review_count,
    (ROW_NUMBER() OVER (
      ORDER BY eligible.qualified_review_count DESC, eligible.public_profile_id ASC
    ))::int AS base_sort_position
  FROM (
    SELECT
      profiles.public_profile_id AS public_profile_id,
      COUNT(countable_facts.public_profile_id)::int AS qualified_review_count
    FROM community.public_profiles AS profiles
    INNER JOIN org.user_settings AS user_settings
      ON user_settings.user_id = profiles.user_id
    LEFT JOIN (
      SELECT facts.public_profile_id
      FROM community.public_review_activity_facts AS facts
      INNER JOIN content.review_events AS review_events
        ON review_events.review_event_id = facts.review_event_id
      INNER JOIN sync.workspace_replicas AS workspace_replicas
        ON workspace_replicas.replica_id = review_events.replica_id
      LEFT JOIN org.user_settings AS fact_user_settings
        ON fact_user_settings.user_id = facts.reviewed_by_user_id
      WHERE facts.metric_version = p_metric_version
        AND facts.is_countable = TRUE
        AND facts.reviewed_at_client <= p_as_of_server_hour
        AND (
          p_window_lower_bound_hours IS NULL
          OR facts.reviewed_at_client > p_as_of_server_hour - (p_window_lower_bound_hours * interval '1 hour')
        )
        AND workspace_replicas.actor_kind = 'client_installation'
        AND workspace_replicas.platform IN ('web', 'android', 'ios')
        AND (
          fact_user_settings.email IS NULL
          OR LOWER(btrim(fact_user_settings.email)) NOT LIKE '%@example.com'
        )
    ) AS countable_facts
      ON countable_facts.public_profile_id = profiles.public_profile_id
    WHERE profiles.leaderboard_participation_enabled = TRUE
      AND (
        user_settings.email IS NULL
        OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'
      )
    GROUP BY profiles.public_profile_id
  ) AS eligible;

  RETURN v_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO backend_app;

COMMENT ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Regenerates one leaderboard snapshot (metric_version, window_key) at a server hour. Includes every opted-in non-demo public profile, including unlinked guests, counts only matching countable facts from real client-app activity, orders tie-neutrally, and atomically replaces the snapshot entries. Returns the snapshot_id.';
