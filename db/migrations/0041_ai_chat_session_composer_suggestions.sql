-- Append-only AI chat composer suggestion generations with a session-level active pointer.

ALTER TABLE ai.chat_sessions
  ADD COLUMN IF NOT EXISTS composer_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS ai.chat_composer_suggestion_generations (
  generation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai.chat_sessions(session_id) ON DELETE CASCADE,
  assistant_item_id UUID REFERENCES ai.chat_items(item_id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('initial', 'assistant_follow_up')),
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidated_at TIMESTAMPTZ,
  invalidated_reason TEXT CHECK (
    invalidated_reason IS NULL
    OR invalidated_reason IN (
      'run_started',
      'run_cancelled',
      'run_failed',
      'run_interrupted',
      'new_chat_rollover'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (invalidated_at IS NULL AND invalidated_reason IS NULL)
    OR (invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_composer_suggestion_generations_session_created
  ON ai.chat_composer_suggestion_generations(session_id, created_at DESC, generation_id DESC);

ALTER TABLE ai.chat_sessions
  ADD COLUMN IF NOT EXISTS active_composer_suggestion_generation_id UUID
  REFERENCES ai.chat_composer_suggestion_generations(generation_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_active_composer_suggestion_generation
  ON ai.chat_sessions(active_composer_suggestion_generation_id)
  WHERE active_composer_suggestion_generation_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai.chat_composer_suggestion_generations TO backend_app;

ALTER TABLE ai.chat_composer_suggestion_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_composer_suggestion_generations_scoped_select_runtime ON ai.chat_composer_suggestion_generations;
DROP POLICY IF EXISTS chat_composer_suggestion_generations_scoped_insert_runtime ON ai.chat_composer_suggestion_generations;
DROP POLICY IF EXISTS chat_composer_suggestion_generations_scoped_update_runtime ON ai.chat_composer_suggestion_generations;
DROP POLICY IF EXISTS chat_composer_suggestion_generations_scoped_delete_runtime ON ai.chat_composer_suggestion_generations;

CREATE POLICY chat_composer_suggestion_generations_scoped_select_runtime
  ON ai.chat_composer_suggestion_generations
  FOR SELECT
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = ai.chat_composer_suggestion_generations.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_composer_suggestion_generations_scoped_insert_runtime
  ON ai.chat_composer_suggestion_generations
  FOR INSERT
  TO backend_app
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = ai.chat_composer_suggestion_generations.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_composer_suggestion_generations_scoped_update_runtime
  ON ai.chat_composer_suggestion_generations
  FOR UPDATE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = ai.chat_composer_suggestion_generations.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = ai.chat_composer_suggestion_generations.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

CREATE POLICY chat_composer_suggestion_generations_scoped_delete_runtime
  ON ai.chat_composer_suggestion_generations
  FOR DELETE
  TO backend_app
  USING (
    EXISTS (
      SELECT 1
      FROM ai.chat_sessions AS chat_sessions
      WHERE chat_sessions.session_id = ai.chat_composer_suggestion_generations.session_id
        AND chat_sessions.user_id = security.current_user_id()
        AND security.current_workspace_access_allowed(chat_sessions.workspace_id)
    )
  );

WITH sessions_with_persisted_suggestions AS (
  SELECT
    chat_sessions.session_id,
    chat_sessions.updated_at,
    COALESCE(
      NULLIF(chat_sessions.composer_suggestions -> 0 ->> 'source', ''),
      'assistant_follow_up'
    ) AS source,
    NULLIF(chat_sessions.composer_suggestions -> 0 ->> 'assistantItemId', '') AS assistant_item_id_text,
    chat_sessions.composer_suggestions AS suggestions
  FROM ai.chat_sessions AS chat_sessions
  WHERE chat_sessions.active_composer_suggestion_generation_id IS NULL
    AND jsonb_typeof(chat_sessions.composer_suggestions) = 'array'
    AND jsonb_array_length(chat_sessions.composer_suggestions) > 0
),
inserted_generations AS (
  INSERT INTO ai.chat_composer_suggestion_generations (
    session_id,
    assistant_item_id,
    source,
    suggestions,
    created_at
  )
  SELECT
    session_id,
    assistant_item_id_text::uuid,
    source,
    suggestions,
    updated_at
  FROM sessions_with_persisted_suggestions
  RETURNING generation_id, session_id
)
UPDATE ai.chat_sessions AS chat_sessions
SET active_composer_suggestion_generation_id = inserted_generations.generation_id
FROM inserted_generations
WHERE chat_sessions.session_id = inserted_generations.session_id;

WITH initial_suggestions AS (
  SELECT jsonb_build_array(
    jsonb_build_object(
      'id', 'initial-1',
      'text', 'Help me create a card',
      'source', 'initial',
      'assistantItemId', NULL
    ),
    jsonb_build_object(
      'id', 'initial-2',
      'text', 'What should I study next?',
      'source', 'initial',
      'assistantItemId', NULL
    )
  ) AS suggestions
),
empty_sessions AS (
  SELECT
    chat_sessions.session_id,
    chat_sessions.created_at
  FROM ai.chat_sessions AS chat_sessions
  WHERE chat_sessions.active_composer_suggestion_generation_id IS NULL
    AND (
      chat_sessions.composer_suggestions IS NULL
      OR (
        jsonb_typeof(chat_sessions.composer_suggestions) = 'array'
        AND jsonb_array_length(chat_sessions.composer_suggestions) = 0
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ai.chat_items AS chat_items
      WHERE chat_items.session_id = chat_sessions.session_id
        AND chat_items.item_kind = 'message'
    )
),
inserted_initial_generations AS (
  INSERT INTO ai.chat_composer_suggestion_generations (
    session_id,
    assistant_item_id,
    source,
    suggestions,
    created_at
  )
  SELECT
    empty_sessions.session_id,
    NULL,
    'initial',
    initial_suggestions.suggestions,
    empty_sessions.created_at
  FROM empty_sessions
  CROSS JOIN initial_suggestions
  RETURNING generation_id, session_id
)
UPDATE ai.chat_sessions AS chat_sessions
SET active_composer_suggestion_generation_id = inserted_initial_generations.generation_id
FROM inserted_initial_generations
WHERE chat_sessions.session_id = inserted_initial_generations.session_id;
