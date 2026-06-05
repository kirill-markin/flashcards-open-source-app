-- Current guidance: backend chat cost policy checks must stay cheap enough to run per chat turn.
-- The policy reads existing chat/review facts only; these indexes support the rolling 7-day review aggregate.

ALTER TABLE ai.chat_runs
  ADD COLUMN IF NOT EXISTS ai_cost_mode TEXT NOT NULL DEFAULT 'normal' CHECK (ai_cost_mode IN ('normal', 'low_cost')),
  ADD COLUMN IF NOT EXISTS chat_turns_last_7d INTEGER NOT NULL DEFAULT 0 CHECK (chat_turns_last_7d >= 0),
  ADD COLUMN IF NOT EXISTS good_review_days_last_7d INTEGER NOT NULL DEFAULT 0 CHECK (good_review_days_last_7d >= 0);

CREATE INDEX IF NOT EXISTS idx_review_events_workspace_replica_server_time
  ON content.review_events(workspace_id, replica_id, reviewed_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_replicas_workspace_user_client
  ON sync.workspace_replicas(workspace_id, user_id, replica_id)
  WHERE actor_kind = 'client_installation';

COMMENT ON COLUMN ai.chat_runs.ai_cost_mode IS
  'Backend chat cost policy mode selected when the run was prepared.';

COMMENT ON COLUMN ai.chat_runs.chat_turns_last_7d IS
  'Backend chat cost policy chat-turn count snapshot selected when the run was prepared.';

COMMENT ON COLUMN ai.chat_runs.good_review_days_last_7d IS
  'Backend chat cost policy good-review-day count snapshot selected when the run was prepared.';

COMMENT ON INDEX content.idx_review_events_workspace_replica_server_time IS
  'Supports backend chat cost policy review aggregates by workspace, replica, and server review time.';

COMMENT ON INDEX sync.idx_workspace_replicas_workspace_user_client IS
  'Supports backend chat cost policy filtering for current user client-installation review actors.';
