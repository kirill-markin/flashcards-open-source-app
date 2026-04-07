ALTER TABLE sync.workspace_replicas
  DROP CONSTRAINT IF EXISTS workspace_replicas_actor_kind_check;

ALTER TABLE sync.workspace_replicas
  ADD CONSTRAINT workspace_replicas_actor_kind_check
  CHECK (
    actor_kind IN (
      'client_installation',
      'workspace_seed',
      'workspace_reset',
      'agent_connection',
      'ai_chat'
    )
  );
