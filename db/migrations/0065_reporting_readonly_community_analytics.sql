-- Migration status: Current / canonical.
-- Introduces: read-only reporting access to community analytics tables.
-- Current guidance: reporting_readonly may inspect community participation,
--   leaderboard facts, friend invitation audit fields, and directed friendship
--   rows for operator analytics. Friend invite token hashes remain hidden.

GRANT USAGE ON SCHEMA community TO reporting_readonly;

REVOKE SELECT ON ALL TABLES IN SCHEMA community FROM reporting_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA community
  REVOKE SELECT ON TABLES FROM reporting_readonly;

GRANT SELECT (
  user_id,
  public_profile_id,
  leaderboard_participation_enabled,
  created_at,
  updated_at
) ON TABLE community.public_profiles TO reporting_readonly;

GRANT SELECT (
  review_event_id,
  metric_version,
  public_profile_id,
  reviewed_by_user_id,
  rating,
  reviewed_at_client,
  reviewed_at_server,
  is_countable,
  exclusion_reason,
  created_at
) ON TABLE community.public_review_activity_facts TO reporting_readonly;

GRANT SELECT (
  snapshot_id,
  metric_version,
  window_key,
  generated_at,
  as_of_server_hour
) ON TABLE community.leaderboard_snapshots TO reporting_readonly;

GRANT SELECT (
  snapshot_id,
  public_profile_id,
  qualified_review_count,
  base_sort_position
) ON TABLE community.leaderboard_snapshot_entries TO reporting_readonly;

GRANT SELECT (
  friend_invitation_id,
  inviter_user_id,
  created_at,
  expires_at,
  accepted_at,
  accepted_by_user_id
) ON TABLE community.friend_invitations TO reporting_readonly;

GRANT SELECT (
  viewer_user_id,
  friend_user_id,
  friend_public_profile_id,
  created_from_invitation_id,
  created_at
) ON TABLE community.friendships TO reporting_readonly;

DROP POLICY IF EXISTS public_profiles_reporting_readonly_select ON community.public_profiles;
CREATE POLICY public_profiles_reporting_readonly_select
  ON community.public_profiles
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS public_review_activity_facts_reporting_readonly_select ON community.public_review_activity_facts;
CREATE POLICY public_review_activity_facts_reporting_readonly_select
  ON community.public_review_activity_facts
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS leaderboard_snapshots_reporting_readonly_select ON community.leaderboard_snapshots;
CREATE POLICY leaderboard_snapshots_reporting_readonly_select
  ON community.leaderboard_snapshots
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS leaderboard_snapshot_entries_reporting_readonly_select ON community.leaderboard_snapshot_entries;
CREATE POLICY leaderboard_snapshot_entries_reporting_readonly_select
  ON community.leaderboard_snapshot_entries
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS friend_invitations_reporting_readonly_select ON community.friend_invitations;
CREATE POLICY friend_invitations_reporting_readonly_select
  ON community.friend_invitations
  FOR SELECT
  TO reporting_readonly
  USING (true);

DROP POLICY IF EXISTS friendships_reporting_readonly_select ON community.friendships;
CREATE POLICY friendships_reporting_readonly_select
  ON community.friendships
  FOR SELECT
  TO reporting_readonly
  USING (true);
