-- Migration status: Current / canonical.
-- Introduces: a narrow current-viewer friend label read helper for the Progress leaderboard.

CREATE OR REPLACE FUNCTION community.read_current_user_leaderboard_friend_labels()
RETURNS TABLE (
  friend_public_profile_id UUID,
  friend_display_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    friendships.friend_public_profile_id,
    friendships.friend_display_name
  FROM community.friendships AS friendships
  INNER JOIN community.public_profiles AS friend_profiles
    ON friend_profiles.public_profile_id = friendships.friend_public_profile_id
  WHERE friendships.viewer_user_id = security.current_user_id()
    AND friend_profiles.leaderboard_participation_enabled = TRUE
  ORDER BY friendships.friend_public_profile_id;
$$;

REVOKE ALL ON FUNCTION community.read_current_user_leaderboard_friend_labels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION community.read_current_user_leaderboard_friend_labels() TO backend_app;

COMMENT ON FUNCTION community.read_current_user_leaderboard_friend_labels() IS
  'Returns current viewer friend public profile ids and viewer-private friend labels for friends that currently participate in the leaderboard.';
