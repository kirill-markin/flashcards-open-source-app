-- Idempotent official chat-turn starts keyed by client request id per session.

DO $$
DECLARE
  duplicate_group_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_group_count
  FROM (
    SELECT session_id, request_id
    FROM ai.chat_runs
    GROUP BY session_id, request_id
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  IF duplicate_group_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create ai.chat_runs(session_id, request_id) unique index because % duplicate request-id group(s) already exist. Clean duplicate ai.chat_runs rows first.',
      duplicate_group_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_chat_runs_session_request_id
  ON ai.chat_runs(session_id, request_id);
