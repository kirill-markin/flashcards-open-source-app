-- Migration status: Historical / partially superseded.
-- Introduces: the neutral otp_send_events naming that replaced the original agent-specific send-event table name.
-- Current guidance: this rename remains part of the current auth schema lineage, but the broader runtime model was refined later.
-- Replaces or corrects: db/migrations/0014_agent_api_keys.sql.
-- Replaced or refined by: db/migrations/0024_auth_runtime_roles.sql.
-- See also: docs/architecture.md.
-- Rename shared OTP send limiter storage to neutral names.

ALTER TABLE IF EXISTS auth.agent_otp_send_events
  RENAME TO otp_send_events;

ALTER INDEX IF EXISTS auth.idx_agent_otp_send_events_email_created
  RENAME TO idx_otp_send_events_email_created;

ALTER INDEX IF EXISTS auth.idx_agent_otp_send_events_ip_created
  RENAME TO idx_otp_send_events_ip_created;
