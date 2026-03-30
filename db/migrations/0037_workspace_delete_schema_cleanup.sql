-- Migration status: Current / additive.
-- Introduces: schema cleanup for lingering sync.devices references plus deferred replica FK semantics for workspace deletion.
-- Current guidance: workspace deletion intentionally removes the workspace root and replica-linked history rows in one transaction, so replica foreign keys must use deferred NO ACTION semantics instead of RESTRICT.

DO $$
DECLARE
  legacy_constraint RECORD;
BEGIN
  IF to_regclass('sync.devices') IS NOT NULL THEN
    FOR legacy_constraint IN
      SELECT conrelid::regclass AS relation_name, conname
      FROM pg_constraint
      WHERE contype = 'f'
        AND confrelid = 'sync.devices'::regclass
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', legacy_constraint.relation_name, legacy_constraint.conname);
    END LOOP;
  END IF;
END
$$;

ALTER TABLE content.cards
  DROP CONSTRAINT IF EXISTS fk_cards_last_modified_replica;

ALTER TABLE content.decks
  DROP CONSTRAINT IF EXISTS fk_decks_last_modified_replica;

ALTER TABLE org.workspaces
  DROP CONSTRAINT IF EXISTS fk_workspaces_fsrs_last_modified_replica;

ALTER TABLE content.review_events
  DROP CONSTRAINT IF EXISTS fk_review_events_replica;

ALTER TABLE sync.hot_changes
  DROP CONSTRAINT IF EXISTS fk_hot_changes_replica;

ALTER TABLE sync.applied_operations_current
  DROP CONSTRAINT IF EXISTS fk_applied_operations_current_replica;

ALTER TABLE content.cards
  DROP COLUMN IF EXISTS last_modified_by_device_id;

ALTER TABLE content.decks
  DROP COLUMN IF EXISTS last_modified_by_device_id;

ALTER TABLE org.workspaces
  DROP COLUMN IF EXISTS fsrs_last_modified_by_device_id;

ALTER TABLE content.review_events
  DROP COLUMN IF EXISTS device_id;

ALTER TABLE sync.hot_changes
  DROP COLUMN IF EXISTS device_id;

ALTER TABLE sync.applied_operations_current
  DROP COLUMN IF EXISTS device_id;

DROP TABLE IF EXISTS sync.devices;

ALTER TABLE content.cards
  ADD CONSTRAINT fk_cards_last_modified_replica
  FOREIGN KEY (last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE content.decks
  ADD CONSTRAINT fk_decks_last_modified_replica
  FOREIGN KEY (last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE org.workspaces
  ADD CONSTRAINT fk_workspaces_fsrs_last_modified_replica
  FOREIGN KEY (fsrs_last_modified_by_replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE content.review_events
  ADD CONSTRAINT fk_review_events_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE sync.hot_changes
  ADD CONSTRAINT fk_hot_changes_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE sync.applied_operations_current
  ADD CONSTRAINT fk_applied_operations_current_replica
  FOREIGN KEY (replica_id) REFERENCES sync.workspace_replicas(replica_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
