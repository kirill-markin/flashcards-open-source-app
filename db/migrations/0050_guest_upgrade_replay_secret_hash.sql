-- Migration status: Current / canonical.
-- Introduces: durable guest-upgrade replay lookup after guest session cleanup.

ALTER TABLE auth.guest_upgrade_history
  ADD COLUMN IF NOT EXISTS source_guest_session_secret_hash TEXT;

UPDATE auth.guest_upgrade_history AS history
SET source_guest_session_secret_hash = sessions.session_secret_hash
FROM auth.guest_sessions AS sessions
WHERE history.source_guest_session_id = sessions.session_id
  AND history.source_guest_session_secret_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_upgrade_history_source_session_secret_hash_unique
  ON auth.guest_upgrade_history(source_guest_session_secret_hash)
  WHERE source_guest_session_secret_hash IS NOT NULL;

COMMENT ON COLUMN auth.guest_upgrade_history.source_guest_session_secret_hash IS
  'SHA-256 hash of the guest session token used only to replay a committed upgrade after auth.guest_sessions is removed by guest user cleanup. The raw guest token is never stored.';
