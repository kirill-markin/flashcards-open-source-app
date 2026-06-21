-- Migration status: Current / additive.
-- Introduces: privacy-limited public leaderboard profile aggregate reads.
-- Schemas touched/read explicitly: community, progress, content, org.

CREATE INDEX IF NOT EXISTS idx_review_events_reviewer_missing_local_client
  ON content.review_events(reviewed_by_user_id, reviewed_at_client)
  WHERE reviewed_local_date IS NULL;

CREATE OR REPLACE FUNCTION community.read_leaderboard_profile_summary(
  p_target_public_profile_id UUID,
  p_rating_metric_version    TEXT,
  p_streak_metric_version    TEXT,
  p_generated_at             TIMESTAMPTZ
)
RETURNS TABLE (
  public_profile_id UUID,
  joined_at         TIMESTAMPTZ,
  total_cards       INTEGER,
  activity_date     TEXT,
  review_count      INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_target_public_profile_id IS NULL THEN
    RAISE EXCEPTION 'p_target_public_profile_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_rating_metric_version IS NULL OR btrim(p_rating_metric_version) = '' THEN
    RAISE EXCEPTION 'p_rating_metric_version is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_streak_metric_version IS NULL OR btrim(p_streak_metric_version) = '' THEN
    RAISE EXCEPTION 'p_streak_metric_version is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_generated_at IS NULL THEN
    RAISE EXCEPTION 'p_generated_at is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH viewer_profile AS (
    SELECT profiles.public_profile_id
    FROM community.public_profiles AS profiles
    WHERE profiles.user_id = security.current_user_id()
    LIMIT 1
  ),
  latest_rating_snapshots AS (
    SELECT DISTINCT ON (snapshots.window_key)
      snapshots.snapshot_id
    FROM community.leaderboard_snapshots AS snapshots
    WHERE snapshots.metric_version = p_rating_metric_version
    ORDER BY snapshots.window_key, snapshots.as_of_server_hour DESC
  ),
  latest_streak_snapshot AS (
    SELECT snapshots.snapshot_id
    FROM community.streak_leaderboard_snapshots AS snapshots
    WHERE snapshots.metric_version = p_streak_metric_version
    ORDER BY snapshots.as_of_utc_date DESC
    LIMIT 1
  ),
  eligible_target AS (
    SELECT
      target_profiles.public_profile_id,
      target_profiles.user_id,
      target_profiles.created_at,
      CASE
        WHEN user_settings.progress_time_zone IS NULL
          THEN timezone('UTC', p_generated_at)::date
        ELSE timezone(user_settings.progress_time_zone, p_generated_at)::date
      END AS current_profile_date
    FROM community.public_profiles AS target_profiles
    INNER JOIN org.user_settings AS user_settings
      ON user_settings.user_id = target_profiles.user_id
    LEFT JOIN viewer_profile
      ON viewer_profile.public_profile_id = target_profiles.public_profile_id
    WHERE target_profiles.public_profile_id = p_target_public_profile_id
      AND target_profiles.leaderboard_participation_enabled = TRUE
      AND (
        viewer_profile.public_profile_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM latest_rating_snapshots
          INNER JOIN community.leaderboard_snapshot_entries AS entries
            ON entries.snapshot_id = latest_rating_snapshots.snapshot_id
          WHERE entries.public_profile_id = target_profiles.public_profile_id
        )
        OR EXISTS (
          SELECT 1
          FROM latest_streak_snapshot
          INNER JOIN community.streak_leaderboard_snapshot_entries AS entries
            ON entries.snapshot_id = latest_streak_snapshot.snapshot_id
          WHERE entries.public_profile_id = target_profiles.public_profile_id
        )
      )
  ),
  profile_dates AS (
    SELECT generate_series(
      eligible_target.current_profile_date - 29,
      eligible_target.current_profile_date,
      interval '1 day'
    )::date AS activity_date
    FROM eligible_target
  ),
  local_review_activity AS (
    SELECT
      active_days.local_date,
      SUM(active_days.review_count)::int AS review_count
    FROM progress.user_active_review_days AS active_days
    INNER JOIN eligible_target
      ON eligible_target.user_id = active_days.reviewed_by_user_id
    WHERE active_days.local_date BETWEEN
      eligible_target.current_profile_date - 29
      AND eligible_target.current_profile_date
    GROUP BY active_days.local_date
  ),
  utc_fallback_review_activity AS (
    SELECT
      (review_events.reviewed_at_client AT TIME ZONE 'UTC')::date AS local_date,
      COUNT(*)::int AS review_count
    FROM content.review_events AS review_events
    INNER JOIN eligible_target
      ON eligible_target.user_id = review_events.reviewed_by_user_id
    WHERE review_events.reviewed_local_date IS NULL
      AND (review_events.reviewed_at_client AT TIME ZONE 'UTC')::date BETWEEN
        eligible_target.current_profile_date - 29
        AND eligible_target.current_profile_date
    GROUP BY (review_events.reviewed_at_client AT TIME ZONE 'UTC')::date
  ),
  review_activity AS (
    SELECT
      activity.local_date,
      SUM(activity.review_count)::int AS review_count
    FROM (
      SELECT local_review_activity.local_date, local_review_activity.review_count
      FROM local_review_activity
      UNION ALL
      SELECT utc_fallback_review_activity.local_date, utc_fallback_review_activity.review_count
      FROM utc_fallback_review_activity
    ) AS activity
    GROUP BY activity.local_date
  ),
  card_totals AS (
    SELECT COUNT(cards.card_id)::int AS total_cards
    FROM eligible_target
    INNER JOIN org.workspace_memberships AS memberships
      ON memberships.user_id = eligible_target.user_id
    INNER JOIN content.cards AS cards
      ON cards.workspace_id = memberships.workspace_id
    WHERE cards.deleted_at IS NULL
  )
  SELECT
    eligible_target.public_profile_id,
    eligible_target.created_at AS joined_at,
    COALESCE(card_totals.total_cards, 0) AS total_cards,
    to_char(profile_dates.activity_date, 'YYYY-MM-DD') AS activity_date,
    COALESCE(review_activity.review_count, 0) AS review_count
  FROM eligible_target
  CROSS JOIN profile_dates
  CROSS JOIN card_totals
  LEFT JOIN review_activity
    ON review_activity.local_date = profile_dates.activity_date
  ORDER BY profile_dates.activity_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION community.read_leaderboard_profile_summary(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.read_leaderboard_profile_summary(UUID, TEXT, TEXT, TIMESTAMPTZ) TO backend_app;

COMMENT ON FUNCTION community.read_leaderboard_profile_summary(UUID, TEXT, TEXT, TIMESTAMPTZ) IS
  'Returns only privacy-limited aggregate fields for one eligible public leaderboard profile: joined timestamp, active card total, and 30 zero-filled local/UTC-fallback review activity days. Does not expose internal user ids, emails, timezones, workspace ids, card ids, or raw review timestamps.';
