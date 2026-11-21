-- Schemas touched/read explicitly: ai.
-- An absent credential on older guest runs provides no instruction access on replay.
ALTER TABLE ai.chat_runs
  ADD COLUMN initiating_guest_session_id UUID,
  ADD CONSTRAINT chat_runs_guest_session_requires_guest
    CHECK (initiating_guest_session_id IS NULL OR NOT initiating_auth_is_signed_in);
