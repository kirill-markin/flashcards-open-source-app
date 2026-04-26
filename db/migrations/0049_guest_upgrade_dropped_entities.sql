-- Migration status: Current / canonical.
-- Introduces: durable guest-upgrade dropped-entity replay metadata.

ALTER TABLE auth.guest_upgrade_history
  ADD COLUMN IF NOT EXISTS dropped_entities JSONB;

COMMENT ON COLUMN auth.guest_upgrade_history.dropped_entities IS
  'Optional replay/audit/reconciliation metadata listing exceptional guest-merge omissions, including entities intentionally dropped after conflicts, dependent review events skipped after card drops, and review events deduplicated to an existing target client event.';
