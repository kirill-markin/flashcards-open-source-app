-- Migration status: Current / additive.
-- Introduces: ai.chat_runs.live_attach_client_id and ai.chat_runs.live_attach_seq, the record of
--   which live SSE attach currently owns a run. A chat-live connection holds a whole Lambda
--   container for its lifetime, and the Function URL never reports that a browser or app went away,
--   so a reconnecting client instance used to leave every earlier container attached until the run
--   finished and could exhaust the reservation on its own. With these columns each identified
--   attach claims the run, and an earlier attach from the same client instance ends as soon as a
--   later one claims it.
-- Schemas touched/read explicitly: ai.

ALTER TABLE ai.chat_runs
  ADD COLUMN IF NOT EXISTS live_attach_client_id TEXT,
  ADD COLUMN IF NOT EXISTS live_attach_seq BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN ai.chat_runs.live_attach_client_id IS
  'Client instance holding the newest live SSE attach on this run, a UUID from the '
  'X-Chat-Live-Client-Id request header and only ever compared, never parsed. It names a client '
  'runtime, not a request and not a device. NULL means no attach ever claimed this run, either '
  'because the client sent no X-Chat-Live-Client-Id or because the value it sent was dropped on '
  'read; neither is ever superseded.';

COMMENT ON COLUMN ai.chat_runs.live_attach_seq IS
  'Counter incremented by each identified live SSE attach on this run. An attach keeps the value '
  'its own claim returned and ends once the run carries the same live_attach_client_id at a '
  'strictly greater value. Two different client instances on one run never supersede each other, '
  'because that would only make them reconnect against one another.';
