CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_upgrade_history_source_session_unique
  ON auth.guest_upgrade_history(source_guest_session_id);
