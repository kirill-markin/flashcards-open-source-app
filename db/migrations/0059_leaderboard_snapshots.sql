-- Migration status: Current / canonical.
-- Introduces: hourly community leaderboard snapshot tables and the privileged
--   backend job function that fills them from community.public_review_activity_facts.
-- Current guidance: snapshots are tie-neutral base orderings per metric/window/server-hour.
--   They never store display names; the read API derives anonymousDisplayName at read
--   time from public_profile_id and the viewer request locale. Viewer-specific rank and
--   the per-viewer tie rule are applied by the read API later, not stored here.
-- See also: db/migrations/0057_community_public_profiles.sql,
--   db/migrations/0058_public_review_activity_facts.sql, docs/architecture.md.

-- 1. Snapshot header: one row per (metric_version, window_key, as_of_server_hour).
CREATE TABLE IF NOT EXISTS community.leaderboard_snapshots (
  snapshot_id        UUID        PRIMARY KEY,
  metric_version     TEXT        NOT NULL,
  window_key         TEXT        NOT NULL,
  generated_at       TIMESTAMPTZ NOT NULL,
  as_of_server_hour  TIMESTAMPTZ NOT NULL,
  UNIQUE (metric_version, window_key, as_of_server_hour)
);

COMMENT ON TABLE community.leaderboard_snapshots IS
  'One leaderboard snapshot header per (metric version, window, server hour). Regenerated hourly and upserted by (metric_version, window_key, as_of_server_hour).';
COMMENT ON COLUMN community.leaderboard_snapshots.as_of_server_hour IS
  'Server clock hour the snapshot was taken for (date_trunc hour). Drives snapshot freshness and window upper bound.';
COMMENT ON COLUMN community.leaderboard_snapshots.generated_at IS
  'Wall-clock time the snapshot job produced this row. Advances on every hourly regeneration of the same server hour.';

-- 2. Snapshot entries: tie-neutral base ordering per snapshot.
CREATE TABLE IF NOT EXISTS community.leaderboard_snapshot_entries (
  snapshot_id            UUID    NOT NULL REFERENCES community.leaderboard_snapshots(snapshot_id) ON DELETE CASCADE,
  public_profile_id      UUID    NOT NULL REFERENCES community.public_profiles(public_profile_id) ON DELETE CASCADE,
  qualified_review_count INTEGER NOT NULL,
  base_sort_position     INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, public_profile_id)
);

COMMENT ON TABLE community.leaderboard_snapshot_entries IS
  'Tie-neutral base ordering for one snapshot. Never stores display names or raw review timestamps; the read API derives display names from public_profile_id and viewer locale.';
COMMENT ON COLUMN community.leaderboard_snapshot_entries.qualified_review_count IS
  'Count of countable facts for this profile inside the snapshot window. Only countable (rating <> 0) facts of opted-in linked accounts are counted.';
COMMENT ON COLUMN community.leaderboard_snapshot_entries.base_sort_position IS
  'Deterministic 1-based base ordering by qualified_review_count DESC, public_profile_id ASC. Viewer-specific tie placement is applied by the read API, not stored here.';

-- Latest snapshot lookup per metric/window.
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_metric_window_as_of
  ON community.leaderboard_snapshots(metric_version, window_key, as_of_server_hour DESC);

-- Ordered top-of-leaderboard reads inside a snapshot.
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshot_entries_snapshot_rank
  ON community.leaderboard_snapshot_entries(snapshot_id, qualified_review_count DESC, base_sort_position ASC);

-- The (snapshot_id, public_profile_id) lookup the read API needs to locate a single
-- profile inside a snapshot is already served by the primary key index, so no separate
-- index is created for it.

ALTER TABLE community.leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.leaderboard_snapshot_entries ENABLE ROW LEVEL SECURITY;

-- The read API runs as backend_app and serves the whole leaderboard, which is derived
-- public data of opted-in participants, so backend_app may read every snapshot row.
-- Writes are not granted to backend_app: only the SECURITY DEFINER job function below
-- writes these tables, so a request-scoped backend_app session cannot forge entries.
GRANT SELECT ON TABLE community.leaderboard_snapshots TO backend_app;
GRANT SELECT ON TABLE community.leaderboard_snapshot_entries TO backend_app;

DROP POLICY IF EXISTS leaderboard_snapshots_backend_select_runtime ON community.leaderboard_snapshots;
CREATE POLICY leaderboard_snapshots_backend_select_runtime
  ON community.leaderboard_snapshots
  FOR SELECT
  TO backend_app
  USING (true);

DROP POLICY IF EXISTS leaderboard_snapshot_entries_backend_select_runtime ON community.leaderboard_snapshot_entries;
CREATE POLICY leaderboard_snapshot_entries_backend_select_runtime
  ON community.leaderboard_snapshot_entries
  FOR SELECT
  TO backend_app
  USING (true);

-- 3. Privileged snapshot generation for one (metric_version, window) at one server hour.
-- SECURITY DEFINER so the hourly backend job (running as backend_app with no request
-- scope) can read activity facts, profiles, and account linkage across all users while
-- the per-user RLS policies on those tables stay intact for normal requests. The owner
-- of this function is the migration role, which owns the underlying tables and is not
-- subject to their row level security.
--
-- p_window_lower_bound_hours is the window size in whole hours, or NULL for all_time
-- (no lower bound). The window is (as_of - lower_bound, as_of] on reviewed_at_client.
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
  -- Upsert the snapshot header so regenerating the same server hour reuses one row.
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

  -- Replace the entries for the regenerated snapshot atomically.
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
      facts.public_profile_id AS public_profile_id,
      COUNT(*)::int AS qualified_review_count
    FROM community.public_review_activity_facts AS facts
    INNER JOIN community.public_profiles AS profiles
      ON profiles.public_profile_id = facts.public_profile_id
    INNER JOIN org.user_settings AS user_settings
      ON user_settings.user_id = profiles.user_id
    WHERE facts.metric_version = p_metric_version
      AND facts.is_countable = TRUE
      AND facts.reviewed_at_client <= p_as_of_server_hour
      AND (
        p_window_lower_bound_hours IS NULL
        OR facts.reviewed_at_client > p_as_of_server_hour - (p_window_lower_bound_hours * interval '1 hour')
      )
      AND profiles.leaderboard_participation_enabled = TRUE
      AND user_settings.email IS NOT NULL
      AND LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'
    GROUP BY facts.public_profile_id
  ) AS eligible;

  RETURN v_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO backend_app;

COMMENT ON FUNCTION community.refresh_leaderboard_snapshot(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Regenerates one leaderboard snapshot (metric_version, window_key) at a server hour. Counts only countable facts of opted-in linked accounts, excludes example.com demo accounts, orders tie-neutrally, and atomically replaces the snapshot entries. Returns the snapshot_id.';
