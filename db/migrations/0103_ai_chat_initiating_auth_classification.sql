ALTER TABLE ai.chat_runs
  ADD COLUMN initiating_auth_is_signed_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ai.chat_runs.initiating_auth_is_signed_in IS
  'Immutable classification of the transport that initiated the run. Existing rows default to guest-ineligible.';
