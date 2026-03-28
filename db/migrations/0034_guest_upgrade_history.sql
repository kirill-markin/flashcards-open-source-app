-- Durable audit trail for destructive guest-to-real account merges.

CREATE TABLE IF NOT EXISTS auth.guest_upgrade_history (
  upgrade_id UUID PRIMARY KEY,
  source_guest_user_id TEXT NOT NULL,
  source_guest_workspace_id UUID NOT NULL,
  source_guest_session_id UUID NOT NULL,
  target_subject_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_workspace_id UUID NOT NULL,
  selection_type TEXT NOT NULL CHECK (selection_type IN ('existing', 'create_new')),
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_upgrade_history_source_user
  ON auth.guest_upgrade_history(source_guest_user_id);

CREATE INDEX IF NOT EXISTS idx_guest_upgrade_history_target_user_merged
  ON auth.guest_upgrade_history(target_user_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_upgrade_history_source_workspace
  ON auth.guest_upgrade_history(source_guest_workspace_id);

CREATE TABLE IF NOT EXISTS auth.guest_device_aliases (
  source_guest_device_id UUID PRIMARY KEY,
  upgrade_id UUID NOT NULL REFERENCES auth.guest_upgrade_history(upgrade_id) ON DELETE CASCADE,
  target_device_id UUID NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_device_aliases_target_device
  ON auth.guest_device_aliases(target_device_id);

GRANT SELECT, INSERT ON auth.guest_upgrade_history TO backend_app;
GRANT SELECT, INSERT ON auth.guest_device_aliases TO backend_app;

COMMENT ON TABLE auth.guest_upgrade_history IS
  'Append-only audit trail for destructive guest-to-real account merges. Stores source and destination ids without live-row foreign keys so history survives guest cleanup.';

COMMENT ON COLUMN auth.guest_upgrade_history.upgrade_id IS
  'Stable identifier for one destructive guest upgrade merge.';

COMMENT ON COLUMN auth.guest_upgrade_history.source_guest_user_id IS
  'Deleted guest user id that used to own the pre-upgrade guest workspace.';

COMMENT ON COLUMN auth.guest_upgrade_history.source_guest_workspace_id IS
  'Deleted guest workspace id whose portable content was merged into the target workspace.';

COMMENT ON COLUMN auth.guest_upgrade_history.source_guest_session_id IS
  'Guest auth session id that initiated the destructive merge.';

COMMENT ON COLUMN auth.guest_upgrade_history.target_subject_user_id IS
  'Auth-provider subject from the human sign-in that completed the merge.';

COMMENT ON COLUMN auth.guest_upgrade_history.target_user_id IS
  'Current app-level user id that now owns the merged guest data.';

COMMENT ON COLUMN auth.guest_upgrade_history.target_workspace_id IS
  'Current workspace id that now contains the merged guest data.';

COMMENT ON COLUMN auth.guest_upgrade_history.selection_type IS
  'How the destination workspace was chosen during merge: reuse an existing workspace or create a new one.';

COMMENT ON COLUMN auth.guest_upgrade_history.merged_at IS
  'Server timestamp when the destructive guest merge was committed.';

COMMENT ON TABLE auth.guest_device_aliases IS
  'Append-only lookup table from deleted guest device ids to their recreated target device ids after a destructive guest merge.';

COMMENT ON COLUMN auth.guest_device_aliases.source_guest_device_id IS
  'Deleted guest device id that existed before the merge.';

COMMENT ON COLUMN auth.guest_device_aliases.upgrade_id IS
  'Owning guest upgrade history row for this device alias.';

COMMENT ON COLUMN auth.guest_device_aliases.target_device_id IS
  'Replacement device id recreated in the destination workspace during merge.';

COMMENT ON COLUMN auth.guest_device_aliases.merged_at IS
  'Server timestamp when this device alias row was recorded.';
