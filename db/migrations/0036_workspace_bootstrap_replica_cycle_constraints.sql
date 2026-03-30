-- Migration status: Current / additive.
-- Introduces: deferred validation for the intentional workspace/bootstrap-replica FK cycle.
-- Current guidance: workspace creation writes both org.workspaces and sync.workspace_replicas in one transaction, so both sides of that cycle must validate at commit time, not statement time.

ALTER TABLE sync.workspace_replicas
  DROP CONSTRAINT IF EXISTS workspace_replicas_workspace_id_fkey;

ALTER TABLE sync.workspace_replicas
  ADD CONSTRAINT workspace_replicas_workspace_id_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES org.workspaces(workspace_id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE org.workspaces
  DROP CONSTRAINT IF EXISTS fk_workspaces_fsrs_last_modified_replica;

ALTER TABLE org.workspaces
  ADD CONSTRAINT fk_workspaces_fsrs_last_modified_replica
  FOREIGN KEY (fsrs_last_modified_by_replica_id)
  REFERENCES sync.workspace_replicas(replica_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
