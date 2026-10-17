-- Schemas touched/read explicitly: community.
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshot_entries_profile
  ON community.leaderboard_snapshot_entries(public_profile_id);

CREATE INDEX IF NOT EXISTS idx_streak_leaderboard_snapshot_entries_profile
  ON community.streak_leaderboard_snapshot_entries(public_profile_id);
